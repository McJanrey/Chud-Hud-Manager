// Run with: node test/variant-test.js
// Chud Hud LOTD (the Halloween edition) must theme the control pages only, never the overlay, and must not change the standard app.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };
const V = require("../variant.js");
const lotd = V.forId("lotd"), std = V.forId("");

(async () => {
  const page = '<html lang="en"><head><title>Chud Hud</title></head><body><small>BROADCAST</small>Chud Hud</body></html>';
  check("the standard app keeps its name and tagline", std.html(page, "app.html").includes("Chud Hud</body>") && std.html(page, "app.html").includes("BROADCAST"));
  const a = lotd.html(page, "x/public/app.html");
  check("LOTD renames the app and sets its tagline", a.includes("Chud Hud LOTD") && a.includes("LAN OF THE DEAD") && !a.includes("LOTD LOTD"));
  check("LOTD adds its theme to the control pages", a.includes('href="/theme.css"') && a.includes('data-variant="lotd"'));
  check("LOTD never themes the overlay page", !lotd.html(page, "x/public/overlay.html").includes("theme.css"));
  check("LOTD has its own port, icon and data folder", lotd.port === 7787 && lotd.camPort === 7788 && lotd.icon === "build/lotd/icon.png" && lotd.dataDir === "Chud Hud LOTD" && lotd.appId !== std.appId);
  const css = fs.readFileSync(path.join(__dirname, "..", "public", "hud.css"), "utf8");
  const out = lotd.hudCss(css);
  check("the overlay stylesheet is recoloured for LOTD (no gold, no green panels)", !/#fdc82f/i.test(out) && !/rgba\(5,\s*24,\s*17/.test(out) && /#e1873d/i.test(out));
  check("the standard overlay stylesheet is untouched", std.hudCss(css) === css);
  for (const f of ["public/themes/lotd.css", "public/brand/lotd/chud-hud.png", "build/lotd/icon.png", "build/lotd/icon.ico", "electron-builder.lotd.js"])
    check("ships " + f, fs.existsSync(path.join(__dirname, "..", f)));
  const cfg = require("../electron-builder.lotd.js");
  check("the LOTD build is its own app with its own update channel", cfg.appId === "ca.stclair.chudhudlotd" && cfg.productName === "Chud Hud LOTD" && cfg.publish[0].channel === "lotd" && cfg.extraMetadata.variant === "lotd");
  check("the LOTD build ships variant.js", cfg.files.includes("variant.js"));

  // the server, started as each edition
  const run = async (variant, port) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "variant-test-"));
    const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SAINTS_DATA: dataDir, PORT: String(port), CAM_PORT: String(port + 1), CHUDHUD_VARIANT: variant }), stdio: "ignore" });
    const base0 = "http://127.0.0.1:" + port;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base0 + "/api/variant")).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 250)); }
    const base = "http://127.0.0.1:" + port, get = async p => { const r = await fetch(base + p); return { status: r.status, text: await r.text(), len: Number(r.headers.get("content-length")) || 0 }; };
    try { return { v: await (await fetch(base + "/api/variant")).json(), app: await get("/"), overlay: await get("/overlay"), theme: await get("/theme.css"), hud: await get("/hud.css"), logo: Buffer.from(await (await fetch(base + "/brand/chud-hud.png")).arrayBuffer()), games: (await (await fetch(base + "/api/state")).json()).db.events.map(e => e.game) }; }
    finally { srv.kill(); }
  };
  try {
    const L = await run("lotd", 7797), S = await run("", 7799);
    check("LOTD server reports itself", L.v.id === "lotd" && L.v.name === "Chud Hud LOTD");
    check("LOTD control room is themed and renamed", L.app.text.includes("theme.css") && L.app.text.includes("Chud Hud LOTD"));
    check("LOTD overlay carries no theme", !L.overlay.text.includes("theme.css") && L.overlay.status === 200);
    check("LOTD serves its Halloween theme", L.theme.text.includes("--accent:#E1873D"));
    check("LOTD serves a recoloured overlay stylesheet", !/#fdc82f/i.test(L.hud.text));
    check("the standard server has no theme and its normal overlay colours", S.theme.text === "" && /#fdc82f/i.test(S.hud.text) && S.v.id === "");
    check("LOTD serves its own logo", !L.logo.equals(S.logo));
    check("LOTD opens with Valorant, Fortnite and Dead by Daylight first", L.games.slice(0, 3).join() === "Valorant,Fortnite,Dead by Daylight", L.games.join());
    check("the standard app does not get the LOTD games", !S.games.includes("Dead by Daylight") && !S.games.includes("Fortnite"), S.games.join());
  } catch (e) { check("server run", false, String(e && e.stack || e)); }
  console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nVARIANT TEST PASS");
  process.exit(failures ? 1 : 0);
})();
