"use strict";
// League of Legends champion select, for the Champion Select scene.
//
// Read from the League client's own local API (the "LCU") on a PC that is in the lobby: a player's, a coach's or an observer's
// in a custom or tournament lobby. The client writes a lockfile (name:pid:port:password:protocol) in its install folder while it
// runs; this reads it, then asks https://127.0.0.1:<port>/lol-champ-select/v1/session about once a second. The client uses a
// self-signed certificate on 127.0.0.1, so certificate checks are skipped for that address only.
//
// Every change is kept with the moment it happened, so the scene can show champion select as it was a set number of seconds
// ago: that lines the graphics up with a stream delay, and bans and picks then appear at the same pace as they did in the client.
const fs = require("fs"), https = require("https"), path = require("path");

const LOCKFILES = [
  "C:\\Riot Games\\League of Legends\\lockfile",
  "D:\\Riot Games\\League of Legends\\lockfile",
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Riot Games", "League of Legends", "lockfile"),
];
const KEEP_MS = 20 * 60 * 1000; // history kept for the delay

function readLockfile(custom) {
  for (const f of [custom, ...LOCKFILES].filter(Boolean)) {
    try {
      const [, , port, password, protocol] = fs.readFileSync(f, "utf8").trim().split(":");
      if (+port && password) return { port: +port, password, protocol: protocol || "https", file: f };
    } catch { /* not this one */ }
  }
  return null;
}
function lcuGet(lock, pth, timeout = 2500) {
  return new Promise(resolve => {
    const req = https.request({ host: "127.0.0.1", port: lock.port, path: pth, method: "GET", auth: "riot:" + lock.password, rejectUnauthorized: false, timeout,
      headers: { accept: "application/json" } }, r => {
      let s = ""; r.on("data", c => (s += c)); r.on("end", () => { let j = null; try { j = JSON.parse(s); } catch { /* not JSON */ } resolve({ status: r.statusCode, json: j }); });
    });
    req.on("timeout", () => req.destroy()); req.on("error", () => resolve({ status: 0, json: null })); req.end();
  });
}

/* the client's session, turned into what the scene draws. Team 1 (blue) is the left side, team 2 (red) the right. */
function normalize(s, now = Date.now()) {
  if (!s || typeof s !== "object" || !Array.isArray(s.myTeam)) return null;
  const cells = [...s.myTeam, ...(s.theirTeam || [])];
  const sideOf = c => (c && (c.team === 2 || (!c.team && c.cellId >= 5)) ? "right" : "left");
  const cellSide = new Map(cells.map(c => [c.cellId, sideOf(c)]));
  const actions = [].concat(...(s.actions || []));
  const out = { active: true, phase: "", left: { picks: [], bans: [] }, right: { picks: [], bans: [] }, endsAt: 0, total: 0, at: now };
  cells.slice().sort((a, b) => a.cellId - b.cellId).forEach(c => {
    const act = actions.filter(a => a.type === "pick" && a.actorCellId === c.cellId).pop();
    out[sideOf(c)].picks.push({
      cell: c.cellId, champ: +c.championId || 0, intent: +c.championPickIntent || 0, pos: String(c.assignedPosition || "").toUpperCase(),
      name: c.gameName || c.summonerName || c.displayName || "", locked: !!(act && act.completed && c.championId), active: !!(act && act.isInProgress),
    });
  });
  actions.filter(a => a.type === "ban").forEach(a => {
    const side = cellSide.get(a.actorCellId) || (a.actorCellId >= 5 ? "right" : "left");
    out[side].bans.push({ champ: a.completed ? +a.championId || 0 : 0, hover: !a.completed ? +a.championId || 0 : 0, active: !!a.isInProgress, done: !!a.completed });
  });
  const t = s.timer || {}, inProgress = actions.find(a => a.isInProgress);
  out.phase = t.phase === "PLANNING" ? "PLANNING" : t.phase === "FINALIZATION" ? "FINALIZATION" : t.phase === "GAME_STARTING" ? "STARTING"
    : inProgress ? (inProgress.type === "ban" ? "BANS" : "PICKS") : (t.phase || "");
  out.activeSide = inProgress ? cellSide.get(inProgress.actorCellId) || "" : "";
  if (!t.isInfinite && t.adjustedTimeLeftInPhase != null) { out.endsAt = now + Math.max(0, +t.adjustedTimeLeftInPhase); out.total = Math.round((+t.totalTimeInPhase || 0) / 1000); }
  return out;
}
const keyOf = s => JSON.stringify(s ? [s.active, s.phase, s.left, s.right, s.activeSide, Math.round((s.endsAt || 0) / 1000)] : null);

/* a simulated champion select, for setting the scene up without a client: 10 bans, then picks in draft order, then finalisation */
const DEMO_CHAMPS = [266, 103, 84, 12, 32, 34, 1, 523, 22, 136, 268, 432, 53, 63, 201, 51, 164, 69, 31, 42, 122, 131, 36, 119, 245];
function demoSession(step) {
  const order = [["ban", 0], ["ban", 5], ["ban", 1], ["ban", 6], ["ban", 2], ["ban", 7], ["pick", 0], ["pick", 5], ["pick", 6], ["pick", 1], ["pick", 2], ["pick", 7],
    ["ban", 8], ["ban", 3], ["ban", 9], ["ban", 4], ["pick", 8], ["pick", 3], ["pick", 4], ["pick", 9]];
  const pos = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"], names = ["Jazii", "Pzy", "Fabso", "raggeo.", "Saint", "Gulls1", "Gulls2", "Gulls3", "Gulls4", "Gulls5"];
  const champs = new Map(), actions = [];
  order.forEach(([type, cell], i) => {
    const champ = DEMO_CHAMPS[i];
    actions.push([{ id: i, type, actorCellId: cell, championId: i <= step ? champ : 0, completed: i < step, isInProgress: i === step }]);
    if (type === "pick" && i < step) champs.set(cell, champ);
  });
  const team = cell => ({ cellId: cell, team: cell < 5 ? 1 : 2, championId: champs.get(cell) || 0, championPickIntent: 0, assignedPosition: pos[cell % 5], gameName: names[cell] });
  return { myTeam: [0, 1, 2, 3, 4].map(team), theirTeam: [5, 6, 7, 8, 9].map(team), actions,
    timer: step < order.length ? { phase: "BAN_PICK", adjustedTimeLeftInPhase: 6000, totalTimeInPhase: 30000 } : { phase: "FINALIZATION", adjustedTimeLeftInPhase: 8000, totalTimeInPhase: 30000 } };
}

/* opts: { lockfile(), enabled(), onChange(), get? } (get lets tests stand in for the client) */
function create(opts) {
  const hist = []; // { t, snap }
  const st = { connected: false, reason: "Not started", lockfile: "", demo: null, lastKey: "" };
  const get = opts.get || lcuGet;
  function record(snap, now = Date.now()) {
    const k = keyOf(snap); if (k === st.lastKey) return;
    st.lastKey = k; hist.push({ t: now, snap }); while (hist.length && now - hist[0].t > KEEP_MS) hist.shift();
    if (opts.onChange) opts.onChange();
  }
  async function tick() {
    if (st.demo) {
      const n = Math.floor((Date.now() - st.demo.start) / 3000); // one action every three seconds
      if (n > 22) { st.demo = null; record({ active: false }); return; }
      record(Object.assign(normalize(demoSession(Math.min(n, 20))), { demo: true })); // marked, so a demo never counts as a game of the series
      return;
    }
    if (opts.enabled && !opts.enabled()) { st.reason = "Off"; return; }
    const lock = readLockfile(opts.lockfile && opts.lockfile());
    if (!lock && !opts.get) { st.connected = false; st.reason = "League client not found on this PC"; record({ active: false }); return; }
    const r = await get(lock || {}, "/lol-champ-select/v1/session");
    st.lockfile = lock ? lock.file : "";
    if (r.status === 0) { st.connected = false; st.reason = "League client not answering"; record({ active: false }); return; }
    st.connected = true;
    if (r.status === 200 && r.json) { st.reason = "In champion select"; record(normalize(r.json) || { active: false }); }
    else { st.reason = "Client open, not in champion select"; record({ active: false }); }
  }
  /* champion select as it was `delayMs` ago (the newest change at or before that moment) */
  function at(delayMs = 0, now = Date.now()) {
    const t = now - delayMs; let cur = null;
    for (const h of hist) { if (h.t <= t) cur = h; else break; }
    return cur ? cur.snap : null;
  }
  let timer = null;
  return {
    start(every = 1000) { if (!timer) { timer = setInterval(() => { tick().catch(() => {}); }, every); if (timer.unref) timer.unref(); tick().catch(() => {}); } },
    stop() { clearInterval(timer); timer = null; },
    tick, at, record,
    demo(on) { st.demo = on ? { start: Date.now() } : null; if (!on) record({ active: false }); return !!st.demo; },
    state: () => ({ connected: st.connected, reason: st.demo ? "Demo champion select" : st.reason, lockfile: st.lockfile, demo: !!st.demo, history: hist.length }),
  };
}

module.exports = { create, normalize, readLockfile, demoSession, keyOf };
