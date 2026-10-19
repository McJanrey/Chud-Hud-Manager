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

    /* VALORANT in-game scene (phase C2): top bar, players-left tab, sponsor boxes, player panels */
    const AG = "add6443a-41bd-e414-f6ad-e58d267f4e95";
    const vmk = (f, squad = 2) => {
      const e = JSON.parse(JSON.stringify(vEv)); e.val.squad = squad;
      e.teams.forEach((t, ti) => { while (t.players.length < squad) t.players.push({ id: "x" + ti + t.players.length, ign: "", alias: "", country: "", avatar: "", cam: "", agent: "" });
        t.players.forEach((p, i) => { p.ign = ["Ann#EU1", "Bob#EU2", "Cy#EU3", "Di#EU4", "Ed#EU5"][i] + (ti ? "x" : ""); p.agent = ""; p.avatar = ""; }); });
      f && f(e); return e;
    };
    const vh = (e, g) => HUD.sceneHtml(e, g || null, "ingame"), cnt = (h, re) => (h.match(re) || []).length;
    let vv = vh(vmk(e => { e.live.score = [3, 2]; e.live.autoScore = false; }));
    check("VALORANT: one score per side and no leftover scorebug (the score was printed twice before)", cnt(vv, /class="sc [lr] num"/g) === 2 && !/h-bug|h-series|h-team/.test(vv) && /sc l num">3</.test(vv) && /sc r num">2</.test(vv), vv.slice(0, 200));
    check("VALORANT: the round line says ROUND n · FIRST TO N (scores + 1)", /ROUND 6 · FIRST TO 10/.test(text(vv)), text(vv).slice(0, 160));
    check("VALORANT: the round number never passes what first-to-N allows", /ROUND 19 · FIRST TO 10/.test(text(vh(vmk(e => { e.live.score = [10, 9]; e.live.autoScore = false; })))) && /ROUND 1 · FIRST TO 3/.test(text(vh(vmk(e => { e.val.target = 3; })))));
    check("VALORANT: team names print without a #TAG when the name comes from a Riot ID", (() => { const h = vh(vmk(e => { e.teams[0].name = ""; e.teams[0].players[0].ign = "Zed#EUW"; })); return /Zed<\/b>/.test(h) && !/#EUW/.test(h); })());
    // the clock only while it keeps arriving
    const gClock = at => ({ players: [], teams: [{ score: 0 }, { score: 0 }], feed: [], time: 95, clockLive: true, clockAt: at, connected: true, source: "ocr" });
    check("VALORANT: no timer without a clock, or with a stale one", !/class="tm/.test(vv) && !/class="tm/.test(vh(vmk(), gClock(Date.now() - 9000))) && !/class="tm/.test(vh(vmk(), Object.assign(gClock(0), { clockAt: undefined }))));
    check("VALORANT: odd scores print as whole numbers, never as markup or NaN", (() => { const h = vh(vmk(e => { e.live.score = ["<i>x</i>", "4.6"]; e.live.autoScore = false; })); return /sc l num">0</.test(h) && /sc r num">5</.test(h) && !/<i>x/.test(h); })());
    check("VALORANT 4v4 and 5v5: the players-left tab widens so both sides fit", vh(vmk(e => { e.val.aliveUsed = true; }, 5)).includes('class="v3-pl w"') && !vh(vmk(e => { e.val.aliveUsed = true; }, 3)).includes('class="v3-pl w"'));
    check("VALORANT: the timer shows while the clock is fresh", /class="tm num">1:35</.test(vh(vmk(), gClock(Date.now() - 1000))));
    // players left: hidden until a toggle has been used, then the alive count per side
    check("VALORANT: players-left is hidden until an alive toggle has been used", !vv.includes("v3-pl") && !vh(vmk(e => { e.val.aliveUsed = false; e.val.dead = {}; })).includes("v3-pl"));
    const dv = vmk(e => { e.val.aliveUsed = true; e.val.dead = { [e.teams[0].players[0].id]: true }; });
    vv = vh(dv);
    const side = (h, s) => (h.match(new RegExp(`data-k="pl-${s}"[\\s\\S]*?</span></span>`)) || [""])[0];
    check("VALORANT 2v2: pips show one of two alive on the left and two of two on the right, no digit", vv.includes("v3-pl") && cnt(side(vv, 0), /<i class="on">/g) === 1 && cnt(side(vv, 0), /<i class="">/g) === 1 && cnt(side(vv, 1), /<i class="on">/g) === 2 && !/<b class="num">\d<\/b><span class="pp">/.test(vv), side(vv, 0));
    const d5 = vmk(e => { e.val.aliveUsed = true; e.val.dead = { [e.teams[0].players[0].id]: true, [e.teams[0].players[1].id]: true }; }, 5);
    vv = vh(d5);
    check("VALORANT 5v5: a digit plus pips (3 left of 5)", cnt(side(vv, 0), /<i class="on">/g) === 3 && /<b class="num">3<\/b><span class="pp">/.test(vv) && /<b class="num">5<\/b><span class="pp">/.test(vv));
    check("VALORANT: nothing is hidden when the toggle is used but all are alive", vh(vmk(e => { e.val.aliveUsed = true; })).includes("v3-pl"));
    // sponsor boxes
    check("VALORANT: no sponsor boxes without sponsors", !vh(vmk()).includes("v3-sp"));
    const spV = vmk(e => { e.tournament.sponsors = [{ name: "SIDEKICK", logo: "", type: "secondary" }, { name: "MAINCO", logo: "/x/main.png", type: "main" }, { name: "THIRD", logo: "/x/third.png", type: "secondary" }]; });
    const dnow = Date.now; Date.now = () => 0; const s0 = vh(spV); Date.now = () => 8000; const s1 = vh(spV); Date.now = dnow;
    check("VALORANT: the main sponsor sits on the left under PRESENTED BY, as an image that hides itself if it breaks", /v3-sp l[\s\S]*PRESENTED BY[\s\S]*src="\/x\/main.png"[^>]*onerror/.test(s0));
    check("VALORANT: the other sponsors rotate every 8 s on the right", /v3-sp r[\s\S]*SIDEKICK/.test(s0) && !/v3-sp r[\s\S]*third/.test(s0) && /v3-sp r[\s\S]*\/x\/third.png/.test(s1) && !/v3-sp r[\s\S]*SIDEKICK/.test(s1));
    check("VALORANT: only a main sponsor means only the left box; the sponsor switch hides both", (() => { const h = vh(vmk(e => { e.tournament.sponsors = [{ name: "ONLY", logo: "", type: "main" }]; })); return h.includes("v3-sp l") && !h.includes("v3-sp r"); })() && !vh(vmk(e => { e.tournament.sponsors = [{ name: "A", logo: "" }]; e.hud.show.sponsor = false; })).includes("v3-sp"));
    // player panels
    vv = vh(vmk());
    check("VALORANT squad 2: four panels, bottom-anchored (590 and 655), 237 wide, no 'Player N'", cnt(vv, /class="v3-p /g) === 4 && vv.includes("top:590px") && vv.includes("top:655px") && !/PLAYER \d/i.test(text(vv)), vv.slice(0, 100));
    vv = vh(vmk(null, 5));
    check("VALORANT squad 5: ten panels from y 395 to the bottom", cnt(vv, /class="v3-p /g) === 10 && vv.includes("top:395px") && vv.includes("top:655px") && !/PLAYER \d/i.test(text(vv)));
    check("VALORANT: a squad bigger than the roster draws no padded or blank seats", (() => { const h = vh(vmk(e => { e.teams[0].players.splice(1); e.teams[1].players[1].ign = ""; e.teams[1].players[1].alias = ""; }, 3)); return cnt(h, /class="v3-p /g) === 3 && !/PLAYER \d|Player \d/.test(h); })());
    check("VALORANT: names lose their #TAG and the alias wins", (() => { const h = vh(vmk(e => { e.teams[0].players[1].alias = "Bobby"; })); return />Ann<\/b>/.test(h) && />Bobby<\/b>/.test(h) && !/#EU/.test(h); })());
    check("VALORANT: an initials tile in the team colour when a player has no art", /class="in">AN</.test(vv) && !/class="ag"/.test(vv));
    vv = vh(vmk(e => { e.teams[0].players[0].agent = AG; e.teams[0].players[1].avatar = "/uploads/b.png"; e.teams[1].players[0].agent = "../../x"; }));
    check("VALORANT: an agent shows its cached icon, else the player's avatar, else initials; a bad agent value is ignored", vv.includes(`src="/val-agent/${AG}/displayicon.png"`) && vv.includes('class="av"') && vv.includes('src="/uploads/b.png"') && !/val-agent\/\.\./.test(vv) && cnt(vv, /class="in">AN</g) === 1 && cnt(vv, /class="in">BO</g) === 1);
    HUD.artFail(`/val-agent/${AG}/displayicon.png`);
    check("VALORANT: a picture that failed to load falls back to the initials tile", !vh(vmk(e => { e.teams[0].players[0].agent = AG; })).includes("val-agent") && /class="in">AN</.test(vh(vmk(e => { e.teams[0].players[0].agent = AG; }))));
    vv = vh(vmk(e => { e.val.aliveUsed = true; e.val.dead = { [e.teams[1].players[0].id]: true }; }));
    check("VALORANT: a dead player is dimmed (class dead) and the others are not", cnt(vv, /class="v3-p [lr] dead"/g) === 1 && /vp-1-0"/.test(vv.match(/class="v3-p r dead"[^>]*>/)[0]) && cnt(vv, /class="v3-p [lr]"/g) === 3);
    check("VALORANT: no HP, ultimate or credits are drawn without values", !/class="hv|class="cr|class="ul|<i style="transform/.test(vv));
    check("VALORANT: HP, ultimate and credits appear only for a player object that carries them", (() => { const g = { players: [{ name: "Ann#EU1", team: 0, shortcut: 1, hp: 80, hpMax: 100, ult: 3, ultMax: 7, credits: 3900 }], teams: [{ score: 0 }, { score: 0 }], feed: [], time: 0, source: "ocr" };
      const m = HUD.model(vmk(), g), h = HUD.sceneHtml(vmk(), g, "ingame"); return m.players[0][0].hp === 80 && /class="hv num">80</.test(h) && /class="cr num">3900</.test(h) && cnt(h, /<span class="ul"[\s\S]*?<\/span>/g) === 1; })());
    check("VALORANT: no Rocket League words and no BLU/ORG anywhere in the scene", !RL_WORDS.test(text(vh(spV))) && !/\b(BLU|ORG)\b/.test(text(vh(spV))));
    check("VALORANT: the scene reads the squad setting (model)", HUD.model(vmk(null, 5), null).players[0].length === 5 && HUD.model(vmk(null, 3), null).players[1].length === 3);
    // cameras: unchanged keys and counts, VALORANT's own boxes
    const vcam = vmk(e => { e.hud.show.playerCam = true; e.teams.forEach((t, ti) => t.players.forEach((p, i) => { p.cam = "https://cam.example/v" + ti + i; })); });
    let vc = HUD.sceneOut(vcam, null, "ingame");
    check("VALORANT cameras (all): 116 x 65 tile on the inner side of each panel row, keys pc-<side>-<i>, every one shown", vc.cams.length === 4 && vc.cams.every(c => c.show === undefined && c.w === 116 && c.h === 65 && /^pc-[01]-\d/.test(c.key)) && vc.cams.find(c => c.key.startsWith("pc-0-0")).x === 237 && vc.cams.find(c => c.key.startsWith("pc-0-0")).y === 590 && vc.cams.find(c => c.key.startsWith("pc-1-1")).x === 927 && vc.cams.find(c => c.key.startsWith("pc-1-1")).y === 655, JSON.stringify(vc.cams.map(c => [c.key.slice(0, 6), c.x, c.y])));
    vcam.camera.director = "action"; vc = HUD.sceneOut(vcam, null, "ingame");
    check("VALORANT cameras (action): 240 x 135 at x 245 / 795, y 564, all loaded, exactly one shown a side, name plate under it", vc.cams.length === 4 && vc.cams.every(c => /^ac-[01]-\d/.test(c.key) && c.w === 240 && c.h === 135 && c.y === 564) && vc.cams.filter(c => c.key.startsWith("ac-0-")).every(c => c.x === 245) && vc.cams.filter(c => c.key.startsWith("ac-1-")).every(c => c.x === 795) && vc.cams.filter(c => c.show).length === 2 && /pc act l[\s\S]*pc act r/.test(vc.html), JSON.stringify(vc.cams.map(c => [c.key.slice(0, 5), c.show])));
    check("VALORANT cameras: five a side follow the panel rows (y 395 first)", (() => { const e5 = vmk(e => { e.hud.show.playerCam = true; e.teams.forEach((t, ti) => t.players.forEach((p, i) => { p.cam = "https://cam.example/w" + ti + i; })); }, 5); const o = HUD.sceneOut(e5, null, "ingame"); return o.cams.length === 10 && o.cams.find(c => c.key.startsWith("pc-0-0")).y === 395 && o.cams.find(c => c.key.startsWith("pc-1-4")).y === 655; })());

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
