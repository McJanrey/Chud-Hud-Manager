// Run with: node test/control-test.js
// Stream Deck / Companion control: one web address per button, protected by a key.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "control-test-")), port = 7805, base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SAINTS_DATA: dataDir, PORT: String(port), CAM_PORT: String(port + 1), ICON_BASE: "http://127.0.0.1:9/" }), stdio: "ignore" });
  const get = async p => { const r = await fetch(base + p); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/state")).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 250)); }
    const info = await get("/api/control/info");
    check("the PC running the app can read the control key", info.status === 200 && /^[0-9a-f]{32}$/.test(info.json.key), JSON.stringify(info.json));
    const key = info.json.key, ev = (await get("/api/state")).json.db.events[0], q = (rest, k = key) => `/api/control?key=${k}&event=${ev.id}&${rest}`;
    check("the key is kept in its own file, not in the saved workspace", fs.readFileSync(path.join(dataDir, "control-key.txt"), "utf8").trim() === key && !JSON.stringify((await get("/api/state")).json.db).includes(key));
    check("no key or a wrong key is refused", (await get(`/api/control?event=${ev.id}&action=scene&value=casters`)).status === 403 && (await get(q("action=scene&value=casters", "0".repeat(32)))).status === 403);
    const state = async () => (await get("/api/state")).json.db.events.find(e => e.id === ev.id);
    let r = await get(q("action=scene&value=casters"));
    check("a scene button switches the scene", r.status === 200 && (await state()).hud.scene === "casters", JSON.stringify(r));
    check("an unknown scene or action is refused", (await get(q("action=scene&value=nope"))).status === 400 && (await get(q("action=fly"))).status === 400);
    await get(q("action=cams&value=on")); check("webcams on", (await state()).hud.show.playerCam === true);
    await get(q("action=cams&value=toggle")); check("webcams toggle", (await state()).hud.show.playerCam === false);
    await get(q("action=show&name=score&value=off")); check("an element can be hidden by name", (await state()).hud.show.score === false);
    check("an unknown element is refused", (await get(q("action=show&name=nothing&value=on"))).status === 400);
    await get(q("action=director&value=action")); check("only the player in the action", (await state()).camera.director === "action");
    await get(q("action=pin&side=1&value=2")); check("pin a player", (await state()).camera.pin[1] === 2);
    await get(q("action=score&side=0&delta=1")); await get(q("action=score&side=0&delta=1")); await get(q("action=score&side=1&delta=-1"));
    const s2 = await state(); check("score buttons add and never go below zero, and take the score off auto", s2.live.score[0] === 2 && s2.live.score[1] === 0 && s2.live.autoScore === false, JSON.stringify(s2.live.score));
    check("an unknown event is refused", (await get(`/api/control?key=${key}&event=nope&action=scene&value=casters`)).status === 404);
  } catch (e) { check("test ran", false, e.stack || e.message); }
  srv.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nCONTROL TEST PASS");
  process.exit(failures ? 1 : 0);
})();
