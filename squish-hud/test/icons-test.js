// Run with: node test/icons-test.js
// Checks the "Download official icons" feature against a local stand-in server (nothing is fetched from the internet).
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAJ6xk2AAAAABJRU5ErkJggg==", "base64");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };

const mock = http.createServer((req, res) => {
  if (req.url.endsWith("riftherald.png")) { res.writeHead(404); return res.end(); }                       // one file missing
  if (req.url.endsWith("baron.png")) { res.writeHead(200); return res.end("this is not a png"); }        // one file that isn't an image
  if (req.url.endsWith("/icons/dragon.png")) { res.writeHead(302, { location: "/redirected/dragon.png" }); return res.end(); }
  res.writeHead(200, { "content-type": "image/png" }); res.end(PNG);
});
mock.listen(0, "127.0.0.1", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icons-test-")), port = 7795;
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SQUISH_DATA: dataDir, PORT: String(port),
    ICON_BASE: `http://127.0.0.1:${mock.address().port}/icons/` }), stdio: "ignore" });
  await new Promise(r => setTimeout(r, 2500));
  const post = (p, body = {}) => fetch(`http://127.0.0.1:${port}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  try {
    await new Promise(r => setTimeout(r, 2500)); // the app fetches the icons by itself on start; nobody clicks anything
    const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
    const files = fs.existsSync(path.join(dataDir, "objective-icons")) ? fs.readdirSync(path.join(dataDir, "objective-icons")) : [];
    check("icons download on their own at start", files.length === 11, `${files.length} files: ${files.join(",")}`);
    check("a missing file doesn't stop the rest", files.includes("dragon_elder.png") && !files.includes("riftherald.png"), files.join(","));
    check("a non-image is rejected", !files.includes("baron.png"));
    check("redirects are followed", files.includes("dragon.png"));
    const off = st.db.settings.iconsOfficial || {};
    check("settings point at the saved icons", off.elder === "/objective-icons/dragon_elder.png" && !off.baron && !off.herald, JSON.stringify(off));
    check("the user's own uploads are kept separate", st.db.settings.icons === undefined || Object.keys(st.db.settings.icons).length === 0);
    const img = await fetch(`http://127.0.0.1:${port}/objective-icons/dragon_elder.png`);
    check("icons are served to the overlay", img.status === 200 && (await img.arrayBuffer()).byteLength === PNG.length);
    const bad = await fetch(`http://127.0.0.1:${port}/objective-icons/..%2F..%2Fdb.json`);
    check("path tricks are refused", bad.status >= 400, String(bad.status));
  } catch (e) { check("test ran", false, e.message); }
  srv.kill(); mock.close(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nICONS TEST PASS");
  process.exit(failures ? 1 : 0);
});
