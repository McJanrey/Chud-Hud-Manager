// League of Legends game logic: objectives, timers and gold, worked out from Riot's Live Client Data.
// Riot's live data doesn't report other players' gold or objective spawn clocks, so both are derived here.
// Timings follow the 2026 season and can be changed per event (event.lol), because Riot moves them between patches.
"use strict";
const https = require("https");
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  // "estimate": gold earned, modelled from time, CS, kills, assists and objectives (never below the items held)
  // "items":    value of the items each player holds (always lower than the real figure)
  // "manual":   typed in by the operator
  goldMode: "estimate",
  goldScale: 1,          // multiply the estimate if it runs consistently high or low
  passiveStart: 35,      // seconds; passive gold starts earlier since the 2026 season
  manualGold: [0, 0],    // [blue side, red side]
  timers: { dragonFirst: 300, dragonRespawn: 300, elderRespawn: 360, grubsFirst: 480, grubsWaves: 1, grubsRespawn: 240, grubsDespawn: 885,
    heraldFirst: 900, heraldDespawn: 1185, baronFirst: 1200, baronRespawn: 360, baronBuff: 180, elderBuff: 150 },
  showTimers: { grubs: true, dragon: true, herald: true, elder: true, baron: true },
  counters: { dragons: true, heralds: true, grubs: true },
};

const DRAGON_NAMES = { Fire: "Infernal", Water: "Ocean", Earth: "Mountain", Air: "Cloud", Hextech: "Hextech", Chemtech: "Chemtech", Elder: "Elder" };
const IGNORED = new Set(["GameStart", "GameEnd", "MinionsSpawning", "FirstBlood", "FirstBrick", "ChampionKill", "Multikill", "Ace", "InhibRespawningSoon", "InhibRespawned"]);
const SIDE = { ORDER: 0, CHAOS: 1 };

// rough gold values used by the estimate
const START_GOLD = 500, PASSIVE_PER_SEC = 2.04, GOLD_PER_CS = 21, GOLD_PER_KILL = 300, GOLD_PER_ASSIST = 75, TEAM_GOLD_PER_TURRET = 400, TEAM_GOLD_PER_BARON = 1500;

function merge(base, extra) {
  const out = JSON.parse(JSON.stringify(base));
  for (const [k, v] of Object.entries(extra || {})) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge(out[k], v) : v;
  return out;
}
const fmtClock = s => { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

/* ------------------------------------------------- Data Dragon (item prices) */
function createDDragon(cacheFile, log = () => {}) {
  const dd = { version: "", items: {}, runes: {}, champs: {} }; // runes: rune id -> icon path (keystones); champs: champion id -> { key, name } (champion select)
  try { const c = JSON.parse(fs.readFileSync(cacheFile, "utf8")); dd.version = c.version; dd.items = c.items; dd.runes = c.runes || {}; dd.champs = c.champs || {}; } catch { /* first run */ }
  const get = url => new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, r => { let s = ""; r.on("data", c => (s += c)); r.on("end", () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); }).on("error", reject);
  });
  (async () => {
    try {
      const version = (await get("https://ddragon.leagueoflegends.com/api/versions.json"))[0];
      const data = (await get(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`)).data, items = {};
      for (const [k, v] of Object.entries(data)) if (/^\d+$/.test(k) && v.gold) items[k] = v.gold.total;
      dd.version = version; dd.items = items;
      try { // keystone and minor rune icons
        const trees = await get(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`), runes = {};
        for (const t of trees) for (const slot of t.slots) for (const r of slot.runes) runes[r.id] = r.icon;
        dd.runes = runes;
      } catch { /* the rune icons are optional */ }
      try { // champion ids to names and image keys, for champion select
        const list = (await get(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)).data, champs = {};
        for (const v of Object.values(list)) champs[v.key] = { key: v.id, name: v.name };
        dd.champs = champs;
      } catch { /* the names are optional: champion select then shows icons only */ }
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ version, items, runes: dd.runes, champs: dd.champs }));
    } catch { log("Couldn't reach Data Dragon: champion icons and exact item prices use the last saved copy."); }
  })();
  return dd;
}

const itemValue = (p, dd) => (p.items || []).reduce((a, it) => {
  const price = dd && dd.items[it.itemID] != null ? dd.items[it.itemID] : (it.price || 0);
  return a + price * Math.max(1, it.count || 1);
}, 0);
const estimatePlayer = (p, time, passiveStart) => { const s = p.scores || {};
  return START_GOLD + PASSIVE_PER_SEC * Math.max(0, time - passiveStart) + GOLD_PER_CS * (s.creepScore || 0) + GOLD_PER_KILL * (s.kills || 0) + GOLD_PER_ASSIST * (s.assists || 0); };

/* ---------------------------------------------------------------- events */
function nameIndex(players) {
  const m = new Map();
  for (const p of players) for (const k of ["riotIdGameName", "summonerName", "riotId"]) if (p[k]) { m.set(p[k].toLowerCase(), p.team); m.set(p[k].split("#")[0].toLowerCase(), p.team); }
  return name => {
    if (!name) return null;
    const hit = m.get(name.toLowerCase()) || m.get(name.split("#")[0].toLowerCase());
    if (hit) return hit;
    if (name.includes("T100") || name.includes("Order")) return "ORDER";   // minions and structures
    if (name.includes("T200") || name.includes("Chaos")) return "CHAOS";
    return null;
  };
}
const structureOwner = name => { const m = /_T(1|2|Order|Chaos)_/i.exec(name || ""); return m ? (["1", "order"].includes(m[1].toLowerCase()) ? "ORDER" : "CHAOS") : null; };
const other = t => (t === "ORDER" ? "CHAOS" : "ORDER");
const blank = () => ({ turrets: 0, inhibs: 0, grubs: 0, heralds: 0, barons: 0, atakhans: 0, dragons: [], elders: 0 });

function tally(events, teamOf) {
  const obj = { ORDER: blank(), CHAOS: blank() }, last = { dragon: null, baron: null, elder: null, herald: null, grubs: [], firstBlood: null }, lastTeam = { baron: null, elder: null }, lastKiller = { baron: null, elder: null }, unknown = new Set(), seen = new Set();
  for (const e of events) {
    if (e.EventID != null) { if (seen.has(e.EventID)) continue; seen.add(e.EventID); } // the same event can arrive twice
    const kind = e.EventName || "", low = kind.toLowerCase(), t = e.EventTime || 0, kt = teamOf(e.KillerName);
    if ((kind === "FirstBlood" || kind === "ChampionKill") && !last.firstBlood) { const team = kind === "FirstBlood" ? teamOf(e.Recipient) : kt; if (team) last.firstBlood = { time: t, team }; }
    if (kind === "TurretKilled") { const o = structureOwner(e.TurretKilled), team = o ? other(o) : kt; if (team) obj[team].turrets++; }
    else if (kind === "InhibKilled") { const o = structureOwner(e.InhibKilled), team = o ? other(o) : kt; if (team) obj[team].inhibs++; }
    else if (kind === "DragonKill") {
      if (e.DragonType === "Elder") { last.elder = t; lastTeam.elder = kt; lastKiller.elder = e.KillerName || null; if (kt) obj[kt].elders++; }
      else if (kt) obj[kt].dragons.push(DRAGON_NAMES[e.DragonType] || e.DragonType);
      last.dragon = t;
    } else if (kind === "BaronKill") { last.baron = t; lastTeam.baron = kt; lastKiller.baron = e.KillerName || null; if (kt) obj[kt].barons++; }
    else if (kind === "HeraldKill") { last.herald = t; if (kt) obj[kt].heralds++; }
    else if (low.includes("horde") || low.includes("grub")) { last.grubs.push(t); if (kt) obj[kt].grubs++; }
    else if (low.includes("atakhan")) { if (kt) obj[kt].atakhans++; }
    else if (!IGNORED.has(kind)) unknown.add(kind);
  }
  return { obj, last, lastTeam, lastKiller, unknown: [...unknown].sort() };
}

const countdown = (spawnAt, now) => { if (spawnAt == null) return { secs: null, label: "" }; const r = spawnAt - now; return r <= 0 ? { secs: 0, label: "LIVE" } : { secs: Math.ceil(r), label: fmtClock(r + 0.999) }; };
function grubsSpawn(kills, now, T) { // when the current or next grub camp spawns, or null once they're gone
  const per = 3, waves = +T.grubsWaves, n = kills.length;
  if (n >= per * waves || now >= T.grubsDespawn) return null;
  const waveStart = Math.floor(n / per) * per;
  return waveStart === 0 ? T.grubsFirst : kills[waveStart - 1] + T.grubsRespawn;
}

/* ----------------------------------------------------------------- build */
// raw: Riot's allgamedata. Returns everything the HUD and the data outputs need. Sides: 0 = blue (ORDER), 1 = red (CHAOS).
function build(raw, config, dd) {
  const cfg = merge(DEFAULTS, config), T = cfg.timers;
  const players = raw.allPlayers || [], events = (raw.events && raw.events.Events) || [], time = +(raw.gameData && raw.gameData.gameTime) || 0;
  const teamOf = nameIndex(players), { obj, last, lastTeam, lastKiller, unknown } = tally(events, teamOf);
  const soul = ["ORDER", "CHAOS"].some(t => obj[t].dragons.length >= 4);
  const dragonSpawn = last.dragon == null ? T.dragonFirst : last.dragon + (soul ? T.elderRespawn : T.dragonRespawn);
  const heraldGone = last.herald != null || time >= T.heraldDespawn;
  const spawns = { grubs: grubsSpawn(last.grubs, time, T), dragon: soul ? null : dragonSpawn, herald: heraldGone ? null : T.heraldFirst, elder: soul ? dragonSpawn : null,
    baron: last.baron == null ? T.baronFirst : last.baron + T.baronRespawn };
  const timers = {}; for (const [k, v] of Object.entries(spawns)) timers[k] = cfg.showTimers[k] === false ? { secs: null, label: "" } : countdown(v, time);

  const byTeam = t => players.filter(p => p.team === t);
  const gold = ["ORDER", "CHAOS"].map((t, i) => {
    const tp = byTeam(t), held = tp.reduce((a, p) => a + itemValue(p, dd), 0);
    if (cfg.goldMode === "manual") return +cfg.manualGold[i] || 0;
    if (cfg.goldMode === "items") return held;
    const per = tp.reduce((a, p) => a + Math.max(estimatePlayer(p, time, cfg.passiveStart), itemValue(p, dd)), 0);
    return Math.max(held, (per + TEAM_GOLD_PER_TURRET * obj[t].turrets + TEAM_GOLD_PER_BARON * obj[t].barons) * cfg.goldScale);
  });
  const playerGold = players.map(p => cfg.goldMode === "items" || cfg.goldMode === "manual" ? itemValue(p, dd) : Math.max(estimatePlayer(p, time, cfg.passiveStart), itemValue(p, dd)));

  // A buff-giving objective (Baron, Elder) shows who took it and how long the buff has left. "player" is the index into allPlayers
  // (the HUD matches it to its own player list by shortcut = index + 1); it stays null if the killer can't be matched.
  const findPlayer = name => { const n = String(name || "").toLowerCase(); if (!n) return -1;
    return players.findIndex(p => [p.riotIdGameName, p.summonerName, p.riotId].some(k => k && (k.toLowerCase() === n || k.split("#")[0].toLowerCase() === n.split("#")[0]))); };
  const buff = (name, length) => { const active = last[name] != null && time - last[name] < length, team = active ? lastTeam[name] : null;
    if (!team) return null;
    const i = findPlayer(lastKiller[name]);
    return { side: SIDE[team], secs: Math.ceil(last[name] + length - time), total: length, killer: lastKiller[name] || "", player: i >= 0 ? i : null }; };
  let lastKill = null;
  for (let i = events.length - 1; i >= 0; i--) if (events[i].EventName === "ChampionKill") { lastKill = { time: events[i].EventTime || 0, killer: events[i].KillerName || "", victim: events[i].VictimName || "" }; break; }

  const pick = f => ["ORDER", "CHAOS"].map(t => f(obj[t], t));
  return {
    time, goldMode: cfg.goldMode, counters: cfg.counters,
    kills: pick((_, t) => byTeam(t).reduce((a, p) => a + ((p.scores && p.scores.kills) || 0), 0)),
    towers: pick(o => o.turrets), inhibs: pick(o => o.inhibs), dragons: pick(o => o.dragons), elders: pick(o => o.elders), heralds: pick(o => o.heralds),
    grubs: pick(o => o.grubs), barons: pick(o => o.barons), atakhans: pick(o => o.atakhans),
    gold, playerGold, timers, nextDragonIsElder: soul,
    buffs: { baron: buff("baron", T.baronBuff), elder: buff("elder", T.elderBuff) },
    firstBlood: last.firstBlood ? { side: SIDE[last.firstBlood.team], time: Math.round(last.firstBlood.time * 10) / 10 } : null,
    lastKill, unknown, ddVersion: dd ? dd.version : "",
  };
}

module.exports = { build, createDDragon, itemValue, estimatePlayer, tally, nameIndex, grubsSpawn, countdown, fmtClock, DEFAULTS, DRAGON_NAMES, merge };
