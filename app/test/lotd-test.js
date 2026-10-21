// Run with: node test/lotd-test.js
// The LOTD edition's Schedule (laid out on MJ's "Schedule Draft 2"): the bar names the event with its year, the ticker always runs,
// the boxes carry Draft 2's own transparency, the ad rotation fades, and the preview's "Transparent" backdrop is visibly a checkerboard.
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
check("names are escaped in the ticker", !/<img/.test(draw(mk(e => { e.tournament.name = "<img src=x>"; e.tournament.sponsors = []; }))));
check("without the Background tick nothing paints the page", !/bp-bg/.test(draw(mk(e => { e.hud.sc = { schedule: { bg: false } }; }))) && /bp-bg/.test(h));

// Draft 2's transparency: cards and ad box 40%, bar and ticker 50%
const rule = sel => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*\\}")) || [""])[0];
check("the activity cards are 40% opaque", /background:rgba\(\d+,\d+,\d+,\.4\)/.test(rule(".lsch .lc")), rule(".lsch .lc"));
check("the ad box is 40% opaque", /background:rgba\(\d+,\d+,\d+,\.4\)/.test(rule(".lsch .adb")), rule(".lsch .adb"));
check("the bar is 50% opaque orange", /background:rgba\(217,131,70,\.5\)/.test(rule(".lsch .bar")), rule(".lsch .bar"));
check("the ticker is 50% opaque and sits where Draft 2 puts it (y 648, full width)", /background:rgba\(\d+,\d+,\d+,\.5\)/.test(rule(".lsch .bp-tk")) && /top:648px/.test(rule(".lsch .bp-tk")), rule(".lsch .bp-tk"));

// the ad rotation fades: the shown slide fades in even when its element is brand new, and every slide keeps its transition
check("the ad rotation fades (transition on every slide, animation on the shown one)", /\.rot \.ri\{[^}]*transition:opacity var\(--rt,800ms\)/.test(css) && /\.rot-fade \.ri\.on[^{]*\{animation:rotIn var\(--rt,800ms\)/.test(css) && /@keyframes rotIn\{from\{opacity:0\}to\{opacity:1\}\}/.test(css));
check("only the Cut style has no fade", /\.rot-cut \.ri\{transition:none\}/.test(css) && !/\.rot-cut \.ri\.on[^{]*\{animation/.test(css));
const ads = mk(e => { e.ads.items = [{ id: "a", url: "/u/a.png", secs: 8, on: true }, { id: "b", url: "/u/b.png", secs: 8, on: true }]; });
const d0 = Date.now; Date.now = () => 0; const a0 = draw(ads); Date.now = () => 8000; const a1 = draw(ads); Date.now = d0;
check("both ad slides are always in the markup", (a0.match(/class="ri[ "]/g) || []).length === 2 && (a1.match(/class="ri[ "]/g) || []).length === 2);
check("the shown slide changes with the clock", a0.match(/class="ri on" data-k="([^"]+)"/)[1] !== a1.match(/class="ri on" data-k="([^"]+)"/)[1]);

// the dashboard preview's "Transparent" backdrop is a checkerboard you can see, and picking a scene never waits for Save Changes
const grey = /fillStyle = \(\(x \+ y\) \/ 40\) % 2 \? "#([0-9a-f]{6})" : "#([0-9a-f]{6})"/i.exec(js);
check("the Transparent preview backdrop is a visible checkerboard (not two near-black greys)", !!grey && grey.slice(1).every(c => parseInt(c.slice(0, 2), 16) > 0x50), grey && grey.slice(1).join());
check("switching the scene applies at once (no Save Changes)", /const LIVE_FIELDS=new Set\(\["hud\.scene"\]\)/.test(html) && /if\(LIVE_FIELDS\.has\(p\)\)\{put\(p,v\)/.test(html));

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nLOTD TEST PASS");
process.exit(failures ? 1 : 0);
