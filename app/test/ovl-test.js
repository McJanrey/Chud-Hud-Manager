// Run with: node test/ovl-test.js
// The overlay-only network listener ("Show overlays on other PCs"): off by default; when on it serves the overlay and what it needs,
// refuses everything else (the control room, settings, anything that writes), and answers requests that carry a network host name.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), { spawn } = require("child_process");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "   ok  " : " FAIL  ", name, ok ? "" : extra); if (!ok) failures++; };
const PORT = 7781, OVL = 7782, CAM = 7783;
// one request with any Host header (the network host name an OBS on another PC would send)
const ask = (port, method, p, host, body) => new Promise(resolve => {
  const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: Object.assign({ host }, body ? { "content-type": "application/json" } : {}) }, res => {
    let d = ""; res.on("data", c => { d += c; if (p.startsWith("/events")) req.destroy(); }); res.on("end", () => resolve({ code: res.statusCode, body: d })); res.on("close", () => resolve({ code: res.statusCode, body: d }));
  });
  req.on("error", () => resolve({ code: 0, body: "" })); if (body) req.write(JSON.stringify(body)); req.end();
});
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovl-test-"));
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SAINTS_DATA: dataDir, PORT: String(PORT), OVL_PORT: String(OVL), CAM_PORT: String(CAM) }), stdio: "ignore" });
  await new Promise(r => setTimeout(r, 2500));
  try {
    const NET = "10.230.5.123:" + OVL;
    let r = await ask(PORT, "GET", "/overlay", "10.230.5.123:" + PORT);
    check("the main server refuses a network host name (421)", r.code === 421, r.code);
    r = await ask(OVL, "GET", "/overlay", NET);
    check("off by default: nothing listens on the overlay port", r.code === 0, r.code);
    r = await ask(PORT, "GET", "/api/ovl/lan", "127.0.0.1:" + PORT);
    check("the switch reports off, with this PC's addresses", r.code === 200 && JSON.parse(r.body).on === false && Array.isArray(JSON.parse(r.body).ips), r.body);

    r = await ask(PORT, "POST", "/api/ovl/lan", "127.0.0.1:" + PORT, { on: true });
    check("switching it on answers on", r.code === 200 && JSON.parse(r.body).on === true && JSON.parse(r.body).port === OVL, r.body);
    for (const p of ["/overlay?scene=auto", "/hud.js", "/hud.css", "/fonts/inter-latin.woff2", "/brand/chud-hud.png", "/api/license", "/hud.json"]) {
      r = await ask(OVL, "GET", p, NET); check(`serves ${p} to a network host name`, r.code === 200, r.code);
    }
    r = await ask(OVL, "GET", "/events?kind=overlay", NET);
    check("serves the overlay's live data stream", r.code === 200 && /event-stream|db/.test(r.body + ""), r.code);
    for (const p of ["/", "/dashboard", "/launcher", "/app.html", "/api/state", "/api/control/info", "/api/cam/links", "/events", "/events?kind=dashboard", "/api/ovl/lan", "/cam", "/../server.js", "/brand/../../server.js"]) {
      r = await ask(OVL, "GET", p, NET); check(`refuses ${p}`, r.code === 404 || r.code === 400 || (p.includes("..") && r.code !== 200), r.code);
    }
    for (const [m, p] of [["POST", "/api/set"], ["POST", "/api/ovl/lan"], ["PUT", "/api/set"], ["DELETE", "/uploads/x.png"], ["POST", "/api/upload"]]) {
      r = await ask(OVL, m, p, NET, { path: "events", value: [] }); check(`refuses ${m} ${p}`, r.code === 404 || r.code === 0, r.code); // 0: the connection is dropped before the body is read
    }
    const st = JSON.parse((await ask(PORT, "GET", "/api/state", "127.0.0.1:" + PORT)).body);
    check("nothing was changed through the network port", Array.isArray(st.db.events), "");

    // it is saved: switch on, restart the app, and the network port is open again by itself
    await new Promise(r => setTimeout(r, 900)); srv.kill(); await new Promise(r => setTimeout(r, 600));
    const again = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SAINTS_DATA: dataDir, PORT: String(PORT), OVL_PORT: String(OVL), CAM_PORT: String(CAM) }), stdio: "ignore" });
    await new Promise(r => setTimeout(r, 2500));
    try {
      r = await ask(OVL, "GET", "/overlay", NET); check("after a restart the network port is open again by itself", r.code === 200, r.code);
      r = await ask(PORT, "POST", "/api/ovl/lan", "127.0.0.1:" + PORT, { on: false });
      r = await ask(OVL, "GET", "/overlay", NET); check("switching it off closes the port again", r.code === 0, r.code);
    } finally { again.kill(); }
  } finally { srv.kill(); }
  console.log(failures ? `\nOVERLAY NETWORK TEST: ${failures} CHECK(S) FAILED` : "\nOVERLAY NETWORK TEST PASS");
  process.exit(failures ? 1 : 0);
})();
