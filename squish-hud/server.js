// Squish HUD server: dashboard + OBS overlays + Rocket League Stats API bridge.
// Zero dependencies: needs only Node.js 18+.
"use strict";
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = +process.env.PORT || 7777;
const HOST = process.env.HOST || "127.0.0.1"; // set HOST=0.0.0.0 to reach it from other PCs on your LAN
const RL_HOST = process.env.RL_HOST || "127.0.0.1";
const RL_PORT = +process.env.RL_PORT || 49123;

const ROOT = __dirname;
const PUB = path.join(ROOT, "public");
const DATA = process.env.SQUISH_DATA || path.join(ROOT, "data"); // the desktop app points this at its user-data folder
const UPLOADS = path.join(DATA, "uploads");
const DB_FILE = path.join(DATA, "db.json");
fs.mkdirSync(UPLOADS, { recursive: true });

const uid = () => crypto.randomBytes(5).toString("hex");
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

/* ------------------------------------------------------------------ data */
const blankTeam = (name, tag, color, color2, igns = []) => ({
  id: uid(), name, tag, division: "", color, color2: color2 || "#ffffff", logos: ["", "", ""],
  players: igns.map(ign => ({ id: uid(), ign, alias: "", country: "", avatar: "", cam: "" })),
});
const talent = (name, role, socials = []) => ({ id: uid(), name, role, portrait: "", socials });

function newEvent(name, game = "Rocket League", organiser = "") {
  return {
    id: uid(), name, game, organiser, kit: "Squish Default", created: Date.now(),
    hud: { scene: "ingame", colorMode: "team", custom: ["#2f7dff", "#ff9b1a"], bg: "pitch", autoBoard: true,
      show: { boost: true, card: true, score: true, stats: true, feed: true, goal: true, playerCam: false } },
    teams: [],
    tournament: { name: "", region: "", lang: "", size: "32 Teams", format: "Double Elimination", logos: ["", "", "", ""], sponsors: [] },
    talent: [],
    live: { left: "", right: "", swap: false, autoTeams: true, autoScore: true, autoSeries: true, score: [0, 0], bestOf: 5,
      series: [0, 0], seriesTitle: "", eventTitle: "", roundTitle: "", gameSeries: "BEST OF 5" },
    camera: { layout: "duo", seats: [{ talent: "", url: "" }, { talent: "", url: "" }, { talent: "", url: "" }] },
    schedule: [],
    bracket: { rounds: [
      { name: "Quarterfinals", matches: Array.from({ length: 4 }, () => ({ a: "", b: "", sa: "", sb: "" })) },
      { name: "Semifinals", matches: Array.from({ length: 2 }, () => ({ a: "", b: "", sa: "", sb: "" })) },
      { name: "Grand Final", matches: [{ a: "", b: "", sa: "", sb: "" }] }] },
    standings: [],
    lowerThird: { title: "", subtitle: "" },
    timer: { label: "BACK SOON", seconds: 300, endsAt: 0, remaining: 300 },
  };
}
// Older saved data may predate some fields: fill them in.
function upgrade(ev) {
  const d = newEvent(ev.name);
  for (const k of Object.keys(d)) if (ev[k] === undefined) ev[k] = d[k];
  ev.hud.show = Object.assign({}, d.hud.show, ev.hud.show);
  ev.hud.lolPanel = ev.hud.lolPanel || "auto";
  // the St. Clair Saints team gets the emblem until a team logo is uploaded
  ev.teams.forEach(t => { if (t.tag === "SCC" && t.logos && !t.logos[0]) t.logos[0] = "/brand/saints-emblem.png"; });
  return ev;
}
function seed() {
  const rl = newEvent("RL - SCC", "Rocket League", "SCC");
  rl.hud.colorMode = "custom";
  const scc = blankTeam("ST. CLAIR SAINTS", "SCC", "#1d8a4a", "#f2b51c", ["Jazii", "Pzy", "Fabso", "raggeo."]);
  scc.division = "Varsity Premier";
  scc.players[0].country = "DE"; scc.players[1].country = "AT"; scc.players[2].country = "DE"; scc.players[3].country = "PE"; scc.players[3].alias = "Raggeo";
  const wv = blankTeam("West Virginia Wesleyan", "WVWC", "#f0712a", "#1b1b1b", ["Player 1", "Player 2", "Player 3"]);
  rl.teams = [scc,
    blankTeam("UNC Charlotte", "UNC", "#0f6b3a"), blankTeam("University of Olivet", "UO", "#c4202f"),
    blankTeam("University of Akron", "US", "#24385f"), blankTeam("USC GAMECOCKS", "USC", "#8a1c2b"),
    blankTeam("Brewton-Parker Christian", "BPCU", "#3a3f9a"), blankTeam("TBD", "TBD", "#4a4c55"),
    blankTeam("QUINNIPIAC UNIVERSITY", "QU", "#1b3f78"), blankTeam("UNIVERSITY OF MARYLAND", "UM", "#d1242f"),
    blankTeam("UNIVERSITY OF MARYLAND, BALTIMORE COUNTY", "UMBC", "#c9a227"), wv];
  rl.tournament.name = "NACE";
  rl.talent = [talent("Smoke", "Caster", [{ p: "X", h: "@Smoke_Casts" }]), talent("Yoogee", "Caster"), talent("Thermalrex", "Caster"),
    talent("Graff", "Caster"), talent("Kirimitosa", "Broadcaster"), talent("mimiQ", "Broadcaster"), talent("notreallyevan", "Caster"),
    talent("Phazer", "Caster"), talent("Swag", "Caster"), talent("B money", "Caster")];
  rl.camera.seats[0].talent = rl.talent[0].id; rl.camera.seats[1].talent = rl.talent[1].id;
  Object.assign(rl.live, { left: wv.id, right: scc.id, seriesTitle: "NACE VARSITY", eventTitle: "SCC vs WVWC" });
  const T = rl.teams;
  rl.schedule = [
    { id: uid(), time: "6:00 PM", left: T[0].id, right: T[10].id, label: "Upper Round 1", sa: "", sb: "" },
    { id: uid(), time: "7:00 PM", left: T[1].id, right: T[2].id, label: "Upper Round 1", sa: "", sb: "" },
    { id: uid(), time: "8:00 PM", left: T[3].id, right: T[4].id, label: "Upper Round 1", sa: "", sb: "" }];
  const q = rl.bracket.rounds[0].matches;
  [[0, 10], [1, 2], [3, 4], [5, 7]].forEach(([a, b], i) => { q[i].a = T[a].id; q[i].b = T[b].id; });
  rl.standings = [0, 1, 2, 3, 4, 5].map((i, n) => ({ team: T[i].id, w: 5 - n, l: n, gd: 6 - n * 2 }));
  rl.lowerThird = { title: "Welcome to NACE Varsity", subtitle: "St. Clair Saints vs West Virginia Wesleyan · Best of 5" };

  const lol = newEvent("SCC - LEAGUE", "League of Legends", "SCC");
  const s2 = blankTeam("ST. CLAIR SAINTS", "SCC", "#1d8a4a", "#f2b51c", ["Top", "Jungle", "Mid", "ADC", "Support"]);
  const o2 = blankTeam("Opponent", "OPP", "#c4202f", "#1b1b1b", ["Top", "Jungle", "Mid", "ADC", "Support"]);
  s2.players.forEach(p => (p.ign = "SCC " + p.ign)); o2.players.forEach(p => (p.ign = "OPP " + p.ign));
  lol.teams = [s2, o2]; lol.hud.colorMode = "custom"; lol.hud.custom = ["#3a8dff", "#e84057"];
  Object.assign(lol.live, { left: s2.id, right: o2.id, seriesTitle: "NACE VARSITY", eventTitle: "SCC vs OPP", gameSeries: "BEST OF 3", bestOf: 3 });
  lol.talent = rl.talent.map(t => Object.assign({}, t, { id: uid(), socials: t.socials.map(s => Object.assign({}, s)) }));
  return { events: [rl, lol], onAir: rl.id, settings: { source: "auto", v: 2 } };
}

let DB;
try { DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { DB = null; }
if (!DB || !Array.isArray(DB.events)) DB = seed();
DB.settings = Object.assign({ source: "auto" }, DB.settings);
if (!DB.settings.v) { DB.settings.v = 2; if (DB.settings.source === "demo") DB.settings.source = "auto"; } // the demo is no longer the default
DB.events.forEach(upgrade);

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + ".tmp";
    fs.writeFile(tmp, JSON.stringify(DB, null, 1), err => {
      if (err) return log("Could not save data:", err.message);
      fs.rename(tmp, DB_FILE, e => e && log("Could not save data:", e.message));
    });
  }, 300);
}
const onAirEvent = () => DB.events.find(e => e.id === DB.onAir) || DB.events[0];

/* ------------------------------------------------------- live game state */
// "auto" follows the on-air event's game; games without a live feed fall back to screen OCR.
let activeSource = "";
const AUTO_SOURCE = { "Rocket League": "rl", "League of Legends": "lol" };
function resolveSource() {
  const s = DB.settings.source;
  if (s !== "auto") return s;
  const ev = onAirEvent();
  return AUTO_SOURCE[ev && ev.game] || "ocr";
}
const blankGame = () => ({
  kind: "rl", lol: null, ocr: null, scoreLive: false, clockLive: false,
  source: activeSource, connected: false, inMatch: false, lastPacket: 0, matchGuid: "", arena: "",
  teams: [{ name: "Blue", score: 0, color: "" }, { name: "Orange", score: 0, color: "" }],
  time: 300, overtime: false, replay: false, paused: false, podium: false, hasWinner: false, winner: -1,
  target: null, players: [], feed: [], lastGoal: null,
});
let game = blankGame();
let gameDirty = true;
const touch = () => { gameDirty = true; };

function pushFeed(item) {
  game.feed.push(Object.assign({ id: uid(), t: Date.now() }, item));
  if (game.feed.length > 8) game.feed.shift();
}
const who = p => p ? { name: p.Name || "", team: p.TeamNum ?? -1, shortcut: p.Shortcut ?? 0 } : null;

function onMatchEnded(winnerTeamNum) {
  const ev = onAirEvent();
  if (!ev || !ev.live.autoSeries || winnerTeamNum < 0) return;
  const side = ev.live.swap ? 1 - winnerTeamNum : winnerTeamNum;
  ev.live.series[side] = Math.min(9, (ev.live.series[side] || 0) + 1);
  save(); broadcastDb("server");
  notice(`Series updated: ${ev.live.series[0]}–${ev.live.series[1]}`);
}

// Rocket League Stats API message handler (also used by /api/ingest and the demo feed)
function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const ev = msg.Event || msg.event;
  let d = msg.Data ?? msg.data ?? {};
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = {}; } }
  game.lastPacket = Date.now();
  switch (ev) {
    case "UpdateState": {
      const g = d.Game || {};
      game.inMatch = true;
      if (d.MatchGuid) game.matchGuid = d.MatchGuid;
      if (Array.isArray(d.Players)) game.players = d.Players.map(p => ({
        name: p.Name || "", id: p.PrimaryId || "", shortcut: p.Shortcut ?? 0, team: p.TeamNum ?? 0,
        score: p.Score | 0, goals: p.Goals | 0, shots: p.Shots | 0, assists: p.Assists | 0, saves: p.Saves | 0,
        touches: p.Touches | 0, demos: p.Demos | 0, boost: p.Boost ?? null, speed: p.Speed ?? 0,
        boosting: !!p.bBoosting, supersonic: !!p.bSupersonic, demolished: !!p.bDemolished,
      }));
      if (Array.isArray(g.Teams)) g.Teams.forEach(t => {
        const i = t.TeamNum ?? 0; if (i > 1) return;
        if (t.Score == null) { if (t.Name) game.teams[i].name = t.Name; return; } // name-only update (OCR)
        game.teams[i] = { name: t.Name || (i ? "Orange" : "Blue"), score: t.Score | 0, color: t.ColorPrimary ? "#" + t.ColorPrimary : "" };
      });
      if (g.TimeSeconds != null) game.time = g.TimeSeconds;
      game.overtime = !!g.bOvertime;
      game.replay = !!g.bReplay;
      game.arena = g.Arena || game.arena;
      game.scoreLive = Array.isArray(g.Teams) && g.Teams.some(t => t.Score != null);
      game.clockLive = g.TimeSeconds != null;
      game.hasWinner = !!g.bHasWinner;
      game.target = g.bHasTarget && g.Target && g.Target.Name ? who(g.Target) : null;
      break;
    }
    case "ClockUpdatedSeconds": game.time = d.TimeSeconds ?? game.time; game.overtime = !!d.bOvertime; break;
    case "GoalScored": {
      const s = who(d.Scorer), a = who(d.Assister);
      const kmh = Math.round((d.GoalSpeed || 0) * 0.036 * 10) / 10; // uu/s → km/h
      game.lastGoal = { id: uid(), t: Date.now(), scorer: s, assister: a, kmh, team: s ? s.team : -1 };
      pushFeed({ type: "goal", main: s, second: a, text: `${kmh} KM/H` });
      break;
    }
    case "StatfeedEvent": {
      const n = d.EventName || "";
      if (n === "Goal" || n === "Assist") break; // shown via GoalScored
      pushFeed({ type: n.toLowerCase(), label: d.Type || n, main: who(d.MainTarget), second: who(d.SecondaryTarget) });
      break;
    }
    case "GoalReplayStart": game.replay = true; break;
    case "GoalReplayEnd": game.replay = false; break;
    case "MatchPaused": game.paused = true; break;
    case "MatchUnpaused": game.paused = false; break;
    case "MatchCreated": case "MatchInitialized":
      game.inMatch = true; game.podium = false; game.hasWinner = false; game.winner = -1; game.feed = []; game.lastGoal = null; break;
    case "RoundStarted": game.paused = false; break;
    case "MatchEnded": game.hasWinner = true; game.winner = d.WinnerTeamNum ?? -1; onMatchEnded(game.winner); break;
    case "PodiumStart": game.podium = true; break;
    case "MatchDestroyed": game.inMatch = false; game.podium = false; game.players = []; game.target = null; break;
    default: return;
  }
  touch();
}

/* ------------------------------------------- Rocket League TCP connection */
// Messages arrive as back-to-back JSON objects; split them by brace depth.
function makeSplitter(onObject) {
  let buf = "";
  return chunk => {
    buf += chunk;
    let depth = 0, inStr = false, esc = false, start = -1, cut = 0;
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { if (depth > 0) inStr = true; continue; }
      if (c === "{") { if (depth === 0) start = i; depth++; }
      else if (c === "}" && depth > 0) {
        depth--;
        if (depth === 0) {
          const raw = buf.slice(start, i + 1); cut = i + 1;
          try { onObject(JSON.parse(raw)); } catch (e) { log("Skipped a malformed packet:", e.message); }
        }
      }
    }
    buf = depth > 0 && start >= 0 ? buf.slice(start) : buf.slice(cut).replace(/^[^{]*/, "");
    if (buf.length > 4e6) buf = ""; // runaway guard
  };
}

let rlSock = null, rlTimer = null, rlWarned = false;
function connectRL() {
  clearTimeout(rlTimer);
  if (activeSource !== "rl") return;
  const sock = net.connect({ host: RL_HOST, port: RL_PORT });
  rlSock = sock;
  sock.setEncoding("utf8");
  sock.on("connect", () => { rlWarned = false; game.connected = true; touch(); log(`Connected to Rocket League Stats API on ${RL_HOST}:${RL_PORT}`); });
  sock.on("data", makeSplitter(handleMessage));
  sock.on("error", err => {
    if (!rlWarned) { rlWarned = true; log(`Waiting for Rocket League on ${RL_HOST}:${RL_PORT} (${err.code || err.message}). Is the game running with the Stats API enabled?`); }
  });
  sock.on("close", () => {
    if (rlSock === sock) { rlSock = null; game.connected = false; touch(); }
    if (activeSource === "rl") rlTimer = setTimeout(connectRL, 2000);
  });
}
function sendRL(cmd) {
  if (!rlSock || !game.connected) return false;
  rlSock.write(JSON.stringify(cmd));
  return true;
}

/* --------------------------------- League of Legends Live Client Data API */
// Riot serves this on https://127.0.0.1:2999 (self-signed cert) while a game or spectate is running.
const https = require("https");
const LOL_HOST = process.env.LOL_HOST || "127.0.0.1";
let ddVersion = "";
https.get("https://ddragon.leagueoflegends.com/api/versions.json", res => {
  let s = ""; res.on("data", c => (s += c)); res.on("end", () => { try { ddVersion = JSON.parse(s)[0]; } catch { } });
}).on("error", () => log("Couldn't reach Data Dragon, so champion icons will show initials."));

let lolLastEvent = -1, lolTimer = null, lolWarned = false;
const lolName = p => p.riotIdGameName || (p.riotId || "").split("#")[0] || p.summonerName || "";
const DRAGONS = { Fire: "Infernal", Water: "Ocean", Earth: "Mountain", Air: "Cloud", Hextech: "Hextech", Chemtech: "Chemtech", Elder: "Elder" };

function handleLoL(d) {
  const players = d.allPlayers || [];
  game.kind = "lol"; game.inMatch = true; game.connected = true; game.lastPacket = Date.now();
  game.players = players.map((p, i) => {
    const s = p.scores || {};
    return { name: lolName(p), id: p.riotId || p.summonerName || "", team: p.team === "CHAOS" ? 1 : 0, shortcut: i + 1,
      champion: p.championName || "", champKey: String(p.rawChampionName || "").replace("game_character_displayname_", ""),
      level: p.level | 0, kills: s.kills | 0, deaths: s.deaths | 0, assists: s.assists | 0, cs: s.creepScore | 0, ward: Math.round(s.wardScore || 0),
      gold: (p.items || []).reduce((a, x) => a + (x.price | 0) * (x.count || 1), 0), // value of items owned (the API doesn't expose total gold)
      dead: !!p.isDead, respawn: Math.round(p.respawnTimer || 0), items: (p.items || []).map(x => x.itemID),
      // RL-shaped fields so generic scenes still work
      score: (s.kills | 0) * 3 + (s.assists | 0), goals: s.kills | 0, saves: 0, shots: 0, demos: 0, boost: null };
  });
  const teamOf = name => { const p = game.players.find(x => x.name === name || x.id === name || x.id.split("#")[0] === name); return p ? p.team : -1; };
  game.time = Math.floor((d.gameData && d.gameData.gameTime) || 0);
  game.arena = (d.gameData && d.gameData.mapName) || "";
  game.overtime = false;
  [0, 1].forEach(t => { game.teams[t] = { name: t ? "Red" : "Blue", score: game.players.filter(p => p.team === t).reduce((a, p) => a + p.kills, 0), color: "" }; });

  const events = (d.events && d.events.Events) || [];
  // Objective spawn times (game seconds). The API gives kills but not spawn clocks, so these follow Summoner's Rift
  // rules: dragon first spawns at 5:00 and returns 5:00 after each kill; Baron first spawns at 20:00 and returns 6:00 after each kill.
  // Adjust here if a patch changes them.
  const SPAWN = { dragonFirst: 300, dragonGap: 300, baronFirst: 1200, baronGap: 360 };
  const lol = { towers: [0, 0], inhibs: [0, 0], dragons: [[], []], barons: [0, 0], heralds: [0, 0], grubs: [0, 0], ddVersion,
    spawn: { dragon: SPAWN.dragonFirst, baron: SPAWN.baronFirst } };
  const initial = lolLastEvent < 0 || (events.length && events[events.length - 1].EventID < lolLastEvent);
  if (initial) { lolLastEvent = -1; game.feed = []; }
  for (const e of events) {
    const fresh = !initial && e.EventID > lolLastEvent;
    const kt = teamOf(e.KillerName);
    const structSide = name => (/_T1_/.test(name || "") ? 1 : /_T2_/.test(name || "") ? 0 : kt);
    switch (e.EventName) {
      case "ChampionKill":
        if (fresh) pushFeed({ type: "kill", label: "KILL", main: { name: e.KillerName, team: kt }, second: { name: e.VictimName, team: teamOf(e.VictimName) } });
        break;
      case "Multikill":
        if (fresh) pushFeed({ type: "multi", label: ({ 2: "DOUBLE KILL", 3: "TRIPLE KILL", 4: "QUADRA KILL", 5: "PENTAKILL" })[e.KillStreak] || "MULTIKILL", main: { name: e.KillerName, team: kt } });
        break;
      case "FirstBlood": if (fresh) pushFeed({ type: "fb", label: "FIRST BLOOD", main: { name: e.Recipient, team: teamOf(e.Recipient) } }); break;
      case "Ace": if (fresh) pushFeed({ type: "ace", label: "ACE", main: { name: e.Acer, team: e.AcingTeam === "CHAOS" ? 1 : 0 } }); break;
      case "TurretKilled": { const s = structSide(e.TurretKilled); if (s >= 0) lol.towers[s]++; if (fresh) pushFeed({ type: "tower", label: "TOWER", main: { name: e.KillerName, team: s } }); break; }
      case "InhibKilled": { const s = structSide(e.InhibKilled); if (s >= 0) lol.inhibs[s]++; if (fresh) pushFeed({ type: "inhib", label: "INHIBITOR", main: { name: e.KillerName, team: s } }); break; }
      case "DragonKill": lol.spawn.dragon = (e.EventTime || 0) + SPAWN.dragonGap; if (kt >= 0) lol.dragons[kt].push(DRAGONS[e.DragonType] || e.DragonType); if (fresh) pushFeed({ type: "dragon", label: `${(DRAGONS[e.DragonType] || e.DragonType || "").toUpperCase()} DRAGON${e.Stolen === "True" ? " (STOLEN)" : ""}`, main: { name: e.KillerName, team: kt } }); break;
      case "BaronKill": lol.spawn.baron = (e.EventTime || 0) + SPAWN.baronGap; if (kt >= 0) lol.barons[kt]++; if (fresh) pushFeed({ type: "baron", label: "BARON", main: { name: e.KillerName, team: kt } }); break;
      case "HeraldKill": if (kt >= 0) lol.heralds[kt]++; if (fresh) pushFeed({ type: "herald", label: "RIFT HERALD", main: { name: e.KillerName, team: kt } }); break;
      case "HordeKill": if (kt >= 0) lol.grubs[kt]++; break;
      case "GameEnd":
        if (fresh && !game.hasWinner) {
          const ap = d.activePlayer ? game.players.find(p => p.name === lolName(d.activePlayer)) : null;
          game.hasWinner = true;
          if (ap) { game.winner = e.Result === "Win" ? ap.team : 1 - ap.team; onMatchEnded(game.winner); }
        }
        break;
    }
    if (e.EventID > lolLastEvent) lolLastEvent = e.EventID;
  }
  // A teamfight is two or more kills within 12 seconds of each other, still ongoing 8 seconds after the latest kill.
  let cluster = [];
  for (const e of events) if (e.EventName === "ChampionKill") {
    const t = e.EventTime || 0;
    if (cluster.length && t - cluster[cluster.length - 1].t > 12) cluster = [];
    cluster.push({ t, team: teamOf(e.KillerName) });
  }
  const lastK = cluster[cluster.length - 1], since = lastK ? game.time - lastK.t : 999;
  lol.fight = { active: cluster.length >= 2 && since >= 0 && since <= 8, kills: [0, 1].map(s => cluster.filter(k => k.team === s).length), since: cluster.length ? cluster[0].t : 0 };
  game.lol = lol;
  touch();
}

function pollLoL() {
  clearTimeout(lolTimer);
  if (activeSource !== "lol") return;
  const req = https.get({ host: LOL_HOST, port: 2999, path: "/liveclientdata/allgamedata", rejectUnauthorized: false, timeout: 1500 }, res => {
    let s = ""; res.setEncoding("utf8");
    res.on("data", c => (s += c));
    res.on("end", () => {
      if (res.statusCode === 200) { try { lolWarned = false; handleLoL(JSON.parse(s)); } catch (e) { log("Couldn't read League data:", e.message); } }
      else { game.connected = true; game.inMatch = false; touch(); } // client answers but the game is still loading
      lolTimer = setTimeout(pollLoL, 1000);
    });
  });
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", err => {
    if (!lolWarned) { lolWarned = true; log(`Waiting for League of Legends on ${LOL_HOST}:2999 (${err.code || err.message}). Start a game or spectate one on this PC.`); }
    if (game.connected || game.inMatch) { game.connected = false; game.inMatch = false; lolLastEvent = -1; touch(); }
    lolTimer = setTimeout(pollLoL, 2000);
  });
}

// Demo match for League events: builds Live Client Data–shaped payloads
let lolDemo = null;
function lolDemoTick() {
  const ev = onAirEvent(), rnd = n => Math.floor(Math.random() * n);
  if (!lolDemo) {
    const L = ev.teams.find(t => t.id === ev.live.left), R = ev.teams.find(t => t.id === ev.live.right);
    const champs = [["Aatrox", "Aatrox"], ["Lee Sin", "LeeSin"], ["Ahri", "Ahri"], ["Jinx", "Jinx"], ["Thresh", "Thresh"],
      ["Darius", "Darius"], ["Viego", "Viego"], ["Orianna", "Orianna"], ["Kai'Sa", "Kaisa"], ["Nautilus", "Nautilus"]];
    const nm = (t, i, side) => (t && t.players[i] && t.players[i].ign) || `${side ? "Red" : "Blue"} ${["Top", "Jungle", "Mid", "Bot", "Support"][i]}`;
    lolDemo = { time: 0, events: [{ EventID: 0, EventName: "GameStart", EventTime: 0 }], players: champs.map(([c, k], i) => ({
      riotIdGameName: nm(i < 5 ? L : R, i % 5, i < 5 ? 0 : 1), championName: c, rawChampionName: "game_character_displayname_" + k,
      team: i < 5 ? "ORDER" : "CHAOS", level: 1, isDead: false, respawnTimer: 0, items: [], scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0, wardScore: 0 } })) };
    lolLastEvent = -1;
  }
  const D = lolDemo, P = D.players, add = e => D.events.push(Object.assign({ EventID: D.events.length, EventTime: D.time }, e));
  D.time += 1;
  P.forEach((p, i) => {
    if (i % 5 !== 4 && i % 5 !== 1) p.scores.creepScore += Math.random() < 0.55 ? 1 : 0;
    if (i % 5 === 1 && Math.random() < 0.4) p.scores.creepScore++;
    p.scores.wardScore += Math.random() < 0.05 ? 1 : 0;
    p.level = Math.min(18, 1 + Math.floor(Math.sqrt(D.time / 40) * 3));
    if (p.isDead) { p.respawnTimer -= 1; if (p.respawnTimer <= 0) { p.isDead = false; p.respawnTimer = 0; } }
  });
  if (D.time > 60 && Math.random() < 0.05) {
    const alive = P.filter(p => !p.isDead), k = alive[rnd(alive.length)], foes = alive.filter(p => p.team !== k.team);
    if (k && foes.length) {
      const v = foes[rnd(foes.length)];
      k.scores.kills++; v.scores.deaths++; v.isDead = true; v.respawnTimer = 8 + Math.floor(D.time / 60) * 2;
      const helpers = P.filter(p => p.team === k.team && p !== k && Math.random() < 0.4); helpers.forEach(h => h.scores.assists++);
      if (!D.fb) { D.fb = true; add({ EventName: "FirstBlood", Recipient: k.riotIdGameName }); }
      add({ EventName: "ChampionKill", KillerName: k.riotIdGameName, VictimName: v.riotIdGameName, Assisters: helpers.map(h => h.riotIdGameName) });
    }
  }
  if (D.time > 300 && Math.random() < 0.012) { const s = rnd(2); add({ EventName: "DragonKill", KillerName: P[s * 5 + 1].riotIdGameName, DragonType: ["Fire", "Water", "Earth", "Air", "Hextech", "Chemtech"][rnd(6)], Stolen: "False" }); }
  if (D.time > 600 && Math.random() < 0.012) { const s = rnd(2); add({ EventName: "TurretKilled", KillerName: P[s * 5 + rnd(5)].riotIdGameName, TurretKilled: `Turret_T${s ? 1 : 2}_L_03_A` }); }
  if (D.time > 1200 && Math.random() < 0.004) { const s = rnd(2); add({ EventName: "BaronKill", KillerName: P[s * 5 + 1].riotIdGameName }); }
  if (D.time > 1800) { lolDemo = null; return; }
  handleLoL({ allPlayers: P, events: { Events: D.events }, gameData: { gameTime: D.time, mapName: "Map11", gameMode: "CLASSIC" } });
}

/* -------------------------------------------------------------- demo feed */
let demo = null;
function demoStart() {
  const ev = onAirEvent();
  const L = ev && ev.teams.find(t => t.id === ev.live.left), R = ev && ev.teams.find(t => t.id === ev.live.right);
  const names = (t, side) => [0, 1, 2].map(i => (t && t.players[i] && t.players[i].ign) || `${side ? "Orange" : "Blue"} ${i + 1}`);
  const [b, o] = ev && ev.live.swap ? [names(R, 0), names(L, 1)] : [names(L, 0), names(R, 1)];
  demo = { clock: 300, ended: 0 };
  game = Object.assign(blankGame(), { connected: true, inMatch: true, arena: "Stadium_P", matchGuid: "DEMO" });
  game.players = [...b, ...o].map((n, i) => ({ name: n, id: "Demo|" + i, shortcut: i + 1, team: i < 3 ? 0 : 1, score: 0, goals: 0, shots: 0,
    assists: 0, saves: 0, touches: 0, demos: 0, boost: 33, speed: 0, boosting: false, supersonic: false, demolished: false }));
  game.target = { name: game.players[0].name, team: 0, shortcut: 1 };
  touch();
}
function demoTick() {
  if (activeSource !== "demo") return;
  const ev = onAirEvent();
  if (ev && ev.game === "League of Legends") { if (!game.paused) lolDemoTick(); return; } // runs at 4x speed
  if (game.kind === "lol") { game = blankGame(); demo = null; }
  if (!demo) demoStart();
  const rnd = n => Math.floor(Math.random() * n);
  const P = game.players;
  game.lastPacket = Date.now();
  P.forEach(p => {
    if (p.demolished && Math.random() < 0.35) p.demolished = false;
    p.boost = Math.max(0, Math.min(100, p.boost + Math.round((Math.random() - 0.6) * 9)));
    if (Math.random() < 0.025) p.boost = 100;
    p.speed = Math.round(800 + Math.random() * 1500); p.supersonic = p.speed > 2200;
  });
  if (demo.ended) {
    if (Date.now() - demo.ended > 9000) { demoStart(); handleMessage({ Event: "MatchCreated", Data: {} }); }
    return touch();
  }
  if (!game.paused) {
    demo.sub = (demo.sub || 0) + 1;
    if (demo.sub % 4 === 0) {
      if (game.overtime) demo.clock++; else demo.clock = Math.max(0, demo.clock - 1);
      handleMessage({ Event: "ClockUpdatedSeconds", Data: { TimeSeconds: demo.clock, bOvertime: game.overtime } });
      if (Math.random() < 0.12) { const t = P[rnd(6)]; game.target = { name: t.name, team: t.team, shortcut: t.shortcut }; }
      if (Math.random() < 0.08) {
        const s = P[rnd(6)]; s.shots++; s.score += 20; s.touches++;
        if (Math.random() < 0.38) {
          const mates = P.filter(p => p.team === s.team && p !== s); const a = Math.random() < 0.6 ? mates[rnd(mates.length)] : null;
          s.goals++; s.score += 100; if (a) { a.assists++; a.score += 50; }
          game.teams[s.team].score++;
          handleMessage({ Event: "GoalScored", Data: { GoalSpeed: 2000 + Math.random() * 2500,
            Scorer: { Name: s.name, Shortcut: s.shortcut, TeamNum: s.team }, Assister: a ? { Name: a.name, Shortcut: a.shortcut, TeamNum: a.team } : undefined } });
          if (game.overtime) { demo.clock = 0; }
        } else {
          const g = P.filter(p => p.team !== s.team)[rnd(3)]; g.saves++; g.score += 50;
          handleMessage({ Event: "StatfeedEvent", Data: { EventName: "Save", Type: "Save", MainTarget: { Name: g.name, Shortcut: g.shortcut, TeamNum: g.team } } });
        }
      }
      if (Math.random() < 0.03) {
        const a = P[rnd(6)], v = P.filter(p => p.team !== a.team && !p.demolished)[0];
        if (v) { a.demos++; a.score += 15; v.demolished = true;
          handleMessage({ Event: "StatfeedEvent", Data: { EventName: "Demolish", Type: "Demolition", MainTarget: { Name: a.name, Shortcut: a.shortcut, TeamNum: a.team }, SecondaryTarget: { Name: v.name, Shortcut: v.shortcut, TeamNum: v.team } } }); }
      }
      const [s0, s1] = [game.teams[0].score, game.teams[1].score];
      if (demo.clock === 0 && !game.overtime && s0 === s1) game.overtime = true;
      if ((demo.clock === 0 && s0 !== s1) || (game.overtime && s0 !== s1)) {
        demo.ended = Date.now();
        handleMessage({ Event: "MatchEnded", Data: { WinnerTeamNum: s0 > s1 ? 0 : 1 } });
        setTimeout(() => { if (demo && demo.ended) handleMessage({ Event: "PodiumStart", Data: {} }); }, 2500);
      }
    }
  }
  touch();
}
setInterval(demoTick, 250);

// Switch the live connector when the chosen source (or the on-air event's game, for "auto") changes.
function applySource(force) {
  const want = resolveSource();
  if (!force && want === activeSource) return;
  activeSource = want;
  clearTimeout(rlTimer); clearTimeout(lolTimer);
  if (rlSock) { rlSock.destroy(); rlSock = null; }
  demo = null; lolDemo = null; lolLastEvent = -1; lolWarned = false; rlWarned = false;
  game = blankGame();
  if (want === "rl") connectRL();
  if (want === "lol") pollLoL();
  touch(); broadcastDb("server");
  log("Data source:", want + (DB.settings.source === "auto" ? " (auto)" : ""));
}
function setSource(src) {
  if (!["auto", "rl", "lol", "ocr", "push", "demo"].includes(src)) return;
  DB.settings.source = src; save();
  applySource(true);
}
setInterval(() => applySource(false), 1500);

/* ---------------------------------------------------- screen OCR (desktop app) */
// The Electron shell registers a provider (ocr.js). In plain Node there is none and the OCR endpoints say so.
let ocr = null;
function setOcrProvider(p) { ocr = p; }
// OCR readings arrive as Stats API–shaped messages; they only drive the HUD while OCR is the active source.
function ocrIngest(msg) { if (activeSource === "ocr") { game.connected = true; handleMessage(msg); } }

/* -------------------------------------------- League replay and game config */
function lolHttp(method, pth, body) {
  return new Promise(resolve => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({ host: LOL_HOST, port: 2999, path: pth, method, rejectUnauthorized: false, timeout: 3000,
      headers: data ? { "content-type": "application/json", "content-length": data.length } : {} }, res => {
      let s = ""; res.setEncoding("utf8"); res.on("data", c => (s += c));
      res.on("end", () => { let j = null; try { j = s ? JSON.parse(s) : null; } catch { j = s; } resolve({ status: res.statusCode, json: j }); });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", e => resolve({ status: 0, error: e.code || e.message }));
    if (data) req.write(data);
    req.end();
  });
}
function lolGameCfg() {
  const dirs = [process.env.LOL_DIR, "C:\\Riot Games\\League of Legends", "D:\\Riot Games\\League of Legends", "E:\\Riot Games\\League of Legends"].filter(Boolean);
  for (const d of dirs) { const f = path.join(d, "Config", "game.cfg"); if (fs.existsSync(f)) return f; }
  return null;
}
function readReplayApiSetting() {
  const f = lolGameCfg(); if (!f) return { found: false };
  const txt = fs.readFileSync(f, "utf8");
  return { found: true, file: f, enabled: /^\s*EnableReplayApi\s*=\s*1\s*$/mi.test(txt) };
}
function enableReplayApi() {
  const f = lolGameCfg(); if (!f) throw new Error("Couldn't find League's Config\\game.cfg. Set LOL_DIR to your League of Legends folder.");
  let txt = fs.readFileSync(f, "utf8");
  const eol = txt.includes("\r\n") ? "\r\n" : "\n";
  if (/^\s*EnableReplayApi\s*=/mi.test(txt)) txt = txt.replace(/^\s*EnableReplayApi\s*=.*$/mi, "EnableReplayApi=1");
  else if (/^\[General\]/mi.test(txt)) txt = txt.replace(/^\[General\][^\S\r\n]*\r?\n/mi, m => m + "EnableReplayApi=1" + eol);
  else txt += eol + "[General]" + eol + "EnableReplayApi=1" + eol;
  fs.writeFileSync(f, txt);
  return f;
}

/* ------------------------------------------------------------- broadcast */
const clients = new Set();
function sse(res, type, data) { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcastDb(by) { const payload = { db: DB, by, screens: screens() }; clients.forEach(c => sse(c.res, "db", payload)); }
function notice(text) { clients.forEach(c => sse(c.res, "notice", { text })); }
function screens() { const s = { dashboard: 0, overlay: 0 }; clients.forEach(c => { s[c.kind] = (s[c.kind] || 0) + 1; }); return s; }
setInterval(() => {
  if (activeSource === "push") game.connected = Date.now() - game.lastPacket < 5000;
  if (activeSource === "ocr") {
    const st = ocr ? ocr.state() : { available: false };
    game.ocr = st; game.connected = !!(st.running && st.lastRead && Date.now() - st.lastRead < 5000);
    if (st.running) gameDirty = true;
  }
  if (!gameDirty) return;
  gameDirty = false;
  game.source = activeSource;
  clients.forEach(c => sse(c.res, "game", game));
}, 100);
setInterval(() => clients.forEach(c => c.res.write(": ping\n\n")), 15000);

/* ------------------------------------------------------------------ http */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".json": "application/json" };

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(buf);
  });
}
function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, decodeURIComponent(rel)));
  return p.startsWith(base + path.sep) ? p : null;
}
function readBody(req, limit, cb) {
  const chunks = []; let size = 0, done = false;
  req.on("data", c => { size += c.length; if (size > limit) { done = true; req.destroy(); return cb(new Error("too large")); } chunks.push(c); });
  req.on("end", () => { if (!done) cb(null, Buffer.concat(chunks)); });
}
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

function setPath(obj, p, v) {
  const ks = String(p).split(".");
  if (ks.some(k => k === "__proto__" || k === "constructor" || k === "prototype")) throw new Error("bad path");
  const last = ks.pop();
  const parent = ks.reduce((a, k) => (a == null ? a : a[k]), obj);
  if (parent == null || typeof parent !== "object") throw new Error("path not found");
  parent[last] = v;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (req.method === "GET") {
    if (p === "/" || p === "/dashboard") return sendFile(res, path.join(PUB, "app.html"));
    if (p === "/overlay") return sendFile(res, path.join(PUB, "overlay.html"));
    if (p === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const c = { res, kind: url.searchParams.get("kind") === "overlay" ? "overlay" : "dashboard" };
      clients.add(c);
      sse(res, "db", { db: DB, by: "init", screens: screens() });
      sse(res, "game", game);
      broadcastDb("screens");
      req.on("close", () => { clients.delete(c); broadcastDb("screens"); });
      return;
    }
    if (p === "/api/state") return json(res, 200, { db: DB, game });
    if (p === "/api/lol/replay") { // playback + render state, plus whether the Replay API is switched on
      return Promise.all([lolHttp("GET", "/replay/playback"), lolHttp("GET", "/replay/render")]).then(([pb, rn]) => {
        const cfg = readReplayApiSetting();
        json(res, 200, { available: pb.status === 200, playback: pb.status === 200 ? pb.json : null, render: rn.status === 200 ? rn.json : null,
          reason: pb.status === 200 ? "" : pb.status === 0 ? "League isn't running a game or replay." : "The Replay API is off. Turn it on, then restart the replay.", config: cfg });
      });
    }
    if (p === "/api/lol/swagger") return lolHttp("GET", "/swagger/v3/openapi.json").then(r => json(res, r.status === 200 ? 200 : 502, r.json || { error: r.error }));
    if (p === "/api/ocr/state") return json(res, 200, ocr ? Object.assign({ available: true, config: DB.settings.ocr || null }, ocr.state()) : { available: false, config: DB.settings.ocr || null });
    if (p === "/api/ocr/sources") {
      if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Saints HUD desktop app." });
      return ocr.listSources().then(s => json(res, 200, s)).catch(e => json(res, 500, { error: e.message }));
    }
    if (p === "/api/ocr/frame") {
      if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Saints HUD desktop app." });
      return ocr.frame(url.searchParams.get("source") || (DB.settings.ocr || {}).sourceId, (DB.settings.ocr || {}).sourceName)
        .then(buf => { res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }); res.end(buf); })
        .catch(e => json(res, 404, { error: e.message }));
    }
    if (p.startsWith("/uploads/")) { const f = safeJoin(UPLOADS, p.slice(9)); return f ? sendFile(res, f) : json(res, 400, { error: "bad path" }); }
    const f = safeJoin(PUB, p.slice(1));
    return f ? sendFile(res, f) : json(res, 404, { error: "not found" });
  }

  if (req.method === "POST") {
    if (p === "/api/upload") {
      const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg" }[req.headers["content-type"]];
      if (!ext) return json(res, 415, { error: "Use a PNG, JPG, WebP, GIF or SVG image." });
      return readBody(req, 15e6, (err, buf) => {
        if (err) return json(res, 413, { error: "That image is over 15 MB." });
        const name = uid() + ext;
        fs.writeFile(path.join(UPLOADS, name), buf, e => e ? json(res, 500, { error: e.message }) : json(res, 200, { url: "/uploads/" + name }));
      });
    }
    return readBody(req, 2e6, (err, buf) => {
      if (err) return json(res, 413, { error: "Request too large" });
      let body; try { body = JSON.parse(buf.toString("utf8") || "{}"); } catch { return json(res, 400, { error: "Body must be JSON" }); }
      try {
        switch (p) {
          case "/api/set": { // { event?: id, path, value, by }
            const target = body.event ? DB.events.find(e => e.id === body.event) : DB;
            if (!target) return json(res, 404, { error: "event not found" });
            setPath(target, body.path, body.value);
            save(); broadcastDb(body.by || "api");
            if (body.path === "onAir" || /(^|\.)game$/.test(body.path)) applySource(false); // auto source follows the on-air game
            return json(res, 200, { ok: true });
          }
          case "/api/lol/playback": case "/api/lol/render": { // forwarded to League's Replay API
            return lolHttp("POST", "/replay/" + p.split("/").pop(), body).then(r => json(res, r.status === 200 ? 200 : 409,
              r.status === 200 ? (r.json || { ok: true }) : { error: r.status === 0 ? "League isn't running a replay." : "The Replay API rejected that.", detail: r.json }));
          }
          case "/api/lol/enable-replay-api": { const file = enableReplayApi(); return json(res, 200, { ok: true, file }); }
          case "/api/ocr/config": {
            if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Saints HUD desktop app." });
            DB.settings.ocr = body; save(); ocr.update(body); broadcastDb("server");
            return json(res, 200, { ok: true });
          }
          case "/api/ocr/start": {
            if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Saints HUD desktop app." });
            if (DB.settings.source !== "ocr") setSource("ocr");
            return ocr.start(DB.settings.ocr || {}, ocrIngest).then(() => json(res, 200, { ok: true })).catch(e => json(res, 400, { error: e.message }));
          }
          case "/api/ocr/stop": if (ocr) ocr.stop(); return json(res, 200, { ok: true });
          case "/api/ocr/test": {
            if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Saints HUD desktop app." });
            return ocr.testRegion(body.source || (DB.settings.ocr || {}).sourceId, (DB.settings.ocr || {}).sourceName, body.region)
              .then(r => json(res, 200, r)).catch(e => json(res, 400, { error: e.message }));
          }
          case "/api/source": setSource(body.source); return json(res, 200, { ok: true });
          case "/api/rl": { // forward a Stats API command, e.g. {Command:"ChangePOV",Data:{Focus:"1"}}
            const ok = sendRL({ Command: body.Command, Data: body.Data || {} });
            return json(res, ok ? 200 : 409, ok ? { ok } : { error: "Rocket League isn't connected." });
          }
          case "/api/ingest": { // external feeds (OCR etc.) post Stats API-shaped messages
            (Array.isArray(body) ? body : [body]).forEach(handleMessage);
            if (DB.settings.source === "push") game.connected = true;
            return json(res, 200, { ok: true });
          }
          case "/api/demo/reset": demo = null; lolDemo = null; lolLastEvent = -1; game = blankGame(); touch(); return json(res, 200, { ok: true });
          case "/api/demo/pause": game.paused = !game.paused; touch(); return json(res, 200, { paused: game.paused });
          default: return json(res, 404, { error: "unknown endpoint" });
        }
      } catch (e) { return json(res, 400, { error: e.message }); }
    });
  }
  res.writeHead(405); res.end();
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") log(`Port ${PORT} is already in use. Close the other Squish window or set PORT to a different number.`);
  else log("Server error:", err.message);
  if (require.main === module) process.exit(1);
});
module.exports = { server, PORT, DATA, setOcrProvider, getDb: () => DB };

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  log(`Saints HUD running`);
  log(`  Dashboard:  http://${shown}:${PORT}/`);
  log(`  Overlay:    http://${shown}:${PORT}/overlay   (add as an OBS Browser Source, 1920x1080)`);
  applySource(true);
});
