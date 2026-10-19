// Flat, named fields for every game: the data behind the vMix / GT Title Designer outputs (JSON, XML, CSV).
// League uses the field names from the St. Clair League HUD (KILLS LEFT, GOLD LEFT, NEXT DRAGON, P1 NAME ...), so titles
// built for it line up. The other games follow the same naming: <WHAT> LEFT / RIGHT for two-sided games, P1..Pn for players.
"use strict";
const path = require("path");
const HUD = require("./public/hud.js");
const league = require("./league.js");

const POSITION = { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 };
const clock = s => { s = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const goldText = n => `${(n / 1000).toFixed(1)}K`;
const SIDES = ["LEFT", "RIGHT"];

// Local images (uploads, the emblem) as a file path for vMix, or as a URL when ?images=url is used.
function assetPath(ctx, p) {
  if (!p || /^https?:\/\//i.test(p)) return p || "";
  if (ctx.images === "url") return `${ctx.base || ""}${p}`;
  if (p.startsWith("/uploads/")) return path.join(ctx.dataDir, p.slice(1));
  if (p.startsWith("/brand/")) return path.join(ctx.appDir, "public", p.slice(1));
  return p;
}

function common(m, ev, game, ctx, f) {
  const l = ev.live;
  f["STATUS"] = game && game.connected ? "LIVE" : "WAITING";
  f["GAME"] = ev.game; f["EVENT NAME"] = ev.name; f["TOURNAMENT"] = ev.tournament.name || "";
  f["SERIES TITLE"] = l.seriesTitle || ""; f["EVENT TITLE"] = l.eventTitle || ""; f["ROUND TITLE"] = l.roundTitle || ""; f["GAME SERIES"] = l.gameSeries || "";
  f["TOURNAMENT LOGO"] = assetPath(ctx, (ev.tournament.logos || []).find(Boolean) || "");
  const need = Math.floor((+l.bestOf || 3) / 2) + 1;
  SIDES.forEach((S, s) => {
    const t = m.sides[s];
    f[`TRI-CODE ${S}`] = t ? t.tag : ""; f[`TEAM NAME ${S}`] = t ? t.name : ""; f[`LOGO ${S}`] = assetPath(ctx, t && t.logos && t.logos[0]);
    f[`COLOR ${S}`] = m.colors[s]; f[`SERIES WINS ${S}`] = m.series[s];
    for (let i = 1; i <= need; i++) f[`BO${l.bestOf} ${i} ${S} WIN`] = m.series[s] >= i ? 1 : 0;
  });
}

function leagueFields(m, ev, game, ctx, f) {
  const o = m.lol || {}, swap = !!ev.live.swap, gs = s => (swap ? 1 - s : s), cfg = ev.lol || {};
  f["TIMER"] = clock(m.clock); f["GAME TIME SECONDS"] = Math.floor(m.clock);
  const gold = [0, 1].map(s => (o.gold ? Math.round(o.gold[gs(s)]) : 0));
  SIDES.forEach((S, s) => {
    const t = gs(s);
    f[`KILLS ${S}`] = o.kills ? o.kills[t] : 0; f[`TURRETS ${S}`] = o.towers ? o.towers[t] : 0;
    f[`GOLD ${S}`] = goldText(gold[s]); f[`GOLD RAW ${S}`] = gold[s];
    f[`VOID GRUB ${S}`] = o.grubs ? o.grubs[t] : 0; f[`DRAGONS ${S}`] = o.dragons ? o.dragons[t].length : 0; f[`DRAGON TYPES ${S}`] = o.dragons ? o.dragons[t].join(",") : "";
    f[`ELDERS ${S}`] = o.elders ? o.elders[t] : 0; f[`HERALDS ${S}`] = o.heralds ? o.heralds[t] : 0; f[`BARONS ${S}`] = o.barons ? o.barons[t] : 0;
    f[`ATAKHANS ${S}`] = o.atakhans ? o.atakhans[t] : 0; f[`INHIBS ${S}`] = o.inhibs ? o.inhibs[t] : 0;
  });
  const diff = gold[0] - gold[1];
  f["GOLD DIFF LEFT"] = diff >= 100 ? "+" + goldText(Math.abs(diff)) : ""; f["GOLD DIFF RIGHT"] = diff <= -100 ? "+" + goldText(Math.abs(diff)) : "";
  const timers = o.timers || {};
  for (const k of ["grubs", "dragon", "herald", "elder", "baron"]) f[`NEXT ${k.toUpperCase()}`] = (timers[k] && timers[k].label) || "";
  f["NEXT DRAGON IS ELDER"] = o.nextDragonIsElder ? 1 : 0;
  for (const b of ["baron", "elder"]) {
    const x = o.buffs && o.buffs[b], side = x ? (swap ? 1 - x.side : x.side) : null;
    f[`${b.toUpperCase()} BUFF SIDE`] = x ? SIDES[side] : ""; f[`${b.toUpperCase()} BUFF TIME`] = x ? clock(x.secs) : "";
  }
  let n = 0;
  for (let s = 0; s < 2; s++) {
    const list = m.players[s].slice().sort((a, b) => (POSITION[a.position] ?? 9) - (POSITION[b.position] ?? 9)).slice(0, 5);
    for (let i = 0; i < 5; i++) {
      const p = list[i]; n++;
      f[`P${n} NAME`] = p ? p.display : ""; f[`P${n} CHAMPION`] = p ? p.champion : "";
      f[`P${n} CHAMPION ICON`] = p && o.ddVersion && p.champKey ? `https://ddragon.leagueoflegends.com/cdn/${o.ddVersion}/img/champion/${p.champKey}.png` : "";
      f[`P${n} LEVEL`] = p ? p.level : ""; f[`P${n} KDA`] = p ? `${p.kills}/${p.deaths}/${p.assists}` : ""; f[`P${n} CS`] = p ? p.cs : "";
      f[`P${n} GOLD`] = p ? goldText(p.gold || 0) : ""; f[`P${n} DEAD`] = p && p.dead ? 1 : 0; f[`P${n} RESPAWN`] = p && p.dead ? p.respawn : "";
    }
  }
  f["FIRST BLOOD SIDE"] = o.firstBlood ? SIDES[swap ? 1 - o.firstBlood.side : o.firstBlood.side] : "";
}

function rocketFields(m, ev, game, ctx, f) {
  f["TIMER"] = clock(m.clock); f["OVERTIME"] = m.ot ? 1 : 0; f["REPLAY"] = m.replay ? 1 : 0; f["ARENA"] = (game && game.arena) || "";
  SIDES.forEach((S, s) => { f[`SCORE ${S}`] = m.score[s]; f[`PLAYERS ALIVE ${S}`] = m.players[s].filter(p => !p.demolished).length; });
  const fo = m.focus;
  f["FOCUS NAME"] = fo ? fo.display : ""; f["FOCUS TEAM"] = fo ? SIDES[fo.side] : ""; f["FOCUS BOOST"] = fo ? fo.boost ?? "" : ""; f["FOCUS SCORE"] = fo ? fo.score : "";
  let n = 0;
  for (let s = 0; s < 2; s++) for (let i = 0; i < 3; i++) {
    const p = m.players[s][i]; n++;
    for (const [k, key] of [["NAME", "display"], ["SCORE", "score"], ["GOALS", "goals"], ["ASSISTS", "assists"], ["SAVES", "saves"], ["SHOTS", "shots"], ["DEMOS", "demos"], ["BOOST", "boost"]])
      f[`P${n} ${k}`] = p ? (p[key] ?? "") : "";
  }
}

function genericFields(m, ev, game, ctx, f) { // games read by screen OCR or entered by hand: scores, the clock, and the series
  f["TIMER"] = clock(m.clock); SIDES.forEach((S, s) => { f[`SCORE ${S}`] = m.score[s]; });
  if (m.kind === "val") {
    const vi = HUD.valInfo(m), names = ctx.agents || {};
    HUD.vetoFix(ev.val && ev.val.veto, ev.val && ev.val.squad).steps.forEach((x, i) => { // the map selection, one row per step
      const who = s => s < 0 ? "DECIDER" : String(((ev.teams.find(t => t.id === (s ? ev.live.right : ev.live.left))) || {}).tag || (s ? "RIGHT" : "LEFT"));
      f[`MAP ${i + 1} NAME`] = x.name || ""; f[`MAP ${i + 1} ACTION`] = x.act === "ban" ? "VETO" : x.act === "pick" ? "PICK" : "DECIDER"; f[`MAP ${i + 1} TEAM`] = who(x.team);
      f[`MAP ${i + 1} SIDE`] = x.side ? `${who(x.by)} ${x.side === "atk" ? "ATTACK" : "DEFENSE"}` : "";
    });
    f["ROUNDS TO WIN"] = vi.target; f["ROUND"] = vi.round; f["TIMER"] = vi.fresh ? clock(m.clock) : ""; // same rules as the scene: the clock only while a screen read is fresh
    SIDES.forEach((S, s) => { f[`PLAYERS LEFT ${S}`] = vi.left[s]; });
    for (let s = 0; s < 2; s++) for (let i = 0; i < 5; i++) { // P1..P5 left team, P6..P10 right team; seats the squad does not use stay empty
      const p = m.players[s][i], real = p && p.shortcut !== 0, n = s * 5 + i + 1;
      f[`P${n} NAME`] = real ? String(p.display || "").replace(/#[^#]*$/, "").trim() : ""; f[`P${n} AGENT`] = real && p.agent ? names[p.agent] || p.agent : ""; f[`P${n} ALIVE`] = real ? (p.pid && vi.dead[p.pid] ? 0 : 1) : "";
      const q = (real && p.pid && ev.val && ev.val.p && ev.val.p[p.pid]) || {}, out = real && p.pid && vi.dead[p.pid]; // the panel numbers the operator typed
      f[`P${n} HP`] = !real ? "" : out ? 0 : q.hp === "" || q.hp == null ? 100 : q.hp; f[`P${n} ULT`] = real ? (q.ult === "" || q.ult == null ? 0 : q.ult) : "";
      f[`P${n} CREDITS`] = real && q.cr != null ? q.cr : ""; f[`P${n} GUN`] = real && q.gun ? (ctx.weapons || {})[q.gun] || "" : "";
    }
  }
  if (m.kind === "dbd") { const d = HUD.dbdScore(ev), last = d.trials[d.trials.length - 1]; f["TRIALS PLAYED"] = d.trials.length; f["KILLER SIDE"] = last ? SIDES[last.killer] : ""; }
  if (m.kind === "fn") { // the leaderboard: RANK 1 NAME, RANK 1 POINTS ... for the top twelve teams
    f["MATCHES PLAYED"] = ((ev.fn && ev.fn.matches) || []).length;
    const L = HUD.fnLive(ev); // the game being played now
    f["PLAYERS LEFT"] = L.alive; f["PLAYERS TOTAL"] = L.max; f["TEAMS LEFT"] = L.teamsLeft; f["TEAMS TOTAL"] = L.teamsMax; f["STORM PHASE"] = L.storm; f["GAME"] = Math.min(L.game, L.games); f["GAMES"] = L.games;
    f["DAMAGE THRESHOLD"] = L.thr.n === "" || L.thr.n == null ? "" : `${L.thr.n} ${L.thr.dir === "below" ? "BELOW" : "ABOVE"}`;
    const ft = ev.teams.find(t => t.id === L.focus.team), fp = ft ? L.named(ft)[+L.focus.p || 0] : null, q = (fp && L.ps[fp.id]) || {};
    f["SPECTATING NAME"] = fp ? String(fp.alias || fp.ign || "").replace(/#[^#]*$/, "").trim() : ""; f["SPECTATING ELIMS"] = fp ? +q.el || 0 : ""; f["SPECTATING HP"] = fp ? (L.dead[fp.id] ? 0 : q.hp === "" || q.hp == null ? 100 : q.hp) : ""; f["SPECTATING SHIELD"] = fp ? (L.dead[fp.id] ? 0 : +q.sh || 0) : "";
    HUD.fnTable(ev).slice(0, 12).forEach((r, i) => { const n = i + 1; f[`RANK ${n} NAME`] = r.team.name; f[`RANK ${n} TAG`] = r.team.tag; f[`RANK ${n} POINTS`] = r.pts; f[`RANK ${n} ELIMS`] = r.elims; f[`RANK ${n} WINS`] = r.wins; });
  }
}

function minecraftFields(m, ev, game, ctx, f) {
  const cfg = ev.mc || {}, rc = m.mc, oc = m.mcOcr && Date.now() - m.mcOcr.t < 6000 ? m.mcOcr : null;
  const roster = new Map(); ev.teams.forEach(t => t.players.forEach(p => p.ign && roster.set(p.ign.toLowerCase(), t)));
  const list = rc ? rc.players.slice() : [];
  const connected = !!(rc && rc.connected), alive = connected ? list.filter(p => p.alive).length : (oc && oc.alive != null ? oc.alive : "");
  const c = cfg.clock || {}, elapsed = oc && oc.clock != null ? oc.clock : (c.base || 0) + (c.running ? (Date.now() - c.startedAt) / 1000 : 0);
  f["MODE"] = cfg.mode === "buildbattle" ? "BUILD BATTLE" : "HUNGER GAMES"; f["TITLE"] = cfg.title || "";
  f["ALIVE"] = alive; f["TOTAL"] = cfg.total || (oc && oc.total) || list.length || ""; f["TIMER"] = clock(elapsed); f["TIMER SECONDS"] = Math.floor(elapsed);
  f["BORDER"] = rc && rc.border != null ? Math.round(rc.border) : oc && oc.border != null ? oc.border : "";
  const top = list.slice().sort((a, b) => b.kills - a.kills)[0];
  f["TOP KILLER"] = top && top.kills ? top.name : ""; f["TOP KILLS"] = top && top.kills ? top.kills : "";
  const last = rc && rc.feed && rc.feed[rc.feed.length - 1];
  f["LAST ELIMINATION KILLER"] = last ? last.killer : ""; f["LAST ELIMINATION VICTIM"] = last ? last.victim : ""; f["LAST ELIMINATION WEAPON"] = last ? last.weapon : "";
  list.slice(0, 32).forEach((p, i) => {
    const n = i + 1, t = roster.get(p.name.toLowerCase());
    f[`T${n} NAME`] = p.name; f[`T${n} TEAM`] = t ? t.tag : ""; f[`T${n} HEALTH`] = p.health ?? ""; f[`T${n} FOOD`] = p.food ?? "";
    f[`T${n} KILLS`] = p.kills; f[`T${n} ALIVE`] = p.alive ? 1 : 0;
  });
  const bb = cfg.bb || {}, rem = oc && oc.clock != null ? oc.clock : (bb.endsAt ? Math.max(0, (bb.endsAt - Date.now()) / 1000) : bb.remaining);
  f["THEME"] = (oc && oc.theme) || bb.theme || ""; f["PHASE"] = (bb.phase || "").toUpperCase(); f["BUILD TIME"] = clock(rem);
  f["JUDGING NAME"] = bb.judging || ""; f["JUDGING SCORE"] = bb.judging && bb.scores && bb.scores[bb.judging] != null ? bb.scores[bb.judging] : "";
  Object.entries(bb.scores || {}).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([name, score], i) => { f[`RANK ${i + 1} NAME`] = name; f[`RANK ${i + 1} SCORE`] = score; });
}

function riftboundFields(m, ev, game, ctx, f) {
  const rb = ev.rb || {}, cards = new Map((rb.cards || []).map(c => [c.id, c])), c = rb.clock || {};
  const elapsed = (c.base || 0) + (c.running ? (Date.now() - c.startedAt) / 1000 : 0), left = Math.max(0, (rb.limitMinutes || 0) * 60 - elapsed);
  f["TIMER"] = clock(rb.limitMinutes ? left : elapsed); f["TURN"] = rb.turn || 1; f["ACTIVE PLAYER"] = SIDES[rb.active || 0]; f["POINTS TO WIN"] = rb.target || "";
  SIDES.forEach((S, s) => {
    f[`PLAYER NAME ${S}`] = (rb.names && rb.names[s]) || (m.sides[s] && m.sides[s].name) || ""; f[`LEGEND ${S}`] = (rb.legends && rb.legends[s]) || "";
    f[`DECK COLOR ${S}`] = (rb.colors && rb.colors[s]) || ""; f[`POINTS ${S}`] = (rb.points && rb.points[s]) || 0; f[`GAMES WON ${S}`] = (rb.games && rb.games[s]) || 0;
    ((rb.play && rb.play[s]) || []).slice(0, 12).forEach((id, i) => { const card = cards.get(id);
      f[`${S} PLAY ${i + 1} NAME`] = card ? card.name : ""; f[`${S} PLAY ${i + 1} IMAGE`] = card ? assetPath(ctx, card.image) : ""; });
  });
  const sp = rb.spotlight && rb.spotlight.show ? cards.get(rb.spotlight.cardId) : null;
  f["SPOTLIGHT SHOW"] = sp ? 1 : 0; f["SPOTLIGHT NAME"] = sp ? sp.name : ""; f["SPOTLIGHT IMAGE"] = sp ? assetPath(ctx, sp.image) : "";
  const log = (rb.log || []).slice(-1)[0], lc = log && cards.get(log.cardId);
  f["LAST PLAY PLAYER"] = log ? SIDES[log.player] : ""; f["LAST PLAY CARD"] = lc ? lc.name : "";
}

// db: the saved data, ev: the on-air event, game: the live game state. ctx: { dataDir, appDir, images, base }
function build(db, ev, game, ctx = {}) {
  if (!ev) return { fields: { STATUS: "WAITING" }, detail: {} };
  const m = HUD.model(ev, game), f = {};
  common(m, ev, game, ctx, f);
  const kind = m.kind;
  if (kind === "lol") leagueFields(m, ev, game, ctx, f);
  else if (kind === "rl") rocketFields(m, ev, game, ctx, f);
  else if (kind === "mc") minecraftFields(m, ev, game, ctx, f);
  else if (kind === "rb") riftboundFields(m, ev, game, ctx, f);
  else genericFields(m, ev, game, ctx, f);
  return { fields: f, detail: { kind, source: game && game.source, connected: !!(game && game.connected), unknownEvents: (game && game.lol && game.lol.unknown) || [] } };
}

/* ---------------------------------------------------------------- formats */
const csvCell = v => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = f => `${Object.keys(f).map(csvCell).join(",")}\r\n${Object.values(f).map(csvCell).join(",")}\r\n`; // a header row and one data row
const xmlName = k => { const n = k.replace(/[^A-Za-z0-9]+/g, "_"); return /^\d/.test(n) ? "_" + n : n; };
const xmlText = v => String(v ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const toXml = f => `<?xml version="1.0" encoding="UTF-8"?>\n<hud>\n${Object.entries(f).map(([k, v]) => `  <${xmlName(k)}>${xmlText(v)}</${xmlName(k)}>`).join("\n")}\n</hud>\n`;

module.exports = { build, toCsv, toXml, xmlName, assetPath };
