// Ad rotation: which ad is up is decided by the clock, so every overlay agrees; switched-off ads are skipped; the corner box and
// banner sit over other scenes but never over the full-screen Ad Rotation scene.
const H = require("../public/hud.js");
let bad = 0;
const ok = (c, m, x = "") => { console.log(`  ${c ? "ok  " : "FAIL"} ${m} ${c ? "" : x}`); if (!c) bad++; };
const realNow = Date.now, at = ms => { Date.now = () => ms; };
const ev = { ads: { start: 0, mode: "off", items: [{ id: "a", url: "/u/a.png", secs: 10, on: true }, { id: "b", url: "/u/b.gif", secs: 5, on: true }, { id: "c", url: "/u/c.mp4", secs: 20, on: false }] } };
at(0); ok(H.adNow(ev).id === "a", "the first ad starts");
at(9999); ok(H.adNow(ev).id === "a", "it stays for its own seconds");
at(10000); ok(H.adNow(ev).id === "b", "then the next one");
at(15000); ok(H.adNow(ev).id === "a", "a switched-off ad is skipped and the list loops");
at(-5000); ok(!!H.adNow(ev), "a clock behind the start still picks an ad");
ok(H.adNow({ ads: { items: [] } }) === null && H.adNow({}) === null, "no ads, nothing shown (and old events without ads are fine)");
ev.ads.items[1].on = false; ev.ads.items[0].on = false; at(3000); ok(H.adNow(ev) === null, "all switched off, nothing shown");
Date.now = realNow;
console.log(bad ? `\n${bad} CHECK(S) FAILED` : "\nADS TEST PASS");
process.exit(bad ? 1 : 0);
