// Run with: node test/league-test.js
// Checks the League objective, timer and gold logic against a small hand-made game with known answers.
"use strict";
const L = require("../league.js");

let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };

const mk = (team, name, o = {}) => ({ team, riotIdGameName: name, summonerName: name, championName: "X", level: 10, isDead: false, respawnTimer: 0,
  scores: Object.assign({ kills: 0, deaths: 0, assists: 0, creepScore: 100 }, o.scores), items: o.items || [] });
const players = [
  mk("ORDER", "Blue1", { scores: { kills: 3, assists: 2, creepScore: 100 }, items: [{ itemID: 1001, price: 300, count: 1 }, { itemID: 2003, price: 50, count: 2 }] }),
  mk("ORDER", "Blue2"), mk("ORDER", "Blue3"), mk("ORDER", "Blue4"), mk("ORDER", "Blue5"),
  mk("CHAOS", "Red1", { scores: { kills: 1, creepScore: 80 } }), mk("CHAOS", "Red2"), mk("CHAOS", "Red3"), mk("CHAOS", "Red4"), mk("CHAOS", "Red5"),
];
const game = (time, events) => ({ allPlayers: players, events: { Events: events.map((e, i) => Object.assign({ EventID: i }, e)) }, gameData: { gameTime: time } });
const DD = { version: "x", items: {} };

console.log("timers");
let r = L.build(game(100, []), {}, DD);
check("dragon counts down to its first spawn (5:00)", r.timers.dragon.secs === 200 && r.timers.dragon.label === "03:20", JSON.stringify(r.timers.dragon));
check("void grubs first spawn at 8:00", r.timers.grubs.secs === 380);
check("herald not up yet, baron at 20:00", r.timers.herald.secs === 800 && r.timers.baron.secs === 1100);
check("elder is blank until a soul", r.timers.elder.label === "" && r.nextDragonIsElder === false);
r = L.build(game(305, []), {}, DD);
check("dragon shows LIVE once spawned", r.timers.dragon.label === "LIVE");

console.log("objectives");
const ev = [
  { EventName: "FirstBlood", Recipient: "Blue2", EventTime: 150 },
  { EventName: "ChampionKill", KillerName: "Blue2", VictimName: "Red1", EventTime: 150 },
  { EventName: "TurretKilled", KillerName: "Blue1", TurretKilled: "Turret_T2_L_03_A", EventTime: 600 }, // red's turret falls: blue scores
  { EventName: "InhibKilled", KillerName: "Red1", InhibKilled: "Barracks_T1_R1", EventTime: 900 },       // blue's inhib falls: red scores
  { EventName: "DragonKill", KillerName: "Blue1", DragonType: "Fire", EventTime: 400 },
  { EventName: "HordeKill", KillerName: "Blue3", EventTime: 500 }, { EventName: "HordeKill", KillerName: "Blue3", EventTime: 501 }, { EventName: "HordeKill", KillerName: "Red2", EventTime: 502 },
  { EventName: "HeraldKill", KillerName: "Red3", EventTime: 950 },
  { EventName: "BaronKill", KillerName: "Blue4", EventTime: 1300 },
  { EventName: "AtakhanKill", KillerName: "Red4", EventTime: 800 },
  { EventName: "SomethingNew", EventTime: 10 },
];
r = L.build(game(1400, ev), {}, DD);
check("turret credited to the team that destroyed it", r.towers[0] === 1 && r.towers[1] === 0, JSON.stringify(r.towers));
check("inhibitor credited to the other side", r.inhibs[1] === 1 && r.inhibs[0] === 0);
check("dragon type named", r.dragons[0][0] === "Infernal" && r.dragons[1].length === 0);
check("void grubs counted per team", r.grubs[0] === 2 && r.grubs[1] === 1);
check("herald and baron and atakhan counted", r.heralds[1] === 1 && r.barons[0] === 1 && r.atakhans[1] === 1);
check("first blood goes to blue", r.firstBlood && r.firstBlood.side === 0 && r.firstBlood.time === 150, JSON.stringify(r.firstBlood));
check("unknown events are reported", r.unknown.includes("SomethingNew"), JSON.stringify(r.unknown));
check("dragon respawns 5:00 after the kill (400 + 300)", r.timers.dragon.label === "LIVE" && L.build(game(650, ev.slice(0, 5)), {}, DD).timers.dragon.secs === 50);
check("herald gone once killed", r.timers.herald.label === "");
check("baron respawn 6:00 after the kill (1300 + 360 = 1660)", L.build(game(1400, ev), {}, DD).timers.baron.secs === 260);
check("baron buff active for blue for 3:00", r.buffs.baron && r.buffs.baron.side === 0 && r.buffs.baron.secs === 80, JSON.stringify(r.buffs));
check("duplicate events only count once", L.build(game(1400, ev.concat([Object.assign({}, ev[2])])).allPlayers && { allPlayers: players, events: { Events: ev.concat([Object.assign({}, ev[2])]).map((e, i) => Object.assign({}, e, { EventID: i === ev.length ? 2 : i })) }, gameData: { gameTime: 1400 } }, {}, DD).towers[0] === 1);

console.log("soul and elder");
const soul = ["Fire", "Water", "Earth", "Air"].map((t, i) => ({ EventName: "DragonKill", KillerName: "Blue1", DragonType: t, EventTime: 300 + i * 300 }));
r = L.build(game(1500, soul), {}, DD);
check("after soul, elder timer replaces dragon (last kill 1200 + 360)", r.nextDragonIsElder && r.timers.dragon.label === "" && r.timers.elder.secs === 60, JSON.stringify(r.timers));

console.log("gold");
const g = (mode, extra = {}) => L.build(game(600, [{ EventName: "TurretKilled", KillerName: "Blue1", TurretKilled: "Turret_T2_L_03_A", EventTime: 500 }]), Object.assign({ goldMode: mode }, extra), DD);
const held = 300 + 50 * 2;
check("items mode is the value of held items", g("items").gold[0] === held, String(g("items").gold[0]));
check("estimate is never below the items held", g("estimate").gold[0] >= held && g("estimate").gold[1] > 0);
check("estimate grows with CS, kills and objectives", g("estimate").gold[0] > g("estimate").gold[1], JSON.stringify(g("estimate").gold));
check("scale multiplies the estimate", Math.abs(g("estimate", { goldScale: 2 }).gold[1] - 2 * g("estimate").gold[1]) < 1 + 2 * 0.0, JSON.stringify([g("estimate").gold, g("estimate", { goldScale: 2 }).gold]));
check("manual mode uses typed values", g("manual", { manualGold: [12345, 999] }).gold[0] === 12345 && g("manual", { manualGold: [12345, 999] }).gold[1] === 999);
check("exact item prices from Data Dragon win over the game's price", L.itemValue({ items: [{ itemID: 3031, price: 625, count: 1 }] }, { items: { 3031: 3400 } }) === 3400);
check("timers can be switched off", L.build(game(100, []), { showTimers: { dragon: false } }, DD).timers.dragon.label === "" );

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nLEAGUE TEST PASS");
process.exit(failures ? 1 : 0);
