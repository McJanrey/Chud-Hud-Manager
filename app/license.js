"use strict";
// License codes you can switch off and on.
//
// A code is made by the owner (app/tools/make-license.js) and signed with a private key that never leaves the owner's machine. The app holds
// only the public key, so it can check a code but nobody can make one. That part works offline: it proves the code is genuine, which
// editions it is for, and when it expires.
//
// Switching a code off and on needs a server, because an offline program can't be told. When a license service is configured
// (app/license-config.json: a Supabase URL and its public key), the app asks it "is this code still on?" when it activates, when it starts
// and every ten minutes. If you switch the code off, the app locks at its next check. If the PC is offline the last answer is trusted for
// the code's grace period (14 days by default), so a LAN event without internet still runs; after that the app waits for a connection.
//
//   code    = "CH1-" + base32(payload + signature), shown in groups of five
//   payload = 9 bytes: version, editions (bit 0 Chud Hud, bit 1 Chud Hud LOTD), expiry (days since 2026-01-01, 0 = never), serial, grace days
//
// Honest limit: a program running on someone's own PC can always be edited. This keeps people from using the app without a code from you;
// it does not stop someone who takes the app apart. The real lock is what lives on your server (see the website plan).
const crypto = require("crypto"), fs = require("fs"), path = require("path");
const pkg = require("./package.json");

const EPOCH = Date.UTC(2026, 0, 1), DAY = 86400000, TAG = Buffer.from("chudhud-license-v2");
const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const EDITIONS = { std: 1, lotd: 2 };
const DEFAULT_GRACE = 14, RAW = 73;
const CHECK_EVERY = (!process.versions.electron && +process.env.CHUDHUD_TEST_EVERY) || 10 * 60 * 1000; // tests may speed this up, the packaged app never

function enc(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; val &= (1 << bits) - 1; }
  }
  if (bits > 0) out += ALPHA[(val << (5 - bits)) & 31];
  return out;
}
function dec(str) {
  let bits = 0, val = 0; const out = [];
  for (const ch of str) {
    const i = ALPHA.indexOf(ch); if (i < 0) return null;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; val &= (1 << bits) - 1; }
  }
  return Buffer.from(out);
}
const group = s => s.match(/.{1,5}/g).join("-");

function publicKey() {
  // tests may swap the key, but never inside the packaged app
  if (process.env.CHUDHUD_TEST_PUBKEY && !process.versions.electron) return fs.readFileSync(process.env.CHUDHUD_TEST_PUBKEY, "utf8");
  return fs.readFileSync(path.join(__dirname, "license-public.pem"), "utf8");
}
/* the license service: { url, key } from license-config.json (the key is Supabase's public one, safe to ship), or none */
function service() {
  if (process.env.CHUDHUD_TEST_SERVICE && !process.versions.electron) { try { return JSON.parse(process.env.CHUDHUD_TEST_SERVICE); } catch { return null; } }
  try { const c = JSON.parse(fs.readFileSync(path.join(__dirname, "license-config.json"), "utf8")); return c && c.url && c.key ? c : null; } catch { return null; }
}

/* owner side: make a code. editions: "std" and/or "lotd"; days: how long it lasts from today (0 = never expires); grace: offline days. */
function sign(privatePem, { editions = ["std", "lotd"], days = 365, grace = 0, serial = crypto.randomBytes(4).readUInt32BE(0), now = Date.now() } = {}) {
  const payload = Buffer.alloc(9);
  payload[0] = 2; payload[1] = editions.reduce((m, e) => m | (EDITIONS[e] || 0), 0);
  payload.writeUInt16BE(days ? Math.min(65535, Math.floor((now - EPOCH) / DAY) + Math.ceil(days)) : 0, 2);
  payload.writeUInt32BE(serial >>> 0, 4); payload[8] = Math.min(255, Math.max(0, Math.floor(grace)));
  const sig = crypto.sign(null, Buffer.concat([TAG, payload]), crypto.createPrivateKey(privatePem));
  return "CH1-" + group(enc(Buffer.concat([payload, sig])));
}

function parse(code) {
  const s = String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!s.startsWith("CH1")) return null;
  const raw = dec(s.slice(3));
  return raw && raw.length === RAW ? { payload: raw.subarray(0, 9), sig: raw.subarray(9) } : null;
}

const WHY = {
  bad: "That isn't a valid code. Check it and try again.",
  edition: "That code is for a different edition of the app.",
  expired: "That code has expired. Ask for a new one.",
  revoked: "This code has been switched off. Ask for it to be turned back on.",
  online: "This copy has to connect to the internet to confirm its code. Connect once and it carries on.",
  unknown: "That code isn't registered. Ask for a new one.",
};
/* offline: is the code genuine, for this edition, and in date? */
function verify(code, edition, now = Date.now()) {
  const p = parse(code);
  if (!p) return { ok: false, reason: "bad", message: WHY.bad };
  let good = false;
  try { good = crypto.verify(null, Buffer.concat([TAG, p.payload]), crypto.createPublicKey(publicKey()), p.sig); } catch { good = false; }
  if (!good || p.payload[0] !== 2) return { ok: false, reason: "bad", message: WHY.bad };
  const days = p.payload.readUInt16BE(2), serial = p.payload.readUInt32BE(4), mask = p.payload[1], grace = p.payload[8] || DEFAULT_GRACE;
  const expires = days ? EPOCH + (days + 1) * DAY - 1 : 0; // valid through the end of the last day
  if (!(mask & (EDITIONS[edition] || 0))) return { ok: false, reason: "edition", message: WHY.edition, serial };
  if (expires && now > expires) return { ok: false, reason: "expired", message: WHY.expired, expires, serial };
  return { ok: true, expires, serial, grace, editions: Object.keys(EDITIONS).filter(e => mask & EDITIONS[e]) };
}

/* ---- what this PC has saved ---- */
const file = dataDir => path.join(dataDir, "license.json");
function load(dataDir) { try { return JSON.parse(fs.readFileSync(file(dataDir), "utf8")) || {}; } catch { return {}; } }
const put = (dataDir, o) => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file(dataDir), JSON.stringify(o)); };
function stored(dataDir) { return String(load(dataDir).code || ""); }
function save(dataDir, code, check) { put(dataDir, { code: String(code).trim(), saved: new Date().toISOString(), check: check || null }); }

/* ---- the service: is this code on? ---- */
async function ask(serial, edition, timeoutMs = 8000) {
  const s = service(); if (!s) return { reached: false, none: true };
  try {
    const r = await fetch(String(s.url).replace(/\/$/, "") + "/rest/v1/rpc/check_license", {
      method: "POST", headers: { "content-type": "application/json", apikey: s.key, authorization: "Bearer " + s.key },
      body: JSON.stringify({ p_serial: serial, p_edition: edition }), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { reached: false };
    const j = await r.json();
    return { reached: true, active: !!(j && j.active), known: !!(j && j.known) };
  } catch { return { reached: false }; }
}
/* check now and remember the answer */
async function refresh(dataDir, edition) {
  const o = load(dataDir); if (!o.code) return null;
  const v = verify(o.code, edition); if (!v.ok) return v;
  const a = await ask(v.serial, edition);
  if (a.reached) { o.check = { at: Date.now(), active: a.active, known: a.known }; put(dataDir, o); }
  return a;
}
/* activation: genuine, and (when a service is configured) switched on. Saves the code only if it works. */
async function activate(dataDir, code, edition) {
  const v = verify(code, edition); if (!v.ok) return v;
  if (service()) {
    const a = await ask(v.serial, edition);
    if (!a.reached) return { ok: false, reason: "online", message: WHY.online };
    if (!a.known) return { ok: false, reason: "unknown", message: WHY.unknown };
    if (!a.active) return { ok: false, reason: "revoked", message: WHY.revoked };
    save(dataDir, code, { at: Date.now(), active: true, known: true });
  } else save(dataDir, code, null);
  return v;
}

/* Release builds enforce the license (the build writes enforceLicense into package.json); running from source does not. */
const enforced = () => pkg.enforceLicense === true || process.env.CHUDHUD_ENFORCE === "1";
function status(dataDir, edition, now = Date.now()) {
  if (!enforced()) return { licensed: true, enforced: false };
  const o = load(dataDir);
  if (!o.code) return { licensed: false, enforced: true, reason: "none", message: "Enter your code to activate this copy." };
  const v = verify(o.code, edition, now);
  if (!v.ok) return Object.assign({ licensed: false, enforced: true }, v);
  if (service()) {
    const c = o.check;
    if (c && c.reached !== false && (c.active === false || c.known === false)) return { licensed: false, enforced: true, ok: false, reason: "revoked", message: WHY.revoked, serial: v.serial };
    if (!c || now - c.at > v.grace * DAY) return { licensed: false, enforced: true, ok: false, reason: "online", message: WHY.online, serial: v.serial };
  }
  return Object.assign({ licensed: true, enforced: true }, v);
}

module.exports = { sign, verify, parse, stored, save, load, status, activate, refresh, ask, service, enforced, EDITIONS, CHECK_EVERY, DEFAULT_GRACE, WHY };
