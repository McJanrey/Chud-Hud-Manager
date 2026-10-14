// Run with: node test/minecraft-selftest.js
// Starts a mock Minecraft server that speaks the RCON protocol, then checks that the connector reads
// players, health, game mode and the border, and counts kills and deaths from the server log.
"use strict";
const net = require("net"), fs = require("fs"), os = require("os"), path = require("path");
const mc = require("../minecraft.js");

const PASSWORD = "tribute";
const world = { Alex: { Health: "20.0f", FoodLevel: "18", playerGameType: "0" }, Sam: { Health: "9.5f", FoodLevel: "12", playerGameType: "0" }, Joe: { Health: "0.0f", FoodLevel: "20", playerGameType: "3" } };

function pack(id, type, body) { const b = Buffer.from(body); const o = Buffer.alloc(14 + b.length); o.writeInt32LE(10 + b.length, 0); o.writeInt32LE(id, 4); o.writeInt32LE(type, 8); b.copy(o, 12); return o; }
function answer(cmd) {
  if (cmd === "list") return `There are ${Object.keys(world).length} of a max of 24 players online: ${Object.keys(world).join(", ")}`;
  if (cmd === "worldborder get") return "The world border is currently 150 blocks wide";
  const m = cmd.match(/^data get entity (\S+) (\w+)$/);
  if (m) return world[m[1]] ? `${m[1]} has the following entity data: ${world[m[1]][m[2]]}` : "No entity was found";
  return "Unknown or incomplete command";
}
const server = net.createServer(sock => {
  let buf = Buffer.alloc(0);
  sock.on("data", d => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) {
      const len = buf.readInt32LE(0), id = buf.readInt32LE(4), type = buf.readInt32LE(8), body = buf.toString("utf8", 12, 4 + len - 2); buf = buf.subarray(4 + len);
      if (type === 3) sock.write(body === PASSWORD ? pack(id, 2, "") : pack(-1, 2, ""));
      else if (type === 2) sock.write(pack(id, 0, answer(body)));
      else sock.write(pack(id, 0, "Unknown request " + type.toString(16)));
    }
  });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port, logPath = path.join(os.tmpdir(), `mc-selftest-${process.pid}.log`);
  fs.writeFileSync(logPath, "[11:00:00] [Server thread/INFO]: Old was slain by History\n"); // old history must not count

  console.log("connection tests");
  const t = mc.create();
  let r = await t.test({ host: "127.0.0.1", port, password: PASSWORD, logPath });
  check("good password connects", r.ok && r.players === 3, JSON.stringify(r));
  r = await t.test({ host: "127.0.0.1", port, password: "nope", logPath });
  check("wrong password is reported", !r.ok && /password/i.test(r.message), JSON.stringify(r));
  r = await t.test({ host: "127.0.0.1", port: 1, password: PASSWORD });
  check("closed port gives a clear message", !r.ok && /enable-rcon|listening/i.test(r.message), JSON.stringify(r));

  console.log("live reading");
  const c = mc.create();
  c.start({ host: "127.0.0.1", port, password: PASSWORD, logPath, roster: ["Alex", "Sam", "Joe"] });
  await sleep(2500);
  let s = c.state(), by = n => s.players.find(p => p.name === n);
  check("connected", s.connected, s.error);
  check("health read", by("Alex") && by("Alex").health === 20 && by("Sam").health === 9.5);
  check("food read", by("Sam") && by("Sam").food === 12);
  check("spectator counts as out", by("Joe") && by("Joe").alive === false && by("Alex").alive === true);
  check("border read", s.border === 150, String(s.border));

  console.log("log parsing");
  const L = (msg) => fs.appendFileSync(logPath, `[11:05:0${Math.floor(Math.random() * 9)}] [Server thread/INFO]: ${msg}\n`);
  L("Sam was slain by Alex using [Diamond Sword]");
  L("Joe fell from a high place");
  L("<Alex> gg");
  L("Alex was shot by Sam");
  L("Alex joined the game");
  L("Sam has made the advancement [Monster Hunter]");
  L("Alex was killed by Zombie");
  await sleep(1500);
  s = c.state(); by = n => s.players.find(p => p.name === n);
  check("kill credited to the killer", by("Alex").kills === 1, `Alex kills=${by("Alex").kills}`);
  check("victim death counted", by("Sam").deaths === 1 && by("Joe").deaths === 1, `Sam=${by("Sam").deaths} Joe=${by("Joe").deaths}`);
  check("player-vs-player kill from a bow", by("Sam").kills === 1);
  check("old log history ignored", !s.players.find(p => p.name === "Old" || p.name === "History"));
  check("advancement and chat ignored", by("Alex").kills === 1 && s.feed.length === 4, `feed=${s.feed.length}`);
  check("weapon captured", s.feed.some(f => f.weapon === "Diamond Sword" && f.killer === "Alex" && f.victim === "Sam"));
  check("environment death has no killer", s.feed.some(f => f.victim === "Joe" && !f.killer));
  c.reset(); s = c.state();
  check("reset clears counts and feed", s.feed.length === 0 && s.players.every(p => p.kills === 0 && p.deaths === 0));

  c.stop(); server.close(); fs.unlinkSync(logPath);
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nMINECRAFT SELFTEST PASS");
  process.exit(failures ? 1 : 0);
});
