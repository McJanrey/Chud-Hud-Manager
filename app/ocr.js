// Screen OCR for games without a live data feed (Call of Duty, Overwatch, Deadlock, Fortnite, ...).
// Captures a screen or window, crops the regions you drew, reads them with Tesseract and sends the
// results to the HUD as Stats API–shaped messages. Runs in the Electron main process.
"use strict";
const { desktopCapturer, screen, nativeImage } = require("electron");
const path = require("path");

const state = { running: false, error: "", readings: {}, lastRead: 0, cycleMs: 0 };
let cfg = {}, emit = null, timer = null, worker = null, workerLoading = null, stable = {};

/* ------------------------------------------------------------- capture */
const kindOf = id => (String(id || "").startsWith("screen:") ? "screen" : "window");

async function findSource(id, name, size) {
  const kind = id ? kindOf(id) : null;
  const srcs = await desktopCapturer.getSources({ types: kind ? [kind] : ["screen", "window"], thumbnailSize: size, fetchWindowIcons: false });
  return srcs.find(s => s.id === id) || (name && (srcs.find(s => s.name === name) || srcs.find(s => s.name.includes(name)))) || null;
}
function captureSize() {
  const d = screen.getPrimaryDisplay();
  return { width: Math.min(3840, Math.round(d.size.width * d.scaleFactor)), height: Math.min(2160, Math.round(d.size.height * d.scaleFactor)) };
}
async function grab(id, name) {
  const s = await findSource(id, name, captureSize());
  if (!s) throw new Error("Couldn't find the selected screen or window. Pick it again in the OCR tracker.");
  const img = s.thumbnail;
  if (img.isEmpty()) throw new Error("The capture came back empty. Games in exclusive fullscreen can't be captured: switch the game to borderless windowed.");
  return { img, id: s.id, name: s.name };
}
let grabFn = grab; // tests can swap the capture step
async function frame(id, name) {
  const { img } = await grab(id, name);
  const sz = img.getSize(), k = Math.min(1, 1280 / sz.width);
  return (k < 1 ? img.resize({ width: Math.round(sz.width * k), height: Math.round(sz.height * k) }) : img).toJPEG(80);
}
// A picture of one game window, found by (part of) its title, for the HUD preview. Only that window is captured.
async function frameByName(fragments) {
  const srcs = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 1280, height: 720 }, fetchWindowIcons: false });
  const low = fragments.map(f => f.toLowerCase());
  const s = srcs.find(x => x.name && !/saints hud/i.test(x.name) && low.some(f => x.name.toLowerCase().includes(f)));
  if (!s || s.thumbnail.isEmpty()) throw new Error("The game window wasn't found.");
  return s.thumbnail.toJPEG(75);
}
async function listSources() {
  const srcs = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 256, height: 144 }, fetchWindowIcons: false });
  return srcs.filter(s => s.name && !s.thumbnail.isEmpty()).map(s => ({ id: s.id, name: s.name, kind: kindOf(s.id), thumb: s.thumbnail.toDataURL() }));
}

/* ---------------------------------------------------------- preprocess */
// Crop, enlarge, binarize (Otsu) and put dark text on a white background, which Tesseract reads best.
// `pixel` is for blocky game fonts (Minecraft): threshold at the original size, then enlarge by whole pixels
// so the letters keep their hard edges instead of being smoothed.
function prepare(img, r, polarity, pixel, thickenOverride) {
  const full = img.getSize();
  const x = Math.max(0, Math.round(r.x * full.width)), y = Math.max(0, Math.round(r.y * full.height));
  const w = Math.max(4, Math.min(full.width - x, Math.round(r.w * full.width))), h = Math.max(4, Math.min(full.height - y, Math.round(r.h * full.height)));
  let c = img.crop({ x, y, width: w, height: h });
  let k = Math.max(1, Math.min(8, Math.ceil(72 / h)));
  if (!pixel && k > 1) { c = c.resize({ width: w * k, height: h * k, quality: "best" }); k = 1; }
  const S = pixel ? k : 1;
  const { width, height } = c.getSize(), bmp = c.toBitmap(), n = width * height;
  const gray = new Uint8Array(n), hist = new Array(256).fill(0);
  for (let i = 0, p = 0; i < n; i++, p += 4) { const g = (bmp[p] * 29 + bmp[p + 1] * 150 + bmp[p + 2] * 77) >> 8; gray[i] = g; hist[g]++; }
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let wB = 0, sumB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  let bright = 0; for (let i = 0; i < n; i++) if (gray[i] > thr) bright++;
  const textIsLight = polarity === "light" ? true : polarity === "dark" ? false : bright < n / 2; // text is the minority class
  const pad = 10, W = width * S + pad * 2, H = height * S + pad * 2, out = Buffer.alloc(W * H * 4, 255);
  let ink = new Uint8Array(W * H);
  for (let yy = 0; yy < height * S; yy++) for (let xx = 0; xx < width * S; xx++) {
    const isLight = gray[((yy / S) | 0) * width + ((xx / S) | 0)] > thr;
    ink[(yy + pad) * W + xx + pad] = (textIsLight ? isLight : !isLight) ? 1 : 0;
  }
  // Blocky fonts have hair-thin strokes that the text reader misses; thicken them a little.
  const iters = thickenOverride != null ? thickenOverride : pixel ? 1 : 0;
  for (let it = 0; it < iters; it++) {
    const nx = new Uint8Array(ink.length);
    for (let yy = 1; yy < H - 1; yy++) for (let xx = 1; xx < W - 1; xx++) { const o = yy * W + xx;
      nx[o] = ink[o] | ink[o - 1] | ink[o + 1] | ink[o - W] | ink[o + W] | ink[o - W - 1] | ink[o - W + 1] | ink[o + W - 1] | ink[o + W + 1]; }
    ink = nx;
  }
  for (let i = 0; i < W * H; i++) { const v = ink[i] ? 0 : 255, o = i * 4; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255; }
  return nativeImage.createFromBitmap(out, { width: W, height: H });
}

/* ----------------------------------------------------------- recognise */
// Inside Electron, Tesseract loads language data with fetch(), which needs an http URL. The English data
// ships inside the app, so a tiny loopback-only file server hands it over (no internet needed).
let langServer = null;
function serveLangData() {
  if (langServer) return langServer;
  const http = require("http"), fs = require("fs");
  const dir = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
  langServer = new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const f = path.join(dir, path.basename(req.url.split("?")[0]));
      fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": "application/gzip" }); res.end(buf); });
    });
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${srv.address().port}`));
    srv.unref();
  });
  return langServer;
}
async function getWorker() {
  if (worker) return worker;
  if (!workerLoading) workerLoading = (async () => {
    const { createWorker } = require("tesseract.js");
    worker = await createWorker("eng", 1, { langPath: await serveLangData(), gzip: true, cacheMethod: "none" });
    return worker;
  })().catch(e => { workerLoading = null; throw e; });
  return workerLoading;
}
const WHITELIST = { number: "0123456789", time: "0123456789:", text: "" };
async function recognise(png, type) {
  const w = await getWorker();
  await w.setParameters({ tessedit_char_whitelist: WHITELIST[type] ?? "", tessedit_pageseg_mode: "7" });
  const r = await w.recognize(png);
  return { raw: (r.data.text || "").replace(/\s+/g, " ").trim(), conf: Math.round(r.data.confidence || 0) };
}
function parse(raw, type) {
  if (type === "number") { const d = raw.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/\D/g, ""); return d ? parseInt(d, 10) : null; }
  if (type === "time") {
    const t = raw.replace(/[;.,\s]/g, ":").replace(/:+/g, ":").replace(/^:|:$/g, "");
    let m = t.match(/^(\d{1,2}):(\d{2})$/); if (m) return +m[1] * 60 + +m[2];
    m = t.match(/^(\d{1,2})(\d{2})$/); if (m && +m[2] < 60) return +m[1] * 60 + +m[2];
    m = t.match(/^(\d{1,3})$/); if (m) return +m[1];
    return null;
  }
  return raw || null;
}
// A reading is accepted once two reads in a row agree (or a clock keeps counting from its last value).
function accept(key, type, v) {
  const s = stable[key] || (stable[key] = { cand: null, n: 0, value: null });
  if (v == null) { s.n = 0; s.cand = null; return s.value; }
  if (type === "time" && s.value != null && Math.abs(v - s.value) <= 2) { s.value = v; s.cand = null; s.n = 0; return v; }
  if (s.cand === v) s.n++; else { s.cand = v; s.n = 1; }
  if (s.n >= 2) s.value = v;
  return s.value;
}

/* Read one box. Blocky game fonts are read at three stroke thicknesses and the majority answer wins
   (unless the box has a fixed Stroke setting), because a single thickness is fragile. */
async function readRegion(img, r) {
  const type = r.type || "number", pol = r.polarity || "auto";
  const fixed = r.thicken != null && r.thicken !== "auto" && r.thicken !== "" ? +r.thicken : null;
  const levels = !r.pixel ? [null] : fixed != null ? [fixed] : [1, 2, 3];
  const tries = [];
  for (const th of levels) {
    const png = prepare(img, r, pol, !!r.pixel, th == null ? undefined : th).toPNG();
    const { raw, conf } = await recognise(png, type);
    tries.push({ raw, conf, parsed: parse(raw, type), png });
  }
  const votes = new Map();
  for (const t of tries) if (t.parsed != null) { const k = JSON.stringify(t.parsed), v = votes.get(k) || { n: 0, conf: 0, t }; v.n++; v.conf += t.conf; if (t.conf > v.t.conf) v.t = t; votes.set(k, v); }
  const best = [...votes.values()].sort((a, b) => b.n - a.n || b.conf - a.conf)[0];
  return best ? best.t : tries[0];
}

/* ---------------------------------------------------------------- loop */
async function readAll(img) {
  const readings = {}, vals = {};
  for (const r of cfg.regions || []) {
    const type = r.type || "number", t0 = Date.now();
    try {
      const { raw, conf, parsed } = await readRegion(img, r);
      const value = accept(r.id, type, parsed);
      readings[r.id] = { key: r.key, raw, conf, parsed, value, ok: value != null, ms: Date.now() - t0 };
      if (value != null && r.key && r.key !== "custom") vals[r.key] = value;
    } catch (e) { readings[r.id] = { key: r.key, raw: "", ok: false, error: e.message }; }
  }
  return { readings, vals };
}
const MC_KEYS = ["alive", "total", "kills", "border", "clock", "theme", "phase"];
// result screens: Fortnite's match results (placement, eliminations) and Dead by Daylight's trial tally (what happened to each survivor, generators done)
const GAME_KEYS = ["fnPlace", "fnElims", "dbdGens", "dbdS1", "dbdS2", "dbdS3", "dbdS4"];
function toMessage(v) {
  const out = [];
  const teams = [0, 1].map(i => ({ TeamNum: i, Score: v["score" + i], Name: v["name" + i] })).filter(t => t.Score != null || t.Name);
  const game = {};
  if (teams.length) game.Teams = teams;
  if (v.clock != null) game.TimeSeconds = v.clock;
  if (Object.keys(game).length) out.push({ Event: "UpdateState", Data: { Players: [], Game: game } });
  const mc = {}; for (const k of MC_KEYS) if (v[k] != null) mc[k] = v[k];
  if (Object.keys(mc).length) out.push({ Event: "McOcr", Data: { values: mc } }); // Minecraft sidebar and build battle values
  const gk = {}; for (const k of GAME_KEYS) if (v[k] != null) gk[k] = v[k];
  if (Object.keys(gk).length) out.push({ Event: "GameOcr", Data: { values: gk } }); // result screens of the scored-by-hand games
  return out.length ? out : null;
}
async function loop() {
  if (!state.running) return;
  const t0 = Date.now();
  try {
    const { img } = await grabFn(cfg.sourceId, cfg.sourceName);
    const { readings, vals } = await readAll(img);
    state.readings = readings; state.error = ""; state.lastRead = Date.now();
    const msg = toMessage(vals); if (msg && emit) emit(msg);
  } catch (e) { state.error = e.message; }
  state.cycleMs = Date.now() - t0;
  timer = setTimeout(loop, Math.max(150, (cfg.interval || 800) - state.cycleMs));
}

async function start(c, em) {
  if (state.running) stop();
  cfg = c || {}; emit = em; stable = {};
  if (!(cfg.regions || []).length) throw new Error("Draw at least one region first.");
  if (!cfg.sourceId && !cfg.sourceName) throw new Error("Pick a screen or window to read first.");
  await grabFn(cfg.sourceId, cfg.sourceName); // fail now if the source is gone
  await getWorker();
  Object.assign(state, { running: true, error: "", readings: {}, lastRead: 0 });
  loop();
}
function stop() { state.running = false; clearTimeout(timer); }
function update(c) { cfg = c || {}; if (state.running) stable = {}; }
async function testRegion(id, name, region) {
  const { img } = await grabFn(id, name);
  const t = await readRegion(img, region);
  return { image: "data:image/png;base64," + t.png.toString("base64"), raw: t.raw, conf: t.conf, value: t.parsed };
}

module.exports = { available: true, state: () => Object.assign({ available: true }, state), listSources, frame, frameByName, start, stop, update, testRegion,
  _internals: { prepare, parse, recognise, grab, setGrab: f => { grabFn = f; } } };
