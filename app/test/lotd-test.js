// Run with: node test/lotd-test.js
// The LOTD edition's Schedule (laid out on MJ's "Schedule Draft 2"): the bar names the event with its year, the ticker always runs,
// the designer's art, the ad rotation fades, and the preview's "Transparent" backdrop is visibly a checkerboard.
"use strict";
const fs = require("fs"), path = require("path");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };

// the edition is read from the page's data-variant attribute when hud.js loads
global.document = { addEventListener() {}, documentElement: { getAttribute: k => (k === "data-variant" ? "lotd" : null) } };
const HUD = require("../public/hud.js");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "hud.css"), "utf8"), js = fs.readFileSync(path.join(__dirname, "..", "public", "hud.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "public", "app.html"), "utf8");

const mk = f => {
  const ev = { id: "e1", name: "VAL - 2V2 SKIRMISH", game: "Valorant", tournament: { name: "LAN OF THE DEAD 2026", logos: [], sponsors: [{ name: "Chud Energy", logo: "" }, { name: "Local Pizza", logo: "" }] },
    live: { left: "a", right: "b", score: [0, 0], series: [0, 0], seriesTitle: "", gameSeries: "" }, teams: [{ id: "a", name: "A", tag: "A", color: "#8250f0", logos: [], players: [] }, { id: "b", name: "B", tag: "B", color: "#e1873d", logos: [], players: [] }],
    schedule: [], lowerThird: { label: "LOCAL TIME", ticker: "" }, ads: { mode: "off", items: [], anim: "fade", fadeMs: 800 }, hud: { scene: "schedule", show: {}, sc: {} }, camera: {}, val: {}, rb: {}, fn: {}, dbd: {} };
  f && f(ev); return ev;
};
const draw = ev => HUD.sceneHtml(ev, null, "schedule");

let h = draw(mk());
check("the bar names the event with its year", />LAN OF THE DEAD 2026</.test(h), h.slice(0, 200));
check("the bar shows the game and UP NEXT", /VALORANT/.test(h) && /UP NEXT/.test(h));
check("with no announcement typed, the ticker still runs: the event name, then the sponsors", /class="bp-tk"/.test(h) && /<span>LAN OF THE DEAD 2026<\/span>/.test(h) && /<span>CHUD ENERGY<\/span>/.test(h) && /<span>LOCAL PIZZA<\/span>/.test(h));
check("a typed announcement wins over that fallback", (x => /<span>HELLO LAN<\/span>/.test(x) && !/CHUD ENERGY/.test(x))(draw(mk(e => { e.lowerThird.ticker = "Hello LAN | Doors at six"; }))));
check("the Bottom Announcement tick switches the ticker off", !/bp-tk/.test(draw(mk(e => { e.hud.sc = { schedule: { ticker: false } }; }))));
check("the Match Text tick switches the bar off", !/class="bar"/.test(draw(mk(e => { e.hud.sc = { schedule: { match: false } }; }))));
check("an event with no sponsors still gets a ticker (its own name)", /<span>LAN OF THE DEAD 2026<\/span>/.test(draw(mk(e => { e.tournament.sponsors = []; }))));
check("names are escaped in the ticker", !/<img src=x>/.test(draw(mk(e => { e.tournament.name = "<img src=x>"; e.tournament.sponsors = []; }))));
check("without the Background tick nothing paints the page", !/bp-bg/.test(draw(mk(e => { e.hud.sc = { schedule: { bg: false } }; }))) && /bp-bg/.test(h));

// the designer's art (text removed): the files ship and the scenes use them
for (const f of ["l3", "caster-plank", "timer-bug", "sch-bar", "sch-planks", "sch-head"]) check("ships brand/lotd/" + f + ".png", fs.existsSync(path.join(__dirname, "..", "public", "brand", "lotd", f + ".png")));
check("the Schedule draws the head, planks and bar art, and the planks carry the activities (four at most)", /sch-head.png/.test(h) && /sch-planks.png/.test(h) && /sch-bar.png/.test(h) && (draw(mk(e => { e.schedule = [1, 2, 3, 4, 5, 6].map(n => ({ id: "s" + n, time: n + ":00 PM", left: "", right: "", sa: "", sb: "", label: "Act " + n })); })).match(/class="lc"/g) || []).length === 4);
check("the ticker is the designer's grey band at the bottom edge", /.lsch .bp-tk{[^}]*background:#232323/.test(css) && /.lsch .bp-tk{[^}]*bottom:0/.test(css));
const l3 = HUD.sceneHtml(mk(e => { e.hud.scene = "lowerthird"; }), null, "lowerthird");
check("the Lower Third draws the designer's board with a clock and two segments, and the ticker shifts it up", /l3.png/.test(l3) && /class="s1"/.test(l3) && /class="s2"/.test(l3) && /class="l3d tk"/.test(l3) && !/class="l3d tk"/.test(HUD.sceneHtml(mk(e => { e.hud.scene = "lowerthird"; e.hud.sc = { lowerthird: { ticker: false } }; }), null, "lowerthird")));
check("the timer bug uses the designer's ticket in LOTD", /class="lbug tr"/.test(HUD.sceneHtml(mk(e => { e.hud.bug = { on: true, corner: "tr", mode: "text", text: "10:00" }; }), null, "schedule")) && /timer-bug.png/.test(HUD.sceneHtml(mk(e => { e.hud.bug = { on: true, mode: "text", text: "x" }; }), null, "schedule")));
check("the caster nameplate is the designer's plank", /caster-plank.png/.test(fs.readFileSync(path.join(__dirname, "..", "variant.js"), "utf8")));
// the ad rotation fades: the shown slide fades in even when its element is brand new, and every slide keeps its transition
check("the ad rotation fades (transition on every slide, animation on the shown one)", /\.rot \.ri\{[^}]*transition:opacity var\(--rt,800ms\)/.test(css) && /\.rot-fade \.ri\.on[^{]*\{animation:rotIn var\(--rt,800ms\)/.test(css) && /@keyframes rotIn\{from\{opacity:0\}to\{opacity:1\}\}/.test(css));
check("only the Cut style has no fade", /\.rot-cut \.ri\{transition:none\}/.test(css) && !/\.rot-cut \.ri\.on[^{]*\{animation/.test(css));
const ads = mk(e => { e.ads.items = [{ id: "a", url: "/u/a.png", secs: 8, on: true }, { id: "b", url: "/u/b.png", secs: 8, on: true }]; });
const d0 = Date.now; Date.now = () => 0; const drawAds = e => HUD.sceneHtml(e, null, "ads"); // the rotation itself (the new Schedule has no ad box; ads show on the Ad Rotation scene or as the corner and banner)
const a0 = drawAds(ads); Date.now = () => 8000; const a1 = drawAds(ads); Date.now = d0;
check("both ad slides are always in the markup", (a0.match(/class="ri[ "]/g) || []).length === 2 && (a1.match(/class="ri[ "]/g) || []).length === 2);
check("the shown slide changes with the clock", a0.match(/class="ri on" data-k="([^"]+)"/)[1] !== a1.match(/class="ri on" data-k="([^"]+)"/)[1]);

// the dashboard preview's "Transparent" backdrop is a checkerboard you can see, and picking a scene never waits for Save Changes
const grey = /fillStyle = \(\(x \+ y\) \/ 40\) % 2 \? "#([0-9a-f]{6})" : "#([0-9a-f]{6})"/i.exec(js);
check("the Transparent preview backdrop is a visible checkerboard (not two near-black greys)", !!grey && grey.slice(1).every(c => parseInt(c.slice(0, 2), 16) > 0x50), grey && grey.slice(1).join());
check("switching the scene applies at once (no Save Changes)", /const LIVE_FIELDS=new Set\(\["hud\.scene"\]\)/.test(html) && /if\(LIVE_FIELDS\.has\(p\)\|\|LIVE_SC\.test\(p\)\)\{put\(p,v\)/.test(html));

// every text on the Schedule can be typed in the HUD Editor's Match Text panel
const st = (o) => draw(mk(e => { e.hud.sc = { schedule: o }; }));
check("the Schedule's event name, game and UP NEXT label can be typed", (x => />MY EVENT</.test(x) && />MY GAME</.test(x) && />WHO IS NEXT</.test(x) && !/>UP NEXT</.test(x) && !/>LAN OF THE DEAD 2026<\/b><div class="nx">/.test(x))(st({ eventText: "my event", gameText: "my game", nextText: "who is next" })));
check("the Match Text panel lists those fields on the Schedule and Reset clears them", /SaintsHUD\.SCENE_TEXT\(e\.hud\.scene\)\.map/.test(html) && /for\(const\[f\]of SaintsHUD\.SCENE_TEXT\(e\.hud\.scene\)\)await put\(`hud\.sc\.\$\{e\.hud\.scene\}\.\$\{f\}`,""\)/.test(html) && HUD.SCHED_TEXT().length === 3);
check("the Bottom Announcement shows what scrolls when Line 1 is empty", /data-tkline="1" value="\$\{esc\(t\.l1\)\}" placeholder="\$\{esc\(e\.tournament\.name/.test(html));

// the Schedule page's cards (tournament, game, match type, typed teams, date, time) are what the graphic draws
const sch = f => draw(mk(e => { e.schedule = [{ id: "a", tn: "NACE Varsity", game: "Super Smash Bros", label: "Regular Season", t1: "St. Clair Saints", t2: "Univ of Saint Mary", date: "2026-10-29", time: "20:30", left: "", right: "", sa: "", sb: "" }, { id: "b", tn: "", game: "", label: "Costume contest", t1: "Everyone", t2: "", date: "", time: "6:00 PM", left: "", right: "", sa: "", sb: "" }]; f && f(e); }));
check("a card shows the tournament, then game, match type, date and time, and the typed teams", (x => />NACE VARSITY</.test(x) && /SUPER SMASH BROS \| Regular Season \| OCT 29 8:30 PM \| St. Clair Saints VS Univ of Saint Mary/i.test(x))(sch()), sch().slice(sch().indexOf("lsc0"), sch().indexOf("lsc0") + 400));
check("with no tournament typed the match type is the big line, and a single team still shows", (x => />COSTUME CONTEST</.test(x) && /6:00 PM \| Everyone</.test(x))(sch()));
check("typed time and date are formatted, and an older entry (team picked, 6:00 PM) still draws", HUD.schShown(mk(e => { e.schedule = [{ id: "z", time: "6:00 PM", left: "", right: "", label: "Old", sa: "", sb: "" }]; })).length === 1 && />OLD</.test(draw(mk(e => { e.schedule = [{ id: "z", time: "6:00 PM", left: "", right: "", label: "Old", sa: "", sb: "" }]; }))));
check("the Schedule page lists the cards with 'On the graphic' and can move and remove them", /On the graphic/.test(html) && /data-act="moveMatch"/.test(html) && /case "moveMatch"/.test(html) && /Upcoming Schedule/.test(html));

// the footer (Lower Third): the second box's title and line, and the clock label, can be typed
const lt = o => HUD.sceneHtml(mk(e => { e.hud.scene = "lowerthird"; e.hud.sc = { lowerthird: o }; e.lowerThird.label = o.lbl || "LOCAL TIME"; }), null, "lowerthird");
check("the footer's second box shows typed text, else the teams and score", (x => />MY TEAMS</.test(x) && />MY LINE</.test(x))(lt({ segText: "my teams", segSub: "my line" })) && /class="s2"><b data-fit>[^<]*<\/b><small data-fit>\d+ - \d+</.test(lt({})));
check("the Match Text panel has a Clock label and the second box fields on the Lower Third", /data-tktext="label"/.test(html) && /SaintsHUD\.SCENE_TEXT\(e\.hud\.scene\)/.test(html) && HUD.SCENE_TEXT("lowerthird").length === 2);

check("the bar's game follows what is up next on the Schedule cards (a typed Game still wins)", (x => />SUPER SMASH BROS</.test(x.slice(x.indexOf('class="bar"'))))(sch()) && (y => />TYPED</.test(y.slice(y.indexOf('class="bar"'))))(draw(mk(e => { e.schedule = [{ id: "a", game: "Super Smash Bros", time: "", left: "", right: "", sa: "", sb: "" }]; e.hud.sc = { schedule: { gameText: "typed" } }; }))));

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nLOTD TEST PASS");
process.exit(failures ? 1 : 0);
