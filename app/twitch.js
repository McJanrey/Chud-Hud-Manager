"use strict";
// Reads a Twitch channel's chat without logging in (Twitch lets anyone read chat as a "justinfan" guest) so viewers can vote
// with chat commands: "!7" or "!vote 7" for a build score, "!2" for option 2 of a chat poll. Nothing is ever sent to chat.
const tls = require("tls"), net = require("net");

const CHANNEL_RE = /^[a-z0-9_]{3,25}$/i;

// ":user!user@user.tmi.twitch.tv PRIVMSG #chan :!7", optionally preceded by "@tag=value;..." tags
function parseLine(line) {
  const m = /^(?:@(\S+) )?:([^!\s]+)![^ ]* PRIVMSG #\S+ :(.*)$/.exec(String(line).replace(/\r?\n$/, ""));
  if (!m) return null;
  let name = m[2];
  const dn = /(?:^|;)display-name=([^;]*)/.exec(m[1] || "");
  if (dn && dn[1]) name = dn[1];
  return { user: m[2].toLowerCase(), name, text: m[3].trim() };
}

// A score vote is "!0".."!10" or "!vote 7". A poll vote is "!1".."!9". null when the message is neither.
function parseVote(text) {
  const m = /^!(?:vote\s*)?(\d{1,2})$/i.exec(String(text).trim());
  return m ? +m[1] : null;
}

function create({ onMessage, log = () => {}, host = process.env.TWITCH_IRC_HOST || "irc.chat.twitch.tv", port = +process.env.TWITCH_IRC_PORT || 6697,
  secure = process.env.TWITCH_IRC_TLS !== "0" } = {}) {
  let sock = null, channel = "", want = false, timer = null, buf = "", state = { connected: false, error: "" }, tries = 0;

  function open() {
    clearTimeout(timer);
    if (!want || !channel) return;
    buf = "";
    const s = sock = (secure ? tls : net).connect(secure ? { host, port, servername: host } : { host, port });
    s.setEncoding("utf8"); s.setKeepAlive(true, 30000);
    s.on(secure ? "secureConnect" : "connect", () => {
      s.write(`PASS SCHMOOPIIE\r\nNICK justinfan${Math.floor(10000 + Math.random() * 89999)}\r\nCAP REQ :twitch.tv/tags\r\nJOIN #${channel.toLowerCase()}\r\n`);
    });
    s.on("data", d => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
        if (line.startsWith("PING")) { s.write("PONG" + line.slice(4) + "\r\n"); continue; }
        if (/ 366 /.test(line) || / JOIN #/.test(line)) { state = { connected: true, error: "" }; tries = 0; continue; }
        if (/ NOTICE /.test(line) && /(Login unsuccessful|Improperly formatted)/i.test(line)) { state = { connected: false, error: "Twitch refused the connection." }; continue; }
        const msg = parseLine(line);
        if (msg) try { onMessage(msg); } catch (e) { log("chat handler:", e.message); }
      }
      if (buf.length > 20000) buf = "";
    });
    s.on("error", e => { state = { connected: false, error: e.code === "ENOTFOUND" || e.code === "EAI_AGAIN" ? "No internet connection to Twitch." : e.message }; });
    s.on("close", () => {
      if (sock === s) sock = null;
      state.connected = false;
      if (want) { tries++; timer = setTimeout(open, Math.min(30000, 1500 * tries)); }
    });
  }

  return {
    connect(ch) {
      ch = String(ch || "").replace(/^#/, "").trim();
      if (!ch) { this.disconnect(); return { ok: true }; }
      if (!CHANNEL_RE.test(ch)) return { ok: false, error: "That does not look like a Twitch channel name." };
      if (want && ch.toLowerCase() === channel.toLowerCase() && sock) return { ok: true };
      this.disconnect(); channel = ch; want = true; tries = 0; open();
      return { ok: true };
    },
    disconnect() { want = false; clearTimeout(timer); if (sock) { try { sock.destroy(); } catch { /* gone */ } sock = null; } state = { connected: false, error: "" }; channel = ""; },
    status: () => ({ channel, connected: state.connected, error: state.error }),
  };
}

module.exports = { create, parseLine, parseVote, CHANNEL_RE };
