// Run with: electron test/ocr-selftest.js
// Checks the OCR engine end to end with known numbers, and that real screen capture returns pixels.
"use strict";
const { app, BrowserWindow } = require("electron");
const ocr = require("../ocr.js");

const html = `<title>OCR SELFTEST</title><body style="margin:0;background:#101820;color:#fff;font:800 120px 'Segoe UI',Arial">
<div style="position:absolute;left:60px;top:40px;width:300px;text-align:center">7</div>
<div style="position:absolute;left:480px;top:40px;width:340px;text-align:center;color:#FDC82F">12:34</div>
<div style="position:absolute;left:940px;top:40px;width:300px;text-align:center">3</div>
<div style="position:absolute;left:60px;top:260px;font-size:70px">NIGHT OWLS</div></body>`;

process.on("unhandledRejection", e => { console.log("SELFTEST ERROR:", e && e.message || e); app.exit(1); });
app.whenReady().then(async () => {
  const W = 1280, H = 400;
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 800));

  // 1. real screen capture returns pixels (size only; nothing is stored or shown)
  const scr = await ocr._internals.grab("screen:0:0");
  console.log("screen capture:", JSON.stringify(scr.img.getSize()), "empty:", scr.img.isEmpty());

  // 2. full OCR loop against the test window's own picture
  ocr._internals.setGrab(async () => ({ img: await win.webContents.capturePage() }));
  const box = (x, y, w, h) => ({ x: x / W, y: y / H, w: w / W, h: h / H });
  const cfg = { sourceName: "test", interval: 400, regions: [
    { id: "r1", key: "score0", type: "number", ...box(60, 30, 300, 160) },
    { id: "r2", key: "clock", type: "time", ...box(480, 30, 340, 160) },
    { id: "r3", key: "score1", type: "number", ...box(940, 30, 300, 160) },
    { id: "r4", key: "name0", type: "text", ...box(60, 250, 600, 100) } ] };
  const got = [], t0 = Date.now();
  await ocr.start(cfg, m => got.push(m));
  console.log("OCR engine ready in", Date.now() - t0, "ms");
  await new Promise(r => setTimeout(r, 5000));
  const st = ocr.state();
  console.log("cycle:", st.cycleMs, "ms, error:", st.error || "none");
  for (const v of Object.values(st.readings)) console.log("  ", v.key.padEnd(7), JSON.stringify(v.raw), "->", JSON.stringify(v.value), "conf", v.conf);
  console.log("last message:", JSON.stringify(got[got.length - 1]));
  const want = { score0: 7, clock: 754, score1: 3, name0: "NIGHT OWLS" };
  const have = Object.fromEntries(Object.values(st.readings).map(r => [r.key, r.value]));
  const ok = Object.entries(want).every(([k, v]) => String(have[k]).toUpperCase() === String(v)) && !scr.img.isEmpty();
  console.log(ok ? "SELFTEST PASS" : "SELFTEST FAIL, got " + JSON.stringify(have));
  ocr.stop();
  app.exit(ok ? 0 : 1);
});
