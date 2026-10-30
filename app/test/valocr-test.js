// Run with: node test/valocr-test.js
// VALORANT's Tab scoreboard, read by Screen OCR (or an observer PC), puts each player's ultimate points and credits on the HUD: a row is matched to
// its player by name, the reading only counts while it is fresh, and what the operator typed is the fallback.
"use strict";
const fs = require("fs"), path = require("path");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };
const HUD = require("../public/hud.js");
const ocr = require("../ocr.js"), html = fs.readFileSync(path.join(__dirname, "..", "public", "app.html"), "utf8"), server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const pl = (id, ign) => ({ id, ign, alias: "", agent: "", avatar: "" });
const ev = () => ({ id: "e1", name: "VAL", game: "Valorant 2v2 Skirmish", tournament: { name: "T", logos: [], sponsors: [] },
  live: { left: "a", right: "b", score: [0, 0], series: [0, 0], bestOf: 5, autoSeries: false, autoScore: false }, teams: [{ id: "a", name: "A", tag: "A", color: "#2f7dff", logos: [], players: [pl("p1", "SCCProd2"), pl("p2", "Second")] }, { id: "b", name: "B", tag: "B", color: "#ff9b1a", logos: [], players: [pl("p3", "Third"), pl("p4", "Fourth")] }],
  schedule: [], lowerThird: { label: "LOCAL TIME", ticker: "" }, ads: { mode: "off", items: [], anim: "fade", fadeMs: 800 }, hud: { scene: "valingame", show: {}, sc: {} }, camera: {}, val: { squad: 2, target: 10, p: { p1: { ult: 2, cr: 1200 } } }, rb: {}, fn: {}, dbd: {} });
const draw = (e, g) => HUD.sceneHtml(e, g || null, "valingame");
const panel = (h, key) => { const i = h.indexOf(`data-k="${key}"`); return i < 0 ? "" : h.slice(i, i + 900); };

const plain = draw(ev());
check("with no reading the panel shows what was typed", />1200</.test(panel(plain, "vp-0-0")) && (panel(plain, "vp-0-0").match(/<i class="on"/g) || []).length === 2);
const g = { valOcr: { t: Date.now(), valName1: "SCCProd2", valUlt1: 5, valCr1: 99999, valName2: "Third", valCr2: 3900 }, teams: [{ name: "x", score: 0 }, { name: "y", score: 0 }], players: [], feed: [] };
const read = draw(ev(), g);
check("a fresh scoreboard row is matched to its player by name (ultimate points and credits)", />99999</.test(panel(read, "vp-0-0")) && (panel(read, "vp-0-0").match(/<i class="on"/g) || []).length === 5, panel(read, "vp-0-0"));
check("a name misread by a letter or two still lands on the right player", />3900</.test(panel(draw(ev(), Object.assign({}, g, { valOcr: { t: Date.now(), valName1: "Thirdd", valCr1: 3900 } })), "vp-1-0")));
check("a row that matches nobody changes nothing", />1200</.test(panel(draw(ev(), Object.assign({}, g, { valOcr: { t: Date.now(), valName1: "Stranger", valCr1: 5 } })), "vp-0-0")));
check("a reading older than 20 seconds is ignored", />1200</.test(panel(draw(ev(), Object.assign({}, g, { valOcr: Object.assign({}, g.valOcr, { t: Date.now() - 21000 }) })), "vp-0-0")));

// what the reader sends
const msg = ocr._internals.toMessage ? ocr._internals.toMessage({ valName1: "SCCProd2", valUlt1: 3, valCr1: 4500, score0: 1 }) : null;
check("the reader sends the scoreboard rows as one ValOcr message (and scores as before)", !!msg && msg.some(m => m.Event === "ValOcr" && m.Data.values.valName1 === "SCCProd2" && m.Data.values.valCr1 === 4500) && msg.some(m => m.Event === "UpdateState"), JSON.stringify(msg));
check("the server keeps the rows on the feed", /case "ValOcr":/.test(server) && /game\.valOcr = /.test(server));
check("the control room offers the VALORANT spectator layout and the row boxes", /val:\[\["score0"/.test(html) && /"Valorant 2v2 Skirmish":\["val","top","corners"\]/.test(html) && /valName1:\["Scoreboard row 1: name","text"\]/.test(html));

// series diamonds
const sr = (series, bestOf) => { const e = ev(); e.live.series = series; e.live.bestOf = bestOf; return draw(e); };
const diamonds = (h, s) => { const m = new RegExp(`<span class="sd ${s ? "r" : "l"}"[^>]*>(.*?)</span>`).exec(h); return m ? [(m[1].match(/<i/g) || []).length, (m[1].match(/class="on"/g) || []).length] : null; };
check("the top bar shows series diamonds: wins needed for the best-of, filled for the wins so far", JSON.stringify([diamonds(sr([1, 0], 5), 0), diamonds(sr([1, 0], 5), 1)]) === "[[3,1],[3,0]]" && JSON.stringify(diamonds(sr([0, 1], 3), 1)) === "[2,1]");
check("the Skirmish page has the Series score controls and New match adds a finished match's win", /<h2>Series score<\/h2>/.test(html) && /case "valReset":\{const t=/.test(html));

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nVALOCR TEST PASS");
process.exit(failures ? 1 : 0);
