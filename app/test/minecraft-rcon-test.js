// Run with: node test/minecraft-rcon-test.js
// Runs the Minecraft connector against a stand-in server that speaks the RCON protocol, with a real log file on disk.
"use strict";
const net = require("net"), fs = require("fs"), os = require("os"), path = require("path");
const mc = require("../minecraft.js");

let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const pack = (id, type, body) => { const b = Buffer.from(body, "utf8"), o = Buffer.alloc(14 + b.length); o.writeInt32LE(10 + b.length, 0); o.writeInt32LE(id, 4); o.writeInt32LE(type, 8); b.copy(o, 12); return o; };
const PLAYERS = { Alice: { Health: "20.0f", FoodLevel: "18", playerGameType: "0" }, Bob: { Health: "6.5f", FoodLevel: "12", playerGameType: "0" } };
const answer = cmd => {
  if (cmd === "list") return "There are 2 of a max of 20 players online: Alice, Bob";
  if (cmd === "worldborder get") return "The world border is currently 1500 blocks wide";
  const m = /^data get entity (\w+) (\w+)$/.exec(cmd);
  if (m && PLAYERS[m[1]]) return `${m[1]} has the following entity data: ${PLAYERS[m[1]][m[2]]}`;
  return "Unknown command";
};
// Auth packet (type 3) is answered with the same id on success or -1 on a wrong password; commands (type 2) get a reply
// with the same id; the empty type-100 packet that marks the end of a reply is echoed back.
const server = net.createServer(sock => {
  let buf = Buffer.alloc(0);
  sock.on("data", d => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) {
      const len = buf.readInt32LE(0), id = buf.readInt32LE(4), type = buf.readInt32LE(8), body = buf.toString("utf8", 12, 4 + len - 2);
      buf = buf.subarray(4 + len);
      if (type === 3) sock.write(pack(body === "secret" ? id : -1, 2, ""));
      else if (type === 2) sock.write(pack(id, 0, answer(body)));
      else sock.write(pack(id, 0, "Unknown request " + type.toString(16)));
    }
  });
  sock.on("error", () => {});
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port, dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-")), logPath = path.join(dir, "latest.log");
  fs.writeFileSync(logPath, "[12:00:00] [Server thread/INFO]: Old line that must not count\n");
  const conn = mc.create(() => {});
  try {
    const bad = await conn.test({ host: "127.0.0.1", port, password: "wrong" });
    check("a wrong password is reported", bad.ok === false && /password/i.test(bad.message), bad.message);
    const good = await conn.test({ host: "127.0.0.1", port, password: "secret", logPath });
    check("the test button connects and counts players", good.ok === true && /2 players/.test(good.message), good.message);

    conn.start({ host: "127.0.0.1", port, password: "secret", logPath, roster: ["Alice", "Bob", "Cara"] });
    await sleep(2500);
    let st = conn.state();
    check("connects and reads who is online", st.connected && st.players.filter(p => p.online).map(p => p.name).sort().join() === "Alice,Bob", JSON.stringify(st.players));
    const alice = st.players.find(p => p.name === "Alice"), bob = st.players.find(p => p.name === "Bob"), cara = st.players.find(p => p.name === "Cara");
    check("reads health and food", alice.health === 20 && alice.food === 18 && bob.health === 6.5 && bob.food === 12, JSON.stringify([alice, bob]));
    check("game mode survival counts as alive, an offline roster player doesn't", alice.alive && bob.alive && cara && !cara.online && !cara.alive);
    check("reads the world border", st.border === 1500, String(st.border));
    check("the log file is found", st.logOk === true);

    fs.appendFileSync(logPath, "[12:01:00] [Server thread/INFO]: Bob was slain by Alice using [Iron Sword]\n[12:01:05] [Server thread/INFO]: Alice joined the game\n[12:02:00] [Server thread/INFO]: Cara fell from a high place\n");
    await sleep(1500);
    st = conn.state();
    const a2 = st.players.find(p => p.name === "Alice"), b2 = st.players.find(p => p.name === "Bob"), c2 = st.players.find(p => p.name === "Cara");
    check("a kill from the log counts for the killer and the victim", a2.kills === 1 && b2.deaths === 1, JSON.stringify([a2, b2]));
    check("the feed names the weapon", st.feed.length >= 1 && st.feed[0].killer === "Alice" && st.feed[0].victim === "Bob" && st.feed[0].weapon === "Iron Sword", JSON.stringify(st.feed));
    check("a fall death has no killer", c2.deaths === 1 && st.feed.some(f => f.victim === "Cara" && !f.killer));
    check("old log lines before connecting are ignored", a2.kills === 1 && st.feed.length === 2, String(st.feed.length));
    conn.reset();
    st = conn.state();
    check("reset clears kills and the feed", st.feed.length === 0 && st.players.every(p => p.kills === 0 && p.deaths === 0));
  } catch (e) { check("test ran", false, e.message); }
  conn.stop(); server.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp folder */ }
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nMINECRAFT RCON TEST PASS");
  process.exit(failures ? 1 : 0);
});
