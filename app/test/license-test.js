// Run with: node test/license-test.js
// License codes: made offline, checked offline, and switched off and on through the license service.
"use strict";
const crypto = require("crypto"), fs = require("fs"), http = require("http"), os = require("os"), path = require("path"), { spawn } = require("child_process");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "license-test-"));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubFile = path.join(tmp, "pub.pem"), priv = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.writeFileSync(pubFile, publicKey.export({ type: "spki", format: "pem" }));
  process.env.CHUDHUD_TEST_PUBKEY = pubFile;
  const lic = require("../license.js");

  /* ---- the code itself (offline) ---- */
  const both = lic.sign(priv, { editions: ["std", "lotd"], days: 30, serial: 1001 });
  check("a code looks like CH1-XXXXX-...", /^CH1-([0-9A-Z]{5}-)+[0-9A-Z]{1,5}$/.test(both), both);
  const v = lic.verify(both, "std");
  check("a genuine code verifies and carries its serial, editions and expiry", v.ok && v.serial === 1001 && v.editions.join() === "std,lotd" && v.expires > Date.now(), JSON.stringify(v));
  check("it works for the other edition too", lic.verify(both, "lotd").ok);
  const lotdOnly = lic.sign(priv, { editions: ["lotd"], days: 30, serial: 1002 });
  check("a code for one edition is refused by the other", lic.verify(lotdOnly, "std").reason === "edition" && lic.verify(lotdOnly, "lotd").ok);
  const old = lic.sign(priv, { days: 1, serial: 1003, now: Date.now() - 5 * 86400000 });
  check("an expired code is refused", lic.verify(old, "std").reason === "expired");
  check("a code with no expiry never expires", lic.verify(lic.sign(priv, { days: 0, serial: 1004 }), "std", Date.now() + 3000 * 86400000).ok);
  const flip = both.slice(0, 20) + (both[20] === "A" ? "B" : "A") + both.slice(21);
  check("a code with one character changed is refused", lic.verify(flip, "std").reason === "bad");
  check("garbage and an empty code are refused", ["", "hello", "CH1-AAAAA", "CH1-" + "0".repeat(120)].every(c => lic.verify(c, "std").reason === "bad"));
  check("typing it in lower case, without dashes, with spaces and O for 0 still works", lic.verify(both.toLowerCase().replace(/-/g, " "), "std").ok && lic.verify(both.replace(/0/g, "O"), "std").ok);
  const other = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  check("a code signed with someone else's key is refused", lic.verify(lic.sign(other, { serial: 1005 }), "std").reason === "bad");
  check("the grace period is kept in the code", lic.verify(lic.sign(priv, { grace: 3, serial: 1006 }), "std").grace === 3 && lic.verify(both, "std").grace === lic.DEFAULT_GRACE);

  /* ---- a stand-in for the license service (what Supabase's check_license does) ---- */
  const rows = new Map([[1001, { active: true }], [1002, { active: true }]]); let up = true;
  const svc = http.createServer((req, res) => {
    let b = ""; req.on("data", d => (b += d)); req.on("end", () => {
      const j = JSON.parse(b || "{}"), r = rows.get(+j.p_serial);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(r ? { known: true, active: r.active } : { known: false, active: false }));
    });
  });
  await new Promise(r => svc.listen(0, "127.0.0.1", r));
  const svcUrl = "http://127.0.0.1:" + svc.address().port;

  /* ---- a locked server ---- */
  const dataDir = path.join(tmp, "data"), port = 7803, base = "http://127.0.0.1:" + port;
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, {
    SAINTS_DATA: dataDir, PORT: String(port), CAM_PORT: String(port + 1), CHUDHUD_ENFORCE: "1", CHUDHUD_TEST_PUBKEY: pubFile, CHUDHUD_TEST_EVERY: "700",
    CHUDHUD_TEST_SERVICE: JSON.stringify({ url: svcUrl, key: "test-key" }) }), stdio: "ignore" });
  const get = async p => { const r = await fetch(base + p, { headers: { accept: p === "/" ? "text/html" : "application/json" } }); return { status: r.status, text: await r.text() }; };
  const act = async code => { const r = await fetch(base + "/api/license", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) }); return { status: r.status, json: await r.json() }; };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/license")).ok) break; } catch { /* not up yet */ } await sleep(250); }
    let s = JSON.parse((await get("/api/license")).text);
    check("a copy with no code is locked", s.enforced && !s.licensed && s.reason === "none", JSON.stringify(s));
    check("a locked copy serves nothing but the launcher: data, control room and overlay are refused", (await get("/api/state")).status === 402 && (await get("/")).status === 402 && (await get("/overlay")).status === 402 && (await get("/hud.json")).status === 402);
    check("the launcher and its styles still load while locked", (await get("/launcher")).status === 200 && (await get("/tokens.css")).status === 200);
    check("the locked page says what to do", (await get("/")).text.includes("isn't activated"));
    let r = await act("nonsense");
    check("a wrong code is refused with a reason", r.status === 400 && r.json.reason === "bad", JSON.stringify(r));
    r = await act(lic.sign(priv, { editions: ["lotd"], days: 30, serial: 1002 }));
    check("a code for another edition is refused", r.status === 400 && r.json.reason === "edition", JSON.stringify(r));
    r = await act(lic.sign(priv, { days: 30, serial: 9999 }));
    check("a genuine code the service has never heard of is refused", r.status === 400 && r.json.reason === "unknown", JSON.stringify(r));
    check("still locked after the refusals", (await get("/api/state")).status === 402);
    r = await act(both);
    check("the right code activates it", r.status === 200 && r.json.licensed === true, JSON.stringify(r));
    check("an activated copy works", (await get("/api/state")).status === 200 && (await get("/overlay")).status === 200);
    check("the code is remembered on this PC", lic.stored(dataDir) === both.trim() || lic.verify(lic.stored(dataDir), "std").ok);

    rows.get(1001).active = false; await sleep(2500);
    check("switching the code OFF locks the running copy at its next check", (await get("/api/state")).status === 402 && JSON.parse((await get("/api/license")).text).reason === "revoked");
    rows.get(1001).active = true; await sleep(2500);
    check("switching it back ON unlocks it again", (await get("/api/state")).status === 200);

    await new Promise(r => svc.close(r)); up = false; await sleep(2500);
    check("with the service unreachable the last answer is trusted (a LAN event without internet keeps working)", (await get("/api/state")).status === 200);
  } catch (e) { check("test ran", false, e.stack || e.message); }
  srv.kill();

  /* ---- offline rules, with the clock moved ---- */
  const d2 = path.join(tmp, "data2"); fs.mkdirSync(d2, { recursive: true });
  process.env.CHUDHUD_ENFORCE = "1"; process.env.CHUDHUD_TEST_SERVICE = JSON.stringify({ url: "http://127.0.0.1:9", key: "k" });
  fs.writeFileSync(path.join(d2, "license.json"), JSON.stringify({ code: both, check: { at: Date.now(), active: true, known: true } }));
  check("a recent answer keeps it licensed", lic.status(d2, "std").licensed === true);
  check("after the grace period with no answer it waits for a connection", lic.status(d2, "std", Date.now() + (lic.DEFAULT_GRACE + 1) * 86400000).reason === "online");
  fs.writeFileSync(path.join(d2, "license.json"), JSON.stringify({ code: both, check: { at: Date.now(), active: false, known: true } }));
  check("a switched-off answer locks it", lic.status(d2, "std").reason === "revoked");
  delete process.env.CHUDHUD_ENFORCE;
  check("a copy run from source is not locked", lic.status(d2, "std").licensed === true && lic.status(d2, "std").enforced === false);
  check("the app has the public key and no private key in it", fs.existsSync(path.join(__dirname, "..", "license-public.pem")) && !fs.readdirSync(path.join(__dirname, "..")).some(f => /private/i.test(f)));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nLICENSE TEST PASS");
  process.exit(failures ? 1 : 0);
})();
