// Run with: node test/scenes-test.js
// Draws every scene for every game and checks that a scene speaks the game it is showing: no Rocket League words (goals, saves,
// boost) on any other game, and no made-up "Player 1" placeholders where a game has no players.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const HUD = require("../public/hud.js");

let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) { console.log(" FAIL ", name, extra); failures++; } };
const text = html => String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "scenes-test-")), port = 7797, base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SAINTS_DATA: dataDir, PORT: String(port), ICON_BASE: "http://127.0.0.1:9/" }), stdio: "ignore" });
  await new Promise(r => setTimeout(r, 2500));
  const GAMES = ["Rocket League", "League of Legends", "Overwatch 2", "Call of Duty", "Deadlock", "Fortnite", "Valorant", "Counter-Strike 2", "Minecraft", "Riftbound", "Dead by Daylight"];
  const scenes = ["auto", ...Object.keys(HUD.SCENES)];
  const RL_WORDS = /\b(GOALS?|SAVES?|SHOTS?|DEMOS?|BOOST|GOAL DIFF|SUPERSONIC)\b/i;
  let drawn = 0;
  try {
    for (const g of GAMES) {
      const tpl = await (await fetch(`${base}/api/event-template?game=${encodeURIComponent(g)}`)).json();
      const variants = g === "Minecraft" ? [["Hunger Games", "hungergames"], ["Build Battle", "buildbattle"]] : [[g, null]];
      for (const [label, mode] of variants) {
        const ev = JSON.parse(JSON.stringify(tpl)); if (mode) ev.mc.mode = mode;
        if (g === "Minecraft") ev.teams[0].players = ["Alice", "Bob", "Cara"].map((ign, i) => ({ id: "p" + i, ign, alias: "", country: "", avatar: "", cam: "" }));
        const kind = HUD.model(ev, null).kind;
        const want = { "Rocket League": "rl", "League of Legends": "lol", "Minecraft": "mc", "Riftbound": "rb", "Dead by Daylight": "dbd", "Fortnite": "fn", "Valorant": "val" }[g] || "gen";
        check(`${label}: kind`, kind === want, `${kind} instead of ${want}`);
        for (const scene of scenes) {
          let html;
          try { html = HUD.sceneHtml(ev, null, scene, { kits: { "Saints Default": { seats: 2 } } }); } catch (e) { check(`${label} / ${scene}: draws`, false, e.message); continue; }
          drawn++;
          check(`${label} / ${scene}: returns markup`, typeof html === "string");
          const t = text(html);
          if (g !== "Rocket League") check(`${label} / ${scene}: no Rocket League words`, !RL_WORDS.test(t), t.match(RL_WORDS) + " in: " + t.slice(0, 120));
          if (["mc", "gen", "dbd", "fn", "val"].includes(kind)) check(`${label} / ${scene}: no made-up players`, !/PLAYER \d/i.test(t), t.slice(0, 120));
          if (g !== "Rocket League" && g !== "League of Legends") check(`${label} / ${scene}: no Blue/Orange placeholders`, !/\b(BLU|ORG)\b/.test(t) || kind === "gen" && /BLU|ORG/.test(t) === false, t.slice(0, 120));
        }
      }
    }
    check("standings label follows the game", HUD.gdLabel("Rocket League") === "GOAL DIFF" && HUD.gdLabel("League of Legends") === "GAME DIFF" && HUD.gdLabel("Valorant") === "ROUND DIFF" && HUD.gdLabel("Fortnite") === "POINTS" && HUD.gdLabel("Overwatch 2") === "DIFF");

    /* the scoring rules of the three scored-by-hand games */
    const fnEv = JSON.parse(JSON.stringify(await (await fetch(`${base}/api/event-template?game=Fortnite`)).json()));
    check("Fortnite starts as a field of duos", fnEv.teams.length === 8 && fnEv.teams.every(t => t.players.length === 2), fnEv.teams.length + " teams");
    const fn = fnEv.fn;
    check("Fortnite placement tiers", HUD.fnPoints(fn, 1, 0) === 10 && HUD.fnPoints(fn, 2, 0) === 7 && HUD.fnPoints(fn, 4, 0) === 3 && HUD.fnPoints(fn, 10, 0) === 1 && HUD.fnPoints(fn, 11, 0) === 0);
    check("Fortnite eliminations add points, and an empty match adds none", HUD.fnPoints(fn, 1, 5) === 15 && HUD.fnPoints(fn, 0, 3) === 3 && HUD.fnPoints(fn, 0, 0) === 0);
    fn.matches = [{ place: [1, 2, 3, 4, 0, 0, 0, 0], elims: [4, 6, 2, 0, 0, 0, 0, 0] }, { place: [3, 1, 2, 12, 0, 0, 0, 0], elims: [1, 3, 3, 0, 0, 0, 0, 0] }];
    const tbl = HUD.fnTable(fnEv);
    check("Fortnite table adds the matches up", tbl[0].team.id === fnEv.teams[1].id && tbl[0].pts === 7 + 6 + 10 + 3 && tbl[0].wins === 1 && tbl[0].played === 2, JSON.stringify(tbl.slice(0, 2).map(r => [r.team.name, r.pts])));
    check("Fortnite ties share a rank", (() => { const e2 = JSON.parse(JSON.stringify(fnEv)); e2.fn.matches = [{ place: [1, 1, 0, 0, 0, 0, 0, 0], elims: [0, 0, 0, 0, 0, 0, 0, 0] }]; const r = HUD.fnTable(e2); return r[0].rank === 1 && r[1].rank === 1 && r[2].rank === 3; })());
    check("Fortnite leaderboard scene lists the leader first", text(HUD.sceneHtml(fnEv, null, "statsteam")).indexOf(fnEv.teams[1].name) < text(HUD.sceneHtml(fnEv, null, "statsteam")).indexOf(fnEv.teams[2].name));

    const dbEv = JSON.parse(JSON.stringify(await (await fetch(`${base}/api/event-template?game=Dead%20by%20Daylight`)).json()));
    check("Dead by Daylight teams have a killer and four survivors", dbEv.teams.every(t => t.players.length === 5));
    dbEv.dbd.trials = [{ killer: 0, kills: 3, escapes: 1, gens: 4 }, { killer: 1, kills: 2, escapes: 2, gens: 3 }];
    Object.assign(dbEv.dbd, { killPts: 2, escapePts: 3, genPts: 1 });
    const ds = HUD.dbdScore(dbEv);
    check("Dead by Daylight scores the killer per kill and the survivors per escape and generator", ds.trials[0].pts[0] === 6 && ds.trials[0].pts[1] === 7 && ds.trials[1].pts[1] === 4 && ds.trials[1].pts[0] === 9 && ds.total[0] === 15 && ds.total[1] === 11, JSON.stringify(ds));
    check("Dead by Daylight scorebug shows those points", /\b15\b/.test(text(HUD.sceneHtml(dbEv, null, "ingame"))) && /TRIAL 2/.test(text(HUD.sceneHtml(dbEv, null, "ingame"))));

    const vEv = JSON.parse(JSON.stringify(await (await fetch(`${base}/api/event-template?game=Valorant`)).json()));
    check("VALORANT 2v2 Skirmish has two players a side and plays first to 10", vEv.teams.every(t => t.players.length === 2) && vEv.val.target === 10 && /FIRST TO 10/.test(text(HUD.sceneHtml(vEv, null, "ingame"))));
  } catch (e) { check("test ran", false, e.stack || e.message); }
  srv.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED (${drawn} scenes drawn)` : `\nSCENES TEST PASS (${drawn} scenes drawn)`);
  process.exit(failures ? 1 : 0);
})();
