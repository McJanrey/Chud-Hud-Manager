// Run with: node test/scenes-test.js
// Draws every scene for every game and checks that a scene speaks the game it is showing: no Rocket League words (goals, saves,
// boost) on any other game, and no made-up "Player 1" placeholders where a game has no players.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const HUD = require("../public/hud.js");

let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) { console.log(" FAIL ", name, extra); failures++; } };
const text = html => String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "scenes-test-")), port = 7797, base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: Object.assign({}, process.env, { SAINTS_DATA: dataDir, PORT: String(port), ICON_BASE: "http://127.0.0.1:9/" }), stdio: "ignore" });
  await new Promise(r => setTimeout(r, 2500));
  const GAMES = ["Rocket League", "League of Legends", "Overwatch 2", "Call of Duty", "Deadlock", "Fortnite", "Valorant", "Counter-Strike 2", "Minecraft", "Riftbound"];
  const scenes = ["auto", ...Object.keys(HUD.SCENES)];
  const RL_WORDS = /\b(GOALS?|SAVES?|SHOTS?|DEMOS?|BOOST|GOAL DIFF|SUPERSONIC)\b/i;
  let drawn = 0;
  try {
    for (const g of GAMES) {
      const tpl = await (await fetch(`${base}/api/event-template?game=${encodeURIComponent(g)}`)).json();
      const variants = g === "Minecraft" ? [["Hunger Games", "hungergames"], ["Build Battle", "buildbattle"]] : [[g, null]];
      for (const [label, mode] of variants) {
        const ev = JSON.parse(JSON.stringify(tpl)); if (mode) ev.mc.mode = mode;
        if (g === "Minecraft") ev.teams[0].players = ["Alice", "Bob", "Cara"].map((ign, i) => ({ id: "p" + i, ign, alias: "", country: "", avatar: "", cam: "" }));
        const kind = HUD.model(ev, null).kind;
        const want = { "Rocket League": "rl", "League of Legends": "lol", "Minecraft": "mc", "Riftbound": "rb" }[g] || "gen";
        check(`${label}: kind`, kind === want, `${kind} instead of ${want}`);
        for (const scene of scenes) {
          let html;
          try { html = HUD.sceneHtml(ev, null, scene, { kits: { "Saints Default": { seats: 2 } } }); } catch (e) { check(`${label} / ${scene}: draws`, false, e.message); continue; }
          drawn++;
          check(`${label} / ${scene}: returns markup`, typeof html === "string");
          const t = text(html);
          if (g !== "Rocket League") check(`${label} / ${scene}: no Rocket League words`, !RL_WORDS.test(t), t.match(RL_WORDS) + " in: " + t.slice(0, 120));
          if (kind === "mc" || kind === "gen") check(`${label} / ${scene}: no made-up players`, !/PLAYER \d/i.test(t), t.slice(0, 120));
          if (g !== "Rocket League" && g !== "League of Legends") check(`${label} / ${scene}: no Blue/Orange placeholders`, !/\b(BLU|ORG)\b/.test(t) || kind === "gen" && /BLU|ORG/.test(t) === false, t.slice(0, 120));
        }
      }
    }
    check("standings label follows the game", HUD.gdLabel("Rocket League") === "GOAL DIFF" && HUD.gdLabel("League of Legends") === "GAME DIFF" && HUD.gdLabel("Valorant") === "DIFF");
  } catch (e) { check("test ran", false, e.stack || e.message); }
  srv.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED (${drawn} scenes drawn)` : `\nSCENES TEST PASS (${drawn} scenes drawn)`);
  process.exit(failures ? 1 : 0);
})();
