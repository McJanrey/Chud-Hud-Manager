"use strict";
// Player and caster cameras without a third-party service: browsers stream to the overlay over WebRTC, and this file is the
// signalling relay that lets two browsers find each other. No video passes through here, only the small setup messages.
//
//   sender  = a player's browser on the same network, on /cam (HTTPS, because browsers only give a camera to secure pages)
//   viewer  = the overlay's /camview frame on this PC
//   room    = "<event id>.<player id>" or "<event id>.seat<n>"
const crypto = require("crypto"), fs = require("fs"), path = require("path");

const ROOM_RE = /^[A-Za-z0-9_.-]{1,80}$/, ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const TYPES = new Set(["hello", "offer", "answer", "ice"]);
const MAX_VIEWERS = 8, MAX_ROOMS = 200;

function create({ dataDir, readBody, originOk }) {
  const rooms = new Map(); // room -> { sender: { id, res } | null, viewers: Map(id -> res) }
  const secretFile = path.join(dataDir, "cam-secret.txt");
  let secret = null;

  // The secret only ever lives in this file (never in the saved workspace, which the overlay can read).
  function getSecret() {
    if (secret) return secret;
    try { secret = fs.readFileSync(secretFile, "utf8").trim(); } catch { secret = null; }
    if (!/^[0-9a-f]{64}$/.test(secret || "")) {
      secret = crypto.randomBytes(32).toString("hex");
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    }
    return secret;
  }
  const tokenFor = r => crypto.createHmac("sha256", getSecret()).update(r).digest("hex").slice(0, 32);
  function tokenOk(r, t) {
    const a = Buffer.from(tokenFor(r)), b = Buffer.from(String(t || ""));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  const roomOf = r => {
    let x = rooms.get(r);
    if (!x) { if (rooms.size >= MAX_ROOMS) return null; x = { sender: null, viewers: new Map() }; rooms.set(r, x); }
    return x;
  };
  const prune = r => { const x = rooms.get(r); if (x && !x.sender && !x.viewers.size) rooms.delete(r); };
  const send = (res, data) => { try { res.write(`event: msg\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* the other side already left */ } };
  const deny = (res, code, text) => { res.writeHead(code, { "content-type": "text/plain" }); res.end(text); };

  // keeps idle event streams from being dropped by routers and browsers
  const beat = setInterval(() => {
    rooms.forEach(x => {
      if (x.sender) try { x.sender.res.write(": keep\n\n"); } catch { /* closed */ }
      x.viewers.forEach(v => { try { v.write(": keep\n\n"); } catch { /* closed */ } });
    });
  }, 20000);
  beat.unref();

  /* GET /api/cam/sig opens the event stream; POST /api/cam/sig forwards one message to the other side.
     lan = the request arrived on the network-facing server: senders only, and the link's token is required. */
  function handle(req, res, url, lan) {
    if (url.pathname !== "/api/cam/sig") return false;
    const r = url.searchParams.get("r") || "", id = url.searchParams.get("id") || "";
    if (!ROOM_RE.test(r) || !ID_RE.test(id)) { deny(res, 400, "Bad room or id"); return true; }
    const asSender = lan || url.searchParams.get("role") === "sender";
    if (lan && !tokenOk(r, url.searchParams.get("t"))) { deny(res, 403, "This camera link is not valid. Ask for a new one."); return true; }

    if (req.method === "GET") {
      const x = roomOf(r);
      if (!x) { deny(res, 503, "Too many cameras"); return true; }
      if (!asSender && x.viewers.size >= MAX_VIEWERS) { deny(res, 429, "Too many viewers"); return true; }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": open\n\n");
      if (asSender) {
        if (x.sender) { try { x.sender.res.end(); } catch { /* already gone */ } } // a newer page for the same player replaces the older one
        const me = { id, res };
        x.sender = me;
        x.viewers.forEach(v => send(v, { type: "sender-up" }));
        req.on("close", () => {
          if (x.sender === me) { x.sender = null; x.viewers.forEach(v => send(v, { type: "sender-down" })); }
          prune(r);
        });
      } else {
        x.viewers.set(id, res);
        if (x.sender) send(res, { type: "sender-up" });
        req.on("close", () => { if (x.viewers.get(id) === res) x.viewers.delete(id); prune(r); });
      }
      return true;
    }

    if (req.method === "POST") {
      if (!originOk(req)) { deny(res, 403, "Cross-site request refused"); return true; }
      readBody(req, 64 * 1024, (err, buf) => {
        let b; try { b = JSON.parse(buf.toString("utf8")); } catch { return deny(res, 400, "Body must be JSON"); }
        const m = b && b.msg;
        if (err || !m || !TYPES.has(m.type)) return deny(res, 400, "Bad message");
        if ((m.sdp != null && (typeof m.sdp !== "string" || m.sdp.length > 30000)) || (m.candidate != null && typeof m.candidate !== "object")) return deny(res, 400, "Bad message");
        const x = rooms.get(r);
        if (!x) return deny(res, 404, "Nobody is connected");
        const out = { type: m.type, from: id, sdp: m.sdp, candidate: m.candidate };
        if (asSender) {
          const to = String(b.to || "");
          if (!x.sender || x.sender.id !== id) return deny(res, 409, "Not the active sender");
          const v = x.viewers.get(to);
          if (v) send(v, out);
        } else if (x.sender) send(x.sender.res, out);
        res.writeHead(204); res.end();
      });
      return true;
    }
    deny(res, 405, "Method not allowed");
    return true;
  }

  function status() {
    const out = {};
    rooms.forEach((x, r) => { out[r] = { live: !!x.sender, viewers: x.viewers.size }; });
    return out;
  }
  function close() { clearInterval(beat); rooms.forEach(x => { if (x.sender) try { x.sender.res.end(); } catch { /* gone */ } x.viewers.forEach(v => { try { v.end(); } catch { /* gone */ } }); }); rooms.clear(); }

  return { handle, status, tokenFor, tokenOk, close };
}

module.exports = { create, ROOM_RE };
