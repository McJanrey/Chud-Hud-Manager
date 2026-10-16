// Twitch chat votes: line parsing, vote parsing, and the whole path (fake IRC server -> server -> scores in the event).
const net = require("net"), fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const { parseLine, parseVote } = require("../twitch.js");
let bad = 0;
const ok = (c, m, x = "") => { console.log(`  ${c ? "ok  " : "FAIL"} ${m} ${c ? "" : x}`); if (!c) bad++; };

const l = parseLine("@badge-info=;display-name=Alice;color=#fff :alice!alice@alice.tmi.twitch.tv PRIVMSG #chan :!vote 7");
ok(l && l.user === "alice" && l.name === "Alice" && l.text === "!vote 7", "chat lines are read with their display name", JSON.stringify(l));
ok(parseLine(":x!x@x.tmi.twitch.tv JOIN #chan") === null, "non-chat lines are ignored");
ok([["!7", 7], ["!vote 10", 10], ["!VOTE3", 3], ["!0", 0], ["7", null], ["hello !7", null], ["!vote", null], ["!100", null]].every(([t, v]) => parseVote(t) === v), "vote commands are recognised, plain numbers are not");

(async () => {
  const sent = [];
  const irc = net.createServer(s => {
    s.setEncoding("utf8"); let joined = false;
    s.on("data", d => { if (!joined && d.includes("JOIN #")) { joined = true; s.write(":tmi.twitch.tv 366 justinfan1 #chan :End of /NAMES list\r\n"); sent.push(s); } });
  });
  await new Promise(r => irc.listen(0, "127.0.0.1", r));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "tw-")), P = 7797;
  const srv = spawn("node", ["server.js"], { cwd: path.join(__dirname, ".."), env: Object.assign({}, process.env,
    { SAINTS_DATA: data, PORT: P, CAM_PORT: 7798, TWITCH_IRC_HOST: "127.0.0.1", TWITCH_IRC_PORT: irc.address().port, TWITCH_IRC_TLS: "0" }) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const J = (u, o) => fetch("http://127.0.0.1:" + P + u, o).then(r => r.json());
  const post = (u, b) => J(u, { method: "POST", body: JSON.stringify(b) });
  await wait(2500);
  try {
    const st = await J("/api/state");
    const ev = st.db.events.find(e => e.mc && e.mc.mode === "buildbattle");
    ok(!!ev, "a Build Battle event exists");
    ok(ev.mc.bb.audience && ev.mc.bb.judges && ev.mc.poll, "judges, audience and poll fields exist");
    await post("/api/set", { event: ev.id, path: "mc.bb.judging", value: "Steve" });
    ok((await post("/api/chat/connect", { channel: "badchannel!!" })).error, "a bad channel name is refused");
    await post("/api/chat/connect", { channel: "saintsesports" });
    await wait(800);
    ok((await J("/api/chat/status")).connected, "connected to chat");
    const say = (u, t) => sent[0].write(`@display-name=${u} :${u.toLowerCase()}!${u.toLowerCase()}@x.tmi.twitch.tv PRIVMSG #saintsesports :${t}\r\n`);
    say("Early", "!9"); await wait(300);
    await post("/api/chat/open", { event: ev.id, mode: "score", open: true });
    say("A", "!8"); say("B", "!vote 10"); say("C", "!6"); say("C", "!4"); say("D", "!11"); say("E", "nice build"); say("F", "!2");
    await wait(1600);
    let e2 = (await J("/api/state")).db.events.find(e => e.id === ev.id);
    const a = e2.mc.bb.audience.scores.Steve;
    ok(a && a.count === 4 && a.avg === 6, "votes average (one per viewer, last wins, out of range and plain text ignored)", JSON.stringify(a));
    await post("/api/chat/open", { event: ev.id, mode: "score", open: false });
    say("G", "!10"); await wait(1300);
    e2 = (await J("/api/state")).db.events.find(e => e.id === ev.id);
    ok(e2.mc.bb.audience.scores.Steve.count === 4, "votes after closing are ignored");
    // poll
    await post("/api/set", { event: ev.id, path: "mc.poll", value: { question: "Next theme?", options: ["Castle", "Space", "Farm"], open: false, show: true, counts: [0, 0, 0], total: 0 } });
    await post("/api/chat/open", { event: ev.id, mode: "poll", open: true });
    say("H", "!1"); say("I", "!2"); say("J", "!2"); say("K", "!4"); say("L", "!0"); await wait(1600);
    e2 = (await J("/api/state")).db.events.find(e => e.id === ev.id);
    ok(JSON.stringify(e2.mc.poll.counts) === "[1,2,0]" && e2.mc.poll.total === 3, "poll counts per option, ignoring options that do not exist", JSON.stringify(e2.mc.poll));
    await post("/api/chat/clear", { event: ev.id, mode: "poll" });
    e2 = (await J("/api/state")).db.events.find(e => e.id === ev.id);
    ok(e2.mc.poll.total === 0, "clearing resets the poll");
    ok((await post("/api/chat/open", { event: "nope", mode: "score", open: true })).error, "an unknown event is refused (votes never land on the on-air fallback)");
    // final score mixing
    const { bbScore } = require("../public/hud.js");
    const bb = { judges: [{ id: "a", name: "A", kind: "caster" }, { id: "b", name: "B", kind: "player" }], judgeScores: { "a~Steve": 8, "b~Steve": 6 }, scores: {}, audience: { weight: 50, scores: { Steve: { avg: 10, count: 5 } } } };
    ok(bbScore(bb, "Steve").v === 8.5, "judges average mixes with chat by weight", bbScore(bb, "Steve").v);
    bb.audience.weight = 0; ok(bbScore(bb, "Steve").v === 7, "weight 0 means judges only");
    bb.scores.Steve = 9.5; ok(bbScore(bb, "Steve").v === 9.5, "a typed score overrides");
  } catch (e) { ok(false, "test ran", e.message); }
  srv.kill(); irc.close();
  console.log(bad ? `\n${bad} CHECK(S) FAILED` : "\nTWITCH TEST PASS");
  process.exit(bad ? 1 : 0);
})();
