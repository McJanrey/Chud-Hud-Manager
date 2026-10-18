// Run with: node test/draft-test.js
// League champion select: reading the client's session, the stream delay, the Worlds-style scene, and the series bans (fearless draft).
"use strict";
const fs = require("fs"), https = require("https"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const draft = require("../draft.js"), HUD = require("../public/hud.js");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = html => String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

(async () => {
  /* ---- the session, read the way the client reports it ---- */
  const mid = draft.normalize(draft.demoSession(7));
  check("a session becomes two sides of five picks with their bans", mid && mid.active && mid.left.picks.length === 5 && mid.right.picks.length === 5 && mid.left.bans.length >= 3 && mid.right.bans.length >= 3);
  check("blue side is on the left, red on the right", mid.left.picks.every(p => p.cell < 5) && mid.right.picks.every(p => p.cell >= 5));
  check("the action in progress is known, with its side and phase", mid.phase === "PICKS" && mid.activeSide === "right" && mid.right.picks.some(p => p.active), JSON.stringify([mid.phase, mid.activeSide]));
  check("finished bans keep their champion, the one being picked glows", mid.left.bans.filter(b => b.done).every(b => b.champ > 0) && mid.left.picks[0].locked && mid.left.picks[0].champ > 0);
  check("names and roles come through", mid.left.picks[0].name === "Jazii" && mid.left.picks[0].pos === "TOP" && mid.right.picks[4].pos === "UTILITY");
  check("the timer is kept as an end time", mid.endsAt > Date.now() && mid.total === 30);
  const fin = draft.normalize(draft.demoSession(20));
  check("all ten locked at the end, in final adjustments", fin.phase === "FINALIZATION" && [...fin.left.picks, ...fin.right.picks].every(p => p.locked && p.champ));
  check("garbage is not a session", draft.normalize(null) === null && draft.normalize({}) === null && draft.normalize({ myTeam: "x" }) === null);

  /* ---- the delay: what it looked like N seconds ago ---- */
  const d = draft.create({ get: async () => ({ status: 404, json: null }) });
  const t0 = Date.now() - 10000;
  d.record({ active: false }, t0); d.record(draft.normalize(draft.demoSession(2)), t0 + 2000); d.record(draft.normalize(draft.demoSession(9)), t0 + 6000);
  check("no delay shows the latest", d.at(0, t0 + 10000).left.picks[1].locked === true || d.at(0, t0 + 10000).phase === "PICKS");
  check("a 5 second delay shows the state from 5 seconds ago", d.at(5000, t0 + 10000).phase === "BANS");
  check("a delay longer than the history shows nothing yet", d.at(60000, t0 + 10000) === null);
  check("an unchanged state is not stored twice", (() => { const n = d.state().history; d.record(draft.normalize(draft.demoSession(9)), t0 + 9000); return d.state().history === n; })());

  /* ---- the scene ---- */
  const tpl = { kind: "lol" };
  const srvData = fs.mkdtempSync(path.join(os.tmpdir(), "draft-test-")), port = 7807, base = `http://127.0.0.1:${port}`;
  // a stand-in League client: HTTPS on a random port with a self-signed certificate, and its lockfile
  const pems = await require("selfsigned").generate([{ name: "commonName", value: "127.0.0.1" }], { keySize: 2048, algorithm: "sha256" });
  let session = null, calls = 0, authOk = true;
  const lcu = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    calls++; authOk = authOk && req.headers.authorization === "Basic " + Buffer.from("riot:pw123").toString("base64");
    if (req.url === "/lol-champ-select/v1/session" && session) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(session)); }
    res.writeHead(404); res.end("{}");
  });
  await new Promise(r => lcu.listen(0, "127.0.0.1", r));
  const lockfile = path.join(srvData, "lockfile"); fs.writeFileSync(lockfile, `LeagueClient:1234:${lcu.address().port}:pw123:https`);
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SAINTS_DATA: srvData, PORT: String(port), CAM_PORT: String(port + 1), ICON_BASE: "http://127.0.0.1:9/" }), stdio: "ignore" });
  const post = (p, body) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  const state = async () => (await fetch(base + "/api/draft/state")).json();
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/state")).ok) break; } catch { /* not up yet */ } await sleep(250); }
    await post("/api/set", { path: "settings.draft.lockfile", value: lockfile, by: "test" });
    await sleep(2500);
    let st = await state();
    check("the client is found through its lockfile and answers", st.connected === true && st.snap.active === false, JSON.stringify(st).slice(0, 200));
    check("with the client's password", calls > 0 && authOk);
    session = draft.demoSession(7); await sleep(2500); st = await state();
    check("champion select shows up", st.snap.active === true && st.snap.phase === "PICKS");
    const db = (await (await fetch(base + "/api/state")).json()).db, ev = db.events.find(e => e.game === "League of Legends");
    const html = HUD.sceneHtml(ev, null, "draft", { draft: st });
    check("the scene draws ten cards with the slot labels and the phase", (html.match(/dr-card/g) || []).length >= 10 && /\[B1\]/.test(text(html)) && /\[R5\]/.test(text(html)) && /PICK PHASE/.test(text(html)));
    check("the in-game scene switches to champion select by itself", HUD.sceneHtml(ev, null, "ingame", { draft: st }).includes("dr-card"));
    check("unless that is switched off", (() => { const e2 = JSON.parse(JSON.stringify(ev)); e2.hud.draftAuto = false; return !HUD.sceneHtml(e2, null, "ingame", { draft: st }).includes("dr-card"); })());
    check("other games don't get a League draft", text(HUD.sceneHtml(db.events.find(e => e.game === "Rocket League"), null, "draft", { draft: st })).includes("LEAGUE OF LEGENDS ONLY"));

    session = draft.demoSession(20); await sleep(2500);
    session = null; await sleep(2500); st = await state();
    check("a finished champion select joins the series bans", st.series.length === 1 && st.series[0].left.length === 5 && st.series[0].right.length === 5, JSON.stringify(st.series));
    check("and the series bans draw on the scene", (() => { const s2 = Object.assign({}, st, { snap: draft.normalize(draft.demoSession(3)) }); return /SERIES BAN/.test(text(HUD.sceneHtml(ev, null, "draft", { draft: s2 }))); })());
    await post("/api/draft/demo", { on: true }); await sleep(1500);
    check("the demo runs without a client", (await state()).demo === true);
    await post("/api/draft/demo", { on: false });
    await post("/api/draft/series-reset", {}); st = await state();
    check("a new series clears the series bans", st.series.length === 0);
    await post("/api/set", { path: "settings.draft.delay", value: 3, by: "test" });
    session = draft.demoSession(2); await sleep(1500);
    check("with a 3 second delay it is not shown yet", (await state()).snap.active === false);
    await sleep(2600);
    check("then it is", (await state()).snap.active === true);
  } catch (e) { check("test ran", false, e.stack || e.message); }
  srv.kill(); lcu.close(); try { fs.rmSync(srvData, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nDRAFT TEST PASS");
  process.exit(failures ? 1 : 0);
})();
