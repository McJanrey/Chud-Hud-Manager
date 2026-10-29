// Run with: node test/observer-test.js
// The observer client: a graphics PC takes screen readings from an observer PC. The observer PC finds the graphics PC on the network
// (UDP), pairs once with its code, and forwards its readings; the graphics PC applies them. Wrong codes are refused and slowed down, the
// network port accepts nothing else, and the pairing code never reaches an overlay.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), { spawn } = require("child_process");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "   ok  " : " FAIL  ", name, ok ? "" : extra); if (!ok) failures++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const G = { port: 7811, ovl: 7812, cam: 7813 }, O = { port: 7815, ovl: 7816, cam: 7817 }, DISC = 7814;
const ask = (port, method, p, body, host) => new Promise(resolve => {
  const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: Object.assign({}, host ? { host } : {}, body ? { "content-type": "application/json" } : {}) }, res => {
    let d = ""; res.on("data", c => { d += c; if (p.startsWith("/events")) { resolve({ code: res.statusCode, body: d }); req.destroy(); } }); res.on("end", () => resolve({ code: res.statusCode, body: d })); res.on("close", () => resolve({ code: res.statusCode, body: d }));
  });
  req.on("error", () => resolve({ code: 0, body: "" })); if (body) req.write(JSON.stringify(body)); req.end();
});
const j = r => { try { return JSON.parse(r.body); } catch { return {}; } };
const start = (dir, ports) => spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SAINTS_DATA: dir, PORT: String(ports.port), OVL_PORT: String(ports.ovl), CAM_PORT: String(ports.cam), OBS_DISC_PORT: String(DISC) }), stdio: "ignore" });
(async () => {
  const gdir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-g-")), odir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-o-"));
  const gfx = start(gdir, G), obs = start(odir, O);
  await wait(2800);
  try {
    // the graphics PC has a VALORANT event that reads the screen
    const st = j(await ask(G.port, "GET", "/api/state")), tpl = j(await ask(G.port, "GET", "/api/event-template?game=Valorant"));
    tpl.id = "v1"; tpl.name = "V"; tpl.source = "ocr"; st.db.events.push(tpl);
    await ask(G.port, "POST", "/api/set", { path: "events", value: st.db.events }); await wait(1800);

    let r = await ask(G.ovl, "GET", "/api/observer/hello", null, "10.1.2.3:" + G.ovl);
    check("off by default: nothing answers on the network port", r.code === 0, r.code);
    r = j(await ask(G.port, "POST", "/api/observer/code", { on: true }));
    check("switching the inbox on makes a 6-digit code and opens the network port", /^\d{6}$/.test(r.code) && r.net.on === true, JSON.stringify(r).slice(0, 120));
    const code = r.code;
    r = await ask(G.ovl, "GET", "/api/observer/hello", null, "10.1.2.3:" + G.ovl);
    check("a network host name can ask hello, and it says the inbox is open", r.code === 200 && j(r).app === "chudhud" && j(r).open === true, r.body);

    // the observer PC finds the graphics PC by UDP, pairs (a wrong code first), and a reading it sends changes the graphics PC's game
    let found = []; for (let i = 0; i < 10 && !found.length; i++) { found = j(await ask(O.port, "GET", "/api/observer/status")).found || []; if (!found.length) await wait(1000); }
    check("the observer PC finds the graphics PC on the network", found.some(f => f.port === G.ovl), JSON.stringify(found));
    r = await ask(O.port, "POST", "/api/observer/connect", { gfx: `127.0.0.1:${G.ovl}`, code: "999999" });
    check("pairing with a wrong code is refused", r.code === 400 && /code/i.test(j(r).error || ""), r.body);
    r = await ask(O.port, "POST", "/api/observer/connect", { gfx: `http://127.0.0.1:${G.ovl}/overlay?scene=auto`, code });
    check("pairing with the right code works (an overlay link pasted in is fine)", r.code === 200 && j(r).link && j(r).link.on === true, r.body);
    const msg = [{ Event: "UpdateState", Data: { Players: [], Game: { Teams: [{ TeamNum: 0, Score: 7, Name: "ALPHA" }, { TeamNum: 1, Score: 3, Name: "BRAVO" }], TimeSeconds: 42 } } }];
    r = await ask(O.port, "POST", "/api/observer/send", { msg });
    check("the observer sends a reading", r.code === 200, r.body);
    await wait(500);
    const gs = j(await ask(G.port, "GET", "/api/state?event=v1")), blob = JSON.stringify(gs.game || {});
    check("the graphics PC applied it: scores and team names from the observer", /ALPHA/.test(blob) && /BRAVO/.test(blob), blob.slice(0, 200));
    check("the graphics PC reports who sent it", j(await ask(G.port, "GET", "/api/observer/status")).in.count >= 2, "");

    // refused: wrong code, no code; slowed after 8 wrong tries
    r = await ask(G.ovl, "POST", "/api/observer/readings", { code: "000000", msg: [] }, "10.1.2.3:" + G.ovl);
    check("a wrong code is refused (403)", r.code === 403, r.code);
    r = await ask(G.ovl, "POST", "/api/observer/readings", { msg: [] }, "10.1.2.3:" + G.ovl);
    check("no code is refused (403)", r.code === 403, r.code);
    for (const p of ["/api/state", "/api/set", "/api/observer/status", "/api/observer/code", "/api/observer/connect", "/api/observer/send"]) {
      r = await ask(G.ovl, p === "/api/state" || p === "/api/observer/status" ? "GET" : "POST", p, { on: false, path: "events", value: [] }, "10.1.2.3:" + G.ovl);
      check(`the network port refuses ${p}`, r.code === 404 || r.code === 0, r.code);
    }
    let last = 0; for (let i = 0; i < 9; i++) last = (await ask(G.ovl, "POST", "/api/observer/readings", { code: "11" + i, msg: [] }, "10.1.2.3:" + G.ovl)).code;
    check("after 8 wrong codes a minute it waits (429), even for the right one", last === 429 && (await ask(G.ovl, "POST", "/api/observer/readings", { code, msg: [] }, "10.1.2.3:" + G.ovl)).code === 429, last);

    // the pairing code never reaches an overlay
    r = await ask(G.ovl, "GET", "/events?kind=overlay", null, "10.1.2.3:" + G.ovl);
    check("the overlay data stream carries no pairing code", r.code === 200 && !r.body.includes(code) && !r.body.includes("observerCode"), r.body.slice(0, 80));
    r = await ask(G.port, "GET", "/events?kind=dashboard");
    check("the control room's own stream does (it is this PC)", r.code === 200 && r.body.includes(code), "");

    // disconnect: readings stay on the observer PC again
    r = await ask(O.port, "POST", "/api/observer/connect", { on: false });
    check("disconnecting lets go of the graphics PC", r.code === 200 && j(r).link && j(r).link.on === false, r.body);
    r = await ask(G.port, "POST", "/api/observer/code", { on: false });
    check("switching the inbox off clears the code", r.code === 200 && j(r).code === "", r.body);
  } finally { gfx.kill(); obs.kill(); }
  console.log(failures ? `\nOBSERVER TEST: ${failures} CHECK(S) FAILED` : "\nOBSERVER TEST PASS");
  process.exit(failures ? 1 : 0);
})();
