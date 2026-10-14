// Run with: electron test/ocr-selftest.js
// Checks the OCR engine end to end with known values, and that real screen capture returns pixels.
//  1. a normal scoreboard (scores, clock, team name) drawn in a window
//  2. a blocky pixel-font screen like Minecraft's sidebar and build battle theme, drawn from a small
//     5x7 pixel font defined here (no game assets), read in pixel-font mode
"use strict";
const { app, BrowserWindow, nativeImage } = require("electron");
const ocr = require("../ocr.js");

const html1 = `<title>OCR SELFTEST</title><body style="margin:0;background:#101820;color:#fff;font:800 120px 'Segoe UI',Arial">
<div style="position:absolute;left:60px;top:40px;width:300px;text-align:center">7</div>
<div style="position:absolute;left:480px;top:40px;width:340px;text-align:center;color:#FDC82F">12:34</div>
<div style="position:absolute;left:940px;top:40px;width:300px;text-align:center">3</div>
<div style="position:absolute;left:60px;top:260px;font-size:70px">NIGHT OWLS</div></body>`;

/* 5x7 pixel font: each glyph is 7 rows of 5 bits */
const G = {
  "0": "01110 10001 10001 10001 10001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110", "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "01110 10001 00001 00110 00001 10001 01110", "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000", "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100", ":": "00000 00100 00000 00000 00000 00100 00000", " ": "00000 00000 00000 00000 00000 00000 00000",
  P: "11110 10001 10001 11110 10000 10000 10000", I: "01110 00100 00100 00100 00100 00100 01110", R: "11110 10001 10001 11110 10100 10010 10001",
  A: "01110 10001 10001 11111 10001 10001 10001", T: "11111 00100 00100 00100 00100 00100 00100", E: "11111 10000 10000 11110 10000 10000 11111",
  S: "01110 10001 10000 01110 00001 10001 01110", H: "10001 10001 10001 11111 10001 10001 10001",
};
function pixelFrame(W, H, S, items) { // items: [text, x, y]
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = 0x3a; buf[i * 4 + 1] = 0x4a; buf[i * 4 + 2] = 0x2b; buf[i * 4 + 3] = 255; } // BGRA: dark green
  const put = (x, y, c) => { for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const o = ((y + dy) * W + x + dx) * 4; if (o >= 0 && o < buf.length) { buf[o] = buf[o + 1] = buf[o + 2] = c; } } };
  for (const pass of [0, 1]) // shadow first, then the white text on top
    for (const [text, x0, y0] of items) [...text].forEach((ch, ci) => (G[ch] || G[" "]).split(" ").forEach((row, ry) => [...row].forEach((bit, rx) => {
      if (bit === "1") put(x0 + (ci * 6 + rx) * S + (pass ? 0 : S), y0 + ry * S + (pass ? 0 : S), pass ? 255 : 0x3f);
    })));
  return nativeImage.createFromBitmap(buf, { width: W, height: H });
}

process.on("unhandledRejection", e => { console.log("SELFTEST ERROR:", e && e.message || e); app.exit(1); });

async function phase(title, getImage, regions, want) {
  ocr._internals.setGrab(async () => ({ img: await getImage() }));
  const got = [];
  await ocr.start({ sourceName: "test", interval: 400, regions }, m => got.push(m));
  await new Promise(r => setTimeout(r, 5000));
  const st = ocr.state();
  console.log(`\n${title}: cycle ${st.cycleMs} ms, error: ${st.error || "none"}`);
  for (const v of Object.values(st.readings)) console.log("  ", String(v.key).padEnd(7), JSON.stringify(v.raw), "->", JSON.stringify(v.value), "conf", v.conf);
  const have = Object.fromEntries(Object.values(st.readings).map(r => [r.key, r.value]));
  const bad = Object.entries(want).filter(([k, v]) => String(have[k]).toUpperCase() !== String(v));
  ocr.stop();
  return bad.length ? `${title} FAILED: ${bad.map(([k, v]) => `${k} wanted ${v}, got ${have[k]}`).join("; ")}` : "";
}

app.whenReady().then(async () => {
  const scr = await ocr._internals.grab("screen:0:0");
  console.log("screen capture:", JSON.stringify(scr.img.getSize()), "empty:", scr.img.isEmpty());
  const fails = [];

  const win = new BrowserWindow({ width: 1280, height: 400, show: false, useContentSize: true });
  const file = require("path").join(require("os").tmpdir(), `ocr-selftest-${process.pid}.html`);
  require("fs").writeFileSync(file, html1, "utf8"); await win.loadFile(file); require("fs").unlink(file, () => {});
  await new Promise(r => setTimeout(r, 800));
  let b = (x, y, w, h) => ({ x: x / 1280, y: y / 400, w: w / 1280, h: h / 400 });
  fails.push(await phase("scoreboard", () => win.webContents.capturePage(), [
    { id: "r1", key: "score0", type: "number", ...b(60, 30, 300, 160) }, { id: "r2", key: "clock", type: "time", ...b(480, 30, 340, 160) },
    { id: "r3", key: "score1", type: "number", ...b(940, 30, 300, 160) }, { id: "r4", key: "name0", type: "text", ...b(60, 250, 600, 100) }],
    { score0: 7, clock: 754, score1: 3, name0: "NIGHT OWLS" }));

  // Minecraft-like: small blocky text scaled 4x, a dark shadow behind each letter
  const S = 4, W = 1280, H = 480, mc = pixelFrame(W, H, S, [["14", 800, 40], ["3", 800, 100], ["08:45", 800, 160], ["PIRATE SHIP", 100, 360]]);
  b = (x, y, w, h) => ({ x: x / W, y: y / H, w: w / W, h: h / H });
  fails.push(await phase("minecraft sidebar + build battle (pixel font)", async () => mc, [
    { id: "m1", key: "alive", type: "number", pixel: true, ...b(780, 24, 90, 56) },
    { id: "m2", key: "kills", type: "number", pixel: true, ...b(780, 84, 60, 56) },
    { id: "m3", key: "clock", type: "time", pixel: true, ...b(780, 144, 170, 56) },
    { id: "m5", key: "theme", type: "text", pixel: true, ...b(80, 344, 330, 56) }],
    { alive: 14, kills: 3, clock: 525, theme: "PIRATE SHIP" }));

  const bad = fails.filter(Boolean);
  console.log(bad.length || scr.img.isEmpty() ? "\nSELFTEST FAIL\n" + bad.join("\n") : "\nSELFTEST PASS");
  app.exit(bad.length || scr.img.isEmpty() ? 1 : 0);
});
