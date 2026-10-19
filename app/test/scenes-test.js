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

    /* player webcams: on the newer games too, and "only the player in the action" */
    const camEv = JSON.parse(JSON.stringify(vEv)); camEv.hud.show.playerCam = true;
    camEv.teams.forEach((t, ti) => t.players.forEach((p, i) => { p.ign = ["Ann", "Bob", "Cy", "Di"][ti * 2 + i]; p.cam = "https://cam.example/" + p.ign; }));
    let out = HUD.sceneOut(camEv, null, "ingame");
    check("webcams show on VALORANT's in-game scene, one slot per player", out.cams.length === 4 && out.cams.every(c => c.show === undefined), out.cams.length + " cams");
    camEv.camera.director = "action";
    out = HUD.sceneOut(camEv, null, "ingame");
    check("'action' keeps every camera loaded but shows one a side", out.cams.length === 4 && out.cams.filter(c => c.show).length === 2 && out.cams.filter(c => c.show === false).length === 2);
    const feed = [{ t: Date.now() - 3000, type: "kill", main: { name: "Bob", team: 0 }, second: { name: "Cy", team: 1 } }];
    out = HUD.sceneOut(camEv, { feed, players: [], teams: [{ score: 0 }, { score: 0 }] }, "ingame");
    check("the camera follows the player in the latest kill", out.cams.find(c => c.show && c.key.startsWith("ac-0-")).key.startsWith("ac-0-1"), JSON.stringify(out.cams.map(c => [c.key.slice(0, 7), c.show])));
    feed[0].t = Date.now() - 20000;
    out = HUD.sceneOut(camEv, { feed, players: [], teams: [{ score: 0 }, { score: 0 }] }, "ingame");
    check("after twelve seconds it goes back to the first player", out.cams.find(c => c.show && c.key.startsWith("ac-0-")).key.startsWith("ac-0-0"));
    camEv.camera.pin = [2, 1];
    out = HUD.sceneOut(camEv, { feed: [{ t: Date.now(), type: "kill", main: { name: "Ann", team: 0 } }], players: [], teams: [{ score: 0 }, { score: 0 }] }, "ingame");
    check("a pinned player beats the action", out.cams.find(c => c.show && c.key.startsWith("ac-0-")).key.startsWith("ac-0-1") && out.cams.find(c => c.show && c.key.startsWith("ac-1-")).key.startsWith("ac-1-0"));
    const dbdCam = JSON.parse(JSON.stringify(dbEv)); dbdCam.hud.show.playerCam = true; dbdCam.teams[0].players[0].cam = "https://cam.example/k"; dbdCam.teams[1].players[0].cam = "https://cam.example/s";
    check("webcams show on Dead by Daylight's scene", HUD.sceneOut(dbdCam, null, "ingame").cams.length === 2);
    const fnCam = JSON.parse(JSON.stringify(fnEv)); fnCam.hud.show.playerCam = true; fnCam.teams[1].players.forEach((p, i) => { p.cam = "https://cam.example/f" + i; }); fnCam.fn.spotlight = fnCam.teams[1].id;
    check("Fortnite shows the cameras of the team you pick", HUD.sceneOut(fnCam, null, "ingame").cams.length === 2);
    fnCam.fn.spotlight = ""; fnCam.fn.matches = [{ place: [2, 1, 3, 4, 5, 6, 7, 8], elims: [0, 0, 0, 0, 0, 0, 0, 0] }];
    check("or the leader's when none is picked", HUD.sceneOut(fnCam, null, "ingame").cams.length === 2);
    check("webcams stay off unless switched on", HUD.sceneOut(JSON.parse(JSON.stringify(vEv)), null, "ingame").cams.length === 0);

    /* League of Legends in-game scene (Worlds-style): bottom band, board, focus panel, sponsor box, minimap frame, stacks, EST, bars, cameras */
    const lolEv = JSON.parse(JSON.stringify(await (await fetch(`${base}/api/event-template?game=${encodeURIComponent("League of Legends")}`)).json()));
    check("League events carry the new band switches and a seed field per team", lolEv.hud.show.focus === true && lolEv.hud.show.sponsor === true && lolEv.hud.show.minimap === true && lolEv.teams.every(t => t.seed === ""), JSON.stringify(lolEv.hud.show));
    const names = ["Top1", "Jng1", "Mid1", "Bot1", "Sup1", "Top2", "Jng2", "Mid2", "Bot2", "Sup2"];
    const mkGame = () => ({ players: names.map((name, i) => ({ name, id: name, team: i < 5 ? 0 : 1, shortcut: i + 1, champion: "Ahri", champKey: "Ahri", level: 9 + (i % 3), kills: i, deaths: 1, assists: 2, cs: 100 + i,
      ward: 7, gold: 5000 + (i < 5 ? 600 * (i + 1) : 0), items: [3157, 3020, 0, 0, 0, 0, 3340], counts: [1, 1, 0, 0, 0, 0, 1], spells: ["SummonerFlash", "SummonerDot"], keystone: "perk-images/Styles/x.png", dead: i === 7, respawn: i === 7 ? 21 : 0 })),
      teams: [{ score: 5 }, { score: 4 }], feed: [], time: 700, clockLive: true, connected: true, source: "lol",
      lol: { ddVersion: "14.1.1", goldMode: "estimate", counters: { dragons: true, heralds: true, grubs: true }, kills: [10, 20], gold: [30000, 31000], towers: [2, 1], dragons: [["Ocean"], []], elders: [0, 0], heralds: [1, 0], grubs: [3, 0], barons: [0, 0], timers: {}, buffs: {} } });
    const lolHtml = (e, g, scene = "ingame") => HUD.sceneHtml(e, g, scene);
    const mk = f => { const e = JSON.parse(JSON.stringify(lolEv)); e.lol = Object.assign({ focus: "auto" }, e.lol); f && f(e); return e; };
    let lg0 = mkGame(), lh = lolHtml(mk(), lg0);
    check("League: the bottom band, the board's ten halves and the top bar draw", /class="l3-band"|data-k="l3-band"/.test(lh) && (lh.match(/class="l3-h[ "]/g) || []).length === 10 && lh.includes("l3-bar") && lh.includes("l3-board"), lh.slice(0, 200));
    check("League: no old layout classes remain", !/\b(l2-|lp-|tf-)[a-z]/.test(lh));
    check("League: five lane rows show the gold difference with an arrow to the leader", (lh.match(/class="l3-d l"/g) || []).length >= 1 && lh.includes('class="ar"') && /\d\.\dK/.test(text(lh)));
    check("League: nothing prints Rocket League words (lane board, teamfight strip, focus)", !RL_WORDS.test(text(lh)) && !RL_WORDS.test(text(lolHtml(mk(e => { e.hud.lolPanel = "fight"; e.lol.focus = "2"; }), lg0))), text(lh).match(RL_WORDS) + "");
    const noTeams = text(lolHtml(mk(e => { e.live.left = ""; e.live.right = ""; e.teams = []; }), null));
    check("League: placeholders stay BLUE and RED", /BLUE/.test(noTeams) && /RED/.test(noTeams), noTeams.slice(0, 80));
    check("League: the team stats page also says BLUE and RED without teams", (() => { const t = text(lolHtml(mk(e => { e.live.left = ""; e.live.right = ""; e.teams = []; }), null, "statsteam")); return /BLUE/.test(t) && /RED/.test(t) && !/\b(BLU|ORG)\b/.test(t); })());
    check("League: broken numbers never print NaN", (() => { const g = mkGame(); g.lol.kills = [NaN, undefined]; g.lol.gold = [NaN, "x"]; g.players[0].gold = NaN; return !/NaN|undefined/.test(text(lolHtml(mk(), g))); })());
    // the focus panel
    check("League: focus panel is absent in auto without a recent kill", !lh.includes("l3-focus"));
    check("League: focus panel appears for a chosen player and shows that player", (() => { const h = lolHtml(mk(e => { e.lol.focus = "3"; }), lg0); return h.includes("l3-focus") && /l3-focus[\s\S]*Bot1/.test(h); })());
    check("League: focus index 5 is the first player of the right side", /l3-focus[\s\S]*Top2/.test(lolHtml(mk(e => { e.lol.focus = "5"; }), lg0)));
    lg0 = mkGame(); lg0.feed = [{ t: Date.now() - 2000, type: "kill", main: { name: "Mid2", team: 1 }, second: { name: "Top1", team: 0 } }];
    check("League: in auto the focus panel follows the player in a kill of the last 12 seconds", /l3-focus[\s\S]*Mid2/.test(lolHtml(mk(), lg0)));
    lg0.feed.push({ t: Date.now() - 500, type: "kill", main: { name: "Jng1", team: 0 }, second: { name: "Top2", team: 1 } });
    check("League: ...the most recent kill across both sides wins", /<div class="l3-focus[^>]*>[\s\S]*?<b>Jng1<\/b>/.test(lolHtml(mk(), lg0)));
    lg0.feed.forEach(f => { f.t = Date.now() - 30000; });
    check("League: ...and it goes away after twelve seconds", !lolHtml(mk(), lg0).includes("l3-focus"));
    check("League: the focus switch hides the panel", !lolHtml(mk(e => { e.lol.focus = "1"; e.hud.show.focus = false; }), mkGame()).includes("l3-focus"));
    // sponsor box
    check("League: no sponsor box without sponsors", !lh.includes("l3-sp"));
    const spEv = mk(e => { e.tournament.sponsors = [{ name: "SIDEKICK", logo: "", type: "secondary" }, { name: "MAINCO", logo: "/x/main.png", type: "main" }]; });
    const dn = Date.now; Date.now = () => 0; const sp0 = lolHtml(spEv, mkGame()); Date.now = () => 8000; const sp1 = lolHtml(spEv, mkGame()); Date.now = dn;
    check("League: the sponsor box shows the main sponsor first, logo as an image", sp0.includes("l3-sp") && sp0.includes('src="/x/main.png"') && !sp0.includes("SIDEKICK"));
    check("League: ...then rotates to the next sponsor (name text without a logo)", sp1.includes("SIDEKICK") && !sp1.includes("/x/main.png"));
    check("League: the sponsor switch hides the box", !lolHtml(mk(e => { e.tournament.sponsors = [{ name: "A", logo: "" }]; e.hud.show.sponsor = false; }), mkGame()).includes("l3-sp"));
    // minimap frame
    check("League: minimap frame shows and toggles off", lh.includes("l3-map") && !lolHtml(mk(e => { e.hud.show.minimap = false; }), mkGame()).includes("l3-map"));
    // stacks
    check("League: no stack count below 2", !/<em>\d+<\/em>/.test(lh));
    lg0 = mkGame(); lg0.players[0].counts[1] = 3;
    check("League: a stack count above 1 is drawn on its item", /<em>3<\/em>/.test(lolHtml(mk(), lg0)));
    // EST mark
    check("League: the EST mark shows with the estimate gold mode", /class="est"/.test(lh));
    lg0 = mkGame(); lg0.lol.goldMode = "manual";
    check("League: ...and not with typed-in gold, nor with item value", !/class="est"/.test(lolHtml(mk(), lg0)) && !/class="est"/.test(lolHtml(mk(), Object.assign(mkGame(), { lol: Object.assign(mkGame().lol, { goldMode: "items" }) }))));
    // bars only with data
    check("League: no health, mana or experience bar without such data", !lh.includes('class="bars"'));
    lg0 = mkGame(); lg0.players[2].hp = 400; lg0.players[2].hpMax = 800;
    check("League: a bar renders only for a player object that carries one", (lolHtml(mk(), lg0).match(/class="bars"/g) || []).length === 1);
    // seed under the tag
    check("League: the team seed prints under the tag, and only when set", /LCK #3/.test(text(lolHtml(mk(e => { e.teams[0].seed = "LCK #3"; e.live.left = e.teams[0].id; e.live.right = e.teams[1].id; }), mkGame()))) && !/LCK #3/.test(text(lh)));
    // teamfight strip lives in the board's box
    const fh = lolHtml(mk(e => { e.hud.lolPanel = "fight"; }), mkGame());
    check("League: the teamfight strip replaces the board", fh.includes("l3-fight") && !fh.includes("l3-board") && /TEAMFIGHT/.test(text(fh)));
    // cameras: one big camera per team, keys ac-<side>-<i>, exactly one shown per side, whatever the director says
    const camL = mk(e => {
      e.hud.show.playerCam = true; e.live.left = e.teams[0].id; e.live.right = e.teams[1].id;
      e.teams.forEach((t, ti) => { t.players = names.slice(ti * 5, ti * 5 + 5).map((ign, i) => ({ id: "p" + ti + i, ign, alias: "", country: "", avatar: "", cam: "https://cam.example/" + ign })); });
    });
    ["all", "action"].forEach(dir => {
      camL.camera.director = dir;
      const co = HUD.sceneOut(camL, mkGame(), "ingame");
      check(`League (director ${dir}): ten cameras stay loaded, keys ac-<side>-<i>, one shown per side`, co.cams.length === 10 && co.cams.every(c => /^ac-[01]-\d/.test(c.key)) && co.cams.filter(c => c.key.startsWith("ac-0-") && c.show).length === 1 && co.cams.filter(c => c.key.startsWith("ac-1-") && c.show).length === 1, JSON.stringify(co.cams.map(c => c.key.slice(0, 7))));
      check(`League (director ${dir}): the cameras sit in the band boxes (150 and 970, 117 x 147)`, co.cams.filter(c => c.key.startsWith("ac-0-")).every(c => c.x === 150 && c.y === 547 && c.w === 117 && c.h === 147) && co.cams.filter(c => c.key.startsWith("ac-1-")).every(c => c.x === 970 && c.w === 117 && c.h === 147));
    });
    lg0 = mkGame(); lg0.feed = [{ t: Date.now() - 1000, type: "kill", main: { name: "Mid2", team: 1 }, second: { name: "Top1", team: 0 } }];
    check("League: the camera follows the player in the latest kill, with a name plate under it", (() => { const co = HUD.sceneOut(camL, lg0, "ingame"); return co.cams.find(c => c.show && c.key.startsWith("ac-1-")).key.startsWith("ac-1-2") && /l3-cam r[\s\S]*Mid2/.test(co.html); })());
    check("League: no cameras unless webcams are switched on", HUD.sceneOut(mk(), mkGame(), "ingame").cams.length === 0 && !lh.includes("l3-cam"));

    /* names read from a screen */
    const nm = HUD.nameMatch;
    check("a misread character still matches", nm("Jazii", "Jaz1i") && nm("SaintJordan", "SaintJord4n") && nm("valyn", "G2 valyn"));
    check("different names never match, and short names must be exact", !nm("Player1", "Player2") && !nm("abc", "abd") && !nm("Jazii", "Pzy") && nm("Pzy", "pzy"));
  } catch (e) { check("test ran", false, e.stack || e.message); }
  srv.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED (${drawn} scenes drawn)` : `\nSCENES TEST PASS (${drawn} scenes drawn)`);
  process.exit(failures ? 1 : 0);
})();
