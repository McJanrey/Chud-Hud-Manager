"use strict";
/* Photo editor shown before an image is uploaded (player photos, logos, sponsors, ads): pick a frame shape, zoom, drag the
   picture to place it, or trim the empty transparent edges off a logo. The result is drawn on a canvas and handed back as a
   file, so the upload stays the same. ChudCrop.open(file, shape) resolves to a File, the original file ("Use original"),
   or null (cancelled). shape: "portrait" (3:4), "square", "wide" (16:9) or "free" (the picture's own shape). */
(function () {
  const SHAPES = { portrait: ["Portrait 3:4", 3 / 4], square: ["Square", 1], wide: ["Wide 16:9", 16 / 9], free: ["Original shape", 0] };
  const BOX = 440, MAX_OUT = 1600;
  let st = null;

  function load(file) {
    return new Promise((ok, bad) => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => ok({ im, u }); im.onerror = () => { URL.revokeObjectURL(u); bad(new Error("unreadable")); }; im.src = u; });
  }
  // the part of the picture that is not see-through (read on a small copy, so a 4000 px logo is still quick)
  function opaqueBox(im) {
    const k = Math.min(1, 800 / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.drawImage(im, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data; let l = w, t = h, r = -1, b = -1;
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (d[(y * w + i) * 4 + 3] > 8) { if (i < l) l = i; if (i > r) r = i; if (y < t) t = y; if (y > b) b = y; }
    if (r < 0) return null;
    return { x: l / k, y: t / k, w: (r - l + 1) / k, h: (b - t + 1) / k };
  }
  // frame size on screen for the chosen shape
  function frame() {
    const a = SHAPES[st.shape][1] || (st.src.w / st.src.h);
    return a >= 1 ? { w: BOX, h: Math.round(BOX / a) } : { w: Math.round(BOX * a), h: BOX };
  }
  // zoom and position so the source area fills the frame (cover) or fits inside it (contain)
  function fit(cover) {
    const f = frame(), s = cover ? Math.max(f.w / st.src.w, f.h / st.src.h) : Math.min(f.w / st.src.w, f.h / st.src.h);
    st.s = st.s0 = s; st.cx = st.src.x + st.src.w / 2; st.cy = st.src.y + st.src.h / 2;
  }
  function draw() {
    const f = frame(), c = st.el.querySelector("canvas"), x = c.getContext("2d");
    c.width = f.w; c.height = f.h; x.imageSmoothingQuality = "high"; x.clearRect(0, 0, f.w, f.h);
    x.drawImage(st.im, f.w / 2 - st.cx * st.s, f.h / 2 - st.cy * st.s, st.im.naturalWidth * st.s, st.im.naturalHeight * st.s);
    const z = st.el.querySelector("[data-c=zoom]"); z.value = String(Math.round((st.s / st.s0) * 100));
    st.el.querySelector("[data-c=zv]").textContent = z.value + "%";
    const o = outSize(); st.el.querySelector("[data-c=out]").textContent = `Saved at ${o.w} × ${o.h}`;
    st.el.querySelectorAll("[data-shape]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.shape === st.shape)));
  }
  // the saved picture keeps the photo's real detail (one picture pixel per saved pixel), up to MAX_OUT on the long side
  function outSize() {
    const f = frame(); let k = 1 / st.s; const big = Math.max(f.w, f.h) * k; if (big > MAX_OUT) k *= MAX_OUT / big;
    return { w: Math.max(1, Math.round(f.w * k)), h: Math.max(1, Math.round(f.h * k)), k };
  }
  function save() {
    const f = frame(), o = outSize(), c = document.createElement("canvas"); c.width = o.w; c.height = o.h;
    const x = c.getContext("2d"), s = st.s * (o.w / f.w); x.imageSmoothingQuality = "high";
    x.drawImage(st.im, o.w / 2 - st.cx * s, o.h / 2 - st.cy * s, st.im.naturalWidth * s, st.im.naturalHeight * s);
    const jpg = st.file.type === "image/jpeg", type = jpg ? "image/jpeg" : "image/png";
    c.toBlob(b => finish(b ? new File([b], (st.file.name || "image").replace(/\.\w+$/, "") + (jpg ? ".jpg" : ".png"), { type }) : null), type, 0.92);
  }
  function finish(v) { if (!st) return; const s = st; st = null; s.el.remove(); URL.revokeObjectURL(s.u); document.removeEventListener("keydown", onKey, true); s.done(v); }
  function onKey(e) { if (!st) return; if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); } else if (e.key === "Enter" && !/INPUT|SELECT/.test(e.target.tagName)) { e.preventDefault(); save(); } }
  function zoomTo(s) { st.s = Math.max(st.s0 * 0.1, Math.min(st.s0 * 8, s)); draw(); }

  async function open(file, shape) {
    if (st) finish(null);
    let L; try { L = await load(file); } catch { return file; } // not something the browser can draw: upload it as it is
    return new Promise(done => {
      const im = L.im;
      st = { file, im, u: L.u, done, shape: SHAPES[shape] ? shape : "free", src: { x: 0, y: 0, w: im.naturalWidth, h: im.naturalHeight }, trimmed: false };
      const el = st.el = document.createElement("div");
      el.className = "scrim crop-scrim";
      el.innerHTML = `<div class="dialog crop-dlg" role="dialog" aria-modal="true" aria-labelledby="cropT">
        <header><h2 id="cropT">Resize and crop</h2><p class="muted">Drag the picture to move it, scroll or use the slider to zoom.</p></header>
        <section><div class="crop-stage"><canvas aria-label="Preview"></canvas></div>
          <div class="seg crop-shapes">${Object.entries(SHAPES).map(([k, v]) => `<button type="button" data-shape="${k}">${v[0]}</button>`).join("")}</div>
          <div class="row c nowrap" style="gap:10px"><span class="note">Zoom</span><input type="range" data-c="zoom" min="10" max="800" step="1" style="flex:1" aria-label="Zoom"><b data-c="zv" class="mono" style="width:52px;text-align:right"></b></div>
          <div class="row c" style="gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-c="trim">Trim empty edges</button><button class="btn" type="button" data-c="fill">Fill frame</button><button class="btn" type="button" data-c="fitin">Fit whole picture</button><span class="grow"></span><span class="note" data-c="out"></span></div></section>
        <footer><button class="btn ghost" type="button" data-c="orig">Use original</button><span class="grow"></span><button class="btn" type="button" data-c="cancel">Cancel</button><button class="btn primary" type="button" data-c="save">Save</button></footer></div>`;
      document.body.appendChild(el);
      fit(st.shape !== "free"); draw();
      const cv = el.querySelector("canvas");
      let drag = null;
      cv.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, cx: st.cx, cy: st.cy }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener("pointermove", e => { if (!drag) return; st.cx = drag.cx - (e.clientX - drag.x) / st.s; st.cy = drag.cy - (e.clientY - drag.y) / st.s; draw(); });
      cv.addEventListener("pointerup", () => { drag = null; });
      cv.addEventListener("wheel", e => { e.preventDefault(); zoomTo(st.s * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
      el.querySelector("[data-c=zoom]").addEventListener("input", e => zoomTo(st.s0 * (+e.target.value / 100)));
      el.addEventListener("click", e => {
        if (e.target === el) return finish(null);
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.shape) { st.shape = b.dataset.shape; fit(st.shape !== "free"); draw(); return; }
        const c = b.dataset.c;
        if (c === "trim") { const bb = opaqueBox(im); if (bb) { st.src = bb; st.trimmed = true; fit(st.shape !== "free"); draw(); } }
        else if (c === "fill") { fit(true); draw(); } else if (c === "fitin") { fit(false); draw(); }
        else if (c === "orig") finish(file); else if (c === "cancel") finish(null); else if (c === "save") save();
      });
      document.addEventListener("keydown", onKey, true);
      el.querySelector("[data-c=save]").focus();
    });
  }
  window.ChudCrop = { open, opaqueBox };
})();
