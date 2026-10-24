// Run with: node test/ticker-test.js
// The bottom announcement (speed and two lines) and the match text are edited in small panels over the HUD Editor's preview,
// opened from the tick's name. The overlay reads the two lines and the speed; the panel code is in app.html.
"use strict";
const fs = require("fs"), path = require("path");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };
const HUD = require("../public/hud.js");
const html = fs.readFileSync(path.join(__dirname, "..", "public", "app.html"), "utf8"), server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const ev = f => { const e = { id: "e", name: "X", game: "Valorant", tournament: { name: "NACE", logos: [], sponsors: [] }, live: { left: "a", right: "b", score: [0, 0], series: [0, 0] }, teams: [{ id: "a", name: "A", tag: "A", color: "#fff", logos: [], players: [] }, { id: "b", name: "B", tag: "B", color: "#000", logos: [], players: [] }],
  schedule: [], lowerThird: { label: "LOCAL TIME", ticker: "" }, ads: {}, hud: { scene: "lowerthird", show: {}, sc: {} }, camera: {}, val: {}, rb: {}, fn: {}, dbd: {} }; f && f(e); return e; };
const dur = e => { const m = /animation-duration:(\d+)s/.exec(HUD.sceneHtml(e, null, "lowerthird")); return m ? +m[1] : null; };

// speed
check("the speed defaults to 60 and stays between 10 and 200", HUD.tickerSpeed(ev()) === 60 && HUD.tickerSpeed(ev(e => { e.lowerThird.tickerSpeed = 999; })) === 200 && HUD.tickerSpeed(ev(e => { e.lowerThird.tickerSpeed = 1; })) === 10 && HUD.tickerSpeed(ev(e => { e.lowerThird.tickerSpeed = "junk"; })) === 60);
const d60 = dur(ev(e => { e.lowerThird.ticker = "Doors at six | See you next time"; })), d120 = dur(ev(e => { e.lowerThird.ticker = "Doors at six | See you next time"; e.lowerThird.tickerSpeed = 120; })), d20 = dur(ev(e => { e.lowerThird.ticker = "Doors at six | See you next time"; e.lowerThird.tickerSpeed = 20; }));
check("speed 120 scrolls twice as fast as 60, speed 20 three times slower", d60 > 0 && d120 === Math.round(d60 / 2) && Math.abs(d20 - d60 * 3) <= 1, [d60, d120, d20].join());
check("the pace at speed 60 is the long-standing one (a short message loops in 18 s at least)", dur(ev(e => { e.lowerThird.ticker = "Hi"; })) >= 18);

// the two lines
const t = HUD.tickerLines(ev(e => { e.lowerThird.ticker = "one | two | three | four"; }));
check("an older announcement splits into Line 1, Line 2 and the rest (nothing is lost)", t.l1 === "one" && t.l2 === "two" && t.more.join() === "three,four", JSON.stringify(t));
check("once the lines are set they keep their place, even when Line 1 is empty", (x => x.l1 === "" && x.l2 === "second")(HUD.tickerLines(ev(e => { e.lowerThird.line1 = ""; e.lowerThird.line2 = "second"; e.lowerThird.ticker = "second"; }))));
check("the lines join as 'a | b' and empty ones are skipped", HUD.tickerJoin("a", "b") === "a | b" && HUD.tickerJoin("", "b") === "b" && HUD.tickerJoin("a", "b", ["c"]) === "a | b | c" && HUD.tickerJoin("", "") === "");
check("a divider typed inside a line cannot split it into extra messages", HUD.tickerJoin("a | b", "c") === "a b | c");
check("both lines scroll on the overlay, in capitals", (h => /<span>DOORS AT SIX<\/span>/.test(h) && /<span>SEE YOU NEXT TIME<\/span>/.test(h))(HUD.sceneHtml(ev(e => { e.lowerThird.ticker = HUD.tickerJoin("Doors at six", "See you next time"); }), null, "lowerthird")));
check("the server keeps the speed in range", /tickerSpeed: 60 \}, ev\.lowerThird\); ev\.lowerThird\.tickerSpeed = Math\.max\(10, Math\.min\(200/.test(server));

// the panels
check("the Bottom Announcement and Match Text ticks open panels from their names (the checkbox stays separate)", /const tkHas=\(sc,k\)=>k==="ticker"\|\|k==="match"/.test(html) && /class="tklbl\$\{ui\.tkp===k\?" on":""\}" data-act="tkPanel"/.test(html) && /<input type="checkbox" id="\$\{fid\(p\)\}" data-bind="\$\{p\}"/.test(html));
check("the announcement panel has a reset arrow, Speed (10 to 200) and Line 1 and Line 2", /aria-label="Bottom Announcement"/.test(html) && /data-act="tkReset" data-arg="ticker"/.test(html) && /type="range" class="tkrange" min="10" max="200"/.test(html) && /data-tkline="1"/.test(html) && /data-tkline="2"/.test(html));
check("the match text panel has Title and Subtitle with the defaults as hints", /aria-label="Match Text"/.test(html) && /data-tktext="title"/.test(html) && /data-tktext="subtitle"/.test(html) && /placeholder="\$\{esc\(e\.tournament\.name\|\|e\.game\|\|""\)\}"/.test(html));
check("typing and dragging in a panel reach the overlay at once (no Save Changes)", /if\(el\.dataset\.tkline\|\|el\.dataset\.tkspeed!==undefined\|\|el\.dataset\.tktext\)\{tkEdit\(el\);return\}/.test(html) && /put\("lowerThird",L\);updateStages\(\)/.test(html));
check("Escape closes the panel and the tick name toggles it", /k\.key==="Escape"&&ui\.tkp/.test(html) && /case "tkPanel":ui\.tkp=ui\.tkp===arg\?"":arg/.test(html));
check("the old Lower Third page no longer has its own announcement box (one place to edit)", !/F\.text\("lowerThird\.ticker"/.test(html) && !/F\.text\("lowerThird\.title"/.test(html) && /<b>HUD Editor<\/b>: pick a scene and click/.test(html));

// the other ticks have panels too
const sc = (scene, o, f) => HUD.sceneHtml(ev(e => { e.hud.scene = scene; e.hud.sc = { [scene]: o }; f && f(e); }), null, scene);
check("every tick with something to type or pick opens a panel, and its fields act at once", ["bg", "top", "banner", "team", "title", "count", "logo", "stats"].every(k => html.includes(k + ':{t:"')) && /const LIVE_SC=/.test(html));
check("the Background colour shows on the overlay and a bad colour is ignored", /class="bp-bg" style="background:#112233"/.test(sc("statsteam", { bg: true, bgColor: "#112233" })) && !/style="background:red/.test(sc("statsteam", { bg: true, bgColor: "red;x" })));
check("the Background tick is the background loop, and a picked colour replaces it", /<div class="bp-bg"><video src="\/brand\/bg-loop\.webm" autoplay muted loop/.test(sc("statsteam", { bg: true })) && !/<video/.test(sc("statsteam", { bg: true, bgColor: "#112233" })));
check("Top Bar text replaces the series title", />MY SERIES</.test(sc("statsteam", { top: true, topText: "my series" })));
check("the Countdown label can be typed", />WE ARE BACK</.test(sc("starting", { count: true, countLabel: "we are back" }, e => { e.timer = { remaining: 60, endsAt: 0, label: "" }; })));
check("the Heading can be typed on the standings board", />my table</.test(sc("rankings", { title: true, titleText: "my table" }, e => { e.standings = []; })));

// cameras found by name, and the K/D/A on the name band of the player in the action
const nm = HUD.nameMatches;
check("a camera name matches a player ignoring case, spaces and marks", nm("FABSO", "fabso") && nm("Jazii", "j a z i i") && nm("Zoë", "zoe"));
check("a team tag in front of the name (up to 4 letters) still matches", nm("SCC Fabso", "Fabso") && nm("SCC-Fabso", "fabso") && !nm("Fabso", "Pzy"));
check("a misread letter is allowed in names of 5 letters or more, never in short ones", nm("Shmook", "Shmoak") && !nm("Jaz", "Jax") && !nm("Pzy", "Pzx"));
check("the overlay looks for name cameras (rooms named '<event>.n-<name>') and the server issues their links", /byNameCam/.test(fs.readFileSync(path.join(__dirname, "..", "public", "hud.js"), "utf8")) && /"\/api\/cam\/name"/.test(server));
check("the player in the action shows K/D/A on the name band", /<em>\$\{\+p\.kills \|\| 0\}/.test(fs.readFileSync(path.join(__dirname, "..", "public", "hud.js"), "utf8")));

check("the sidebar follows BLOB's order: Overview and HUD Editor, Event setup, Live game with Camera feed right after Live Game", html.includes('link("overview")+link("hud")') && html.includes('grp("Event setup",["teams","tournament","talent"])') && html.includes('grp("Live game",["live","camera",'));

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nTICKER TEST PASS");
process.exit(failures ? 1 : 0);
