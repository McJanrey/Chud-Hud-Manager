// Run with: node test/games-test.js
// Dead by Daylight, Fortnite and VALORANT 2v2 Skirmish: the events the server makes for them, how their numbers are saved,
// and that result-screen readings (Screen OCR) reach the dashboard.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "games-test-")), port = 7801, base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SAINTS_DATA: dataDir, PORT: String(port), CAM_PORT: String(port + 1), ICON_BASE: "http://127.0.0.1:9/" }), stdio: "ignore" });
  const post = (p, body) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + "/api/state")).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 250)); }
    const tpl = async g => (await fetch(`${base}/api/event-template?game=${encodeURIComponent(g)}`)).json();
    const dbd = await tpl("Dead by Daylight"), fn = await tpl("Fortnite"), val = await tpl("Valorant");
    check("Dead by Daylight: two teams of five, scored by hand", dbd.teams.length === 2 && dbd.teams.every(t => t.players.length === 5) && dbd.dbd && Array.isArray(dbd.dbd.trials) && dbd.dbd.killPts === 1);
    check("Fortnite: eight duos, placement tiers and no matches yet", fn.teams.length === 8 && fn.teams.every(t => t.players.length === 2) && fn.fn.placePts.length >= 4 && fn.fn.matches.length === 0 && fn.fn.elimPts === 1);
    check("VALORANT 2v2 Skirmish: two players a side, first to 10", val.teams.length === 2 && val.teams.every(t => t.players.length === 2) && val.val.target === 10);
    check("every game's event carries the others' settings too (so changing the game never loses a field)", [dbd, fn, val].every(e => e.dbd && e.fn && e.val));

    // an event saved before these games existed gets the fields when it is loaded
    const state = await (await fetch(base + "/api/state")).json();
    check("the sample events were upgraded with the new settings", state.db.events.every(e => e.dbd && e.fn && e.val && Array.isArray(e.fn.matches)));

    // the numbers survive a save: add the event, score a Fortnite match and a Dead by Daylight trial, read them back
    fn.name = "FN TEST"; dbd.name = "DBD TEST";
    const events = state.db.events.concat([fn, dbd]);
    await post("/api/set", { path: "events", value: events, by: "test" });
    await post("/api/set", { event: fn.id, path: "fn.matches", value: [{ place: [1, 2, 3, 4, 5, 6, 7, 8], elims: [5, 4, 3, 2, 1, 0, 0, 0] }], by: "test" });
    await post("/api/set", { event: dbd.id, path: "dbd.trials", value: [{ killer: 0, kills: 3, escapes: 1, gens: 3 }], by: "test" });
    const after = (await (await fetch(base + "/api/state")).json()).db.events;
    const f2 = after.find(e => e.id === fn.id), d2 = after.find(e => e.id === dbd.id);
    check("Fortnite results are saved", f2.fn.matches.length === 1 && f2.fn.matches[0].place[0] === 1 && f2.fn.matches[0].elims[0] === 5);
    check("Dead by Daylight trials are saved", d2.dbd.trials.length === 1 && d2.dbd.trials[0].kills === 3);

    // data for vMix follows the scoring: the Dead by Daylight score is the trial's points
    const hud = await (await fetch(`${base}/hud.json?event=${dbd.id}`)).json();
    check("the vMix data carries the Dead by Daylight score", JSON.stringify(hud).includes("3"), JSON.stringify(hud).slice(0, 160));

    // a result-screen reading (Screen OCR sends these as GameOcr messages) reaches the dashboard
    await post("/api/source", { event: dbd.id, source: "push" });
    await post("/api/ingest", { Event: "GameOcr", Data: { values: { dbdS1: "ESCAPED", dbdS2: "SACRIFICED", dbdS3: "KILLED", dbdS4: "ESCAPED", dbdGens: 4 } } });
    const st = await (await fetch(`${base}/api/state?event=${dbd.id}`)).json();
    check("a GameOcr reading reaches the feed", st.game && st.game.gameOcr && st.game.gameOcr.dbdGens === 4 && st.game.gameOcr.dbdS2 === "SACRIFICED", JSON.stringify(st.game && st.game.gameOcr));
  } catch (e) { check("test ran", false, e.stack || e.message); }
  srv.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nGAMES TEST PASS");
  process.exit(failures ? 1 : 0);
})();
