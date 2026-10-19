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

    // a screen read that misses the clock once (scores only) does not drop a clock that arrived a moment ago
    await post("/api/ingest", { Event: "UpdateState", Data: { Players: [], Game: { TimeSeconds: 95, Teams: [{ TeamNum: 0, Score: 1 }, { TeamNum: 1, Score: 0 }] } } });
    await post("/api/ingest", { Event: "UpdateState", Data: { Players: [], Game: { Teams: [{ TeamNum: 0, Score: 1 }, { TeamNum: 1, Score: 0 }] } } });
    const ck = (await (await fetch(`${base}/api/state?event=${dbd.id}`)).json()).game;
    check("one missed clock read keeps the clock live", ck && ck.clockLive === true && ck.time === 95, JSON.stringify(ck && { l: ck.clockLive, t: ck.time }));

    /* VALORANT (phase C2): the squad setting, the alive toggles, the agent field, the agent route and the vMix fields */
    check("VALORANT starts with a squad of 2, nobody out, and an empty agent on every player", val.val.squad === 2 && val.val.aliveUsed === false && JSON.stringify(val.val.dead) === "{}" && val.teams.every(t => t.players.every(p => p.agent === "")), JSON.stringify(val.val));
    check("other games' players carry no agent field", dbd.teams.every(t => t.players.every(p => p.agent === undefined)));
    const AG = "add6443a-41bd-e414-f6ad-e58d267f4e95";
    val.name = "VAL TEST"; val.teams[0].players[0].ign = "Ann#EU1"; val.teams[0].players[0].agent = AG; val.teams[1].players[0].ign = "Bob#EU2";
    await post("/api/set", { path: "events", value: (await (await fetch(base + "/api/state")).json()).db.events.concat([val]), by: "test" });
    await post("/api/set", { event: val.id, path: "val.squad", value: 4, by: "test" });
    let v2 = (await (await fetch(base + "/api/state")).json()).db.events.find(e => e.id === val.id);
    check("a bigger squad seats the empty roster rows (4 a side, with agent fields) and keeps the players already there", v2.val.squad === 4 && v2.teams.every(t => t.players.length === 4 && t.players.every(p => p.agent !== undefined)) && v2.teams[0].players[0].ign === "Ann#EU1" && v2.teams[0].players[0].agent === AG, JSON.stringify(v2.teams.map(t => t.players.length)));
    await post("/api/set", { event: val.id, path: "val.squad", value: 9, by: "test" });
    v2 = (await (await fetch(base + "/api/state")).json()).db.events.find(e => e.id === val.id);
    check("the squad is kept between 2 and 5", v2.val.squad === 5 && v2.teams.every(t => t.players.length === 5));
    // alive toggles: the data the Skirmish page writes, what the scene and vMix read, and the reset a + Round does
    const HUD = require("../public/hud.js"), id0 = v2.teams[0].players[0].id;
    await post("/api/set", { event: val.id, path: "val.dead", value: { [id0]: true }, by: "test" }); await post("/api/set", { event: val.id, path: "val.aliveUsed", value: true, by: "test" });
    v2 = (await (await fetch(base + "/api/state")).json()).db.events.find(e => e.id === val.id);
    check("alive toggles are saved per player id", v2.val.dead[id0] === true && v2.val.aliveUsed === true && HUD.valInfo(HUD.model(v2, null)).left[0] === 4 && HUD.valInfo(HUD.model(v2, null)).left[1] === 5);
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAJ6xk2AAAAABJRU5ErkJggg==", "base64");
    fs.mkdirSync(path.join(dataDir, "val-agents"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "val-agents", `${AG}_displayicon.png`), PNG);
    fs.writeFileSync(path.join(dataDir, "val-agents", "agents.json"), JSON.stringify([{ uuid: AG, name: "Jett", role: "Duelist" }, { uuid: "5f8d3a7f-467b-97f3-062c-13acf203c006", name: "Breach", role: "Initiator" }]));
    const f1 = await (await fetch(`${base}/hud.json?event=${val.id}`)).json();
    check("vMix fields: ROUND, ROUNDS TO WIN, PLAYERS LEFT, and name, agent and alive per player", f1.ROUND === 1 && f1["ROUNDS TO WIN"] === 10 && f1["PLAYERS LEFT LEFT"] === 4 && f1["PLAYERS LEFT RIGHT"] === 5 && f1["P1 NAME"] === "Ann" && f1["P1 ALIVE"] === 0 && f1["P6 NAME"] === "Bob" && f1["P6 ALIVE"] === 1 && f1["P2 NAME"] === "" && f1["P1 AGENT"] === "Jett", JSON.stringify(f1).slice(0, 400));
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "app.html"), "utf8");
    check("+ Round and New match bring everyone back alive (the dashboard actions)", /case "valRound":[^\n]*put\("val\.dead",\{\}\);put\("val\.aliveUsed",false\)/.test(html) && /case "valReset":[^\n]*put\("val\.dead",\{\}\);put\("val\.aliveUsed",false\)/.test(html) && /case "valAllAlive":put\("val\.dead",\{\}\)/.test(html));
    // the agent route: nothing but a real uuid and an allowed picture kind; a cached picture is served from disk, an unknown one fails cleanly offline
    const status = p => fetch(base + p).then(r => r.status);
    for (const bad of ["/val-agent/not-a-uuid/displayicon.png", `/val-agent/${AG}/evil.png`, `/val-agent/${AG}/displayicon.jpg`, `/val-agent/${AG}/displayicon`, `/val-agent/${AG.toUpperCase()}/displayicon.png`, `/val-agent/${AG}/..%2F..%2Fdb.png`,
      `/val-agent/..%2F..%2Fsecret/displayicon.png`, `/val-agent/${AG}/displayicon.png/extra`, `/val-agent/${AG}x/displayicon.png`, `/val-agent//displayicon.png`, `/val-agent/${AG}/constructor.png`, `/val-agent/${AG}/%00.png`])
      check("agent route refuses " + bad, (await status(bad)) === 400, String(await status(bad)));
    const cp = await fetch(`${base}/val-agent/${AG}/displayicon.png`);
    check("a cached agent picture is served from disk as a PNG", cp.status === 200 && cp.headers.get("content-type") === "image/png" && (await cp.arrayBuffer()).byteLength === PNG.length, String(cp.status));
    const ag = await fetch(base + "/api/val/agents"), agl = await ag.json();
    check("the cached agent list is served (uuid, name, role)", ag.status === 200 && Array.isArray(agl) && agl[0].uuid === AG && agl[0].name === "Jett" && agl[0].role === "Duelist");
  } catch (e) { check("test ran", false, e.stack || e.message); }
  srv.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nGAMES TEST PASS");
  process.exit(failures ? 1 : 0);
})();
