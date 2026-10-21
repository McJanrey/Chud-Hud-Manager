// Chud Hud server: dashboard + OBS overlays + Rocket League Stats API bridge.
// Zero dependencies: needs only Node.js 18+.
"use strict";
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const V = require("./variant.js"); // the standard app, or a themed edition such as Chud Hud LOTD
const LIC = require("./license.js"); // license codes: release builds only run with a valid, switched-on code (see license.js)
const EDITION = V.id || "std";
const TEAM_A = V.id === "wwl" ? "#57a5fc" : "#2f7dff", TEAM_B = V.id === "wwl" ? "#ff6060" : "#ff9b1a"; // the two default team colours (Winter Wonder-LAN: brand blue and red)
const PORT = +process.env.PORT || V.port || 7777;
const HOST = process.env.HOST || "127.0.0.1"; // set HOST=0.0.0.0 to reach it from other PCs on your LAN
const RL_HOST = process.env.RL_HOST || "127.0.0.1";
const RL_PORT = +process.env.RL_PORT || 49123;

const ROOT = __dirname;
const PUB = path.join(ROOT, "public");
const DATA = process.env.SAINTS_DATA || path.join(ROOT, "data"); // the desktop app points this at its user-data folder
const UPLOADS = path.join(DATA, "uploads");
const DB_FILE = path.join(DATA, "db.json");
fs.mkdirSync(UPLOADS, { recursive: true });

const uid = () => crypto.randomBytes(5).toString("hex");
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

/* ------------------------------------------------------------------ data */
const blankTeam = (name, tag, color, color2, igns = []) => ({
  id: uid(), name, tag, division: "", seed: "", color, color2: color2 || "#ffffff", logos: ["", "", ""],
  players: igns.map(ign => ({ id: uid(), ign, alias: "", country: "", avatar: "", cam: "", stats: {} })),
});
const talent = (name, role, socials = []) => ({ id: uid(), name, role, portrait: "", socials });

// ads that ship with the app; every new event starts with them, and the Ads page can add them back
const BUILTIN_ADS = [{ id: "standby", url: "/brand/ads/standby.png", secs: 8, fit: "contain", on: true }, { id: "lotd", url: "/brand/ads/lotd.png", secs: 8, fit: "contain", on: true }];
function newEvent(name, game = "Rocket League", organiser = "") {
  return {
    id: uid(), name, game, organiser, kit: "Saints Default", created: Date.now(), source: "auto", cover: "", // cover: an uploaded image for the event card // source: which live feed the event reads (auto = its game's own)
    hud: { scene: "ingame", colorMode: "team", custom: [TEAM_A, TEAM_B], bg: "pitch", autoBoard: true,
      show: { boost: true, card: true, score: true, stats: true, feed: true, goal: true, playerCam: false, focus: true, sponsor: true, minimap: true, // focus, sponsor, minimap: League's bottom band
        maps: true, mcTop: true, mcKills: true, mcFeed: true, mcElim: true, mcSpot: true, mcGrid: true, mcSponsors: true, mcCam: false }, // Hunger Games elements
      mcSet: { killRows: 5, feedRows: 4, bars: true, elimSecs: 6, showBorder: true }, mcState: "main" }, // their settings, and the HUD state: main, final or winner
    teams: [],
    tournament: { name: "", region: "", lang: "", size: "32 Teams", format: "Double Elimination", logos: ["", "", "", ""], sponsors: [] },
    talent: [],
    live: { left: "", right: "", swap: false, autoTeams: true, autoScore: true, autoSeries: true, score: [0, 0], bestOf: 5,
      series: [0, 0], seriesTitle: "", eventTitle: "", roundTitle: "", gameSeries: "BEST OF 5" },
    camera: { own: true, layout: "duo", director: "all", pin: [0, 0], seats: Array.from({ length: 8 }, () => ({ talent: "", url: "", role: "" })) }, // how many seats show is decided by the kit (settings.kits)
    schedule: [],
    bracket: { rounds: [
      { name: "Quarterfinals", matches: Array.from({ length: 4 }, () => ({ a: "", b: "", sa: "", sb: "" })) },
      { name: "Semifinals", matches: Array.from({ length: 2 }, () => ({ a: "", b: "", sa: "", sb: "" })) },
      { name: "Grand Final", matches: [{ a: "", b: "", sa: "", sb: "" }] }] },
    standings: [],
    lowerThird: { title: "", subtitle: "" },
    ads: { items: BUILTIN_ADS.map(x => Object.assign({}, x)), mode: "off", start: 0, anim: "fade", fadeMs: 800 }, // ad rotation: pictures, GIFs or videos taking turns (hud.js rotHtml); anim: fade, slide, zoom or cut; mode: off (full screen scene only), corner, banner or logo (in the scenes' logo boxes)
    timer: { label: "BACK SOON", seconds: 300, endsAt: 0, remaining: 300 },
    // Minecraft: Hunger Games and Build Battle
    mc: { mode: "hungergames", title: "HUNGER GAMES", total: 24, spotlight: "", winner: "", clock: { running: false, base: 0, startedAt: 0 },
      bb: { theme: "", phase: "waiting", buildSeconds: 900, endsAt: 0, remaining: 900, judging: "", scores: {},
        judges: [], judgeScores: {}, audience: { open: false, weight: 0, scores: {} } },
      poll: { question: "", options: ["", ""], open: false, show: false, counts: [0, 0], total: 0 } },
    // VALORANT 2v2 Skirmish: first to "target" rounds, scored by hand
    val: { target: 10, squad: 2, dead: {}, aliveUsed: false, p: {}, barBg: "", barStyle: "solid", veto: null, feed: [], spec: "", state: "main", to: { side: 0, role: "", at: 0, secs: 60 }, rounds: [], win: { side: 0, at: 0 } }, // win: the last round win, for the ROUND WIN banner // state: the HUD state (main, buy or timeout); to: the timeout being shown; rounds: who won each round (0 left, 1 right) // feed: the killfeed rows; spec: the spectated player's id // squad: players a side (2 to 5); dead: player id -> true while out this round; aliveUsed: a toggle was used since the last reset;
    // p: player id -> { hp, ult, ultMax, gun, cr } typed by the operator (VALORANT has no live feed); barStyle: solid | clear | media, barBg: the picture or video behind the top bar
    // Dead by Daylight: one trial is a killer against survivors; points per kill, per escape and per generator
    dbd: { killPts: 1, escapePts: 1, genPts: 0, trials: [] },
    // Fortnite: points for the placement tier a team lands in plus points per elimination, over a number of matches
    fn: { elimPts: 1, spotlight: "", placePts: [{ to: 1, pts: 10 }, { to: 2, pts: 7 }, { to: 3, pts: 5 }, { to: 5, pts: 3 }, { to: 10, pts: 1 }], matches: [], games: 6, live: {} }, // live: the game being played now (see hud.js fnLive)
    // Riftbound (trading card game): operator-driven scoring
    rb: { names: ["", ""], legends: ["", ""], colors: [TEAM_A, TEAM_B], points: [0, 0], target: 8, games: [0, 0], bestOf: 3, turn: 1, active: 0,
      limitMinutes: 50, clock: { running: false, base: 0, startedAt: 0 }, cards: [], spotlight: { cardId: "", show: false }, roundTitle: "", play: [[], []], log: [],
      // the broadcast layout (Riot card ids): legend and champion, battlefield, who went first, the hand lists, decklists, the showdown, the cameras
      legend: ["", ""], champ: ["", ""], bf: ["", ""], first: 0, hand: [[], []], deck: [[], []], sd: { on: false, bf: "", might: [0, 0] }, feat: { id: "", side: 1 }, cams: ["", ""] }, // card entries carry Riot's card id
  };
}
// Older saved data may predate some fields: fill them in.
function upgrade(ev) {
  const d = newEvent(ev.name);
  for (const k of Object.keys(d)) if (ev[k] === undefined) ev[k] = d[k];
  ev.hud.show = Object.assign({}, d.hud.show, ev.hud.show);
  { const dm = d.mc; // Build Battle judges, audience scores and the chat poll arrived later than the first Minecraft events
    ev.mc.bb = Object.assign({}, dm.bb, ev.mc.bb); ev.mc.bb.audience = Object.assign({}, dm.bb.audience, ev.mc.bb.audience);
    ev.mc.poll = Object.assign({}, dm.poll, ev.mc.poll); }
  if (ev.hud.draftAuto === undefined) ev.hud.draftAuto = true; // League: the in-game scene shows champion select while it is on
  if (ev.camera && !ev.camera.director) ev.camera.director = "all"; // "all" shows every player's webcam, "action" only the player in the action
  if (ev.camera && !Array.isArray(ev.camera.pin)) ev.camera.pin = [0, 0];
  if (ev.camera && ev.camera.own === undefined) ev.camera.own = true;
  { const SC = require("./public/hud.js").SC_DEF; ev.hud.sc = ev.hud.sc || {}; // each broadcast-pack scene's own switches (Background, Bottom Announcement, ...)
    for (const k of Object.keys(SC)) ev.hud.sc[k] = Object.assign({}, SC[k], ev.hud.sc[k]); }
  ev.lowerThird = Object.assign({ label: "LOCAL TIME", ticker: "" }, ev.lowerThird); ev.lowerThird.ticker = String(ev.lowerThird.ticker || "").replace(/\s*\n\s*/g, " | "); // older events kept one message per line
  ev.teams.forEach(t => t.players.forEach(p => { if (!p.stats || typeof p.stats !== "object") p.stats = {}; })); // typed stats for the Stats scenes // our own camera links are used unless an event opts out
  ev.hud.mcSet = Object.assign({}, d.hud.mcSet, ev.hud.mcSet); if (!ev.hud.mcState) ev.hud.mcState = "main";
  if (ev.mc && ev.mc.winner === undefined) ev.mc.winner = "";
  while (ev.camera.seats.length < 8) ev.camera.seats.push({ talent: "", url: "", role: "" }); // older events kept three or five seats
  ev.val = Object.assign({}, d.val, ev.val); ev.val.squad = Math.max(2, Math.min(5, Math.round(+ev.val.squad) || 2)); if (!ev.val.dead || typeof ev.val.dead !== "object" || Array.isArray(ev.val.dead)) ev.val.dead = {};
  if (!ev.val.p || typeof ev.val.p !== "object" || Array.isArray(ev.val.p)) ev.val.p = {}; if (!["solid", "clear", "media"].includes(ev.val.barStyle)) ev.val.barStyle = "solid"; if (!Array.isArray(ev.val.feed)) ev.val.feed = []; if (typeof ev.val.spec !== "string") ev.val.spec = "";
  if (!ev.ads || typeof ev.ads !== "object") ev.ads = { items: [], mode: "off", start: 0 };
  if (!Array.isArray(ev.ads.items)) ev.ads.items = [];
  if (!["off", "corner", "banner", "logo"].includes(ev.ads.mode)) ev.ads.mode = "off";
  if (!["fade", "slide", "zoom", "cut"].includes(ev.ads.anim)) ev.ads.anim = "fade";
  ev.ads.fadeMs = Math.max(0, Math.min(3000, Math.round(+(ev.ads.fadeMs ?? 800)) || 0));
  if (!["main", "buy", "timeout"].includes(ev.val.state)) ev.val.state = "main";
  { const t = ev.val.to && typeof ev.val.to === "object" ? ev.val.to : {}; ev.val.to = { side: +t.side === 1 ? 1 : 0, role: ["atk", "def"].includes(t.role) ? t.role : "", at: +t.at || 0, secs: Math.max(10, Math.min(300, Math.round(+t.secs) || 60)) }; }
  ev.val.rounds = (Array.isArray(ev.val.rounds) ? ev.val.rounds : []).filter(x => x === 0 || x === 1).slice(0, 60);
  { const w = ev.val.win && typeof ev.val.win === "object" ? ev.val.win : {}; ev.val.win = { side: +w.side === 1 ? 1 : 0, at: +w.at || 0 }; }
  ev.val.veto = require("./public/hud.js").vetoFix(ev.val.veto, ev.val.squad); // map selection: format, pool and one step per map
  if (ev.game === "Valorant") ev.teams.forEach(t => t.players.forEach(p => { if (p.agent === undefined) p.agent = ""; })); // the agent a player picks (a valorant-api.com uuid)
  if (ev.rb) { const D = d.rb; ["legend", "champ", "bf", "hand", "deck", "cams"].forEach(k => { if (!Array.isArray(ev.rb[k]) || ev.rb[k].length !== 2) ev.rb[k] = JSON.parse(JSON.stringify(D[k])); });
    if (!ev.rb.sd || typeof ev.rb.sd !== "object") ev.rb.sd = JSON.parse(JSON.stringify(D.sd)); if (!ev.rb.feat || typeof ev.rb.feat !== "object") ev.rb.feat = { id: "", side: 1 }; if (ev.rb.first !== 1) ev.rb.first = 0; }
  ev.dbd = Object.assign({}, d.dbd, ev.dbd); ev.fn = Object.assign({}, d.fn, ev.fn); if (!ev.fn.live || typeof ev.fn.live !== "object" || Array.isArray(ev.fn.live)) ev.fn.live = {};
  ev.fn.matches.forEach(m => { m.place = m.place || []; m.elims = m.elims || []; });
  ev.rb.play = ev.rb.play || [[], []]; ev.rb.log = ev.rb.log || []; // Riftbound cards in play and what was played
  if (!ev.source) ev.source = "auto";
  if (ev.cover === undefined) ev.cover = "";
  if (typeof ev.kit === "string" && ev.kit.startsWith("Squish ")) ev.kit = "Saints " + ev.kit.slice(7); // events saved before the rename
  if (!ev.hud.lolPanel || ev.hud.lolPanel === "auto") ev.hud.lolPanel = "lane"; // the teamfight strip is a manual switch
  if (ev.game === "League of Legends") ev.lol = require("./league.js").merge(require("./league.js").DEFAULTS, ev.lol || {}); // every League setting has a visible value
  // League now follows the in-game layout: the stats board is at the bottom, so the side player lists start switched off (once)
  if (ev.game === "League of Legends" && !ev.hud.lolLayout2) { ev.hud.show.boost = false; ev.hud.lolLayout2 = true; }
  // the Worlds-style band (focus panel, sponsor box, minimap frame) starts switched on for existing League events (once)
  if (ev.game === "League of Legends" && !ev.hud.lolLayout3) { ev.hud.show.focus = ev.hud.show.sponsor = ev.hud.show.minimap = true; ev.hud.lolLayout3 = true; }
  ev.teams.forEach(t => { if (t.seed === undefined) t.seed = ""; });
  // the St. Clair team shows the app's logo until a team logo is uploaded (older saves had the Saints emblem filled in)
  ev.teams.forEach(t => { if (t.tag === "SCC" && t.logos && (!t.logos[0] || t.logos[0] === "/brand/saints-emblem.png")) t.logos[0] = "/brand/chud-hud.png"; });
  return ev;
}
const SQUAD = { "League of Legends": 5, "Rocket League": 3, "Dead by Daylight": 5, "Fortnite": 2, "Valorant": 2 };
const seatPlayers = (ev, n) => ev.teams.forEach(t => { while (t.players.length < n) t.players.push(Object.assign({ id: uid(), ign: "", alias: "", country: "", avatar: "", cam: "", stats: {} }, ev.game === "Valorant" ? { agent: "" } : {})); });
function freshEvent(game, name = "New Event") {
  const ev = newEvent(name, game);
  // Blue and Orange are Rocket League's sides (and League has blue and red); every other game starts with names that fit it
  const NAMES = { "Rocket League": ["Blue Side", "BLU", "Orange Side", "ORG"], "League of Legends": ["Blue Side", "BLU", "Orange Side", "ORG"], "Riftbound": ["Player 1", "P1", "Player 2", "P2"] };
  const [an, at, bn, bt] = NAMES[game] || ["Team A", "TMA", "Team B", "TMB"];
  const A = blankTeam(an, at, TEAM_A), B = blankTeam(bn, bt, TEAM_B);
  ev.teams = game === "Minecraft" ? [blankTeam("Players", "PLR", "#1d8a4a", "#f2b51c")] : [A, B]; // Minecraft has players, not two sides
  Object.assign(ev.live, { left: ev.teams[0].id, right: ev.teams[1] ? ev.teams[1].id : "" });
  if (game === "League of Legends") { B.name = "Red Side"; B.tag = "RED"; B.color = "#e84057"; ev.hud.colorMode = "custom"; ev.hud.custom = ["#3a8dff", "#e84057"]; }
  if (game === "Fortnite") { // a field of duos rather than two sides
    const cols = [TEAM_A, TEAM_B, "#1d8a4a", "#e84057", "#b48cff", "#2fd4c4", "#f2b51c", "#ff6ba8"];
    ev.teams = Array.from({ length: 8 }, (_, i) => blankTeam("Duo " + (i + 1), "D" + (i + 1), cols[i]));
    Object.assign(ev.live, { left: ev.teams[0].id, right: ev.teams[1].id });
  }
  if (SQUAD[game]) seatPlayers(ev, game === "Valorant" ? ev.val.squad : SQUAD[game]);
  return upgrade(ev);
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
if (DB.settings && DB.settings.brand) delete DB.settings.brand; // the app logo is fixed (see lockedPath); saved with the next change
// The data source used to be one setting for the whole workspace (and only the on-air event used it). Now every event has its own:
// a test match, screen reading or external feed set before stays with the event that was on air; League or Rocket League sources
// are what Auto already does for the matching game.
if (!DB.settings.perEventSource) {
  DB.settings.perEventSource = true;
  const first = DB.events.find(e => e.id === DB.onAir) || DB.events[0];
  if (first && ["demo", "ocr", "push"].includes(DB.settings.source)) first.source = DB.settings.source;
  DB.settings.source = "auto";
}
if (!DB.settings.draft) DB.settings.draft = { delay: 0, lockfile: "" }; // champion select: stream delay in seconds, and a lockfile path if the client is installed elsewhere
// Chud Hud LOTD (Lan of the Dead) starts with its own three games, put at the front once. Everything else stays available.
if (V.id === "lotd" && !DB.settings.lotdEvents) {
  DB.settings.lotdEvents = true;
  const mk = (game, name, series) => { const ev = freshEvent(game, name); ev.tournament.name = "LAN OF THE DEAD 2026"; ev.live.seriesTitle = series; return ev; };
  const dbd = mk("Dead by Daylight", "DBD - TRIALS", "LAN OF THE DEAD"), fn = mk("Fortnite", "FN - DUOS", "LAN OF THE DEAD"), vl = mk("Valorant", "VAL - 2V2 SKIRMISH", "LAN OF THE DEAD");
  dbd.live.gameSeries = "TRIALS"; fn.live.gameSeries = "DUOS"; vl.live.gameSeries = "2V2 SKIRMISH";
  DB.events.unshift(vl, fn, dbd);
  setImmediate(save);
}
// the Schedule design names the event "LAN OF THE DEAD 2026": events still carrying the old default name get the year once (a name you typed is never touched)
if (V.id === "lotd" && !DB.settings.lotdYear) {
  DB.settings.lotdYear = true;
  DB.events.forEach(e => { if (e.tournament && e.tournament.name === "LAN OF THE DEAD") e.tournament.name = "LAN OF THE DEAD 2026"; });
  setImmediate(save);
}
// Ready-made events for Minecraft (Hunger Games and Build Battle) and Riftbound, added once to a saved workspace that has none.
if (!DB.settings.extraEvents) {
  DB.settings.extraEvents = true;
  const has = g => DB.events.some(e => e.game === g);
  const withTeams = (ev, ...teams) => { ev.teams = teams; return ev; };
  if (!has("Minecraft")) {
    const hg = withTeams(newEvent("MC - HUNGER GAMES", "Minecraft", "SCC"), blankTeam("Players", "PLR", "#1d8a4a", "#f2b51c"));
    hg.mc.mode = "hungergames"; hg.mc.title = "HUNGER GAMES"; hg.live.seriesTitle = "SCC HUNGER GAMES";
    const bb = withTeams(newEvent("MC - BUILD BATTLE", "Minecraft", "SCC"), blankTeam("Players", "PLR", "#1d8a4a", "#f2b51c"));
    bb.mc.mode = "buildbattle"; bb.mc.title = "BUILD BATTLE"; bb.live.seriesTitle = "SCC BUILD BATTLE";
    DB.events.push(upgrade(hg), upgrade(bb));
  }
  if (!has("Riftbound")) {
    const rb = withTeams(newEvent("RB - RIFTBOUND", "Riftbound", "SCC"), blankTeam("Player 1", "P1", TEAM_A), blankTeam("Player 2", "P2", TEAM_B));
    Object.assign(rb.live, { left: rb.teams[0].id, right: rb.teams[1].id, seriesTitle: "SCC RIFTBOUND", bestOf: 3, gameSeries: "BEST OF 3" });
    DB.events.push(upgrade(rb));
  }
  setImmediate(save); // save() needs the state that is declared further down, so run it after startup
}
// Each broadcast kit owns its caster-seat count (1 to 5), shared by every event that uses the kit. Camera links stay on the event.
// A kit that has no setting yet starts from the layout its first event already had.
DB.settings.kits = DB.settings.kits || {};
DB.events.forEach(ev => { if (!DB.settings.kits[ev.kit]) DB.settings.kits[ev.kit] = { seats: { solo: 1, duo: 2, trio: 3 }[ev.camera && ev.camera.layout] || 2 }; });
for (const k of ["Saints Default", "Saints Varsity", "Saints Gaming"]) if (!DB.settings.kits[k]) DB.settings.kits[k] = { seats: 2 };
// official objective icons are kept apart from icons the user uploads (an earlier build stored both together)
if (DB.settings.icons) {
  const mine = {}, official = DB.settings.iconsOfficial || {};
  for (const [k, v] of Object.entries(DB.settings.icons)) if (String(v).startsWith("/objective-icons/")) official[k] = v; else mine[k] = v;
  DB.settings.icons = mine; DB.settings.iconsOfficial = official;
}

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
// Every kind of live source runs at once, one feed each: Rocket League, League, Minecraft, screen OCR, the external feed and one
// test match per event. An event reads the feed of its own game (or the source picked on its Live Game page), so any number of
// events can be live together, each with its own overlay link.
const HUD = require("./public/hud.js");
const blankGame = (key = "") => ({
  kind: "rl", lol: null, ocr: null, mc: null, mcOcr: null, scoreLive: false, clockLive: false, clockAt: 0,
  source: String(key).split(":")[0], connected: false, inMatch: false, lastPacket: 0, matchGuid: "", arena: "",
  teams: [{ name: "Blue", score: 0, color: "" }, { name: "Orange", score: 0, color: "" }],
  time: 300, overtime: false, replay: false, paused: false, podium: false, hasWinner: false, winner: -1,
  target: null, players: [], feed: [], lastGoal: null,
});
const feeds = new Map(); // key -> { game, dirty, lolLast, demo, lolDemo }
let game = blankGame(), curKey = ""; // `game` is the feed the running handler is updating (set by inFeed)
const feedOf = key => { let f = feeds.get(key); if (!f) { f = { game: blankGame(key), dirty: true, lolLast: -1, demo: null, lolDemo: null }; feeds.set(key, f); } return f; };
function inFeed(key, fn) { const pg = game, pk = curKey, f = feedOf(key); game = f.game; curKey = key; try { return fn(f); } finally { game = pg; curKey = pk; } }
const touch = () => { const f = feeds.get(curKey); if (f) f.dirty = true; };
const feedKeyOf = ev => HUD.feedKey(ev);
// the screen-reading feed stays alive while Screen OCR runs, even if no event reads from it: the scoring pages use its result-screen values
const usedKeys = () => { const k = new Set(DB.events.map(feedKeyOf)); if (ocr && ocr.state().running) k.add("ocr"); return k; };
const eventForFeed = key => DB.events.find(e => feedKeyOf(e) === key);
const low = s => String(s || "").toLowerCase().trim();

function pushFeed(item) {
  game.feed.push(Object.assign({ id: uid(), t: Date.now() }, item));
  if (game.feed.length > 8) game.feed.shift();
}
const who = p => p ? { name: p.Name || "", team: p.TeamNum ?? -1, shortcut: p.Shortcut ?? 0 } : null;

// A finished match adds a game win to every event on this feed whose roster played it.
function onMatchEnded(winnerTeamNum) {
  if (winnerTeamNum < 0) return;
  const names = new Set(game.players.map(p => low(p.name)));
  let changed = false;
  for (const ev of DB.events) {
    if (feedKeyOf(ev) !== curKey || !ev.live.autoSeries) continue;
    const roster = ev.teams.flatMap(t => t.players.map(p => low(p.ign))).filter(Boolean);
    if (roster.length && names.size && !roster.some(n => names.has(n))) continue; // a different match on the same game
    const side = ev.live.swap ? 1 - winnerTeamNum : winnerTeamNum;
    ev.live.series[side] = Math.min(9, (ev.live.series[side] || 0) + 1);
    changed = true; notice(`${ev.name}: series ${ev.live.series[0]}–${ev.live.series[1]}`);
  }
  if (changed) { save(); broadcastDb("server"); }
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
      if (g.TimeSeconds != null) game.clockAt = Date.now(); // when the clock last arrived: a scene can tell a live clock from a stale one
      game.clockLive = g.TimeSeconds != null || (game.clockLive && Date.now() - game.clockAt < 5000); // one missed screen read (scores only) does not drop the clock
      game.hasWinner = !!g.bHasWinner;
      game.target = g.bHasTarget && g.Target && g.Target.Name ? who(g.Target) : null;
      break;
    }
    case "GameOcr": { // values read from a result screen: Fortnite placement and eliminations, Dead by Daylight survivors and generators
      game.gameOcr = Object.assign({}, d.values || {}, { t: Date.now() });
      break;
    }
    case "McOcr": { // values read from a Minecraft screen: alive, total, kills, border, clock, theme, phase
      game.mcOcr = Object.assign({}, d.values || {}, { t: Date.now() });
      break;
    }
    case "ClockUpdatedSeconds": if (d.TimeSeconds != null) game.clockAt = Date.now(); game.time = d.TimeSeconds ?? game.time; game.overtime = !!d.bOvertime; break;
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

let rlSock = null, rlTimer = null, rlWarned = false, rlOn = false;
function connectRL() {
  clearTimeout(rlTimer);
  if (!rlOn) return;
  const sock = net.connect({ host: RL_HOST, port: RL_PORT });
  rlSock = sock;
  sock.setEncoding("utf8");
  sock.on("connect", () => { rlWarned = false; inFeed("rl", () => { game.connected = true; touch(); }); log(`Connected to Rocket League Stats API on ${RL_HOST}:${RL_PORT}`); });
  sock.on("data", makeSplitter(m => inFeed("rl", () => handleMessage(m))));
  sock.on("error", err => {
    if (!rlWarned) { rlWarned = true; log(`Waiting for Rocket League on ${RL_HOST}:${RL_PORT} (${err.code || err.message}). Is the game running with the Stats API enabled?`); }
  });
  sock.on("close", () => {
    if (rlSock === sock) { rlSock = null; inFeed("rl", () => { game.connected = false; touch(); }); }
    if (rlOn) rlTimer = setTimeout(connectRL, 2000);
  });
}
function sendRL(cmd) {
  const f = feeds.get("rl");
  if (!rlSock || !f || !f.game.connected) return false;
  rlSock.write(JSON.stringify(cmd));
  return true;
}

/* --------------------------------- League of Legends Live Client Data API */
// Riot serves this on https://127.0.0.1:2999 (self-signed cert) while a game or spectate is running.
const https = require("https");
const LOL_HOST = process.env.LOL_HOST || "127.0.0.1";
const league = require("./league.js");
const dd = league.createDDragon(path.join(DATA, "ddragon_cache.json"), log); // item prices and the patch version for icons
// League champion select (draft.js): read from the League client in the lobby; the scene shows it as it was "delay" seconds ago
const draft = require("./draft.js").create({
  lockfile: () => (DB.settings.draft || {}).lockfile,
  enabled: () => DB.events.some(e => e.game === "League of Legends"),
  onChange: () => { draftSeriesTrack(); draftPush(); },
});
let draftFull = null;
function draftSeriesTrack() { // when a champion select with all ten champions locked ends, its picks join the series bans
  const s = draft.at(0);
  if (s && s.active) { const all = [...s.left.picks, ...s.right.picks]; if (all.length >= 10 && all.every(p => p.locked && p.champ)) draftFull = s; return; }
  if (!draftFull) return;
  const g = { left: draftFull.left.picks.map(p => p.champ), right: draftFull.right.picks.map(p => p.champ), at: Date.now() }, demo = draftFull.demo; draftFull = null;
  if (demo) return;
  const list = DB.settings.draftSeries || (DB.settings.draftSeries = []), last = list[list.length - 1];
  if (!last || JSON.stringify([last.left, last.right]) !== JSON.stringify([g.left, g.right])) { list.push(g); while (list.length > 9) list.shift(); save(); }
}
let draftLast = "";
function draftNow() {
  const cfg = DB.settings.draft || {}, delayMs = Math.max(0, Math.min(600, +cfg.delay || 0)) * 1000;
  const snap = draft.at(delayMs), champs = {};
  if (snap && snap.active) for (const side of ["left", "right"]) for (const x of [...snap[side].picks, ...snap[side].bans]) for (const id of [x.champ, x.intent, x.hover]) if (id && dd.champs[id]) champs[id] = dd.champs[id];
  const series = DB.settings.draftSeries || [];
  for (const g of series) for (const id of [...(g.left || []), ...(g.right || [])]) if (id && dd.champs[id]) champs[id] = dd.champs[id];
  return { snap: snap || { active: false }, delayMs, champs, ddVersion: dd.version, series };
}
function draftPush(force) { // called on every change and four times a second, so a delayed state comes out on time
  const d = draftNow(), k = JSON.stringify([d.snap, d.delayMs, Object.keys(d.champs).length]);
  if (!force && k === draftLast) return; draftLast = k;
  const msg = frame("draft", d); clients.forEach(c => c.res.write(msg));
}

let lolTimer = null, lolWarned = false, lolOn = false;
const lolName = p => p.riotIdGameName || (p.riotId || "").split("#")[0] || p.summonerName || "";

function handleLoL(d) {
  const players = d.allPlayers || [], F = feedOf(curKey);
  game.kind = "lol"; game.inMatch = true; game.connected = true; game.lastPacket = Date.now();
  const lol = league.build(d, (eventForFeed(curKey) || {}).lol, dd); // objectives, timers, gold
  game.players = players.map((p, i) => {
    const s = p.scores || {};
    return { name: lolName(p), id: p.riotId || p.summonerName || "", team: p.team === "CHAOS" ? 1 : 0, shortcut: i + 1,
      champion: p.championName || "", champKey: String(p.rawChampionName || "").replace("game_character_displayname_", ""),
      level: p.level | 0, kills: s.kills | 0, deaths: s.deaths | 0, assists: s.assists | 0, cs: s.creepScore | 0, ward: Math.round(s.wardScore || 0),
      gold: Math.round(lol.playerGold[i]), itemGold: league.itemValue(p, dd), position: p.position || "",
      dead: !!p.isDead, respawn: Math.round(p.respawnTimer || 0),
      items: (p.items || []).reduce((a, x) => { a[x.slot != null ? x.slot : a.filter(Boolean).length] = x.itemID; return a; }, Array(7).fill(0)), // by slot: 6 items + trinket
      counts: (p.items || []).reduce((a, x) => { const i = x.slot != null ? x.slot : -1; if (i >= 0 && i < 7) a[i] = Math.max(0, x.count | 0); return a; }, Array(7).fill(0)), // stack size per slot (potions, wards); 0 when empty
      spells: [p.summonerSpells && p.summonerSpells.summonerSpellOne, p.summonerSpells && p.summonerSpells.summonerSpellTwo]
        .map(s => { const m = /SummonerSpell_(\w+?)_DisplayName/.exec((s && s.rawDisplayName) || ""); return m ? m[1] : ""; }),
      keystone: (p.runes && p.runes.keystone && dd.runes[p.runes.keystone.id]) || "",
      // RL-shaped fields so generic scenes still work
      score: (s.kills | 0) * 3 + (s.assists | 0), goals: s.kills | 0, saves: 0, shots: 0, demos: 0, boost: null };
  });
  const teamOf = name => { const p = game.players.find(x => x.name === name || x.id === name || x.id.split("#")[0] === name); return p ? p.team : -1; };
  game.time = Math.floor((d.gameData && d.gameData.gameTime) || 0);
  game.arena = (d.gameData && d.gameData.mapName) || "";
  game.overtime = false;
  [0, 1].forEach(t => { game.teams[t] = { name: t ? "Red" : "Blue", score: game.players.filter(p => p.team === t).reduce((a, p) => a + p.kills, 0), color: "" }; });

  const events = (d.events && d.events.Events) || [];
  const initial = F.lolLast < 0 || (events.length && events[events.length - 1].EventID < F.lolLast);
  if (initial) { F.lolLast = -1; game.feed = []; game.hasWinner = false; game.winner = -1; } // a new game: the series can count its result
  for (const e of events) {
    const fresh = !initial && e.EventID > F.lolLast;
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
      case "TurretKilled": { const s = structSide(e.TurretKilled); if (fresh) pushFeed({ type: "tower", label: "TOWER", main: { name: e.KillerName, team: s } }); break; }
      case "InhibKilled": { const s = structSide(e.InhibKilled); if (fresh) pushFeed({ type: "inhib", label: "INHIBITOR", main: { name: e.KillerName, team: s } }); break; }
      case "DragonKill": if (fresh) pushFeed({ type: "dragon", label: `${((e.DragonType === "Elder" ? "Elder" : league.DRAGON_NAMES[e.DragonType]) || e.DragonType || "").toUpperCase()} DRAGON${e.Stolen === "True" ? " (STOLEN)" : ""}`, main: { name: e.KillerName, team: kt } }); break;
      case "BaronKill": if (fresh) pushFeed({ type: "baron", label: "BARON", main: { name: e.KillerName, team: kt } }); break;
      case "HeraldKill": if (fresh) pushFeed({ type: "herald", label: "RIFT HERALD", main: { name: e.KillerName, team: kt } }); break;
      case "GameEnd":
        if (fresh && !game.hasWinner) {
          const ap = d.activePlayer ? game.players.find(p => p.name === lolName(d.activePlayer)) : null;
          game.hasWinner = true;
          if (ap) { game.winner = e.Result === "Win" ? ap.team : 1 - ap.team; onMatchEnded(game.winner); }
          else notice("League game ended. A spectated game doesn't report who won, so set the series score by hand.");
        }
        break;
    }
    if (e.EventID > F.lolLast) F.lolLast = e.EventID;
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
  if (!lolOn) return;
  const req = https.get({ host: LOL_HOST, port: 2999, path: "/liveclientdata/allgamedata", rejectUnauthorized: false, timeout: 1500 }, res => {
    let s = ""; res.setEncoding("utf8");
    res.on("data", c => (s += c));
    res.on("end", () => {
      inFeed("lol", () => {
        if (res.statusCode === 200) { try { lolWarned = false; handleLoL(JSON.parse(s)); } catch (e) { log("Couldn't read League data:", e.message); } }
        else { game.connected = true; game.inMatch = false; touch(); } // client answers but the game is still loading
      });
      lolTimer = setTimeout(pollLoL, 1000);
    });
  });
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", err => {
    if (!lolWarned) { lolWarned = true; log(`Waiting for League of Legends on ${LOL_HOST}:2999 (${err.code || err.message}). Start a game or spectate one on this PC.`); }
    inFeed("lol", F => { if (game.connected || game.inMatch) { game.connected = false; game.inMatch = false; F.lolLast = -1; touch(); } });
    lolTimer = setTimeout(pollLoL, 2000);
  });
}

// Demo match for League events: builds Live Client Data–shaped payloads
function lolDemoTick(ev, F) {
  const rnd = n => Math.floor(Math.random() * n);
  if (!F.lolDemo) {
    const L = ev.teams.find(t => t.id === ev.live.left), R = ev.teams.find(t => t.id === ev.live.right);
    const champs = [["Aatrox", "Aatrox"], ["Lee Sin", "LeeSin"], ["Ahri", "Ahri"], ["Jinx", "Jinx"], ["Thresh", "Thresh"],
      ["Darius", "Darius"], ["Viego", "Viego"], ["Orianna", "Orianna"], ["Kai'Sa", "Kaisa"], ["Nautilus", "Nautilus"]];
    const nm = (t, i, side) => (t && t.players[i] && t.players[i].ign) || `${side ? "Red" : "Blue"} ${["Top", "Jungle", "Mid", "Bot", "Support"][i]}`;
    F.lolDemo = { time: 0, events: [{ EventID: 0, EventName: "GameStart", EventTime: 0 }], players: champs.map(([c, k], i) => ({
      riotIdGameName: nm(i < 5 ? L : R, i % 5, i < 5 ? 0 : 1), championName: c, rawChampionName: "game_character_displayname_" + k,
      team: i < 5 ? "ORDER" : "CHAOS", level: 1, isDead: false, respawnTimer: 0, items: [], scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0, wardScore: 0 } })) };
    F.lolLast = -1;
  }
  const D = F.lolDemo, P = D.players, add = e => D.events.push(Object.assign({ EventID: D.events.length, EventTime: D.time }, e));
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
  if (D.time > 1800) { F.lolDemo = null; return; }
  handleLoL({ allPlayers: P, events: { Events: D.events }, gameData: { gameTime: D.time, mapName: "Map11", gameMode: "CLASSIC" } });
}

/* -------------------------------------------------------------- demo feed */
function demoStart(ev, F) {
  const L = ev && ev.teams.find(t => t.id === ev.live.left), R = ev && ev.teams.find(t => t.id === ev.live.right);
  const names = (t, side) => [0, 1, 2].map(i => (t && t.players[i] && t.players[i].ign) || `${side ? "Orange" : "Blue"} ${i + 1}`);
  const [b, o] = ev && ev.live.swap ? [names(R, 0), names(L, 1)] : [names(L, 0), names(R, 1)];
  F.demo = { clock: 300, ended: 0 };
  F.game = Object.assign(blankGame("demo:" + ev.id), { connected: true, inMatch: true, arena: "Stadium_P", matchGuid: "DEMO" });
  game = F.game;
  game.players = [...b, ...o].map((n, i) => ({ name: n, id: "Demo|" + i, shortcut: i + 1, team: i < 3 ? 0 : 1, score: 0, goals: 0, shots: 0,
    assists: 0, saves: 0, touches: 0, demos: 0, boost: 33, speed: 0, boosting: false, supersonic: false, demolished: false }));
  game.target = { name: game.players[0].name, team: 0, shortcut: 1 };
  touch();
}
function demoStep(ev, F) {
  if (ev.game === "League of Legends") { if (!game.paused) lolDemoTick(ev, F); return; } // runs at 4x speed
  if (game.kind === "lol") { F.game = blankGame("demo:" + ev.id); game = F.game; F.demo = null; }
  if (!F.demo) demoStart(ev, F);
  const demo = F.demo;
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
    if (Date.now() - demo.ended > 9000) { demoStart(ev, F); handleMessage({ Event: "MatchCreated", Data: {} }); }
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
        setTimeout(() => inFeed("demo:" + ev.id, G => { if (G.demo && G.demo.ended) handleMessage({ Event: "PodiumStart", Data: {} }); }), 2500);
      }
    }
  }
  touch();
}
setInterval(() => { for (const ev of DB.events) if (ev.source === "demo") inFeed("demo:" + ev.id, F => demoStep(ev, F)); }, 250); // one test match per event that asks for one

// Part of each game's window title, used to find the game on screen for the live preview background.
const GAME_WINDOWS = { "League of Legends": ["League of Legends (TM) Client"], "Rocket League": ["Rocket League"], "Minecraft": ["Minecraft"], "Overwatch 2": ["Overwatch"],
  "Call of Duty": ["Call of Duty", "Warzone", "Black Ops", "Modern Warfare"], "Deadlock": ["Deadlock"], "Fortnite": ["Fortnite"], "Valorant": ["VALORANT"], "Dead by Daylight": ["DeadByDaylight", "Dead by Daylight"], "Counter-Strike 2": ["Counter-Strike 2"], "Riftbound": ["Riftbound"] };

/* ------------------------------------------------ Data Dragon image cache */
const DD_DIR = path.join(DATA, "ddragon-img");
/* ------------------------------------------------ cover art for the event cards */
// Official key art from the publishers' own public image servers (Steam's store assets, Riot's Data Dragon and valorant-api, Mojang's launcher
// content, Epic's news). It is downloaded on the user's PC the first time a card needs it and kept in <data>/covers, never bundled with the app
// or this repository. A game with no source here (or no internet) gets the gradient, and any event can use its own uploaded cover.
const COVER_DIR = path.join(DATA, "covers");
const steamHero = id => () => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`;
const getJson = url => new Promise((resolve, reject) => https.get(url, { timeout: 10000, headers: { "user-agent": "SaintsHUD" } }, r => {
  let s = ""; r.setEncoding("utf8"); r.on("data", c => (s += c)); r.on("end", () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
}).on("error", reject));
const COVER_SRC = {
  "Rocket League": steamHero(252950), "Overwatch 2": steamHero(2357570), "Call of Duty": steamHero(1938090), "Deadlock": steamHero(1422450), "Counter-Strike 2": steamHero(730),
  "League of Legends": () => "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Jinx_0.jpg",
  "Valorant": () => "https://media.valorant-api.com/agents/add6443a-41bd-e414-f6ad-e58d267f4e95/fullportrait.png",
  "Minecraft": async () => { const j = await getJson("https://launchercontent.mojang.com/v2/javaPatchNotes.json"), e = j.entries.find(x => x.type === "release" && x.image) || j.entries.find(x => x.image); return "https://launchercontent.mojang.com" + e.image.url; },
  "Fortnite": async () => { const j = await getJson("https://fortnite-api.com/v2/news/br"), m = (j.data.motds || []).find(x => x.image); return m.image; },
};
const coverSlug = g => String(g).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const IMG_MAGIC = [[[0xff, 0xd8, 0xff], "image/jpeg"], [[0x89, 0x50, 0x4e, 0x47], "image/png"], [[0x52, 0x49, 0x46, 0x46], "image/webp"]];
function fetchImage(url, hops = 3, max = 4e6) { // max: bytes allowed (map art is larger than a cover)
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https") ? https : http;
    get.get(url, { timeout: 15000, headers: { "user-agent": "SaintsHUD" } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops > 0) { r.resume(); return resolve(fetchImage(new URL(r.headers.location, url).href, hops - 1, max)); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error("HTTP " + r.statusCode)); }
      const chunks = []; let size = 0;
      r.on("data", c => { size += c.length; if (size > max) { r.destroy(); reject(new Error("file too large")); } else chunks.push(c); });
      r.on("end", () => { const b = Buffer.concat(chunks), m = IMG_MAGIC.find(([sig]) => sig.every((x, i) => b[i] === x)); m ? resolve({ buf: b, type: m[1] }) : reject(new Error("not an image")); });
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("timed out")); });
  });
}
async function coverFor(slug) {
  const game = Object.keys(COVER_SRC).find(g => coverSlug(g) === slug); if (!game) return null;
  const img = path.join(COVER_DIR, slug + ".img"), typ = path.join(COVER_DIR, slug + ".type");
  if (fs.existsSync(img) && fs.existsSync(typ)) return { buf: fs.readFileSync(img), type: fs.readFileSync(typ, "utf8") };
  const got = await fetchImage(await COVER_SRC[game]());
  fs.mkdirSync(COVER_DIR, { recursive: true }); fs.writeFileSync(img, got.buf); fs.writeFileSync(typ, got.type);
  return got;
}

/* ------------------------------------------------ VALORANT agent art */
// The playable agents and their pictures come from valorant-api.com (community project, Riot's art). The list is fetched once and kept in
// <data>/val-agents/agents.json; each picture is fetched the first time a player panel asks for it and kept beside it. Nothing is bundled,
// and nothing is fetched during a show once it has been seen. Offline, a panel falls back to an initials tile.
const VAL_DIR = path.join(DATA, "val-agents");
const VAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const valFresh = name => { try { return Date.now() - fs.statSync(path.join(VAL_DIR, name)).mtimeMs < 3 * 864e5; } catch { return false; } }; // lists are re-checked every 3 days so new agents, guns and maps appear
const VAL_KINDS = new Set(["displayicon", "killfeedportrait", "fullportrait", "role"]); // role: the agent's role icon
let valAgents = null;
function valAgentCache() { // the cached list from disk (null when never fetched); also feeds the vMix agent names
  if (valAgents) return valAgents;
  try { const a = JSON.parse(fs.readFileSync(path.join(VAL_DIR, "agents.json"), "utf8")); if (Array.isArray(a) && a.length) valAgents = a; } catch { /* not fetched yet */ }
  return valAgents;
}
async function valAgentList() {
  const have = valAgentCache(); if (have && have.every(a => a.roleId !== undefined) && valFresh("agents.json")) return have; // a list saved before role icons is refreshed once
  let j; try { j = await getJson("https://valorant-api.com/v1/agents?isPlayableCharacter=true"); } catch (e) { if (have) return have; throw e; }
  if (!j || !Array.isArray(j.data)) throw new Error("unexpected answer");
  const seen = new Set(), list = j.data.filter(a => a && a.isPlayableCharacter !== false && VAL_UUID.test(String(a.uuid)) && !seen.has(a.uuid) && seen.add(a.uuid))
    .map(a => ({ uuid: a.uuid, name: String(a.displayName || "").slice(0, 40), role: String((a.role && a.role.displayName) || "").slice(0, 30), roleId: a.role && VAL_UUID.test(String(a.role.uuid)) ? a.role.uuid : "" }))
    .filter(a => a.name).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) throw new Error("no agents in the answer");
  fs.mkdirSync(VAL_DIR, { recursive: true }); fs.writeFileSync(path.join(VAL_DIR, "agents.json"), JSON.stringify(list));
  valAgents = list; return list;
}
let valWeapons = null;
function valWeaponCache() {
  if (valWeapons) return valWeapons;
  try { const a = JSON.parse(fs.readFileSync(path.join(VAL_DIR, "weapons.json"), "utf8")); if (Array.isArray(a) && a.length) valWeapons = a; } catch { /* not fetched yet */ }
  return valWeapons;
}
async function valWeaponList() { // every gun (and the knife) with its shop category, for the loadout picker on the Skirmish page
  const have = valWeaponCache(); if (have && valFresh("weapons.json")) return have;
  let j; try { j = await getJson("https://valorant-api.com/v1/weapons"); } catch (e) { if (have) return have; throw e; } // offline: the saved list
  if (!j || !Array.isArray(j.data)) throw new Error("unexpected answer");
  const order = ["Sidearms", "SMGs", "Shotguns", "Rifles", "Sniper Rifles", "Heavy Weapons", ""];
  const list = j.data.filter(w => w && VAL_UUID.test(String(w.uuid))).map(w => ({ uuid: w.uuid, name: String(w.displayName || "").slice(0, 30), cat: String((w.shopData && w.shopData.category) || "").slice(0, 30), cost: +(w.shopData && w.shopData.cost) || 0 }))
    .filter(w => w.name).sort((a, b) => (order.indexOf(a.cat) + 7) % 7 - (order.indexOf(b.cat) + 7) % 7 || a.cost - b.cost || a.name.localeCompare(b.name));
  if (!list.length) throw new Error("no weapons in the answer");
  fs.mkdirSync(VAL_DIR, { recursive: true }); fs.writeFileSync(path.join(VAL_DIR, "weapons.json"), JSON.stringify(list));
  valWeapons = list; return list;
}
// The maps for the map selection scene: the competitive pool (the maps with bomb sites) and the 2v2 Skirmish maps, with their tall
// card art, from valorant-api.com; listed once, pictures fetched on first use and kept in the data folder like the agents.
const VAL_MAP_KINDS = new Set(["listviewicontall", "listviewicon", "splash"]);
let valMaps = null;
function valMapCache() {
  if (valMaps) return valMaps;
  try { const a = JSON.parse(fs.readFileSync(path.join(VAL_DIR, "maps.json"), "utf8")); if (Array.isArray(a) && a.length) valMaps = a; } catch { /* not fetched yet */ }
  return valMaps;
}
async function valMapList() {
  const have = valMapCache(); if (have && valFresh("maps.json")) return have;
  let j; try { j = await getJson("https://valorant-api.com/v1/maps"); } catch (e) { if (have) return have; throw e; } // offline: the saved list
  if (!j || !Array.isArray(j.data)) throw new Error("unexpected answer");
  const list = j.data.filter(m => m && VAL_UUID.test(String(m.uuid)) && m.displayName).map(m => {
    const name = String(m.displayName).slice(0, 30), pool = m.tacticalDescription ? "comp" : /^Skirmish\b/i.test(name) ? "skirmish" : "";
    return { uuid: m.uuid, name, pool };
  }).filter(m => m.pool).sort((a, b) => a.pool.localeCompare(b.pool) || a.name.localeCompare(b.name));
  if (!list.length) throw new Error("no maps in the answer");
  fs.mkdirSync(VAL_DIR, { recursive: true }); fs.writeFileSync(path.join(VAL_DIR, "maps.json"), JSON.stringify(list));
  valMaps = list; return list;
}
async function valMapImage(uuid, kind) {
  const f = path.join(VAL_DIR, "m_" + uuid + "_" + kind + ".png");
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const got = await fetchImage(`https://media.valorant-api.com/maps/${uuid}/${kind}.png`, 3, 16e6); // the tall card art is about 5 MB
  if (got.type !== "image/png") throw new Error("not a PNG");
  fs.mkdirSync(VAL_DIR, { recursive: true }); fs.writeFileSync(f, got.buf);
  return got.buf;
}
// Riftbound cards from Riot's own card gallery (riftbound.leagueoflegends.com/card-gallery: every card, in one page). The list is read once
// and re-checked every 3 days; each picture (on Riot's CDN) is fetched the first time the overlay shows it and kept in <data>/rb-cards/.
const RB_DIR = path.join(DATA, "rb-cards"), RB_ID = /^[a-z0-9-]{3,40}$/;
let rbCards = null;
function rbCardCache() {
  if (rbCards) return rbCards;
  try { const a = JSON.parse(fs.readFileSync(path.join(RB_DIR, "cards.json"), "utf8")); if (Array.isArray(a) && a.length) rbCards = a; } catch { /* not fetched yet */ }
  return rbCards;
}
const rbFresh = () => { try { return Date.now() - fs.statSync(path.join(RB_DIR, "cards.json")).mtimeMs < 3 * 864e5; } catch { return false; } };
const getText = (url, max = 16e6, hops = 3) => new Promise((resolve, reject) => https.get(url, { timeout: 30000, headers: { "user-agent": "SaintsHUD" } }, r => {
  if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops > 0) { r.resume(); return resolve(getText(new URL(r.headers.location, url).href, max, hops - 1)); }
  if (r.statusCode !== 200) { r.resume(); return reject(new Error("HTTP " + r.statusCode)); }
  const chunks = []; let size = 0;
  r.on("data", c => { size += c.length; if (size > max) { r.destroy(); reject(new Error("page too large")); } else chunks.push(c); });
  r.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); r.on("error", reject);
}).on("error", reject).on("timeout", function () { this.destroy(new Error("timed out")); }));
function rbParseGallery(html) { // the card list the gallery page carries for its own search (Next.js page data)
  const mt = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!mt) throw new Error("no card data on the page");
  let items = null;
  (function walk(o, d) { if (items || d > 14 || !o || typeof o !== "object") return; if (Array.isArray(o)) { if (o.length > 100 && o[0] && o[0].cardType && o[0].name) items = o; else o.forEach(x => walk(x, d + 1)); return; } for (const k in o) walk(o[k], d + 1); })(JSON.parse(mt[1]), 0);
  if (!items) throw new Error("no cards in the page data");
  const num = v => (v && v.value && v.value.id != null && isFinite(+v.value.id) ? +v.value.id : null);
  const base = id => /^[a-z]+-\d+-\d+$/.test(id); // the first printing (no a/star/alt suffix) wins a name
  const list = items.map(c => {
    const id = String(c.id || ""), type = String(((c.cardType && c.cardType.type) || [])[0] && c.cardType.type[0].id || ""), tags = (c.tags && Array.isArray(c.tags.tags) ? c.tags.tags : []).map(String);
    let name = String(c.name || "").trim(); const sub = String(c.subtitle || "").trim();
    if (sub) name += ", " + sub; else if (type === "legend" && tags[0] && !name.toLowerCase().includes(tags[0].toLowerCase())) name = tags[0] + ", " + name;
    const img = String((c.cardImage && c.cardImage.url) || "");
    return { id, name: name.slice(0, 70), type: type.charAt(0).toUpperCase() + type.slice(1), domain: ((c.domain && c.domain.values) || []).map(x => String(x.label || x.id || "")).slice(0, 3),
      energy: num(c.energy), might: num(c.might), power: num(c.power), land: c.orientation === "landscape", img: /^https:\/\/cmsassets\.rgpub\.io\//.test(img) ? img : "", base: base(id) };
  }).filter(c => RB_ID.test(c.id) && c.name && c.img).sort((x, y) => (y.base - x.base) || x.id.localeCompare(y.id));
  const seen = new Set();
  return list.filter(c => !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase())).map(c => { delete c.base; return c; }).sort((x, y) => x.name.localeCompare(y.name));
}
let rbLoading = null;
async function rbCardList() {
  const have = rbCardCache(); if (have && rbFresh()) return have;
  if (rbLoading) return rbLoading;
  rbLoading = getText("https://riftbound.leagueoflegends.com/en-us/card-gallery/").then(html => {
    const list = rbParseGallery(html);
    if (list.length < 50) throw new Error("only " + list.length + " cards found");
    fs.mkdirSync(RB_DIR, { recursive: true }); fs.writeFileSync(path.join(RB_DIR, "cards.json"), JSON.stringify(list));
    rbCards = list; return list;
  }).catch(e => { if (have) return have; throw e; }).finally(() => { rbLoading = null; });
  return rbLoading;
}
async function rbCardImage(id) {
  const file = path.join(RB_DIR, id + ".png");
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const c = (await rbCardList()).find(x => x.id === id);
  if (!c || !c.img) throw new Error("unknown card");
  const got = await fetchImage(c.img, 3, 16e6);
  if (got.type !== "image/png" && got.type !== "image/jpeg" && got.type !== "image/webp") throw new Error("not an image");
  fs.mkdirSync(RB_DIR, { recursive: true }); fs.writeFileSync(file, got.buf);
  return got.buf;
}
const valWeaponNames = () => Object.fromEntries((valWeaponCache() || []).map(w => [w.uuid, w.name]));
async function valWeaponImage(uuid) {
  const f = path.join(VAL_DIR, "w_" + uuid + ".png");
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const got = await fetchImage(`https://media.valorant-api.com/weapons/${uuid}/killstreamicon.png`);
  if (got.type !== "image/png") throw new Error("not a PNG");
  fs.mkdirSync(VAL_DIR, { recursive: true }); fs.writeFileSync(f, got.buf);
  return got.buf;
}
const valAgentNames = () => Object.fromEntries((valAgentCache() || []).map(a => [a.uuid, a.name]));
async function valAgentImage(uuid, kind) {
  const f = path.join(VAL_DIR, uuid + "_" + kind + ".png");
  if (fs.existsSync(f)) return fs.readFileSync(f);
  let src = `https://media.valorant-api.com/agents/${uuid}/${kind}.png`;
  if (kind === "role") { const a = (await valAgentList()).find(x => x.uuid === uuid); if (!a || !a.roleId) throw new Error("no role"); src = `https://media.valorant-api.com/agents/roles/${a.roleId}/displayicon.png`; }
  const got = await fetchImage(src, 3, 16e6);
  if (got.type !== "image/png") throw new Error("not a PNG");
  fs.mkdirSync(VAL_DIR, { recursive: true }); fs.writeFileSync(f, got.buf);
  return got.buf;
}

const DD_OK = /^cdn\/(?:(?:[\w.-]+\/img\/(?:champion|item|spell)\/[\w.-]+|img\/[\w\/.-]+)\.png|img\/champion\/loading\/[\w.-]+\.jpg)$/; // the only paths the cache will fetch (icons, and champion select's loading art)

/* ------------------------------------------------ official League objective icons */
// Riot's own in-game minimap icons, published by Community Dragon. They are downloaded on the user's click and kept in the
// app's data folder, never bundled with the app or the source code.
const ICON_BASE = process.env.ICON_BASE || "https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/";
const ICON_DIR = path.join(DATA, "objective-icons");
const ICON_FILES = { dragon: "dragon.png", infernal: "dragon_infernal.png", ocean: "dragon_ocean.png", mountain: "dragon_mountain.png", cloud: "dragon_cloud.png",
  hextech: "dragon_hextech.png", chemtech: "dragon_chemtech.png", elder: "dragon_elder.png", grubs: "grub.png", herald: "riftherald.png", baron: "baron.png",
  tower: "icon_ui_tower_minimap.png", inhib: "inhibitor.png" };
function fetchPng(url, hops = 3) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https") ? https : http;
    get.get(url, { timeout: 10000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops > 0) { r.resume(); return resolve(fetchPng(new URL(r.headers.location, url).href, hops - 1)); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error("HTTP " + r.statusCode)); }
      const chunks = []; let size = 0;
      r.on("data", c => { size += c.length; if (size > 512 * 1024) { r.destroy(); reject(new Error("file too large")); } else chunks.push(c); });
      r.on("end", () => { const b = Buffer.concat(chunks); b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? resolve(b) : reject(new Error("not a PNG")); });
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("timed out")); });
  });
}
async function fetchOfficialIcons() {
  fs.mkdirSync(ICON_DIR, { recursive: true });
  const icons = Object.assign({}, DB.settings.iconsOfficial || {}), failed = []; // kept apart from any icons the user uploads (settings.icons)
  for (const [key, file] of Object.entries(ICON_FILES)) {
    try { fs.writeFileSync(path.join(ICON_DIR, file), await fetchPng(ICON_BASE + file)); icons[key] = "/objective-icons/" + file; }
    catch (e) { failed.push(`${file} (${e.message})`); }
  }
  DB.settings.iconsOfficial = icons; save(); broadcastDb("server");
  return { ok: Object.keys(ICON_FILES).length - failed.length, total: Object.keys(ICON_FILES).length, failed };
}
// The icons simply appear: fetched on first run, and retried every 10 minutes until they're all there.
let iconTimer = null;
async function ensureOfficialIcons() {
  clearTimeout(iconTimer);
  const missing = Object.values(ICON_FILES).filter(f => !fs.existsSync(path.join(ICON_DIR, f)));
  if (!missing.length) { // already on disk: just make sure the settings point at them
    const icons = {}; for (const [k, f] of Object.entries(ICON_FILES)) icons[k] = "/objective-icons/" + f;
    if (JSON.stringify(DB.settings.iconsOfficial) !== JSON.stringify(icons)) { DB.settings.iconsOfficial = icons; save(); }
    return;
  }
  const r = await fetchOfficialIcons().catch(e => ({ failed: [e.message] }));
  if (r.failed && r.failed.length) { log(`Objective icons: ${r.failed.length} not downloaded yet (no internet?). Trying again in 10 minutes.`); iconTimer = setTimeout(ensureOfficialIcons, 10 * 60 * 1000); }
  else log("Objective icons are ready.");
}

/* ------------------------------------------ data outputs (vMix / GT Title Designer) */
// The live fields as JSON, XML or CSV: at /hud.json, /hud.xml, /hud.csv and as files in <data>/output, rewritten every second.
const fieldsLib = require("./fields.js");
const OUT_DIR = path.join(DATA, "output");
fs.mkdirSync(OUT_DIR, { recursive: true });
const eventById = id => DB.events.find(e => e.id === id) || onAirEvent(); // the on-air event is only the fallback for old links that name no event
function fieldsOf(ev, query = {}, base = "") { return fieldsLib.build(DB, ev, ev ? feedOf(feedKeyOf(ev)).game : null, { dataDir: DATA, appDir: ROOT, images: query.images, base, agents: valAgentNames(), weapons: valWeaponNames() }); }
function currentFields(query = {}, base = "") { return fieldsOf(eventById(query.event), query, base); }
let lastCsv = "", lastJson = "";
const lastOut = new Map();
function atomicWrite(file, text) { const tmp = file + ".tmp"; fs.writeFile(tmp, text, err => { if (!err) fs.rename(tmp, file, () => {}); }); } // vMix never reads half a file
setInterval(() => {
  for (const ev of DB.events) { // every event has its own three files in output/events/<event id>/
    try {
      const { fields } = fieldsOf(ev), csv = fieldsLib.toCsv(fields), json = JSON.stringify(fields, null, 1), last = lastOut.get(ev.id) || {}, dir = path.join(OUT_DIR, "events", ev.id);
      if (csv === last.csv && json === last.json) continue;
      fs.mkdirSync(dir, { recursive: true });
      if (csv !== last.csv) atomicWrite(path.join(dir, "hud.csv"), csv);
      if (json !== last.json) { atomicWrite(path.join(dir, "hud.json"), json); atomicWrite(path.join(dir, "hud.xml"), fieldsLib.toXml(fields)); }
      lastOut.set(ev.id, { csv, json });
    } catch (e) { /* a game mid-update can't break the overlay */ }
  }
  try { // the three files in output/ itself keep following one event (the first, or the one that was on air) for older vMix setups
    const ev = onAirEvent(); if (!ev) return;
    const { fields } = fieldsOf(ev), csv = fieldsLib.toCsv(fields), json = JSON.stringify(fields, null, 1);
    if (csv !== lastCsv) { lastCsv = csv; atomicWrite(path.join(OUT_DIR, "hud.csv"), csv); }
    if (json !== lastJson) { lastJson = json; atomicWrite(path.join(OUT_DIR, "hud.json"), json); atomicWrite(path.join(OUT_DIR, "hud.xml"), fieldsLib.toXml(fields)); }
  } catch (e) { /* ignore */ }
}, 1000);

/* ------------------------------------------------------------- Minecraft */
const mcc = require("./minecraft.js").create(log);
let mcOn = false;
function mcRoster() { return DB.events.filter(e => feedKeyOf(e) === "mc").flatMap(ev => ev.teams.flatMap(t => t.players.map(p => p.ign))).filter(Boolean); }
function startMc() {
  const c = DB.settings.mc || {};
  if (c.host || c.logPath) mcc.start(Object.assign({}, c, { roster: mcRoster() })); // only connect once a server is set up
}

// Bring the live connectors in line with the events: a connector runs while at least one event reads its feed, and a feed that
// nothing reads any more is dropped. Runs every 1.5 s and whenever an event or its source changes.
function applyFeeds() {
  const used = usedKeys();
  for (const k of used) feedOf(k);
  for (const k of [...feeds.keys()]) if (!used.has(k)) feeds.delete(k);
  if (used.has("rl") && !rlOn) { rlOn = true; rlWarned = false; connectRL(); }
  else if (!used.has("rl") && rlOn) { rlOn = false; clearTimeout(rlTimer); if (rlSock) { rlSock.destroy(); rlSock = null; } }
  if (used.has("lol") && !lolOn) { lolOn = true; lolWarned = false; pollLoL(); }
  else if (!used.has("lol") && lolOn) { lolOn = false; clearTimeout(lolTimer); }
  if (used.has("mc") && !mcOn) { mcOn = true; startMc(); }
  else if (!used.has("mc") && mcOn) { mcOn = false; mcc.stop(); }
}
const SOURCES = ["auto", "rl", "lol", "mc", "ocr", "push", "demo"];
function setEventSource(id, src) {
  const ev = DB.events.find(e => e.id === id) || onAirEvent();
  if (!ev || !SOURCES.includes(src)) return false;
  ev.source = src; save(); applyFeeds(); broadcastDb("server");
  return true;
}
setInterval(applyFeeds, 1500);
setInterval(() => { if (mcOn) mcc.update({ roster: mcRoster() }); }, 5000);

/* ---------------------------------------------------- screen OCR (desktop app) */
// The Electron shell registers a provider (ocr.js). In plain Node there is none and the OCR endpoints say so.
let ocr = null;
function setOcrProvider(p) { ocr = p; }
// OCR readings arrive as Stats API–shaped messages and go to every event that reads the screen (the OCR and Minecraft feeds).
function ocrIngest(msg) { for (const key of ["ocr", "mc"]) if (feeds.has(key)) inFeed(key, () => { game.connected = true; [].concat(msg).forEach(handleMessage); }); }

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
const frame = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; // built once, then written to every client
function sse(res, type, data) { res.write(frame(type, data)); }
function broadcastDb(by) { const msg = frame("db", { db: DB, by, screens: screens() }); clients.forEach(c => c.res.write(msg)); }
function notice(text) { clients.forEach(c => sse(c.res, "notice", { text })); }
function screens() { const s = { dashboard: 0, overlay: 0 }; clients.forEach(c => { s[c.kind] = (s[c.kind] || 0) + 1; }); return s; }
setInterval(() => {
  for (const [key, f] of feeds) {
    const base = key.split(":")[0];
    inFeed(key, () => {
      if (base === "push") game.connected = Date.now() - game.lastPacket < 5000;
      if (base === "ocr") {
        const st = ocr ? ocr.state() : { available: false };
        game.ocr = st; game.connected = !!(st.running && st.lastRead && Date.now() - st.lastRead < 5000);
        if (st.running) f.dirty = true;
      }
      if (base === "mc") { // server feed and screen OCR both land here; the HUD prefers whichever is live
        game.mc = mcc.state(); game.ocr = ocr ? ocr.state() : null;
        game.connected = !!(game.mc.connected || (game.ocr && game.ocr.running && game.ocr.lastRead && Date.now() - game.ocr.lastRead < 5000));
        f.dirty = true;
      }
      game.source = base;
    });
    if (!f.dirty) continue;
    f.dirty = false;
    const msg = frame("game", { key, game: f.game });
    clients.forEach(c => c.res.write(msg));
  }
}, 100);
setInterval(() => clients.forEach(c => c.res.write(": ping\n\n")), 15000);

/* ------------------------------------------------------------------ http */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".json": "application/json",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/mp4" }; // a .mov (H.264) plays in Chromium when it is labelled as MP4
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov"]);
function sendVideo(req, res, file) { // byte ranges, so OBS and vMix can loop and seek a background video without loading it whole
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    const type = MIME[path.extname(file).toLowerCase()], m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (!m || (m[1] === "" && m[2] === "")) { res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes", "cache-control": "no-cache" }); return fs.createReadStream(file).pipe(res); }
    let a = m[1] === "" ? Math.max(0, st.size - +m[2]) : +m[1], b = m[1] !== "" && m[2] !== "" ? Math.min(+m[2], st.size - 1) : st.size - 1;
    if (a > b || a >= st.size) { res.writeHead(416, { "content-range": "bytes */" + st.size }); return res.end(); }
    res.writeHead(206, { "content-type": type, "content-length": b - a + 1, "content-range": `bytes ${a}-${b}/${st.size}`, "accept-ranges": "bytes", "cache-control": "no-cache" });
    fs.createReadStream(file, { start: a, end: b }).pipe(res);
  });
}

function sendFile(res, file) {
  const norm = file.replace(/\\/g, "/");
  if (V.id && norm.endsWith("/public/brand/chud-hud.png")) file = path.join(PUB, "brand", V.id, "chud-hud.png"); // the edition's own logo
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    const ext = path.extname(file).toLowerCase();
    if (ext === ".html") buf = Buffer.from(V.html(buf.toString("utf8"), norm));
    else if (V.id && path.basename(file) === "hud.css") buf = Buffer.from(V.hudCss(buf.toString("utf8")));
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-cache" });
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

// The app's own logo is fixed: it is part of the app, never a setting. A workspace saved by an older build that let it be
// replaced has that setting removed when it loads, and nothing can write it again.
const lockedPath = p => { const k = String(p || ""); return k === "settings" || k === "" || k === "settings.brand" || k.startsWith("settings.brand."); };
function setPath(obj, p, v) {
  const ks = String(p).split(".");
  if (ks.some(k => k === "__proto__" || k === "constructor" || k === "prototype")) throw new Error("bad path");
  const last = ks.pop();
  const parent = ks.reduce((a, k) => (a == null ? a : a[k]), obj);
  if (parent == null || typeof parent !== "object") throw new Error("path not found");
  parent[last] = v;
}

// Browsers let any web page send a request to this machine's localhost. Without these two checks a page open in the operator's
// browser could change events, switch the data source, start screen reading or edit League's game.cfg.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
function hostOk(req) { // DNS rebinding: when listening on loopback only, only loopback names are served
  if (HOST === "0.0.0.0" || HOST === "::") return true;
  const h = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  return LOOPBACK.has(h) || h === HOST.toLowerCase();
}
function originOk(req) { // our own pages send an Origin that matches the Host; curl, OBS and trackers send none
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

/* ------------------------------------------------ player and caster cameras (WebRTC, our own signalling, see cams.js) */
// The main server stays on this PC only. When the operator switches "Let players connect" on, a second server listens on the
// network with HTTPS (browsers only hand out a camera to secure pages) and serves nothing but the camera page and its signalling.
const os = require("os");
const selfsigned = require("selfsigned");
const CAM_PORT = +process.env.CAM_PORT || V.camPort || 7778;
const cams = require("./cams.js").create({ dataDir: DATA, readBody, originOk });
let camServer = null;
function lanIps() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach(l => (l || []).forEach(a => { if (a.family === "IPv4" && !a.internal) out.push(a.address); }));
  return out;
}
async function camCert() {
  const file = path.join(DATA, "cam-cert.json"), ips = lanIps().join(",");
  try { const c = JSON.parse(fs.readFileSync(file, "utf8")); if (c.key && c.cert && c.ips === ips && c.until > Date.now() + 30 * 864e5) return c; } catch { /* make a new one */ }
  const until = Date.now() + 825 * 864e5;
  const alt = [{ type: 2, value: "localhost" }, ...lanIps().map(ip => ({ type: 7, ip }))];
  const pems = await selfsigned.generate([{ name: "commonName", value: "Chud Hud camera" }],
    { keySize: 2048, algorithm: "sha256", notAfterDate: new Date(until), extensions: [{ name: "subjectAltName", altNames: alt }] });
  const c = { key: pems.private, cert: pems.cert, ips, until };
  fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(file, JSON.stringify(c), { mode: 0o600 });
  return c;
}
async function setCamLan(on) {
  if (!on) { if (camServer) { const s = camServer; camServer = null; await new Promise(r => { s.close(r); s.closeAllConnections && s.closeAllConnections(); }); } return; }
  if (camServer) return;
  const c = await camCert();
  const srv = https.createServer({ key: c.key, cert: c.cert }, (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/cam") return sendFile(res, path.join(PUB, "cam.html"));
    if (cams.handle(req, res, url, true)) return;
    res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found");
  });
  await new Promise((resolve, reject) => { srv.once("error", reject); srv.listen(CAM_PORT, "0.0.0.0", () => { srv.removeListener("error", reject); resolve(); }); });
  camServer = srv;
  srv.on("error", err => log("Camera server error:", err.message));
  log(`Player cameras: listening on https://<this PC>:${CAM_PORT}`);
}
function camLinks() {
  const ip = lanIps()[0] || "localhost", base = `https://${ip}:${CAM_PORT}`, mk = room => ({ room, url: `${base}/cam?r=${encodeURIComponent(room)}&t=${cams.tokenFor(room)}`, local: `/cam?r=${encodeURIComponent(room)}` });
  return { on: !!camServer, port: CAM_PORT, base, status: cams.status(), events: DB.events.map(ev => ({ id: ev.id, name: ev.name,
    players: ev.teams.flatMap((t, ti) => t.players.map(p => Object.assign({ team: t.tag || t.name, teamId: t.id, pid: p.id, name: p.alias || p.ign || "Player", side: ti }, mk(ev.id + "." + p.id)))),
    seats: ev.camera.seats.map((s, i) => Object.assign({ n: i + 1 }, mk(ev.id + ".seat" + i))) })) };
}

/* ------------------------------------------------ Twitch chat votes: build scores and chat polls (twitch.js) */
const twitchLib = require("./twitch.js");
const chatEvent = id => (id ? DB.events.find(e => e.id === id) : null); // never the on-air fallback: a vote only ever lands on the event it was opened for
const chat = { event: "", mode: "", voters: new Map(), dirty: false }; // voters: build name (or "poll") -> Map(user -> number)
const voteMap = k => { let m = chat.voters.get(k); if (!m) chat.voters.set(k, m = new Map()); return m; };
function onChat({ user, text }) {
  const ev = chatEvent(chat.event); if (!ev) return;
  const n = twitchLib.parseVote(text); if (n == null) return;
  if (chat.mode === "score") {
    const bb = ev.mc.bb; if (!bb.audience.open || !bb.judging || n > 10) return;
    const m = voteMap(bb.judging); if (m.size < 50000) { m.set(user, n); chat.dirty = true; }
  } else if (chat.mode === "poll") {
    const p = ev.mc.poll; if (!p.open || n < 1 || n > p.options.length) return;
    const m = voteMap("poll"); if (m.size < 50000) { m.set(user, n); chat.dirty = true; }
  }
}
const twitch = twitchLib.create({ onMessage: onChat, log });
function tally(ev) {
  const bb = ev.mc.bb, sc = {};
  chat.voters.forEach((m, k) => { if (k === "poll" || !m.size) return; let sum = 0; m.forEach(v => { sum += v; }); sc[k] = { avg: Math.round(sum / m.size * 10) / 10, count: m.size }; });
  bb.audience.scores = sc;
  const p = ev.mc.poll, pm = chat.voters.get("poll"), counts = p.options.map(() => 0);
  if (pm) pm.forEach(v => { if (counts[v - 1] != null) counts[v - 1]++; });
  p.counts = counts; p.total = counts.reduce((a, b) => a + b, 0);
}
setInterval(() => { // votes arrive in bursts: write them out once a second
  if (!chat.dirty) return; chat.dirty = false;
  const ev = chatEvent(chat.event); if (!ev) return;
  tally(ev); save(); broadcastDb("chat");
}, 1000).unref();
function chatOpen(evId, mode, open) {
  const ev = chatEvent(evId); if (!ev || !["score", "poll"].includes(mode)) return "Pick an event and a mode.";
  const prev = chatEvent(chat.event);
  if (open && prev && (prev !== ev || chat.mode !== mode)) { prev.mc.bb.audience.open = false; prev.mc.poll.open = false; } // one vote at a time
  if (open) { chat.event = ev.id; chat.mode = mode; }
  if (mode === "score") ev.mc.bb.audience.open = open; else ev.mc.poll.open = open;
  save(); broadcastDb("chat");
  return "";
}
function chatClear(evId, mode, build) {
  const ev = chatEvent(evId); if (!ev) return;
  if (mode === "poll") chat.voters.delete("poll"); else if (build) chat.voters.delete(build); else [...chat.voters.keys()].forEach(k => k !== "poll" && chat.voters.delete(k));
  tally(ev); save(); broadcastDb("chat");
}

// Stream Deck and Bitfocus Companion: one web address per button (Companion's "Generic HTTP" connection, or anything that opens a link).
// The key keeps other web pages from pressing your buttons. It lives in its own file, never in the saved workspace the overlay can read.
let controlKeyV = null;
function controlKey() {
  if (controlKeyV) return controlKeyV;
  const f = path.join(DATA, "control-key.txt");
  try { controlKeyV = fs.readFileSync(f, "utf8").trim(); } catch { controlKeyV = ""; }
  if (!/^[0-9a-f]{32}$/.test(controlKeyV)) { controlKeyV = crypto.randomBytes(16).toString("hex"); fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f, controlKeyV, { mode: 0o600 }); }
  return controlKeyV;
}
const isLoopback = req => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || "");
function controlApply(ev, q) {
  const val = String(q.value == null ? "" : q.value), flag = v => (v === "on" ? true : v === "off" ? false : null);
  switch (q.action) {
    case "scene": if (!HUD.SCENES[val]) return { error: "unknown scene" }; ev.hud.scene = val; return { ok: true, scene: val };
    case "show": case "cams": {
      const name = q.action === "cams" ? "playerCam" : String(q.name || "");
      if (!(name in ev.hud.show)) return { error: "unknown element" };
      const f = flag(val); ev.hud.show[name] = f === null ? !ev.hud.show[name] : f; return { ok: true, [name]: ev.hud.show[name] };
    }
    case "director": if (!["all", "action"].includes(val)) return { error: "director is all or action" }; ev.camera.director = val; return { ok: true, director: val };
    case "pin": { const side = +q.side === 1 ? 1 : 0, n = Math.max(0, Math.min(9, Math.floor(+val) || 0)); ev.camera.pin[side] = n; return { ok: true, pin: ev.camera.pin }; }
    case "score": { const side = +q.side === 1 ? 1 : 0, d = Math.trunc(+q.delta || 1); ev.live.score[side] = Math.max(0, (ev.live.score[side] || 0) + d); ev.live.autoScore = false; return { ok: true, score: ev.live.score }; }
    case "valstate": if (!["main", "buy", "timeout"].includes(val)) return { error: "state is main, buy or timeout" };
      ev.val.state = val; if (val === "timeout") { if (q.side != null) ev.val.to.side = +q.side === 1 ? 1 : 0; ev.val.to.at = Date.now(); } return { ok: true, state: val };
    case "hgstate": if (!["main", "final", "winner"].includes(val)) return { error: "state is main, final or winner" }; ev.hud.mcState = val; return { ok: true, state: val };
    default: return { error: "unknown action" };
  }
}

// Licensing: the verdict is cached for a few seconds. Only the launcher, its styles and the license calls work while locked.
let licCache = { at: 0, s: null };
const licenseStatus = () => { if (Date.now() - licCache.at > 3000 || !licCache.s) licCache = { at: Date.now(), s: LIC.status(DATA, EDITION) }; return licCache.s; };
const licensed = () => licenseStatus().licensed;
const licenseOpen = p => p === "/launcher" || p === "/api/license" || p === "/api/variant" || p.startsWith("/brand/") || p.startsWith("/fonts/") || ["/tokens.css", "/components.css", "/launcher.css", "/theme.css", "/favicon.ico"].includes(p);
function licenseWatch() { // ask the license service now and every ten minutes; if the code was switched off, drop every open page
  const run = () => LIC.refresh(DATA, EDITION).catch(() => null).then(() => { const was = licCache.s && licCache.s.licensed; licCache.at = 0; if (was && !licensed()) { log("This copy's license was switched off. Locked."); clients.forEach(c => { try { c.res.end(); } catch { /* gone */ } }); clients.clear(); } });
  run(); setInterval(run, LIC.CHECK_EVERY).unref();
}

const server = http.createServer((req, res) => {
  if (!hostOk(req)) { res.writeHead(421, { "content-type": "text/plain" }); return res.end("Unexpected host name"); }
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (!licensed() && !licenseOpen(p)) {
    const wantsPage = String(req.headers.accept || "").includes("text/html");
    res.writeHead(402, { "content-type": wantsPage ? "text/html; charset=utf-8" : "application/json", "cache-control": "no-store" });
    return res.end(wantsPage ? `<!doctype html><meta charset="utf-8"><title>${V.name}</title><body style="font:16px system-ui;background:#0b0b0f;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:420px;text-align:center"><h2>${V.name} isn't activated</h2><p style="color:#aaa">${LIC.status(DATA, EDITION).message || "Enter your code in the launcher."}</p><p><a style="color:#ffb86b" href="/launcher">Open the launcher</a></p></div>` : JSON.stringify({ error: "license", message: LIC.status(DATA, EDITION).message }));
  }
  if (cams.handle(req, res, url, false)) return;

  if (req.method === "GET") {
    if (p === "/theme.css") { // the edition's look for the control pages; the standard app has none (never used by the overlay)
      if (V.id) return sendFile(res, path.join(PUB, "themes", V.id + ".css"));
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" }); return res.end("");
    }
    if (p === "/api/variant") return json(res, 200, { id: V.id, name: V.name, tagline: V.tagline, port: PORT });
    if (p === "/api/control/info") { // the key, for the Outputs page: only to the PC the app runs on
      if (!isLoopback(req)) return json(res, 403, { error: "The control key is only shown on the PC running the app." });
      return json(res, 200, { key: controlKey(), port: PORT });
    }
    if (p === "/api/control") {
      const q = Object.fromEntries(url.searchParams), a = Buffer.from(String(q.key || "")), b = Buffer.from(controlKey());
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return json(res, 403, { error: "wrong or missing key" });
      const ev = q.event ? DB.events.find(e => e.id === q.event) : DB.events[0];
      if (!ev) return json(res, 404, { error: "event not found" });
      const r = controlApply(ev, q);
      if (r.error) return json(res, 400, r);
      save(); broadcastDb("control"); return json(res, 200, Object.assign({ event: ev.id }, r));
    }
    if (p === "/api/draft/state") return json(res, 200, Object.assign(draft.state(), { delay: +(DB.settings.draft || {}).delay || 0, champsKnown: Object.keys(dd.champs).length }, draftNow()));
    if (p === "/api/license") return json(res, 200, Object.assign({ edition: EDITION, service: !!LIC.service() }, licenseStatus()));
    if (p === "/cam") return sendFile(res, path.join(PUB, "cam.html")); // this PC's own camera (127.0.0.1 counts as secure)
    if (p === "/camview") return sendFile(res, path.join(PUB, "camview.html"));
    if (p === "/api/cam/status") return json(res, 200, cams.status());
    if (p === "/api/cam/links") return json(res, 200, camLinks());
    if (p === "/api/chat/status") return json(res, 200, Object.assign(twitch.status(), { event: chat.event, mode: chat.mode, voters: Object.fromEntries([...chat.voters].map(([k, m]) => [k, m.size])) }));
    if (p === "/" || p === "/dashboard") return sendFile(res, path.join(PUB, "app.html"));
    if (p === "/overlay") return sendFile(res, path.join(PUB, "overlay.html"));
    if (p === "/launcher") return sendFile(res, path.join(PUB, "launcher.html"));
    if (p === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const c = { res, kind: url.searchParams.get("kind") === "overlay" ? "overlay" : "dashboard" };
      clients.add(c);
      sse(res, "db", { db: DB, by: "init", screens: screens() });
      feeds.forEach((f, key) => sse(res, "game", { key, game: f.game }));
      sse(res, "draft", draftNow());
      broadcastDb("screens");
      req.on("close", () => { clients.delete(c); broadcastDb("screens"); });
      return;
    }
    if (p === "/api/state") { const ev = eventById(url.searchParams.get("event")); return json(res, 200, { db: DB, game: ev ? feedOf(feedKeyOf(ev)).game : null, games: Object.fromEntries([...feeds].map(([k, f]) => [k, f.game])) }); }
    if (p === "/api/event-template") { // a clean, independent event for the chosen game (nothing copied from another event)
      const g = new URL(req.url, "http://x").searchParams.get("game") || "Rocket League";
      return json(res, 200, freshEvent(g));
    }
    if (p === "/api/lol/replay") { // playback + render state, plus whether the Replay API is switched on
      return Promise.all([lolHttp("GET", "/replay/playback"), lolHttp("GET", "/replay/render")]).then(([pb, rn]) => {
        const cfg = readReplayApiSetting();
        json(res, 200, { available: pb.status === 200, playback: pb.status === 200 ? pb.json : null, render: rn.status === 200 ? rn.json : null,
          reason: pb.status === 200 ? "" : pb.status === 0 ? "League isn't running a game or replay." : "The Replay API is off. Turn it on, then restart the replay.", config: cfg });
      });
    }
    if (p === "/hud.json" || p === "/hud.xml" || p === "/hud.csv") {
      const q = Object.fromEntries(url.searchParams), base = `http://${req.headers.host || "localhost:" + PORT}`;
      const { fields, detail } = currentFields(q, base);
      const [type, body] = p === "/hud.json" ? ["application/json", JSON.stringify(q.detail ? { fields, detail } : fields, null, 1)]
        : p === "/hud.xml" ? ["application/xml; charset=utf-8", fieldsLib.toXml(fields)] : ["text/csv; charset=utf-8", fieldsLib.toCsv(fields)];
      res.writeHead(200, { "content-type": type, "cache-control": "no-store", "access-control-allow-origin": "*" }); return res.end(body);
    }
    if (p === "/api/outputs") return json(res, 200, { dir: OUT_DIR, eventsDir: path.join(OUT_DIR, "events"), files: ["hud.csv", "hud.json", "hud.xml"], port: PORT, lan: HOST === "0.0.0.0" });
    if (p === "/api/preview/frame") { // the game's window, live, behind the HUD preview (desktop app only)
      if (!ocr) return json(res, 501, { error: "The live game picture needs the desktop app." });
      const g = url.searchParams.get("game") || "", names = GAME_WINDOWS[g] || [g];
      return ocr.frameByName(names).then(buf => { res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }); res.end(buf); })
        .catch(e => json(res, 404, { error: e.message }));
    }
    if (p === "/api/mc/state") return json(res, 200, { config: DB.settings.mc || null, state: mcc.state() });
    if (p === "/api/lol/swagger") return lolHttp("GET", "/swagger/v3/openapi.json").then(r => json(res, r.status === 200 ? 200 : 502, r.json || { error: r.error }));
    if (p === "/api/ocr/state") return json(res, 200, ocr ? Object.assign({ available: true, config: DB.settings.ocr || null }, ocr.state()) : { available: false, config: DB.settings.ocr || null });
    if (p === "/api/ocr/sources") {
      if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Chud Hud desktop app." });
      return ocr.listSources().then(s => json(res, 200, s)).catch(e => json(res, 500, { error: e.message }));
    }
    if (p === "/api/ocr/frame") {
      if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Chud Hud desktop app." });
      return ocr.frame(url.searchParams.get("source") || (DB.settings.ocr || {}).sourceId, (DB.settings.ocr || {}).sourceName)
        .then(buf => { res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }); res.end(buf); })
        .catch(e => json(res, 404, { error: e.message }));
    }
    if (p.startsWith("/ddragon/")) { // champion, item, spell and rune icons: fetched once, then served from the data folder (works offline afterwards)
      let rel = ""; try { rel = decodeURIComponent(p.slice(9)); } catch { /* bad escape */ }
      if (!DD_OK.test(rel) || rel.includes("..")) return json(res, 400, { error: "bad path" });
      const f = path.join(DD_DIR, rel.replace(/\//g, "_"));
      if (fs.existsSync(f)) return sendFile(res, f);
      return fetchPng("https://ddragon.leagueoflegends.com/" + rel).then(buf => {
        fs.mkdirSync(DD_DIR, { recursive: true }); fs.writeFile(f, buf, () => {});
        res.writeHead(200, { "content-type": rel.endsWith(".jpg") ? "image/jpeg" : "image/png", "cache-control": "max-age=86400" }); res.end(buf);
      }).catch(e => json(res, 502, { error: e.message }));
    }
    if (p === "/api/val/agents") return valAgentList().then(list => json(res, 200, list)).catch(e => json(res, 502, { error: "Couldn't load the agent list: " + e.message }));
    if (p === "/api/rb/cards") return rbCardList().then(list => json(res, 200, list)).catch(e => json(res, 502, { error: "Couldn't load the Riftbound cards: " + e.message }));
    if (p.startsWith("/rb-card/")) { // a card picture: a strict card id, fetched once, then served from the data folder
      const mt = /^\/rb-card\/([a-z0-9-]{3,40})\.png$/.exec(p);
      if (!mt) return json(res, 400, { error: "bad path" });
      return rbCardImage(mt[1]).then(buf => { res.writeHead(200, { "content-type": buf[0] === 0x89 ? "image/png" : buf[0] === 0xff ? "image/jpeg" : "image/webp", "cache-control": "max-age=86400" }); res.end(buf); })
        .catch(e => json(res, 502, { error: e.message }));
    }
    if (p === "/api/val/maps") return valMapList().then(list => json(res, 200, list)).catch(e => json(res, 502, { error: "Couldn't load the map list: " + e.message }));
    if (p.startsWith("/val-map/")) { // a map's card art: strict uuid and kind, fetched once, then served from the data folder
      const mt = /^\/val-map\/([^/]+)\/([a-z]+)\.png$/.exec(p);
      if (!mt || !VAL_UUID.test(mt[1]) || !VAL_MAP_KINDS.has(mt[2])) return json(res, 400, { error: "bad path" });
      return valMapImage(mt[1], mt[2]).then(buf => { res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400" }); res.end(buf); })
        .catch(e => json(res, 502, { error: e.message }));
    }
    if (p === "/api/val/weapons") return valWeaponList().then(list => json(res, 200, list)).catch(e => json(res, 502, { error: "Couldn't load the weapon list: " + e.message }));
    if (p.startsWith("/val-weapon/")) { // a gun's white kill-feed silhouette, same rules as the agent pictures
      const mt = /^\/val-weapon\/([^/]+)\.png$/.exec(p);
      if (!mt || !VAL_UUID.test(mt[1])) return json(res, 400, { error: "bad path" });
      return valWeaponImage(mt[1]).then(buf => { res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400" }); res.end(buf); })
        .catch(e => json(res, 502, { error: e.message }));
    }
    if (p.startsWith("/val-agent/")) { // an agent's picture: strict uuid and kind, fetched once, then served from the data folder; an error status makes the panel fall back to an initials tile
      const mt = /^\/val-agent\/([^/]+)\/([a-z]+)\.png$/.exec(p);
      if (!mt || !VAL_UUID.test(mt[1]) || !VAL_KINDS.has(mt[2])) return json(res, 400, { error: "bad path" });
      return valAgentImage(mt[1], mt[2]).then(buf => { res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400" }); res.end(buf); })
        .catch(e => json(res, 502, { error: e.message }));
    }
    if (p.startsWith("/covers/")) { // official key art for the event cards; 404 means "use the gradient"
      return coverFor(coverSlug(p.slice(8))).then(c => {
        if (!c) return json(res, 404, { error: "no cover" });
        res.writeHead(200, { "content-type": c.type, "cache-control": "max-age=86400" }); res.end(c.buf);
      }).catch(e => json(res, 404, { error: e.message }));
    }
    if (p.startsWith("/objective-icons/")) { const f = safeJoin(ICON_DIR, p.slice(17)); return f ? sendFile(res, f) : json(res, 400, { error: "bad path" }); }
    if (p.startsWith("/uploads/")) { const f = safeJoin(UPLOADS, p.slice(9)); return !f ? json(res, 400, { error: "bad path" }) : VIDEO_EXT.has(path.extname(f).toLowerCase()) ? sendVideo(req, res, f) : sendFile(res, f); }
    const f = safeJoin(PUB, p.slice(1));
    return !f ? json(res, 404, { error: "not found" }) : VIDEO_EXT.has(path.extname(f).toLowerCase()) ? sendVideo(req, res, f) : sendFile(res, f); // videos (the background loop) with byte ranges
  }

  if (req.method === "POST") {
    if (!originOk(req)) return json(res, 403, { error: "Cross-site request refused" });
    if (p === "/api/upload") {
      const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" }[req.headers["content-type"]];
      if (!ext) return json(res, 415, { error: "Use a PNG, JPG, WebP, GIF or SVG image, or an MP4, WebM or MOV video." });
      const video = VIDEO_EXT.has(ext), max = video ? 150e6 : 15e6; // a looping background video may be bigger than a logo
      return readBody(req, max, (err, buf) => {
        if (err) return json(res, 413, { error: video ? "That video is over 150 MB." : "That image is over 15 MB." });
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
            if (!body.event && lockedPath(body.path)) return json(res, 403, { error: "The app logo can't be changed." });
            setPath(target, body.path, body.value);
            if (body.event && body.path === "val.squad") { target.val.squad = Math.max(2, Math.min(5, Math.round(+target.val.squad) || 2)); seatPlayers(target, target.val.squad); } // a bigger squad seats the empty roster rows
            if (body.event && body.path === "game") { upgrade(target); if (SQUAD[target.game] && target.teams.every(t => !t.players.length)) seatPlayers(target, SQUAD[target.game]); } // switching game gives that game's own settings
            save(); broadcastDb(body.by || "api");
            applyFeeds(); // an event's game decides which feed it reads
            return json(res, 200, { ok: true });
          }
          case "/api/lol/playback": case "/api/lol/render": { // forwarded to League's Replay API
            return lolHttp("POST", "/replay/" + p.split("/").pop(), body).then(r => json(res, r.status === 200 ? 200 : 409,
              r.status === 200 ? (r.json || { ok: true }) : { error: r.status === 0 ? "League isn't running a replay." : "The Replay API rejected that.", detail: r.json }));
          }
          case "/api/lol/enable-replay-api": { const file = enableReplayApi(); return json(res, 200, { ok: true, file }); }
          case "/api/ocr/config": {
            if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Chud Hud desktop app." });
            DB.settings.ocr = body; save(); ocr.update(body); broadcastDb("server");
            return json(res, 200, { ok: true });
          }
          case "/api/ocr/start": {
            if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Chud Hud desktop app." });
            return ocr.start(DB.settings.ocr || {}, ocrIngest).then(() => json(res, 200, { ok: true })).catch(e => json(res, 400, { error: e.message }));
          }
          case "/api/chat/connect": {
            const r = twitch.connect(body.channel); if (!r.ok) return json(res, 400, { error: r.error });
            DB.settings.twitch = { channel: String(body.channel || "").replace(/^#/, "").trim() }; save(); broadcastDb("chat");
            return json(res, 200, twitch.status());
          }
          case "/api/chat/open": { const err = chatOpen(String(body.event || ""), String(body.mode || ""), !!body.open); return err ? json(res, 400, { error: err }) : json(res, 200, { ok: true }); }
          case "/api/chat/clear": chatClear(String(body.event || ""), String(body.mode || ""), String(body.build || "")); return json(res, 200, { ok: true });
          case "/api/cam/lan": {
            const on = !!body.on;
            return setCamLan(on).then(() => { DB.settings.camLan = on; save(); json(res, 200, camLinks()); })
              .catch(e => json(res, 500, { error: e.code === "EADDRINUSE" ? `Port ${CAM_PORT} is already in use.` : e.message }));
          }
          case "/api/draft/series-reset": DB.settings.draftSeries = []; save(); draftPush(true); return json(res, 200, { ok: true });
          case "/api/draft/demo": { // { on }: a simulated champion select for setting the scene up
            const on = draft.demo(!!body.on); draftPush(true); return json(res, 200, { ok: true, demo: on });
          }
          case "/api/ocr/save-frame": { // the picture the reader sees and what it read from it, saved to <data>/ocr-frames
            if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Chud Hud desktop app." });
            const c = DB.settings.ocr || {};
            return ocr.frame(c.sourceId, c.sourceName).then(buf => {
              const dir = path.join(DATA, "ocr-frames"), stamp = new Date().toISOString().replace(/[:.]/g, "-"); fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, stamp + ".jpg"), buf);
              fs.writeFileSync(path.join(dir, stamp + ".json"), JSON.stringify({ at: new Date().toISOString(), config: c, readings: ocr.state().readings }, null, 1));
              json(res, 200, { ok: true, file: path.join(dir, stamp + ".jpg") });
            }).catch(e => json(res, 400, { error: e.message }));
          }
          case "/api/ocr/stop": if (ocr) ocr.stop(); return json(res, 200, { ok: true });
          case "/api/mc/config": {
            DB.settings.mc = { host: String(body.host || "127.0.0.1"), port: +body.port || 25575, password: String(body.password || ""), logPath: String(body.logPath || "") };
            save(); mcc.stop(); if (mcOn) startMc(); broadcastDb("server");
            return json(res, 200, { ok: true });
          }
          case "/api/icons/fetch": return fetchOfficialIcons().then(r => json(res, 200, r)).catch(e => json(res, 500, { error: e.message }));
          case "/api/lol/panel": { // flip (or set) the bottom board between the lane board and the teamfight strip: one event, or every League event for the F9 hotkey
            const evs = body.event ? [DB.events.find(e => e.id === body.event)].filter(Boolean) : DB.events.filter(e => e.game === "League of Legends");
            if (!evs.length) return json(res, 404, { error: "No League event." });
            const mode = body.mode === "lane" || body.mode === "fight" ? body.mode : evs[0].hud.lolPanel === "fight" ? "lane" : "fight";
            evs.forEach(e => { e.hud.lolPanel = mode; });
            save(); broadcastDb("hotkey"); return json(res, 200, { mode });
          }
          case "/api/mc/test": return mcc.test(body).then(r => json(res, 200, r));
          case "/api/mc/reset": mcc.reset(); return json(res, 200, { ok: true });
          case "/api/ocr/test": {
            if (!ocr) return json(res, 501, { error: "Screen OCR only works in the Chud Hud desktop app." });
            return ocr.testRegion(body.source || (DB.settings.ocr || {}).sourceId, (DB.settings.ocr || {}).sourceName, body.region)
              .then(r => json(res, 200, r)).catch(e => json(res, 400, { error: e.message }));
          }
          case "/api/source": return json(res, setEventSource(body.event, body.source) ? 200 : 400, { ok: true });
          case "/api/rl": { // forward a Stats API command, e.g. {Command:"ChangePOV",Data:{Focus:"1"}}
            const ok = sendRL({ Command: body.Command, Data: body.Data || {} });
            return json(res, ok ? 200 : 409, ok ? { ok } : { error: "Rocket League isn't connected." });
          }
          case "/api/license": { // { code }: activate this copy. Saved only when the code is genuine, for this edition, and switched on.
            return LIC.activate(DATA, String(body.code || ""), EDITION).then(r => { licCache.at = 0; if (r.ok) return json(res, 200, Object.assign({ ok: true }, licenseStatus())); return json(res, 400, { ok: false, error: r.message, reason: r.reason }); });
          }
          case "/api/ingest": { // external feeds (OCR etc.) post Stats API-shaped messages; they reach every event whose source is External
            if (!feeds.has("push")) return json(res, 200, { ok: true, used: false });
            inFeed("push", () => { (Array.isArray(body) ? body : [body]).forEach(handleMessage); game.connected = true; });
            return json(res, 200, { ok: true, used: true });
          }
          case "/api/demo/reset": { // restart the test match of one event, or of every event that has one
            for (const [k, f] of feeds) if (k.startsWith("demo:") && (!body.event || k === "demo:" + body.event)) { f.demo = null; f.lolDemo = null; f.lolLast = -1; f.game = blankGame(k); f.dirty = true; }
            return json(res, 200, { ok: true });
          }
          case "/api/demo/pause": {
            const f = feeds.get("demo:" + body.event); if (!f) return json(res, 404, { error: "That event has no test match." });
            f.game.paused = !f.game.paused; f.dirty = true; return json(res, 200, { paused: f.game.paused });
          }
          default: return json(res, 404, { error: "unknown endpoint" });
        }
      } catch (e) { return json(res, 400, { error: e.message }); }
    });
  }
  res.writeHead(405); res.end();
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") log(`Port ${PORT} is already in use. Close the other Chud Hud window or set PORT to a different number.`);
  else log("Server error:", err.message);
  if (require.main === module) process.exit(1);
});
module.exports = { server, PORT, DATA, setOcrProvider, getDb: () => DB };

server.listen(PORT, HOST, () => {
  if (LIC.enforced()) licenseWatch();
  draft.start(); setInterval(() => draftPush(), 250).unref();
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  log(`Chud Hud running`);
  log(`  Dashboard:  http://${shown}:${PORT}/`);
  log(`  Overlay:    http://${shown}:${PORT}/overlay   (add as an OBS Browser Source, 1920x1080)`);
  applyFeeds();
  ensureOfficialIcons();
  if (DB.settings.twitch && DB.settings.twitch.channel) twitch.connect(DB.settings.twitch.channel);
  if (DB.settings.camLan) setCamLan(true).catch(e => log("Player cameras could not start:", e.message));
});
