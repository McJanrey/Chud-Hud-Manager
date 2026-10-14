// Minecraft (Java) connector for Hunger Games style matches.
// Reads a server you run through two built-in channels, so no plugin or mod is needed:
//   RCON  (enable-rcon=true in server.properties): who is online, health, food, game mode, world border
//   latest.log (path set in the app): deaths and kills, parsed from the server's death messages
"use strict";
const net = require("net");
const fs = require("fs");

/* ------------------------------------------------------------------ RCON */
const pack = (id, type, body) => {
  const b = Buffer.from(body, "utf8"), out = Buffer.alloc(14 + b.length);
  out.writeInt32LE(10 + b.length, 0); out.writeInt32LE(id, 4); out.writeInt32LE(type, 8); b.copy(out, 12); out.writeInt16LE(0, 12 + b.length);
  return out;
};

class Rcon {
  constructor() { this.sock = null; this.buf = Buffer.alloc(0); this.waiting = new Map(); this.n = 1; this.chain = Promise.resolve(); this.onclose = null; }
  _id() { this.n = (this.n % 0x3fffffff) + 1; return this.n; }
  connect(host, port, password, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host, port }); this.sock = sock; let settled = false;
      const fail = e => { if (settled) return; settled = true; sock.destroy(); reject(e); };
      sock.setTimeout(timeoutMs, () => fail(new Error("The server didn't answer on its RCON port in time.")));
      sock.on("error", e => fail(new Error(e.code === "ECONNREFUSED" ? `Nothing is listening on ${host}:${port}. Is the server running with enable-rcon=true?` : e.message)));
      sock.on("close", () => {
        this.sock = null;
        for (const w of this.waiting.values()) w.fail && w.fail(new Error("The RCON connection closed."));
        this.waiting.clear();
        if (!settled) { settled = true; reject(new Error("The server closed the connection (wrong RCON password?).")); }
        if (this.onclose) this.onclose();
      });
      sock.on("data", d => this._data(d));
      sock.on("connect", () => {
        const id = this._id();
        this.waiting.set(id, { onPacket: () => { this.waiting.delete(id); sock.setTimeout(0); settled = true; resolve(); } });
        this.waiting.set(-1, { onPacket: () => fail(new Error("Wrong RCON password.")) });
        sock.write(pack(id, 3, password || ""));
      });
    });
  }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const len = this.buf.readInt32LE(0);
      if (len < 10 || len > 1 << 20) { this.buf = Buffer.alloc(0); return; }
      if (this.buf.length < 4 + len) return;
      const id = this.buf.readInt32LE(4), type = this.buf.readInt32LE(8), body = this.buf.toString("utf8", 12, 4 + len - 2);
      this.buf = this.buf.subarray(4 + len);
      const w = this.waiting.get(id); if (w) w.onPacket({ id, type, body });
    }
  }
  // Commands run one at a time. A second, invalid packet marks the end of a (possibly split) reply.
  send(cmd) {
    const run = () => new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error("Not connected to the server."));
      const id = this._id(), sid = this._id(), parts = [];
      const done = () => { clearTimeout(t); this.waiting.delete(id); this.waiting.delete(sid); };
      const t = setTimeout(() => { done(); reject(new Error("The server didn't answer a command in time.")); }, 5000);
      const fail = e => { done(); reject(e); };
      this.waiting.set(id, { onPacket: p => parts.push(p.body), fail });
      this.waiting.set(sid, { onPacket: () => { done(); resolve(parts.join("")); }, fail });
      this.sock.write(pack(id, 2, cmd)); this.sock.write(pack(sid, 100, ""));
    });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
  close() { if (this.sock) this.sock.destroy(); }
}

/* ------------------------------------------------------------- parsing */
const clean = s => String(s || "").replace(/§./g, "").trim();
const parseList = t => { const m = clean(t).match(/players online:\s*(.*)$/s); return m && m[1].trim() ? m[1].split(",").map(x => x.trim()).filter(Boolean) : []; };
const parseNum = t => { const m = clean(t).match(/data:\s*(-?[\d.]+)[bBsSfFdDlL]?\s*$/); return m ? parseFloat(m[1]) : null; };
const parseBorder = t => { const m = clean(t).match(/currently\s+([\d.,]+)\s+blocks? wide/i); return m ? parseFloat(m[1].replace(/,/g, "")) : null; };
const NAME = /^[A-Za-z0-9_]{3,16}$/;
// lines that start with a player's name but are not deaths
const NOT_DEATH = /(joined the game|left the game|lost connection|has made the advancement|has completed the challenge|has reached the goal|logged in with entity id|moved too quickly|issued server command|UUID of player|Disconnected)/i;
const DEATH_HINT = /\b(was|fell|drowned|starved|suffocated|burned|blew up|withered|tried to|walked into|hit the ground|experienced|died|froze|went up in flames|didn't want|discovered|left the confines|squished|impaled|speared|slain|shot|killed|pummeled|fireballed)\b/i;

/* Pull a death out of one log line, or return null. `known` is the set of player names we know. */
function parseDeath(line, known) {
  const m = line.match(/\]:\s+(.*)$/); if (!m) return null;
  const msg = clean(m[1]);
  if (msg.startsWith("<") || msg.startsWith("[") || NOT_DEATH.test(msg)) return null;
  const sp = msg.indexOf(" "); if (sp < 0) return null;
  const victim = msg.slice(0, sp);
  if (!NAME.test(victim) || !known.has(victim.toLowerCase()) || !DEATH_HINT.test(msg.slice(sp))) return null;
  const rest = msg.slice(sp + 1);
  let killer = null;
  for (const w of rest.split(/[\s,.!]+/)) if (NAME.test(w) && w.toLowerCase() !== victim.toLowerCase() && known.has(w.toLowerCase())) { killer = w; break; }
  const wm = rest.match(/ using \[?([^\]]+?)\]?\s*$/);
  return { victim, killer: killer ? [...known.keys ? [] : []].concat(killer)[0] : null, weapon: wm ? wm[1] : "", cause: rest };
}

/* ---------------------------------------------------------- connector */
function create(log = () => {}) {
  const st = { connected: false, error: "", host: "", border: null, players: new Map(), feed: [], lastPoll: 0, matchId: 0, logOk: false };
  const known = new Map(); // lower-case name -> proper name
  let rcon = null, timer = null, logTimer = null, cfg = null, running = false, cycle = 0, logPos = null, partial = "", feedId = 0;

  const player = name => {
    const k = name.toLowerCase(); if (!known.has(k)) known.set(k, name);
    if (!st.players.has(k)) st.players.set(k, { name, health: null, food: null, mode: null, online: false, kills: 0, deaths: 0, lastSeen: 0 });
    return st.players.get(k);
  };

  function onLine(line) {
    const j = line.match(/\]:\s+(\S+) joined the game/); if (j && NAME.test(j[1])) { player(j[1]).online = true; return; }
    const d = parseDeath(line, known); if (!d) return;
    const v = player(d.victim); v.deaths++; v.alive = false;
    const killer = d.killer ? player(d.killer) : null; if (killer) killer.kills++;
    st.feed.push({ id: ++feedId, t: Date.now(), victim: v.name, killer: killer ? killer.name : "", weapon: d.weapon, cause: killer ? "" : d.cause });
    if (st.feed.length > 12) st.feed.shift();
    log(`Elimination: ${killer ? killer.name + " → " : ""}${v.name}`);
  }

  function pollLog() {
    if (!cfg.logPath) { st.logOk = false; return; }
    fs.stat(cfg.logPath, (err, s) => {
      if (err) { st.logOk = false; return; }
      st.logOk = true;
      if (logPos === null || s.size < logPos) { logPos = s.size; return; } // start at the end: old deaths don't count
      if (s.size === logPos) return;
      const len = s.size - logPos, b = Buffer.alloc(len);
      try { const fd = fs.openSync(cfg.logPath, "r"); fs.readSync(fd, b, 0, len, logPos); fs.closeSync(fd); } catch { return; }
      logPos = s.size; partial += b.toString("utf8");
      const lines = partial.split(/\r?\n/); partial = lines.pop();
      lines.forEach(onLine);
    });
  }

  async function poll() {
    const names = parseList(await rcon.send("list"));
    const online = new Set(names.map(n => n.toLowerCase()));
    for (const p of st.players.values()) if (!online.has(p.name.toLowerCase())) p.online = false;
    cycle++;
    for (const n of names) {
      const p = player(n); p.online = true; p.lastSeen = Date.now();
      const hp = parseNum(await rcon.send(`data get entity ${n} Health`)); if (hp != null) p.health = hp;
      if (cycle % 3 === 1 || p.mode == null) {
        const food = parseNum(await rcon.send(`data get entity ${n} FoodLevel`)); if (food != null) p.food = food;
        const gm = parseNum(await rcon.send(`data get entity ${n} playerGameType`)); if (gm != null) p.mode = gm;
      }
    }
    if (cycle % 2 === 1) { const b = parseBorder(await rcon.send("worldborder get")); if (b != null) st.border = b; }
    st.lastPoll = Date.now();
  }

  async function loop() {
    if (!running) return;
    try {
      if (!rcon || !rcon.sock) {
        rcon = new Rcon(); rcon.onclose = () => { st.connected = false; };
        await rcon.connect(cfg.host || "127.0.0.1", +cfg.port || 25575, cfg.password || "");
        st.connected = true; st.error = ""; log("Connected to the Minecraft server");
      }
      await poll(); st.error = "";
    } catch (e) { st.connected = false; st.error = e.message; if (rcon) { rcon.close(); rcon = null; } }
    if (running) timer = setTimeout(loop, st.connected ? 700 : 3000);
  }

  return {
    start(c) { this.stop(); cfg = Object.assign({ host: "127.0.0.1", port: 25575, password: "", logPath: "" }, c); (cfg.roster || []).forEach(n => NAME.test(n) && player(n)); st.host = `${cfg.host}:${cfg.port}`; running = true; logPos = null; partial = ""; loop(); logTimer = setInterval(pollLog, 500); },
    stop() { running = false; clearTimeout(timer); clearInterval(logTimer); if (rcon) rcon.close(); rcon = null; st.connected = false; },
    update(c) { if (!running) return; (c.roster || []).forEach(n => NAME.test(n) && player(n)); },
    reset() { st.matchId++; st.feed = []; for (const p of st.players.values()) { p.kills = 0; p.deaths = 0; } },
    state() {
      return { connected: st.connected, error: st.error, host: st.host, border: st.border, logOk: st.logOk, lastPoll: st.lastPoll, matchId: st.matchId, feed: st.feed,
        players: [...st.players.values()].map(p => ({ name: p.name, health: p.health, food: p.food, mode: p.mode, online: p.online, kills: p.kills, deaths: p.deaths,
          alive: p.online && p.mode != null && p.mode !== 3 })) };
    },
    // One-off check for the dashboard's "Test connection" button.
    async test(c) {
      const r = new Rcon();
      try { await r.connect(c.host || "127.0.0.1", +c.port || 25575, c.password || ""); const names = parseList(await r.send("list")); r.close();
        const log = c.logPath ? (fs.existsSync(c.logPath) ? "log file found" : "log file NOT found") : "no log file set (kills and deaths won't be counted)";
        return { ok: true, players: names.length, message: `Connected. ${names.length} player${names.length === 1 ? "" : "s"} online; ${log}.` }; }
      catch (e) { r.close(); return { ok: false, message: e.message }; }
    },
  };
}

module.exports = { create, Rcon, parseDeath, parseList, parseNum, parseBorder };
