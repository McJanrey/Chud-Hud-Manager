#!/usr/bin/env node
// Owner's tool for Chud Hud license codes. Run it from the app folder:
//
//   node tools/make-license.js init                                   once: make the signing key and the admin secret
//   node tools/make-license.js new --edition all --days 365 --note "Alex"    make a code (editions: std, lotd or all; days 0 = never expires)
//   node tools/make-license.js revoke 123456789                       switch a code off (it locks at its next check)
//   node tools/make-license.js enable 123456789                       switch it back on
//   node tools/make-license.js list                                   every code and when it was last seen
//
// The signing key and the admin secret live OUTSIDE the repository, in <vault>/Secrets/chudhud-license/ (or CHUDHUD_LICENSE_DIR).
// Never commit them. Anyone with private.pem can make codes; anyone with admin-secret.txt can switch codes on and off.
"use strict";
const crypto = require("crypto"), fs = require("fs"), path = require("path");
const lic = require("../license.js");

const APP = path.join(__dirname, "..");
const DIR = process.env.CHUDHUD_LICENSE_DIR || path.join(APP, "..", "..", "Secrets", "chudhud-license");
const PRIV = path.join(DIR, "private.pem"), SECRET = path.join(DIR, "admin-secret.txt"), LEDGER = path.join(DIR, "issued.csv");
const args = process.argv.slice(2), cmd = args[0];
const opt = (name, def) => { const i = args.indexOf("--" + name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const die = m => { console.error(m); process.exit(1); };

async function rpc(name, body) {
  const s = lic.service(); if (!s) return { skipped: "no license service configured yet (app/license-config.json), so this was not sent to a server" };
  const r = await fetch(String(s.url).replace(/\/$/, "") + "/rest/v1/rpc/" + name, { method: "POST", headers: { "content-type": "application/json", apikey: s.key, authorization: "Bearer " + s.key }, body: JSON.stringify(body) });
  const t = await r.text(); if (!r.ok) die(`The license service said no (${r.status}): ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return t; }
}
const secret = () => { try { return fs.readFileSync(SECRET, "utf8").trim(); } catch { die("No admin secret yet. Run: node tools/make-license.js init"); } };

(async () => {
  if (cmd === "init") {
    fs.mkdirSync(DIR, { recursive: true });
    if (!fs.existsSync(PRIV)) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      fs.writeFileSync(PRIV, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
      fs.writeFileSync(path.join(APP, "license-public.pem"), publicKey.export({ type: "spki", format: "pem" }));
      console.log("Made the signing key. The public half is in app/license-public.pem (commit that one). The private half is " + PRIV + " (never commit it).");
    } else console.log("The signing key already exists.");
    if (!fs.existsSync(SECRET)) { fs.writeFileSync(SECRET, crypto.randomBytes(32).toString("hex"), { mode: 0o600 }); console.log("Made the admin secret: " + SECRET); }
    const hash = crypto.createHash("sha256").update(secret()).digest("hex");
    const sql = `insert into public.chudhud_admin (id, secret_hash) values (1, '${hash}') on conflict (id) do update set secret_hash = excluded.secret_hash;\n`;
    fs.writeFileSync(path.join(DIR, "admin-hash.sql"), sql);
    console.log("Run supabase/licensing.sql in the license database, then this line (it holds only a hash, not the secret):\n" + sql);
    return;
  }
  if (cmd === "new") {
    if (!fs.existsSync(PRIV)) die("No signing key yet. Run: node tools/make-license.js init");
    const e = opt("edition", "all"), editions = e === "all" ? ["std", "lotd"] : e.split(",").filter(x => lic.EDITIONS[x]);
    if (!editions.length) die('--edition must be std, lotd or all');
    const days = +opt("days", 365), grace = +opt("grace", 0), note = opt("note", "");
    let serial; do { serial = crypto.randomBytes(4).readUInt32BE(0); } while (!serial);
    const code = lic.sign(fs.readFileSync(PRIV, "utf8"), { editions, days, grace, serial });
    const expires = days ? new Date(Date.now() + days * 86400000) : null;
    const reg = await rpc("admin_issue", { p_secret: secret(), p_serial: serial, p_editions: editions.join(","), p_note: note, p_expires: expires ? expires.toISOString() : null });
    fs.appendFileSync(LEDGER, [serial, new Date().toISOString(), editions.join("+"), days || "never", JSON.stringify(note)].join(",") + "\n");
    console.log(`\nCode:     ${code}\nSerial:   ${serial}\nFor:      ${editions.join(" + ")}${note ? "  (" + note + ")" : ""}\nExpires:  ${expires ? expires.toDateString() : "never"}\nOffline:  ${grace || lic.DEFAULT_GRACE} days between checks\n`);
    if (reg.skipped) console.log("Note: " + reg.skipped + ". The code works, but it cannot be switched off until the service is set up.");
    return;
  }
  if (cmd === "revoke" || cmd === "enable") {
    const serial = +args[1]; if (!serial) die(`Usage: node tools/make-license.js ${cmd} <serial>`);
    const r = await rpc("admin_set", { p_secret: secret(), p_serial: serial, p_active: cmd === "enable" });
    if (r.skipped) die(r.skipped);
    console.log(r && r.ok ? `Code ${serial} is now ${cmd === "enable" ? "ON" : "OFF"}. A running copy locks (or unlocks) at its next check, within ten minutes.` : "No code with that serial.");
    return;
  }
  if (cmd === "list") {
    const r = await rpc("admin_list", { p_secret: secret() });
    if (r.skipped) { console.log(r.skipped + "\nIssued so far:\n" + (fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, "utf8") : "(none)")); return; }
    console.log("serial        on   editions   expires      last seen            note");
    for (const l of r) console.log(String(l.serial).padEnd(13), (l.active ? "ON " : "OFF").padEnd(4), String(l.editions).padEnd(10), String(l.expires_at ? l.expires_at.slice(0, 10) : "never").padEnd(12), String(l.last_seen ? l.last_seen.slice(0, 16).replace("T", " ") : "never").padEnd(20), l.note || "");
    return;
  }
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 11).map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
})();
