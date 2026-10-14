// Run with: node test/security-test.js
// Checks that other web pages can't drive the server, and that the League icon cache only serves what it should.
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAJ6xk2AAAAABJRU5ErkJggg==", "base64");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "security-test-")), port = 7796, base = `http://127.0.0.1:${port}`;
  fs.mkdirSync(path.join(dataDir, "ddragon-img"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "ddragon-img", "cdn_1.0_img_champion_Ahri.png"), PNG); // already cached: no internet needed
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SAINTS_DATA: dataDir, PORT: String(port),
    ICON_BASE: "http://127.0.0.1:9/" }), stdio: "ignore" });
  await new Promise(r => setTimeout(r, 2500));
  const post = (headers) => fetch(base + "/api/demo/reset", { method: "POST", headers: Object.assign({ "content-type": "application/json" }, headers), body: "{}" });
  const withHost = host => new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port, path: "/api/state", headers: { host } }, r => { r.resume(); resolve(r.statusCode); }).on("error", reject));
  try {
    check("a request with no Origin works (curl, OBS, trackers)", (await post({})).status === 200);
    check("our own pages work (Origin matches the Host)", (await post({ origin: base })).status === 200);
    const evil = await post({ origin: "https://evil.example" });
    check("a page on another site is refused", evil.status === 403, String(evil.status));
    check("a sandboxed page (Origin: null) is refused", (await post({ origin: "null" })).status === 403);
    check("a rebinding host name is refused", (await withHost("evil.example:" + port)) === 421);
    check("localhost still works", (await withHost("localhost:" + port)) === 200);

    const sb = (await (await fetch(base + "/api/state")).json()).db;
    check("each kit starts with a caster-seat count", ["Saints Default", "Saints Varsity", "Saints Gaming"].every(k => sb.settings.kits[k] && sb.settings.kits[k].seats >= 1 && sb.settings.kits[k].seats <= 5), JSON.stringify(sb.settings.kits));
    check("every event has five seats to choose from", sb.events.every(e => e.camera.seats.length >= 5));

    const hit = await fetch(base + "/ddragon/cdn/1.0/img/champion/Ahri.png");
    check("a cached icon is served without internet", hit.status === 200 && (await hit.arrayBuffer()).byteLength === PNG.length, String(hit.status));
    for (const bad of ["/ddragon/evil.png", "/ddragon/cdn/1.0/img/champion/..%2F..%2Fdb.json", "/ddragon/cdn/1.0/data/en_US/item.json", "/ddragon/https%3A%2F%2Fevil.example%2Fx.png"])
      check("icon cache refuses " + bad, (await fetch(base + bad)).status === 400);
  } catch (e) { check("test ran", false, e.message); }
  srv.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nSECURITY TEST PASS");
  process.exit(failures ? 1 : 0);
})();
