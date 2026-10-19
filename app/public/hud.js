// Shared HUD renderer for the dashboard previews and the OBS overlay.
(function () {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = s => { s = Math.max(0, Math.floor(+s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }; // whole seconds: the Minecraft and Riftbound clocks are fractional
  const low = s => String(s || "").toLowerCase().trim();
  /* Names read from a screen are rarely perfect ("Jazii" as "Jaz1i", a team tag in front). Exact matches always win; this only
     decides when there isn't one. Digits must agree, and short names must match exactly, so "Player1" never becomes "Player2". */
  const nrm = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
    .replace(/[01|!5$84il]/g, c => ({ "0": "o", "1": "l", "|": "l", "!": "l", "i": "l", "5": "s", "$": "s", "8": "b", "4": "a" }[c]));
  function sim(a, b) {
    if (a === b) return 1; const n = a.length, m = b.length; if (!n || !m) return 0;
    let prev = Array.from({ length: m + 1 }, (_, j) => j);
    for (let i = 1; i <= n; i++) { const cur = [i]; for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return 1 - prev[m] / Math.max(n, m);
  }
  function nameMatch(a, b) {
    if (low(a) === low(b)) return !!low(a);
    const x = nrm(a), y = nrm(b); if (!x || !y) return false;
    const da = String(a).replace(/\D/g, ""), db = String(b).replace(/\D/g, ""); if (da && db && da !== db) return false; // Player1 is not Player2
    if (x === y) return true;
    const lo = Math.min(x.length, y.length);
    if (lo >= 3 && (x.endsWith(y) || y.endsWith(x)) && Math.abs(x.length - y.length) <= 4) return true; // a team tag in front: "G2 valyn"
    return lo >= 5 && sim(x, y) >= 0.85;
  }
  const pickName = (list, name) => list.find(p => low(p.ign) === low(name)) || list.find(p => nameMatch(p.ign, name));


  /* Our own cameras (cams.js): rooms whose player has their camera page open right now. Polled, because the overlay
     is a plain web page; a tile only appears while that player is live, so nobody gets an empty box. */
  const camLive = {};
  if (typeof location !== "undefined" && /^https?:$/.test(location.protocol) && typeof fetch === "function") {
    const poll = () => fetch("/api/cam/status").then(r => r.json()).then(st => {
      Object.keys(camLive).forEach(k => delete camLive[k]);
      Object.entries(st || {}).forEach(([k, v]) => { if (v && v.live) camLive[k] = 1; });
    }).catch(() => {});
    poll(); setInterval(poll, 2000);
  }
  const ownCam = (ev, key) => ev.camera && ev.camera.own !== false && camLive[ev.id + "." + key] ? "/camview?r=" + encodeURIComponent(ev.id + "." + key) : "";

  const SCENES = {
    ingame: "Ingame HUD", bracket: "Bracket", casters: "Caster Nameplates", lowerthird: "Lower Thirds",
    rankings: "Rankings Screen", replay: "Replay", schedule: "Schedule", starting: "Starting Soon",
    statsplayer: "Stats Page Individual", statsteam: "Stats Page Team", lineup: "Team Lineup", timer: "Timer", title: "Title Screen", draft: "Champion Select",
  };

  /* Combine event config with the live game feed into one view model. */
  function model(ev, game) {
    const l = ev.live, sw = !!l.swap;
    const byId = id => ev.teams.find(t => t.id === id);
    const tn = s => (sw ? 1 - s : s); // HUD side -> game team number
    const sideOfTeam = t => (sw ? 1 - t : t);
    const live = !!(game && game.players && game.players.length);
    const hasScore = !!(game && game.scoreLive), hasClock = !!(game && game.clockLive);
    const sides = [byId(l.left), byId(l.right)], tracked = [false, false];
    if (l.autoTeams && !live && game && game.source === "ocr") { // OCR gives team names only: match them to the event's teams
      [0, 1].forEach(s => {
        const nm = low(game.teams[tn(s)] && game.teams[tn(s)].name);
        const t = nm && ev.teams.find(x => low(x.name) === nm || low(x.tag) === nm || (nm.length > 3 && (low(x.name).includes(nm) || nm.includes(low(x.name)))));
        if (t) { sides[s] = t; tracked[s] = true; }
      });
    }
    if (l.autoTeams && live) {
      [0, 1].forEach(s => {
        const names = game.players.filter(p => p.team === tn(s)).map(p => low(p.name));
        let best = null, bn = 0;
        ev.teams.forEach(t => { const n = t.players.filter(p => names.some(nm => nameMatch(p.ign, nm))).length; if (n > bn) { bn = n; best = t; } });
        if (best) { sides[s] = best; tracked[s] = true; }
      });
    }
    const kind = GAMEDEF[ev.game] ? GAMEDEF[ev.game].kind : live && game.kind ? game.kind : ev.game === "League of Legends" ? "lol" : ev.game === "Minecraft" ? "mc" : ev.game === "Riftbound" ? "rb" : ev.game === "Rocket League" ? "rl" : "gen";
    const size = kind === "lol" ? 5 : (GAMEDEF[ev.game] && GAMEDEF[ev.game].squad) || 3;
    const roster = (t, name) => t && pickName(t.players, name);
    const blank = { score: 0, goals: 0, shots: 0, assists: 0, saves: 0, demos: 0, touches: 0, boost: 0, kills: 0, deaths: 0, cs: 0, level: 1, ward: 0 };
    const players = [0, 1].map(s => {
      const t = sides[s];
      let list = live
        ? game.players.filter(p => p.team === tn(s)).sort((a, b) => a.shortcut - b.shortcut).slice(0, size === 5 ? 5 : 4)
        : (t ? t.players.slice(0, size) : []).map((p, i) => Object.assign({ name: p.ign, shortcut: i + 1 + s * size, _r: p }, blank));
      while (list.length < size && !live) list.push(Object.assign({ name: `Player ${list.length + 1}`, shortcut: 0 }, blank));
      return list.map(p => {
        const r = p._r || roster(t, p.name);
        return Object.assign({}, blank, p, { _r: undefined, display: (r && (r.alias || r.ign)) || p.name, side: s, team: t,
          avatar: r ? r.avatar : "", country: r ? r.country : "", cam: r ? r.cam : "", pid: r ? r.id : "" });
      });
    });
    const all = players[0].concat(players[1]);
    const find = w => w && all.find(p => (w.shortcut && p.shortcut === w.shortcut) || low(p.name) === low(w.name));
    // who is in the action on each side: the player in the latest kill, goal or demolition of the last 12 seconds (null when none)
    const nowT = Date.now(), hit = [0, 1].map(s => (game && game.feed || []).slice().reverse().find(f => nowT - f.t < 12000 && f.main && f.main.team >= 0 && sideOfTeam(f.main.team) === s && /^(kill|multi|goal|demo|fb|ace)/.test(f.type)));
    const action = hit.map((it, s) => { const p = it && find(it.main); const i = p ? players[s].indexOf(p) : -1; return i >= 0 ? i : null; });
    const topS = [0, 1].filter(s => action[s] != null).sort((a, b) => hit[b].t - hit[a].t)[0]; // the most recent of the two sides (League's focus panel)
    const actionLast = topS != null ? { side: topS, i: action[topS] } : null;
    const score = kind === "dbd" ? dbdScore(ev).total : l.autoScore && (live || hasScore) ? [game.teams[tn(0)].score, game.teams[tn(1)].score] : l.score;
    const colors = ev.hud.colorMode === "custom" ? ev.hud.custom : [sides[0] ? sides[0].color : "#2f7dff", sides[1] ? sides[1].color : "#ff9b1a"];
    const feed = (game && game.feed || []).filter(f => Date.now() - f.t < 9000).slice(-4).map(f => ({
      type: f.type, label: f.type === "goal" ? "GOAL" : f.label || f.type, main: find(f.main) || f.main, second: find(f.second) || f.second,
      side: f.main && f.main.team >= 0 ? sideOfTeam(f.main.team) : 0, text: f.text || "", id: f.id }));
    let goal = null;
    if (game && game.lastGoal && Date.now() - game.lastGoal.t < 5500 && game.lastGoal.team >= 0) {
      const g = game.lastGoal;
      goal = { side: sideOfTeam(g.team), scorer: find(g.scorer) || g.scorer, assister: find(g.assister) || g.assister, kmh: g.kmh };
    }
    const lastGoal = game && game.lastGoal ? { side: sideOfTeam(game.lastGoal.team), scorer: find(game.lastGoal.scorer) || game.lastGoal.scorer,
      assister: find(game.lastGoal.assister) || game.lastGoal.assister, kmh: game.lastGoal.kmh } : null;
    const mvp = all.slice().sort((a, b) => b.score - a.score)[0];
    return {
      ev, live, kind, lol: game && game.lol, mc: game && game.mc, mcOcr: game && game.mcOcr, sides, tracked, players, all, score, colors, feed, goal, lastGoal, mvp,
      series: l.series, focus: live ? find(game.target) : null, action, actionLast,
      clock: live || hasClock ? game.time : 300, clockLive: live || hasClock, ot: !!(game && game.overtime), replay: !!(game && game.replay), podium: !!(game && game.podium),
      connected: !!(game && game.connected), source: game ? game.source : "",
    };
  }

  const lg = (t, cls = "lgbox") => `<div class="${cls}">${!t ? `<div class="lg" style="background:#2a2b31">?</div>`
    : t.logos && t.logos[0] ? `<img class="lg" src="${esc(t.logos[0])}" alt="">`
    : `<svg class="lg" viewBox="0 0 100 100" style="background:${esc(t.color)}"><text x="50" y="52" text-anchor="middle" dominant-baseline="central" fill="currentColor" font-size="${[0, 60, 54, 46, 36, 30][Math.min(5, Math.max(1, (t.tag || "?").slice(0, 5).length))]}">${esc((t.tag || "?").slice(0, 5))}</text></svg>`}</div>`;
  const tourLogo = ev => (ev.tournament.logos || []).find(Boolean) || "/brand/chud-hud.png"; // the app's logo until the tournament has its own
  const sideTeam = (ev, id) => ev.teams.find(t => t.id === id);

  /* ---------------- scenes: each returns { html, cams } ---------------- */
  const camUrlOf = (ev, p) => (p && (p.cam || (p.pid ? ownCam(ev, p.pid) : ""))) || "";
  /* Player webcams. "all": one slot per player down both edges (3 a side in Rocket League, 5 in League). "action": only the player
     in the action shows, big, in the bottom corner of their team's side, and every camera stays loaded so a switch is instant.
     A slot only shows when that player has a camera link or a live camera page. */
  function playerCams(m, top) {
    if ((m.ev.camera || {}).director === "action") return actionCams(m);
    const w = 150, camH = 84, pitch = 111, cams = []; let html = "";
    [0, 1].forEach(s => m.players[s].forEach((p, i) => {
      const camUrl = camUrlOf(m.ev, p);
      if (!camUrl) return;
      const x = s ? 1280 - 8 - w : 8, y = top + i * pitch;
      html += `<div class="pc ${s ? "r" : "l"}" style="left:${x}px;top:${y}px;--c:${esc(m.colors[s])}"><span>${esc(p.display)}</span></div>`;
      cams.push({ key: "pc-" + s + "-" + i + camUrl, url: camUrl, x, y, w, h: camH });
    }));
    return { html, cams };
  }
  /* who is in the action for a side: the player you pinned, else the player in the latest kill or goal of the last 12 seconds,
     else the spectated player, else the first with a camera. The same data gives the same answer on every screen. */
  function actionIndex(m, s) {
    const list = m.players[s], pin = +(((m.ev.camera || {}).pin || [])[s]) || 0;
    if (pin >= 1 && camUrlOf(m.ev, list[pin - 1])) return pin - 1;
    const a = m.action && m.action[s]; if (a != null && a >= 0 && camUrlOf(m.ev, list[a])) return a;
    if (m.focus && m.focus.side === s) { const i = list.indexOf(m.focus); if (i >= 0 && camUrlOf(m.ev, list[i])) return i; }
    return list.findIndex(p => camUrlOf(m.ev, p));
  }
  function actionCams(m) {
    const w = 240, h = 135, y = 455, cams = []; let html = "";
    [0, 1].forEach(s => {
      const x = s ? 1280 - 8 - w : 8, act = actionIndex(m, s);
      m.players[s].forEach((p, i) => { const u = camUrlOf(m.ev, p); if (u) cams.push({ key: "ac-" + s + "-" + i + u, url: u, x, y, w, h, show: i === act }); });
      const p = act >= 0 ? m.players[s][act] : null;
      if (p) html += `<div class="pc act ${s ? "r" : "l"}" data-k="ac-${s}" style="left:${x}px;top:${y + h}px;width:${w}px;--c:${esc(m.colors[s])}"><span>${esc(p.display)}</span></div>`;
    });
    return { html, cams };
  }
  /* Fortnite has a field of teams, not two sides: the cameras of one team (the one you pick, else the leader) down the left edge */
  function fnCams(ev, rows) {
    const f = ev.fn || {}, team = ev.teams.find(t => t.id === f.spotlight) || (rows[0] && rows[0].team), cams = []; let html = "";
    if (!team) return { html, cams };
    team.players.forEach((p, i) => {
      const u = p.cam || ownCam(ev, p.id); if (!u) return;
      const x = 8, y = 330 + i * 111;
      html += `<div class="pc l" style="left:${x}px;top:${y}px;--c:${esc(team.color)}"><span>${esc(p.alias || p.ign || team.name)}</span></div>`;
      cams.push({ key: "pc-fn-" + i + u, url: u, x, y, w: 150, h: 84 });
    });
    return { html, cams };
  }

  const S = {};
  S.ingame = (m) => {
    const ev = m.ev, l = ev.live, sh = ev.hud.show, [L, R] = m.sides;
    const sponsors = ev.tournament.sponsors.map(x => x.name).filter(Boolean);
    const tick = [l.seriesTitle, l.eventTitle, l.roundTitle, ...sponsors].filter(Boolean).join("  |  ") || ev.name;
    const row = p => `<div class="h-row${m.focus === p ? " f" : ""}${p.demolished ? " dead" : ""}"><span class="nm">${esc(p.display)}</span><b class="num">${p.demolished ? "DEMO" : p.boost ?? ""}</b><div class="bar" style="width:${p.boost || 0}%"></div></div>`;
    const f = m.focus, fc = f ? m.colors[f.side] : "#888";
    const sum = (k, s) => m.players[s].reduce((a, x) => a + (x[k] || 0), 0);
    const arc = 245 * 58 / 52, tl = tourLogo(ev);
    let h = "", cams = [];
    if (sh.score) h += `<div class="h-tick"><span>${esc(tick)}  |  ${esc(tick)}  |  </span></div>
      <div class="h-bug"><div class="h-team l">${lg(L)}<span class="tn${L && L.name.length > 13 ? " long" : ""}">${esc(L ? L.name : "Blue")}</span><span class="gs num">${m.score[0]}</span></div>
      <div class="h-mid">${tl ? `<div class="lgbox"><img class="lg" src="${esc(tl)}" alt=""></div>` : `<span style="font-size:22px;color:#9a9ba3">${esc(ev.tournament.name || "VS")}</span>`}</div>
      <div class="h-team r">${lg(R)}<span class="tn${R && R.name.length > 13 ? " long" : ""}">${esc(R ? R.name : "Orange")}</span><span class="gs num">${m.score[1]}</span></div></div>
      <div class="h-series"><div class="ss l num">${m.series[0]}</div><div class="clk${m.ot ? " ot" : ""}"><b class="num">${m.ot ? "+" : ""}${fmt(m.clock)}</b><small>${esc(l.gameSeries || "BEST OF " + l.bestOf)}</small></div><div class="ss r num">${m.series[1]}</div></div>`;
    if (sh.boost) h += `<div class="h-boost l">${m.players[0].map(row).join("")}</div><div class="h-boost r">${m.players[1].map(row).join("")}</div>`;
    if (sh.stats) h += `<div class="h-stats">${[["shots", "SHOTS"], ["saves", "SAVES"], ["demos", "DEMOS"]].map(([k, n]) => `<div><b class="num">${sum(k, 0)}</b><span>${n}</span><b class="num">${sum(k, 1)}</b></div>`).join("")}</div>`;
    if (sh.feed && m.feed.length) h += `<div class="h-feed" style="top:${sh.boost ? 160 : 20}px${sh.playerCam ? ";right:170px" : ""}">${m.feed.map(x => `<div><span style="color:${m.colors[x.side]}">${esc(x.main ? x.main.display || x.main.name : "")}</span><i>${esc(x.label)}</i>${x.second ? `<span style="color:${m.colors[1 - x.side]}">${esc(x.second.display || x.second.name)}</span>` : ""}</div>`).join("")}</div>`;
    if (sh.card && f) {
      h += `<div class="h-card" style="--c:${fc}">${lg(f.team)}<div class="who"><b>${esc(f.display)}</b><small>${esc(f.team ? f.team.tag : "")}${f.supersonic ? " · SUPERSONIC" : ""}</small></div><div class="st">${[["score", "SCORE"], ["goals", "GOALS"], ["assists", "ASSISTS"], ["saves", "SAVES"], ["shots", "SHOTS"]].map(([k, n]) => `<div><b class="num">${f[k] || 0}</b><small>${n}</small></div>`).join("")}</div>${f.avatar ? `<img class="cut" src="${esc(f.avatar)}" alt="">` : ""}</div>
      <div class="h-gauge"><svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="58" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="9" stroke-dasharray="${arc} 999"/><circle cx="70" cy="70" r="58" fill="none" stroke="${fc}" stroke-width="9" stroke-dasharray="${arc * (f.boost || 0) / 100} 999"/></svg><b class="num">${f.boost ?? 0}</b><small>BOOST</small></div>`;
    }
    if (sh.playerCam) { const pc = playerCams(m, 150); h += pc.html; cams.push(...pc.cams); }
    if (m.ev.hud.show.goal && m.goal && !m.replay) {
      const g = m.goal;
      h += `<div class="h-goal" style="--c:${m.colors[g.side]}"><b>GOAL</b><div><span>SCORED BY</span>${esc(g.scorer ? g.scorer.display || g.scorer.name : "")}${g.assister ? `<span>ASSIST</span>${esc(g.assister.display || g.assister.name)}` : ""}<span>${g.kmh} KM/H</span></div></div>`;
    }
    return { html: h, cams };
  };
  S.replay = (m) => {
    const g = m.lastGoal, c = g ? m.colors[g.side] : "#888";
    return { html: `<div class="h-replay" style="--c:${c}"><div class="tag">REPLAY</div>${g ? `<div class="info">
      <div><small>SCORED BY</small>${esc(g.scorer ? g.scorer.display || g.scorer.name : "-")}</div>
      ${g.assister ? `<div><small>ASSIST</small>${esc(g.assister.display || g.assister.name)}</div>` : ""}
      <div><small>BALL SPEED</small>${g.kmh} KM/H</div></div>` : ""}</div>`, cams: [] };
  };
  S.starting = (m) => {
    const l = m.ev.live, [L, R] = m.sides;
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(l.seriesTitle || m.ev.tournament.name || m.ev.name)}</div><div class="h-title">STARTING SOON</div>
    <div class="h-vs"><div class="t">${lg(L)}<b>${esc(L ? L.name : "TBD")}</b></div><div class="v">VS</div><div class="t">${lg(R)}<b>${esc(R ? R.name : "TBD")}</b></div></div>
    <div class="h-strip">${esc([l.eventTitle, l.roundTitle, l.gameSeries].filter(Boolean).join("  ·  "))}</div></div>`, cams: [] };
  };
  S.title = (m) => {
    const ev = m.ev, tl = tourLogo(ev);
    return { html: `<div class="h-full">${tl ? `<div class="h-big-logo"><img class="lg" src="${esc(tl)}" alt=""></div>` : ""}
    <div class="h-title">${esc(ev.live.seriesTitle || ev.tournament.name || ev.name)}</div>
    <div class="h-eyebrow">${esc([ev.tournament.region, ev.tournament.format, ev.organiser].filter(Boolean).join("  ·  "))}</div></div>`, cams: [] };
  };
  /* Caster nameplates: small slanted plates that sit over the broadcast. Each one has a position that is dragged in the HUD Editor
     preview (seat.x and seat.y on the 1280x720 stage). How many show is the kit's seat count. A seat with a camera link also gets the
     camera above its plate. */
  S.casters = (m) => {
    const ev = m.ev, kit = (CTX.kits || {})[ev.kit], n = Math.max(1, Math.min(8, Math.round(+(kit && kit.seats) || { solo: 1, duo: 2, trio: 3 }[ev.camera.layout] || 2)));
    const cams = []; let html = "";
    ev.camera.seats.slice(0, n).forEach((s, i) => {
      const t = ev.talent.find(x => x.id === s.talent), social = t && t.socials && t.socials[0] && t.socials[0].h ? t.socials[0].p + "/" + t.socials[0].h : "";
      const x = s.x != null ? s.x : 150 + (i % 4) * 250, y = s.y != null ? s.y : 560 + Math.floor(i / 4) * 80;
      const sub = [s.role || (t && t.role) || "", social].filter(Boolean).join(" | ");
      html += `<div class="np" data-i="${i}" style="left:${x}px;top:${y}px"><i class="sh"></i><div class="bd"><b>${esc(t ? t.name : "Caster " + (i + 1))}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div></div>`;
      const seatUrl = s.url || ownCam(ev, "seat" + i);
      if (seatUrl) cams.push({ key: "seat" + i + seatUrl, url: seatUrl, x, y: Math.max(0, y - 150), w: 256, h: 144 });
    });
    return { html, cams };
  };
  S.lowerthird = (m) => {
    const x = m.ev.lowerThird;
    return { html: x.title ? `<div class="h-l3"><b>${esc(x.title)}</b>${x.subtitle ? `<span>${esc(x.subtitle)}</span>` : ""}</div>` : "", cams: [] };
  };
  const COLS = {
    rl: [["score", "SCORE"], ["goals", "GOALS"], ["assists", "ASSISTS"], ["saves", "SAVES"], ["shots", "SHOTS"], ["demos", "DEMOS"]],
    lol: [["kills", "KILLS"], ["deaths", "DEATHS"], ["assists", "ASSISTS"], ["cs", "CS"], ["level", "LEVEL"], ["ward", "VISION"]],
  };
  S.statsteam = (m) => {
    const [L, R] = m.sides, cols = COLS[m.kind] || COLS.rl, lol = m.kind === "lol";
    const r = (p, c) => `<tr class="${c}"><td>${esc(p.display)}${lol && p.champion ? ` <span style="color:#9a9ba3;font-size:20px">${esc(p.champion)}</span>` : ""}</td>${cols.map(([k]) => `<td class="num">${p[k] || 0}</td>`).join("")}</tr>`;
    return { html: `<div class="h-full"><div style="display:flex;align-items:center;gap:30px;font-size:52px">${lg(L, "lgbox h-l")}<span class="num">${esc(L ? L.tag : lol ? "BLUE" : "BLU")} ${m.score[0]} – ${m.score[1]} ${esc(R ? R.tag : lol ? "RED" : "ORG")}</span>${lg(R, "lgbox h-l")}</div>
    ${lol ? `<div class="h-eyebrow" style="font-size:22px">${m.live ? "TEAM KILLS · " + fmt(m.clock) : "TEAM KILLS"}</div>` : ""}
    <table class="h-table" style="width:${lol ? 1040 : 960}px;font-size:${lol ? 23 : 26}px"><thead><tr><th>PLAYER</th>${cols.map(([, n]) => `<th>${n}</th>`).join("")}</tr></thead>
    <tbody>${m.players[0].map(p => r(p, "l")).join("")}<tr class="sep"><td colspan="7"></td></tr>${m.players[1].map(p => r(p, "r")).join("")}</tbody></table></div>`.replace(/lgbox h-l"/g, 'lgbox" style="width:76px;height:76px"'), cams: [] };
  };
  const DRAKE = { Infernal: "#ff6b3d", Ocean: "#3dbbff", Mountain: "#b5835a", Cloud: "#d9e6f2", Hextech: "#3de0d0", Chemtech: "#8fd14f", Elder: "#b48cff" };
  /* ---------------- League of Legends in-game scene (laid out like the Worlds broadcast; classes l3-*, look in hud.css variables) ----------------
     Top: a two-row score bar and the two soonest objective timers. Bottom band (y 547-720): focus panel and sponsor box on the left, one big
     camera per team either side of the board, the board in the middle, a transparent minimap frame on the right. Riot's spectator data has no
     HP, mana, experience or gold, so none of those are invented: gold is the app's estimate (marked EST) and a bar only renders if a player
     object ever carries hp / mp / xp. */
  function lolCams(m) { // one big camera per team: same choice and keys as actionCams, but its own boxes in the band (y is relative to the band)
    const w = 117, h = 147, cams = []; let html = "";
    [0, 1].forEach(s => {
      const x = s ? 970 : 150, act = actionIndex(m, s);
      m.players[s].forEach((p, i) => { const u = camUrlOf(m.ev, p); if (u) cams.push({ key: "ac-" + s + "-" + i + u, url: u, x, y: 547, w, h, show: i === act }); });
      const p = act >= 0 ? m.players[s][act] : null;
      if (p) html += `<div class="l3-cam ${s ? "r" : "l"}" data-k="cam-${s}" style="left:${x}px;--c:${esc(m.colors[s])}"><span>${esc(p.display)}</span></div>`;
    });
    return { html, cams };
  }
  S.lolingame = (m) => {
    const ev = m.ev, l = ev.live, sh = ev.hud.show, [L, R] = m.sides;
    const o = m.lol || { ddVersion: "", counters: { dragons: true, heralds: true, grubs: true }, timers: {}, buffs: {} };
    const icon = p => o.ddVersion && p.champKey ? `<img src="/ddragon/cdn/${esc(o.ddVersion)}/img/champion/${encodeURIComponent(p.champKey)}.png" alt="">`
      : `<span>${esc(String(p.champion || p.display || "?").slice(0, 2))}</span>`;
    // objective counts are stored per game side (0 = blue); the HUD's left/right may be swapped
    const gs = s => (l.swap ? 1 - s : s);
    const K = n => (Math.max(0, +n || 0) / 1000).toFixed(1) + "K"; // gold is always shown as 12.0K, 0.5K (never NaNK)
    const kills = [0, 1].map(s => (o.kills ? o.kills[gs(s)] : m.players[s].reduce((a, p) => a + (p.kills || 0), 0)));
    const gold = [0, 1].map(s => (o.gold ? Math.round(o.gold[gs(s)]) : m.players[s].reduce((a, p) => a + (p.gold || 0), 0)));
    const est = (o.goldMode || (ev.lol && ev.lol.goldMode) || "estimate") === "estimate"; // only the estimate gets the EST mark
    const ICON = {
      coin: `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="9" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="2.2"/></svg>`,
      tower: `<svg viewBox="0 0 24 24"><path d="M6 21V10h2V6h2v2h4V6h2v4h2v11zM10 21v-5h4v5" fill="currentColor"/></svg>`,
      drake: `<svg viewBox="0 0 24 24"><path d="M12 2 21 12 12 22 3 12z" fill="currentColor"/></svg>`,
      grub: `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8" ry="5.5" fill="currentColor"/><path d="M9 7v10M12.5 6.5v11M16 7.5v9" stroke="#07120e" stroke-width="1.4"/></svg>`,
      herald: `<svg viewBox="0 0 24 24"><path d="M2 12c3-5 7-7 10-7s7 2 10 7c-3 5-7 7-10 7S5 17 2 12z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>`,
    };
    ICON.elder = ICON.drake; ICON.baron = `<i>B</i>`;
    const EYE = `<svg viewBox="0 0 24 24"><path d="M2 12c3-5 7-7 10-7s7 2 10 7c-3 5-7 7-10 7S5 17 2 12z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;
    // Official objective icons are downloaded automatically (server.js); the shapes above are the fallback.
    const OI = k => (CTX.icons && CTX.icons[k] ? `<img class="oi" src="${esc(CTX.icons[k])}" alt="">` : "");
    const ic = (k, fallback) => OI(k) || fallback;
    const cnt = (k, s) => (o[k] ? o[k][gs(s)] : 0) || 0;
    let h = "";

    // --- top left: the two soonest objective timers (the per-timer switches in the League settings still apply)
    if (sh.stats) {
      const chips = [["dragon", "drake"], ["grubs", "grub"], ["herald", "herald"], ["elder", "elder"], ["baron", "baron"]].map(([k, cls]) => { const t = (o.timers || {})[k]; return t && t.label ? { k, cls, t } : null; })
        .filter(Boolean).sort((a, b) => (a.t.secs == null ? 1e9 : a.t.secs) - (b.t.secs == null ? 1e9 : b.t.secs)).slice(0, 2);
      if (chips.length) h += `<div class="l3-timers" data-k="l3-timers">${chips.map(({ k, cls, t }) => `<div class="l3-t ${cls}" data-k="tm-${k}">${ic(k, ICON[cls])}<b class="${t.label === "LIVE" ? "up" : "num"}">${t.label}</b></div>`).join("")}</div>`;
    }

    // --- top bar: row 1 = [team][towers][gold][kills][tournament logo][kills][gold][towers][team], row 2 = objectives and the clock
    const need = Math.floor((+l.bestOf || 3) / 2) + 1;
    const pipsOf = s => `<span class="pips">${Array.from({ length: need }, (_, i) => `<i class="${m.series[s] > i ? "on" : ""}"></i>`).join("")}</span>`;
    const teamCell = (t, s) => `<div class="l3-team ${s ? "r" : "l"}" data-k="l3-team-${s}"><i class="edge"></i>${lg(t)}<div class="tx"><b class="tg">${esc(t ? t.tag : s ? "RED" : "BLUE")}</b>${t && String(t.seed || "").trim() ? `<small>${esc(String(t.seed).trim())}</small>` : ""}</div>${pipsOf(s)}</div>`;
    const twCell = s => `<div class="l3-tw ${s ? "r" : "l"}" data-k="l3-tw-${s}">${ic("tower", ICON.tower)}<b class="num">${cnt("towers", s)}</b></div>`;
    const gdCell = s => `<div class="l3-gd ${s ? "r" : "l"}" data-k="l3-gd-${s}"><span class="g">${ICON.coin}<b class="num">${K(gold[s])}</b></span>${est ? `<em class="est">EST</em>` : ""}</div>`;
    const klCell = s => `<div class="l3-kl ${s ? "r" : "l"}" data-k="l3-kl-${s}"><b class="num">${+kills[s] || 0}</b></div>`;
    const objs = (s, right) => { const t = gs(s), C = o.counters || {}, drag = (o.dragons && o.dragons[t]) || [];
      return `<div class="l3-ob${right ? " r" : ""}" data-k="l3-ob-${s}">`
        + (C.grubs !== false ? `<span>${ic("grubs", ICON.grub)}<b class="num">${cnt("grubs", s)}</b></span>` : "")
        + (C.heralds !== false ? `<span>${ic("herald", ICON.herald)}<b class="num">${cnt("heralds", s)}</b></span>` : "")
        + (C.dragons !== false ? `<span class="drk">${drag.slice(0, 4).map(d => ic(d.toLowerCase(), `<i style="color:${DRAKE[d] || "#888"}">${ICON.drake}</i>`)).join("")}${cnt("elders", s) ? ic("elder", `<i style="color:${DRAKE.Elder}">${ICON.drake}</i>`) : ""}</span>` : "")
        + (cnt("barons", s) ? `<span class="bn">B<b class="num">${cnt("barons", s)}</b></span>` : "") + `</div>`; };
    const NOTE = { dragon: 1, baron: 1, herald: 1, tower: 1, inhib: 1, ace: 1, fb: 1, multi: 1 };
    const note = m.feed.slice().reverse().find(x => NOTE[x.type]);
    if (sh.score) h += `<div class="l3-bar" data-k="l3-bar"><div class="rw1">${teamCell(L, 0)}${twCell(0)}${gdCell(0)}${klCell(0)}<div class="l3-logo"><div class="lgbox"><img class="lg" src="${esc(tourLogo(ev))}" alt=""></div></div>${klCell(1)}${gdCell(1)}${twCell(1)}${teamCell(R, 1)}</div>
      <div class="rw2">${objs(0, false)}<div class="l3-time"><b class="num">${fmt(m.clock)}</b></div>${objs(1, true)}</div></div>
      ${note ? `<div class="l3-note" data-k="l3-note" style="--c:${m.colors[note.side] || "#FDC82F"}"><span><b>${esc(((note.main && note.main.name && m.sides[note.side]) ? m.sides[note.side].tag : ""))}</b> ${esc(note.label)}${note.main ? ` · ${esc(note.main.display || note.main.name)}` : ""}</span></div>` : ""}`;

    // --- Baron / Elder buff cards, down each side above the band: the objective, who took it, and the buff's countdown
    const BUFF = { baron: ["BARON BUFF", "baron", "#b48cff"], elder: ["ELDER BUFF", "elder", DRAKE.Elder] };
    const buffCards = (s, right) => ["baron", "elder"].map(b => { const f = o.buffs && o.buffs[b]; if (!f || f.side !== gs(s)) return "";
      const who = f.player != null ? m.players[s].find(p => p.shortcut === f.player + 1) : null, [label, key, col] = BUFF[b];
      return `<div class="l3-buff ${key}${right ? " r" : ""}" style="--c:${col}" data-k="bf-${key}"><div class="pt">${who ? icon(who) : ic(key, ICON[key])}</div>
        <div class="tx"><small>${label}</small><b>${esc(who ? who.display : f.killer || "")}</b></div><b class="num cd">${fmt(f.secs)}</b><i class="dr" style="transform:scaleX(${Math.max(0, Math.min(1, f.secs / (f.total || 1)))})"></i></div>`; }).join("");
    const buffSide = (s, right) => { const c = buffCards(s, right); return c ? `<div class="l3-buffs${right ? " r" : ""}" data-k="l3-buffs-${s}">${c}</div>` : ""; };
    if (sh.score) h += buffSide(0, false) + buffSide(1, true);

    // optional side player lists (off by default for League: the board has the same information)
    const K1 = p => `<div class="l-p${p.dead ? " dead" : ""}"><div class="ch">${icon(p)}<b class="lv num">${p.level || 1}</b>${p.dead && p.respawn > 0 ? `<b class="rs num">${p.respawn}</b>` : ""}</div>
      <div class="nm"><b>${esc(p.display)}</b><small class="num">${p.kills || 0}/${p.deaths || 0}/${p.assists || 0} · ${p.cs || 0} CS · ${K(p.gold || 0)}</small></div></div>`;
    if (sh.boost) h += `<div class="l-side l" style="top:130px">${m.players[0].map(K1).join("")}</div><div class="l-side r" style="top:130px">${m.players[1].map(K1).join("")}</div>`;
    if (sh.feed && m.feed.length) h += `<div class="h-feed" style="top:${sh.boost ? 420 : 110}px">${m.feed.map(x => `<div><span style="color:${m.colors[x.side]}">${esc(x.main ? x.main.display || x.main.name : "")}</span><i>${esc(x.label)}</i>${x.second ? `<span style="color:${m.colors[1 - x.side]}">${esc(x.second.display || x.second.name)}</span>` : ""}</div>`).join("")}</div>`;

    // --- bottom band
    const item = (id, n) => `<span class="sl">${o.ddVersion && id ? `<img src="/ddragon/cdn/${esc(o.ddVersion)}/img/item/${id}.png" alt="">` : ""}${n > 1 ? `<em>${n | 0}</em>` : ""}</span>`; // n: the stack size (potions, wards), drawn only above 1
    const slots = (p, n) => Array.from({ length: n }, (_, i) => item((p.items || [])[i], (p.counts || [])[i])).join(""); // 7 = six items and the trinket
    const spell = k => (o.ddVersion && k ? `<img src="/ddragon/cdn/${esc(o.ddVersion)}/img/spell/${esc(k)}.png" alt="">` : `<i></i>`);
    const champ = p => `<div class="ch">${icon(p)}<b class="lv num">${p.level || 1}</b>${p.dead && p.respawn > 0 ? `<b class="rs num">${p.respawn}</b>` : ""}</div>`;
    const kda = p => `${p.kills || 0}/${p.deaths || 0}/${p.assists || 0}`;
    const frac = (v, mx) => Math.max(0, Math.min(1, +v / (+mx || 1)));
    // health, mana and experience bars exist only if a player object carries them (never true for spectated games: Riot's feed has no such values)
    const bars = p => p.hp == null ? "" : `<div class="bars"><i class="hp" style="transform:scaleX(${frac(p.hp, p.hpMax)})"></i>${p.mp != null ? `<i class="mp" style="transform:scaleX(${frac(p.mp, p.mpMax)})"></i>` : ""}${p.xp != null ? `<i class="xp" style="transform:scaleX(${frac(p.xp, p.xpMax || 1)})"></i>` : ""}</div>`;
    const half = (p, right, i) => !p ? `<div class="l3-h${right ? " r" : ""}" data-k="h-${i}-${right ? 1 : 0}"></div>` : `<div class="l3-h${right ? " r" : ""}${p.dead ? " dead" : ""}" data-k="h-${i}-${right ? 1 : 0}">
      <div class="it">${slots(p, 7)}</div><div class="sp">${spell((p.spells || [])[0])}${spell((p.spells || [])[1])}</div>${champ(p)}
      <div class="nm"><b>${esc(p.display)}</b>${p.keystone ? `<img class="rk" src="/ddragon/cdn/img/${esc(p.keystone)}" alt="">` : ""}</div>
      <div class="st"><b class="num">${p.cs || 0}</b><small class="num">${kda(p)}</small></div>${bars(p)}</div>`;
    const lanes = Math.max(m.players[0].length, m.players[1].length);
    const board = Array.from({ length: lanes }, (_, i) => { const a = m.players[0][i], b = m.players[1][i], d = ((a && a.gold) || 0) - ((b && b.gold) || 0), lead = d >= 50 ? 0 : d <= -50 ? 1 : -1; // lane gold difference (an estimate), the arrow points at the leader
      return `${half(a, false, i)}<div class="l3-d${lead === 0 ? " l" : lead === 1 ? " r" : ""}" data-k="d-${i}">${lead === 0 ? `<i class="ar"></i>` : ""}<b class="num">${K(Math.abs(d))}</b>${lead === 1 ? `<i class="ar"></i>` : ""}</div>${half(b, true, i)}`; }).join("");
    // teamfight strip (F9): replaces the board only, inside the same box
    const fight = o.fight || { active: false, kills: [0, 0] };
    const tile = p => !p ? "" : `<div class="l3-tp${p.dead ? " dead" : ""}"><div class="it">${slots(p, 6)}</div>${champ(p)}<b class="nm">${esc(p.display)}</b><small class="num">${kda(p)}</small></div>`;
    const fv = String((ev.lol || {}).focus == null ? "auto" : ev.lol.focus);
    const fp = /^\d$/.test(fv) ? (m.players[+fv >= 5 ? 1 : 0] || [])[+fv % 5] : m.actionLast ? m.players[m.actionLast.side][m.actionLast.i] : null; // chosen player, else the one in the latest kill (12 s), else none
    const focus = fp ? `<div class="l3-focus${fp.dead ? " dead" : ""}" data-k="l3-focus" style="--c:${esc(m.colors[fp.side])}"><div class="fh">${champ(fp)}<div class="sp">${spell((fp.spells || [])[0])}${spell((fp.spells || [])[1])}</div>
      <div class="who"><b>${esc(fp.display)}</b><small>${esc(fp.champion || "")}</small></div>${fp.keystone ? `<img class="rk" src="/ddragon/cdn/img/${esc(fp.keystone)}" alt="">` : ""}</div>
      <div class="kd"><b class="num">${kda(fp)}</b><span class="num">${fp.cs || 0} CS</span><span class="vs num">${EYE}${fp.ward || 0}</span></div><div class="it">${slots(fp, 7)}</div></div>` : "";
    const sp = (ev.tournament.sponsors || []).filter(x => x && (x.name || x.logo)), main = sp.find(x => x.type === "main"), order = main ? [main].concat(sp.filter(x => x !== main)) : sp;
    const si = order.length ? Math.floor(Date.now() / 8000) % order.length : 0, cur = order[si]; // the main sponsor first, then each sponsor for 8 seconds
    const sponsor = cur ? `<div class="l3-sp" data-k="l3-sp"><div class="in" data-k="sp-${si}">${cur.logo ? `<img src="${esc(cur.logo)}" alt="${esc(cur.name || "")}" onerror="this.style.display='none'">` : `<b>${esc(cur.name)}</b>`}</div></div>` : "";
    const pc = sh.playerCam ? lolCams(m) : { html: "", cams: [] };
    const band = (sh.focus !== false ? focus : "") + (sh.sponsor !== false ? sponsor : "") + pc.html
      + (sh.card ? (ev.hud.lolPanel === "fight" ? `<div class="l3-fight" data-k="l3-fight"><div class="sd">${m.players[0].map(tile).join("")}</div><div class="mid"><small>TEAMFIGHT</small><b class="num"><span style="color:var(--L)">${fight.kills[gs(0)]}</span> – <span style="color:var(--R)">${fight.kills[gs(1)]}</span></b></div><div class="sd">${m.players[1].map(tile).join("")}</div></div>` : `<div class="l3-board" data-k="l3-board">${board}</div>`) : "")
      + (sh.minimap !== false ? `<div class="l3-map" data-k="l3-map"></div>` : ""); // an empty frame: the game's own minimap shows through it
    if (band) h += `<div class="l3-band" data-k="l3-band">${band}</div>`;
    return { html: h, cams: pc.cams };
  };
  S.statsplayer = (m) => {
    const p = m.focus || m.mvp; if (!p) return { html: "", cams: [] };
    const c = m.colors[p.side], cols = COLS[m.kind] || COLS.rl;
    return { html: `<div class="h-full"><div class="h-eyebrow">${m.focus ? "PLAYER SPOTLIGHT" : "MATCH MVP"}</div><div class="h-ind" style="--c:${c}">
    <div class="pic">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : `<div class="h-sil"></div>`}</div>
    <div class="info"><div style="display:flex;align-items:center;gap:14px;font-size:30px;color:${c}">${lg(p.team).replace('class="lgbox"', 'class="lgbox" style="width:44px;height:44px"')}${esc(p.team ? p.team.name : "")}</div><b>${esc(p.display)}</b>
    <div class="grid">${cols.map(([k, n]) => `<div><b class="num">${p[k] || 0}</b><small>${n}</small></div>`).join("")}</div></div></div></div>`, cams: [] };
  };
  S.lineup = (m) => {
    const side = (t, s) => `<div class="side" style="--c:${m.colors[s]}"><div class="hd">${lg(t)}<span>${esc(t ? t.name : "TBD")}</span></div>
      ${(t ? t.players : []).map(p => `<div class="p"><div class="av">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : `<div class="h-sil"></div>`}</div><b>${esc(p.alias || p.ign)}</b>${p.country ? `<span class="h-cc">${esc(p.country)}</span>` : ""}</div>`).join("") || `<div class="p" style="padding-left:16px"><small>ROSTER NOT SET</small></div>`}</div>`;
    return { html: `<div class="h-full"><div class="h-eyebrow">TEAM LINEUPS</div><div class="h-lineup">${side(m.sides[0], 0)}${side(m.sides[1], 1)}</div></div>`, cams: [] };
  };
  S.schedule = (m) => {
    const ev = m.ev;
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(ev.live.seriesTitle || ev.tournament.name || "")}</div><div class="h-title" style="font-size:90px">SCHEDULE</div><div class="h-sched">
    ${ev.schedule.slice(0, 6).map(x => { const a = sideTeam(ev, x.left), b = sideTeam(ev, x.right); const done = x.sa !== "" && x.sb !== "";
      return `<div class="m"><span class="time">${esc(x.time)}</span><div class="t">${lg(a)}<span>${esc(a ? a.name : "TBD")}</span></div><div class="sc num">${done ? `${esc(x.sa)} – ${esc(x.sb)}` : "VS"}</div><div class="t r">${lg(b)}<span>${esc(b ? b.name : "TBD")}</span></div><span class="lbl">${esc(x.label)}</span></div>`; }).join("") || `<div class="m"><span class="lbl" style="grid-column:1/-1;text-align:center">NO MATCHES SCHEDULED</span></div>`}</div></div>`, cams: [] };
  };
  S.bracket = (m) => {
    const ev = m.ev;
    const tr = (id, sc, win) => { const t = sideTeam(ev, id); return `<div class="tr${win ? " w" : ""}">${lg(t)}<span>${esc(t ? t.name : "TBD")}</span><b class="num">${esc(sc)}</b></div>`; };
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(ev.tournament.name || "")} ${esc(ev.tournament.format || "")}</div><div class="h-bracket">
    ${ev.bracket.rounds.map(r => `<div class="rd"><h4>${esc(r.name)}</h4><div class="ms">${r.matches.map(x => { const a = +x.sa, b = +x.sb, d = x.sa !== "" && x.sb !== "";
      return `<div class="mt">${tr(x.a, x.sa, d && a > b)}${tr(x.b, x.sb, d && b > a)}</div>`; }).join("")}</div></div>`).join("")}</div></div>`, cams: [] };
  };
  S.rankings = (m) => {
    const ev = m.ev, rows = ev.standings.slice().sort((a, b) => b.w - a.w || a.l - b.l || b.gd - a.gd).slice(0, 10);
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(ev.tournament.name || "")}</div><div class="h-title" style="font-size:90px">STANDINGS</div>
    <table class="h-table" style="width:820px"><thead><tr><th>#</th><th style="text-align:left">TEAM</th><th>W</th><th>L</th><th>${gdLabel(ev.game)}</th></tr></thead><tbody>
    ${rows.map((r, i) => { const t = sideTeam(ev, r.team); return `<tr class="${i === 0 ? "top" : ""}"><td class="num">${i + 1}</td><td class="tm" style="text-align:left">${lg(t)}${esc(t ? t.name : "TBD")}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td></tr>`; }).join("")}</tbody></table></div>`, cams: [] };
  };
  S.timer = (m) => {
    const t = m.ev.timer, rem = t.endsAt ? Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) : t.remaining;
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(m.ev.live.seriesTitle || m.ev.name)}</div><div class="h-title" style="font-size:80px">${esc(t.label)}</div><div class="h-timer num">${fmt(rem)}</div></div>`, cams: [] };
  };

  /* ---------------- Minecraft: Hunger Games and Build Battle ---------------- */
  // Player heads come from a public skin service. If it can't be reached (no internet), a letter tile is shown instead.
  const BAD = new Set();
  if (typeof document !== "undefined") document.addEventListener("error", e => { const t = e.target; if (t && t.tagName === "IMG" && t.dataset && t.dataset.head) BAD.add(t.src); }, true);
  const headUrl = n => `https://mc-heads.net/avatar/${encodeURIComponent(n)}/64`;
  const head = (n, cls = "") => `<span class="hd ${cls}"><i>${esc(String(n || "?").charAt(0).toUpperCase())}</i>${BAD.has(headUrl(n)) ? "" : `<img data-head="1" src="${headUrl(n)}" alt="">`}</span>`;
  const HEART = `<svg viewBox="0 0 24 24"><path d="M12 21 3.5 12.5a5 5 0 0 1 7-7L12 7l1.5-1.5a5 5 0 0 1 7 7z"/></svg>`;
  const hearts = hp => Array.from({ length: 10 }, (_, i) => { const f = Math.max(0, Math.min(1, (hp || 0) / 2 - i)); return `<span class="ht">${HEART}<span class="f" style="width:${f * 100}%">${HEART}</span></span>`; }).join("");
  const clk = c => (c ? (c.base || 0) + (c.running ? (Date.now() - c.startedAt) / 1000 : 0) : 0);
  const PHASE = { waiting: "STARTING SOON", building: "BUILDING", judging: "JUDGING", results: "RESULTS" };
  const phaseOf = t => (/build/i.test(t) ? "building" : /judg|vote|rate/i.test(t) ? "judging" : /result|winner|final/i.test(t) ? "results" : /wait|lobby|start/i.test(t) ? "waiting" : null);

  // Everything the Minecraft scenes need: the server feed (if connected) and the screen reader, with the roster for team tags.
  function mcData(m) {
    const ev = m.ev, cfg = ev.mc || {}, rc = m.mc, oc = m.mcOcr && Date.now() - m.mcOcr.t < 6000 ? m.mcOcr : null, connected = !!(rc && rc.connected);
    const roster = new Map(); ev.teams.forEach(t => t.players.forEach(p => { if (p.ign) roster.set(p.ign.toLowerCase(), { name: p.ign, team: t }); }));
    const list = [], seen = new Set();
    if (rc) rc.players.forEach(p => { seen.add(p.name.toLowerCase()); const r = roster.get(p.name.toLowerCase()); list.push(Object.assign({}, p, { team: r ? r.team : null })); });
    roster.forEach((r, k) => { if (!seen.has(k)) list.push({ name: r.name, health: null, food: null, mode: null, online: false, kills: 0, deaths: 0, alive: false, team: r.team, offline: true }); });
    list.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
    const alive = connected ? list.filter(p => p.alive).length : oc && oc.alive != null ? oc.alive : null;
    return { cfg, list, connected, oc, alive, total: cfg.total || (oc && oc.total) || list.length || 0,
      elapsed: oc && oc.clock != null ? oc.clock : clk(cfg.clock), border: rc && rc.border != null ? rc.border : oc && oc.border != null ? oc.border : null,
      feed: rc && rc.feed ? rc.feed.filter(f => Date.now() - f.t < 10000).slice(-4) : [] };
  }
  S.mcingame = (m) => {
    const d = mcData(m);
    return d.cfg.mode === "buildbattle" ? mcBuild(m, d) : mcHunger(m, d);
  };
  /* Hunger Games. Every piece is an element that can be switched on or off in the HUD Editor (hud.show.mc*), has its own settings
     (hud.mcSet) and carries data-el so a click on it in the preview selects it. hud.mcState is the HUD state: main, final or winner. */
  function mcHunger(m, d) {
    const cfg = d.cfg, ev = m.ev, sh = ev.hud.show, state = ev.hud.mcState || "main";
    const set = Object.assign({ killRows: 5, feedRows: 4, bars: true, elimSecs: 6, showBorder: true }, ev.hud.mcSet);
    const on = k => sh[k] !== false, sel = k => (CTX.sel === k ? " sel" : "");
    const byKills = d.list.filter(p => p.kills > 0).sort((a, b) => b.kills - a.kills).slice(0, set.killRows);
    const spot = d.list.find(p => p.name === cfg.spotlight) || d.list.slice().sort((a, b) => b.kills - a.kills || (b.alive ? 1 : 0) - (a.alive ? 1 : 0))[0];
    const alive = d.list.filter(p => p.alive), left = d.alive != null ? d.alive : alive.length;
    const n = d.list.length, tw = Math.max(26, Math.min(56, Math.floor(1210 / Math.max(1, n))));
    const cams = []; let h = "";
    if (on("mcTop")) h += `<div class="mc-top${sel("top")}" data-el="top"><div class="t">${esc(cfg.title || "HUNGER GAMES")}</div><div class="a"><b class="num">${d.alive ?? "–"}</b><small>/ ${d.total || "–"} ALIVE</small></div>
      <div class="c"><b class="num">${fmt(d.elapsed)}</b>${set.showBorder && d.border != null ? `<small>BORDER ${Math.round(d.border)}</small>` : ""}</div></div>`;
    if (state === "final" && on("mcTop")) h += `<div class="mc-final" data-k="final">FINAL ${left}</div>`;
    if (on("mcKills") && byKills.length) h += `<div class="mc-kills${sel("kills")}" data-el="kills"><h4>KILLS</h4>${byKills.map(p => `<div data-k="k${esc(p.name)}">${head(p.name)}<span class="nm">${esc(p.name)}</span><b class="num">${p.kills}</b></div>`).join("")}</div>`;
    if (on("mcFeed") && d.feed.length) h += `<div class="mc-feed${sel("feed")}" data-el="feed">${d.feed.slice(-set.feedRows).map(f => `<div data-k="f${f.id}">${f.killer ? `<b>${esc(f.killer)}</b><i>${esc(f.weapon || "ELIMINATED")}</i>` : ""}<span>${esc(f.victim)}</span>${f.killer ? "" : "<i>OUT</i>"}</div>`).join("")}</div>`;
    const last = d.feed[d.feed.length - 1];
    if (on("mcElim") && last && Date.now() - last.t < set.elimSecs * 1000 && state !== "winner")
      h += `<div class="mc-elim${sel("elim")}" data-el="elim" data-k="e${last.id}"><b>${esc(last.killer ? last.killer + " ELIMINATED " + last.victim : last.victim + " IS OUT")}</b><small>${left} REMAIN</small></div>`;
    if (on("mcSpot") && spot) h += `<div class="mc-spot${sel("spot")}" data-el="spot">${head(spot.name, "big")}<div class="nm"><b>${esc(spot.name)}</b><small>${spot.team ? esc(spot.team.tag) : ""}${spot.alive ? "" : " · OUT"}</small></div>
      <div class="hearts">${hearts(spot.health)}</div><div class="rw2"><span class="fd"><i style="width:${Math.max(0, Math.min(100, ((spot.food || 0) / 20) * 100))}%"></i></span><span class="kl num">${spot.kills} KILLS</span></div></div>`;
    if (on("mcCam") && spot) { // the spotlight player's camera, from their roster entry
      const r = ev.teams.flatMap(t => t.players).find(p => low(p.ign) === low(spot.name));
      if (r && r.cam) cams.push({ key: "mccam-" + r.cam, url: r.cam, x: 324, y: 480, w: 256, h: 144 });
    }
    const sp = (ev.tournament.sponsors || []).filter(x => x.name || x.logo);
    if (on("mcSponsors") && sp.length) {
      const main = sp.find(x => x.type === "main"), rest = sp.filter(x => x !== main);
      const one = (x, big) => (x.logo ? `<img class="spl${big ? " big" : ""}" src="${esc(x.logo)}" alt="${esc(x.name)}">` : `<span class="spn${big ? " big" : ""}">${esc(x.name)}</span>`);
      h += `<div class="mc-sp${sel("sponsors")}" data-el="sponsors">${main ? `<small>PRESENTED BY</small>${one(main, true)}` : ""}${rest.slice(0, 5).map(x => one(x, false)).join("")}</div>`;
    }
    if (on("mcGrid") && n) h += `<div class="mc-grid${state === "final" ? " fin" : ""}${sel("grid")}" data-el="grid" style="--w:${tw}px">${d.list.map(p => `<div class="tile${p.alive ? "" : " out"}" data-k="p${esc(p.name)}">${head(p.name)}${set.bars ? `<span class="hpb"><i style="width:${Math.max(0, Math.min(100, ((p.health || 0) / 20) * 100))}%"></i></span>` : ""}${p.kills ? `<b class="kb num">${p.kills}</b>` : ""}</div>`).join("")}</div>`;
    if (state === "winner") {
      const w = d.list.find(p => p.name === cfg.winner) || (alive.length === 1 ? alive[0] : null) || d.list.slice().sort((a, b) => b.kills - a.kills)[0];
      if (w) h += `<div class="mc-win" data-k="win">${head(w.name, "huge")}<div><small>WINNER</small><b>${esc(w.name)}</b><em class="num">${w.kills} KILLS</em></div></div>`;
    }
    return { html: h, cams };
  }
  /* A build's score: a number typed by hand wins; otherwise the average of the judges (casters, players, guests), mixed with the
     Twitch chat average by the audience weight (0 = judges only). */
  function bbScore(bb, name) {
    const man = (bb.scores || {})[name];
    if (man != null && man !== "") return { v: +man, manual: true, chips: [], jud: null, aud: null, count: 0 };
    const js = bb.judgeScores || {}, judges = bb.judges || [], key = j => j.id + "~" + name; // flat keys ("<judge id>~<build>") so every cell is one simple path
    const chips = judges.filter(j => js[key(j)] != null && js[key(j)] !== "").map(j => ({ name: j.name, kind: j.kind, v: +js[key(j)] }));
    const jud = chips.length ? chips.reduce((a, c) => a + c.v, 0) / chips.length : null;
    const au = bb.audience || {}, a = (au.scores || {})[name], aud = a && a.count ? a.avg : null, w = Math.min(100, Math.max(0, +au.weight || 0)) / 100;
    const v = jud != null && aud != null ? jud * (1 - w) + aud * w : jud != null ? jud : aud != null && w > 0 ? aud : null;
    return { v: v == null ? null : Math.round(v * 10) / 10, manual: false, chips, jud, aud, count: a ? a.count : 0 };
  }
  function mcBuild(m, d) {
    const bb = d.cfg.bb || {}, oc = d.oc, phase = (oc && oc.phase && phaseOf(String(oc.phase))) || bb.phase || "waiting";
    const theme = (oc && oc.theme) || bb.theme || "", rem = oc && oc.clock != null ? oc.clock : bb.endsAt ? Math.max(0, (bb.endsAt - Date.now()) / 1000) : bb.remaining || 0;
    const sc = n => bbScore(bb, n).v;
    if (phase === "results") {
      const names = [...new Set([...Object.keys(bb.scores || {}), ...Object.keys(bb.judgeScores || {}).map(k => k.split("~")[1]).filter(Boolean), ...d.list.map(p => p.name)])];
      const rows = names.map(n => ({ n, s: sc(n) })).sort((a, b) => (b.s ?? -1) - (a.s ?? -1)).slice(0, 10);
      return { html: `<div class="h-full"><div class="h-eyebrow">${esc(theme || d.cfg.title || "BUILD BATTLE")}</div><div class="h-title" style="font-size:90px">RESULTS</div>
        <table class="h-table" style="width:760px"><tbody>${rows.map((r, i) => `<tr class="${i === 0 ? "top" : ""}"><td class="num" style="width:60px">${i + 1}</td><td class="tm" style="text-align:left">${head(r.n, "sm")}${esc(r.n)}</td><td class="num">${r.s ?? "–"}</td></tr>`).join("")}</tbody></table></div>`, cams: [] };
    }
    let h = `<div class="bb-top"><div class="th"><small>THEME</small><b>${esc(theme || "–")}</b></div><div class="ph">${PHASE[phase]}</div><div class="tm num">${fmt(rem)}</div></div>`;
    h += `<div class="bb-list">${d.list.slice(0, 14).map(p => `<div data-k="b${esc(p.name)}" class="${p.online ? "" : "off"}">${head(p.name, "sm")}<span class="nm">${esc(p.name)}</span>${sc(p.name) != null ? `<b class="num">${sc(p.name)}</b>` : ""}</div>`).join("")}</div>`;
    if (phase === "judging" && bb.judging) {
      const x = bbScore(bb, bb.judging), au = bb.audience || {};
      const chips = x.chips.map(c => `<span class="jc" data-k="j${esc(c.name)}"><small>${esc(c.name)}</small><b class="num">${c.v}</b></span>`).join("")
        + (au.open || x.count ? `<span class="jc chat" data-k="jchat"><small>CHAT${x.count ? " · " + x.count : ""}</small><b class="num">${x.aud != null ? x.aud : "–"}</b></span>` : "");
      h += `<div class="bb-judge">${head(bb.judging, "big")}<div><small>NOW JUDGING</small><b>${esc(bb.judging)}</b></div>${chips ? `<div class="jcs">${chips}</div>` : ""}<div class="sc"><b class="num">${x.v ?? "–"}</b><small>/ 10</small></div></div>`;
    }
    const pl = (d.ev && d.ev.mc && d.ev.mc.poll) || m.ev.mc.poll;
    if (pl && pl.show && pl.options.some(Boolean)) {
      const tot = pl.total || 0;
      h += `<div class="bb-poll"><small>CHAT POLL${pl.open ? " · VOTE NOW" : ""}</small>${pl.question ? `<b>${esc(pl.question)}</b>` : ""}${pl.options.map((o, i) => o ? `<div class="o" data-k="po${i}"><span class="k num">!${i + 1}</span><span class="t">${esc(o)}</span><span class="bar"><i style="width:${tot ? Math.round((pl.counts[i] || 0) / tot * 100) : 0}%"></i></span><b class="num">${pl.counts[i] || 0}</b></div>` : "").join("")}</div>`;
    }
    return { html: h, cams: [] };
  }

  /* ---------------- Riftbound (card game): operator-driven ---------------- */
  S.rbingame = (m) => {
    const ev = m.ev, rb = ev.rb || {}, cards = new Map((rb.cards || []).map(c => [c.id, c]));
    const elapsed = clk(rb.clock), shown = rb.limitMinutes ? Math.max(0, rb.limitMinutes * 60 - elapsed) : elapsed;
    const nm = s => (rb.names && rb.names[s]) || (m.sides[s] && m.sides[s].name) || `PLAYER ${s + 1}`, col = s => (rb.colors && rb.colors[s]) || m.colors[s];
    const pts = s => (rb.points && rb.points[s]) || 0, target = rb.target || 8;
    const pips = s => Array.from({ length: target }, (_, i) => `<i class="${i < pts(s) ? "on" : ""}"></i>`).join("");
    const tile = (id, key) => { const k = cards.get(id); if (!k) return ""; return `<div class="rb-card" data-k="${key}">${k.image ? `<img src="${esc(k.image)}" alt="${esc(k.name)}">` : `<b>${esc(k.name)}</b>`}</div>`; };
    const panel = s => `<div class="rb-p${(rb.active || 0) === s ? " act" : ""}" style="--c:${esc(col(s))}"><div class="nm"><b>${esc(nm(s))}</b><small>${esc((rb.legends && rb.legends[s]) || "")}</small></div><div class="pt"><b class="num">${pts(s)}</b><small>/ ${target}</small></div><div class="pips">${pips(s)}</div></div>`;
    let h = `<div class="rb-top">${panel(0)}<div class="mid"><div class="gw num">${(rb.games && rb.games[0]) || 0} – ${(rb.games && rb.games[1]) || 0}</div><small>${esc(rb.roundTitle || ev.live.gameSeries || "")}</small><div class="ck num">${fmt(shown)}</div><small>TURN ${rb.turn || 1}</small></div>${panel(1)}</div>`;
    [0, 1].forEach(s => { const ids = ((rb.play && rb.play[s]) || []).slice(0, 10); if (ids.length) h += `<div class="rb-play ${s ? "r" : "l"}">${ids.map((id, i) => tile(id, `c${s}-${i}-${id}`)).join("")}</div>`; });
    const sp = rb.spotlight && rb.spotlight.show ? cards.get(rb.spotlight.cardId) : null;
    if (sp) h += `<div class="rb-spot" data-k="spot-${esc(sp.id)}">${sp.image ? `<img src="${esc(sp.image)}" alt="${esc(sp.name)}">` : `<div class="txt"><b>${esc(sp.name)}</b></div>`}<div class="cap">${esc(sp.name)}</div></div>`;
    const log = (rb.log || []).slice(-3).reverse();
    if (log.length) h += `<div class="rb-log">${log.map(l => { const k = cards.get(l.cardId); return k ? `<div data-k="l${l.t}"><span style="color:${esc(col(l.player))}">${esc(nm(l.player))}</span> played <b>${esc(k.name)}</b></div>` : ""; }).join("")}</div>`;
    return { html: h, cams: [] };
  };

  /* ---------------- scenes for the games that are not Rocket League ----------------
     Every scene has to speak the game it is showing. The Rocket League versions (goals, saves, demos, boost) stay as they were; Minecraft,
     Riftbound and the screen-read games (kind "gen") get their own stats, lineup and starting-soon scenes, and a plain scorebug in game. */
  const GD_LABEL = { "Rocket League": "GOAL DIFF", "League of Legends": "GAME DIFF", "Riftbound": "POINT DIFF", "Minecraft": "POINTS", "Dead by Daylight": "POINTS", "Fortnite": "POINTS", "Valorant": "ROUND DIFF" };
  const gdLabel = g => GD_LABEL[g] || "DIFF";
  const lgBig = t => lg(t).replace('class="lgbox"', 'class="lgbox" style="width:76px;height:76px"');
  const noLive = g => String(g || "").toUpperCase();

  S.geningame = (m) => {
    const ev = m.ev, l = ev.live, [L, R] = m.sides, tl = tourLogo(ev);
    const sponsors = ev.tournament.sponsors.map(x => x.name).filter(Boolean);
    const tick = [l.seriesTitle, l.eventTitle, l.roundTitle, ...sponsors].filter(Boolean).join("  |  ") || ev.name;
    return { html: `<div class="h-tick"><span>${esc(tick)}  |  ${esc(tick)}  |  </span></div>
      <div class="h-bug"><div class="h-team l">${lg(L)}<span class="tn${L && L.name.length > 13 ? " long" : ""}">${esc(L ? L.name : "Team A")}</span><span class="gs num">${m.score[0]}</span></div>
      <div class="h-mid">${tl ? `<div class="lgbox"><img class="lg" src="${esc(tl)}" alt=""></div>` : `<span style="font-size:22px;color:#9a9ba3">${esc(ev.tournament.name || "VS")}</span>`}</div>
      <div class="h-team r">${lg(R)}<span class="tn${R && R.name.length > 13 ? " long" : ""}">${esc(R ? R.name : "Team B")}</span><span class="gs num">${m.score[1]}</span></div></div>
      <div class="h-series"><div class="ss l num">${m.series[0]}</div><div class="clk"><b class="num">${m.clockLive ? fmt(m.clock) : "VS"}</b><small>${esc(l.gameSeries || "BEST OF " + l.bestOf)}</small></div><div class="ss r num">${m.series[1]}</div></div>`, cams: [] };
  };

  /* ---- Minecraft ---- */
  function mcStatsTeam(m) {
    const d = mcData(m), cfg = d.cfg, bb = cfg.mode === "buildbattle", sc = (cfg.bb && cfg.bb.scores) || {};
    const rows = d.list.slice().sort(bb ? (a, b) => (sc[b.name] ?? -1) - (sc[a.name] ?? -1) || a.name.localeCompare(b.name)
      : (a, b) => b.kills - a.kills || (b.alive ? 1 : 0) - (a.alive ? 1 : 0) || a.name.localeCompare(b.name)).slice(0, 12);
    const title = bb ? (cfg.bb && cfg.bb.theme) || cfg.title || "BUILD BATTLE" : cfg.title || "HUNGER GAMES";
    const cols = bb ? `<th>#</th><th style="text-align:left">PLAYER</th><th>SCORE</th>` : `<th>#</th><th style="text-align:left">PLAYER</th><th>KILLS</th><th>DEATHS</th><th>STATUS</th>`;
    const who = p => `<td class="tm" style="text-align:left">${head(p.name, "sm")}${esc(p.name)}</td>`;
    const body = rows.map((p, i) => bb
      ? `<tr class="${i === 0 && sc[p.name] != null ? "top" : ""}"><td class="num">${i + 1}</td>${who(p)}<td class="num">${sc[p.name] ?? "–"}</td></tr>`
      : `<tr class="${i === 0 && p.kills ? "top" : ""}"><td class="num">${i + 1}</td>${who(p)}<td class="num">${p.kills}</td><td class="num">${p.deaths}</td><td>${p.alive ? "ALIVE" : "OUT"}</td></tr>`).join("");
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(title)}</div><div class="h-title" style="font-size:80px">${bb ? "SCORES" : "LEADERBOARD"}</div>
      <table class="h-table" style="width:${bb ? 760 : 900}px"><thead><tr>${cols}</tr></thead><tbody>${body || `<tr><td colspan="5" style="text-align:center">NO PLAYERS YET</td></tr>`}</tbody></table></div>`, cams: [] };
  }
  function mcStatsPlayer(m) {
    const d = mcData(m), cfg = d.cfg, bb = cfg.mode === "buildbattle", sc = (cfg.bb && cfg.bb.scores) || {};
    const ranked = d.list.slice().sort((a, b) => (sc[b.name] ?? -1) - (sc[a.name] ?? -1));
    const p = bb ? d.list.find(x => x.name === (cfg.bb && cfg.bb.judging)) || ranked[0] : d.list.find(x => x.name === cfg.spotlight) || d.list.slice().sort((a, b) => b.kills - a.kills)[0];
    if (!p) return { html: `<div class="h-full"><div class="h-eyebrow">${esc(cfg.title || "MINECRAFT")}</div><div class="h-title" style="font-size:80px">NO PLAYERS YET</div></div>`, cams: [] };
    const tiles = bb ? [[sc[p.name] ?? "–", "SCORE"], [ranked.findIndex(x => x.name === p.name) + 1, "RANK"]]
      : [[p.kills, "KILLS"], [p.deaths, "DEATHS"], [p.health == null ? "–" : Math.round(p.health) / 2, "HEARTS"], [p.food == null ? "–" : p.food, "FOOD"], [p.alive ? "ALIVE" : "OUT", "STATUS"]];
    return { html: `<div class="h-full"><div class="h-eyebrow">${bb ? "NOW JUDGING" : "PLAYER SPOTLIGHT"}</div><div class="h-ind" style="--c:var(--gold)">
      <div class="pic" style="display:grid;place-items:center">${head(p.name, "huge")}</div>
      <div class="info"><b>${esc(p.name)}</b><div class="grid">${tiles.map(([v, n]) => `<div><b class="num">${esc(v)}</b><small>${n}</small></div>`).join("")}</div></div></div></div>`, cams: [] };
  }
  function mcLineup(m) {
    const d = mcData(m), title = d.cfg.mode === "buildbattle" ? "BUILD BATTLE" : d.cfg.title || "HUNGER GAMES";
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(title)}</div><div class="h-title" style="font-size:80px">PLAYERS</div>
      <div class="mc-roster">${d.list.slice(0, 24).map(p => `<div>${head(p.name, "big")}<span>${esc(p.name)}</span></div>`).join("") || `<small style="color:#9a9ba3">NO PLAYERS YET</small>`}</div></div>`, cams: [] };
  }
  function mcStarting(m) {
    const ev = m.ev, d = mcData(m), l = ev.live, bb = d.cfg.mode === "buildbattle", theme = bb && d.cfg.bb && d.cfg.bb.theme;
    const strip = [d.cfg.title || (bb ? "BUILD BATTLE" : "HUNGER GAMES"), theme, d.list.length ? d.list.length + " PLAYERS" : ""].filter(Boolean).join("  ·  ");
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(l.seriesTitle || ev.tournament.name || ev.name)}</div><div class="h-title">STARTING SOON</div><div class="h-strip">${esc(strip)}</div></div>`, cams: [] };
  }

  /* ---- Riftbound ---- */
  function rbSide(m, s) {
    const rb = m.ev.rb || {};
    return { name: (rb.names && rb.names[s]) || (m.sides[s] && m.sides[s].name) || "PLAYER " + (s + 1), legend: (rb.legends && rb.legends[s]) || "", col: (rb.colors && rb.colors[s]) || m.colors[s],
      pts: (rb.points && rb.points[s]) || 0, games: (rb.games && rb.games[s]) || 0, played: (rb.log || []).filter(x => x.player === s).length, target: rb.target || 8 };
  }
  function rbPanel(x, full) {
    const row = (n, v) => `<div class="p"><small>${n}</small><b class="num">${esc(v)}</b></div>`;
    return `<div class="side" style="--c:${esc(x.col)}"><div class="tl"><span>${esc(x.name)}</span></div>${row("LEGEND", x.legend || "–")}${full ? row("POINTS", x.pts + " / " + x.target) + row("GAMES WON", x.games) + row("CARDS PLAYED", x.played) : ""}</div>`;
  }
  function rbStatsTeam(m) { const rb = m.ev.rb || {}; return { html: `<div class="h-full"><div class="h-eyebrow">${esc(rb.roundTitle || m.ev.live.seriesTitle || m.ev.name)}</div><div class="h-title" style="font-size:80px">MATCH STATS</div><div class="h-lineup">${rbPanel(rbSide(m, 0), true)}${rbPanel(rbSide(m, 1), true)}</div></div>`, cams: [] }; }
  function rbStatsPlayer(m) { const rb = m.ev.rb || {}; return { html: `<div class="h-full"><div class="h-eyebrow">PLAYER SPOTLIGHT</div><div class="h-lineup">${rbPanel(rbSide(m, rb.active || 0), true)}</div></div>`, cams: [] }; }
  function rbLineup(m) { return { html: `<div class="h-full"><div class="h-eyebrow">THE MATCH-UP</div><div class="h-lineup">${rbPanel(rbSide(m, 0), false)}${rbPanel(rbSide(m, 1), false)}</div></div>`, cams: [] }; }
  function rbStarting(m) {
    const ev = m.ev, rb = ev.rb || {}, a = rbSide(m, 0), b = rbSide(m, 1);
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(ev.live.seriesTitle || ev.tournament.name || ev.name)}</div><div class="h-title">STARTING SOON</div>
      <div class="h-vs"><div class="t"><b style="color:${esc(a.col)}">${esc(a.name)}</b><small>${esc(a.legend)}</small></div><div class="v">VS</div><div class="t"><b style="color:${esc(b.col)}">${esc(b.name)}</b><small>${esc(b.legend)}</small></div></div>
      <div class="h-strip">${esc([rb.roundTitle, ev.live.gameSeries].filter(Boolean).join("  ·  ") || "RIFTBOUND")}</div></div>`, cams: [] };
  }

  /* ---- games read from the screen (Overwatch, Call of Duty, Valorant and the rest): team names, scores and the clock only ---- */
  function genStatsTeam(m) {
    const [L, R] = m.sides, ev = m.ev;
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(ev.live.seriesTitle || ev.tournament.name || ev.name)}</div>
      <div style="display:flex;align-items:center;gap:30px;font-size:52px">${lgBig(L)}<span class="num">${esc(L ? L.tag : "TEAM A")} ${m.score[0]} – ${m.score[1]} ${esc(R ? R.tag : "TEAM B")}</span>${lgBig(R)}</div>
      <div class="h-eyebrow" style="font-size:22px">${esc(ev.live.gameSeries || "BEST OF " + ev.live.bestOf)}  ·  SERIES ${m.series[0]} – ${m.series[1]}</div></div>`, cams: [] };
  }
  function genStatsPlayer(m) {
    return { html: `<div class="h-full"><div class="h-eyebrow">${noLive(m.ev.game)}</div><div class="h-title" style="font-size:80px">NO PLAYER STATS</div><div class="h-strip">SCORES AND THE CLOCK ARE READ FROM THE SCREEN</div></div>`, cams: [] };
  }

  /* ---------------- Dead by Daylight, Fortnite and VALORANT 2v2 Skirmish ----------------
     None of the three gives a live feed to a caster, so they are scored by hand (Overwolf and screen reading can fill the numbers
     in later). Each has its own scoring rule, kept here so the dashboard, the overlay and the data files always agree. */
  const GAMEDEF = {
    "Dead by Daylight": { kind: "dbd", squad: 5, gd: "POINTS" },
    "Fortnite": { kind: "fn", squad: 2, gd: "POINTS" },
    "Valorant": { kind: "val", squad: 2, gd: "ROUND DIFF" },
  };
  /* Fortnite: points for a placement (the first tier whose "to" covers it) plus points per elimination, summed over matches. */
  function fnPoints(fn, place, elims) {
    place = Math.max(0, Math.floor(+place || 0)); elims = Math.max(0, Math.floor(+elims || 0));
    if (!place && !elims) return 0;
    const tier = place ? (fn.placePts || []).slice().sort((a, b) => a.to - b.to).find(t => place <= +t.to) : null;
    return (tier ? +tier.pts || 0 : 0) + elims * (+fn.elimPts || 0);
  }
  function fnTable(ev) {
    const fn = ev.fn || {};
    const rows = ev.teams.map((t, i) => {
      const r = { team: t, played: 0, wins: 0, elims: 0, pts: 0, best: 0, last: 0 };
      (fn.matches || []).forEach(m => {
        const place = Math.floor(+(m.place || [])[i] || 0), el = Math.floor(+(m.elims || [])[i] || 0);
        if (!place && !el) return;
        r.played++; r.elims += el; r.pts += fnPoints(fn, place, el); r.last = fnPoints(fn, place, el);
        if (place === 1) r.wins++;
        if (place && (!r.best || place < r.best)) r.best = place;
      });
      return r;
    });
    rows.sort((a, b) => b.pts - a.pts || b.wins - a.wins || b.elims - a.elims || (a.best || 999) - (b.best || 999) || a.team.name.localeCompare(b.team.name));
    rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].pts === r.pts && rows[i - 1].wins === r.wins && rows[i - 1].elims === r.elims ? rows[i - 1].rank : i + 1; });
    return rows;
  }
  /* Dead by Daylight: one trial is one killer against survivors. The killer's side scores per kill; the survivors' side per escape
     and per generator. Side 0 is the team on the left of the HUD. */
  function dbdScore(ev) {
    const d = ev.dbd || {}, total = [0, 0];
    const trials = (d.trials || []).map(t => {
      const k = +t.killer === 1 ? 1 : 0, s = 1 - k, kills = Math.max(0, +t.kills || 0), esc4 = Math.max(0, +t.escapes || 0), gens = Math.max(0, +t.gens || 0);
      const pts = [0, 0]; pts[k] = kills * (+d.killPts || 0); pts[s] = esc4 * (+d.escapePts || 0) + gens * (+d.genPts || 0);
      total[0] += pts[0]; total[1] += pts[1];
      return { killer: k, kills, escapes: esc4, gens, pts };
    });
    return { total, trials };
  }
  const kStrip = ev => [ev.live.seriesTitle, ev.live.eventTitle, ev.live.roundTitle].filter(Boolean).join("  ·  ") || ev.tournament.name || ev.name;
  const bugHead = m => { const g = S.geningame(m); return g.html.slice(0, g.html.indexOf('<div class="h-series">')); };

  S.valingame = (m) => {
    const ev = m.ev, v = ev.val || {}, t = +v.target || 10;
    return { html: bugHead(m) + `<div class="h-series"><div class="ss l num">${m.score[0]}</div><div class="clk"><b class="num">FIRST TO ${t}</b><small>${esc(ev.live.gameSeries || "2V2 SKIRMISH")}</small></div><div class="ss r num">${m.score[1]}</div></div>`, cams: [] };
  };

  S.dbdingame = (m) => {
    const ev = m.ev, [L, R] = m.sides, d = dbdScore(ev), n = d.trials.length, cur = d.trials[n - 1];
    const role = s => (!cur ? "" : cur.killer === s ? "KILLER" : "SURVIVORS");
    return { html: bugHead(m) + `<div class="h-series"><div class="ss l num" style="font-size:14px">${role(0)}</div><div class="clk"><b class="num">${n ? "TRIAL " + n : "DEAD BY DAYLIGHT"}</b><small>${esc(ev.live.gameSeries || "")}</small></div><div class="ss r num" style="font-size:14px">${role(1)}</div></div>`, cams: [] };
  };

  S.fningame = (m) => {
    const ev = m.ev, rows = fnTable(ev), fn = ev.fn || {}, nm = (fn.matches || []).length;
    const tick = kStrip(ev);
    return { html: `<div class="h-tick"><span>${esc(tick)}  |  ${esc(tick)}  |  </span></div>
      <div class="fn-board"><div class="fn-h"><b>${esc(ev.live.seriesTitle || "FORTNITE")}</b><small>${nm ? "AFTER MATCH " + nm : "STANDINGS"}</small></div>
      ${rows.slice(0, 6).map(r => `<div class="fn-row" data-k="fn-${esc(r.team.id)}"><span class="rk num">${r.rank}</span>${lg(r.team)}<span class="nm">${esc(r.team.tag || r.team.name)}</span><b class="num">${r.pts}</b></div>`).join("") || `<div class="fn-row"><span class="nm">NO TEAMS YET</span></div>`}</div>`, cams: [] };
  };
  function fnFull(m, limit) {
    const ev = m.ev, rows = fnTable(ev).slice(0, limit || 12), fn = ev.fn || {}, nm = (fn.matches || []).length;
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(ev.live.seriesTitle || ev.tournament.name || ev.name)}${nm ? "  ·  AFTER MATCH " + nm : ""}</div><div class="h-title" style="font-size:80px">LEADERBOARD</div>
      <table class="h-table" style="width:900px"><thead><tr><th>#</th><th style="text-align:left">TEAM</th><th>MATCHES</th><th>WINS</th><th>ELIMS</th><th>POINTS</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.rank === 1 && r.pts ? "top" : ""}"><td class="num">${r.rank}</td><td class="tm" style="text-align:left">${lg(r.team, "lgbox")}${esc(r.team.name)}</td><td class="num">${r.played}</td><td class="num">${r.wins}</td><td class="num">${r.elims}</td><td class="num">${r.pts}</td></tr>`).join("") || `<tr><td colspan="6" style="text-align:center">NO TEAMS YET</td></tr>`}</tbody></table></div>`, cams: [] };
  }
  function fnLineup(m) {
    const ev = m.ev;
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(ev.live.seriesTitle || ev.tournament.name || ev.name)}</div><div class="h-title" style="font-size:80px">THE TEAMS</div>
      <table class="h-table" style="width:900px"><tbody>${ev.teams.slice(0, 12).map(t => `<tr><td class="tm" style="text-align:left">${lg(t, "lgbox")}${esc(t.name)}</td><td style="text-align:left">${esc(t.players.map(p => p.alias || p.ign).filter(Boolean).join("  ·  ") || "–")}</td></tr>`).join("")}</tbody></table></div>`, cams: [] };
  }
  function dbdTrials(m) {
    const ev = m.ev, [L, R] = m.sides, d = dbdScore(ev), side = s => (s ? (R ? R.tag || R.name : "RIGHT") : (L ? L.tag || L.name : "LEFT"));
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(ev.live.seriesTitle || ev.tournament.name || ev.name)}</div><div class="h-title" style="font-size:80px">TRIAL RESULTS</div>
      <table class="h-table" style="width:900px"><thead><tr><th>#</th><th>KILLER</th><th>KILLS</th><th>ESCAPES</th><th>GENS</th><th>${esc(side(0))}</th><th>${esc(side(1))}</th></tr></thead><tbody>
      ${d.trials.map((t, i) => `<tr><td class="num">${i + 1}</td><td>${esc(side(t.killer))}</td><td class="num">${t.kills}</td><td class="num">${t.escapes}</td><td class="num">${t.gens}</td><td class="num">${t.pts[0]}</td><td class="num">${t.pts[1]}</td></tr>`).join("") || `<tr><td colspan="7" style="text-align:center">NO TRIALS YET</td></tr>`}
      <tr class="top"><td colspan="5" style="text-align:right">TOTAL</td><td class="num">${d.total[0]}</td><td class="num">${d.total[1]}</td></tr></tbody></table></div>`, cams: [] };
  }
  function dbdLineup(m) {
    const [L, R] = m.sides, panel = (t, col) => `<div class="side" style="--c:${esc(col)}"><div class="tl"><span>${esc(t ? t.name : "TEAM")}</span></div>${(t ? t.players : []).slice(0, 5).map((p, i) => `<div class="p"><small>P${i + 1}</small><b>${esc(p.alias || p.ign || "–")}</b></div>`).join("")}</div>`;
    return { html: `<div class="h-full"><div class="h-eyebrow">THE MATCH-UP</div><div class="h-lineup">${panel(L, m.colors[0])}${panel(R, m.colors[1])}</div></div>`, cams: [] };
  }
  function kStarting(m) {
    const ev = m.ev, [L, R] = m.sides, fnk = m.kind === "fn", vs = !fnk && L && R ? `${esc(L.name)}  VS  ${esc(R.name)}` : fnk ? `${ev.teams.length} TEAMS` : "";
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(ev.live.seriesTitle || ev.tournament.name || ev.name)}</div><div class="h-title">STARTING SOON</div><div class="h-strip">${esc([vs, ev.live.roundTitle].filter(Boolean).join("  ·  ") || ev.game.toUpperCase())}</div></div>`, cams: [] };
  }

  const withCams = (scene, camFn) => m => { const r = scene(m); if (!m.ev.hud.show.playerCam) return r; const pc = camFn(m); return { html: r.html + pc.html, cams: r.cams.concat(pc.cams) }; };
  S.valingame = withCams(S.valingame, m => playerCams(m, 100));
  S.dbdingame = withCams(S.dbdingame, m => playerCams(m, 100));
  S.fningame = withCams(S.fningame, m => fnCams(m.ev, fnTable(m.ev)));

  /* ---------------- League of Legends: champion select (laid out like the Worlds broadcast) ----------------
     Fed by draft.js through CTX.draft: { snap, delayMs, champs: id -> { key, name }, ddVersion, series }. Along the bottom: ten tall cards,
     blue side on the left, with the champion's loading art once picked (dimmed while only hovered), the player's name up the side and
     their role; the teams, series score, phase, timer and patch in the middle. Above: each team's bans, and the champions already used
     earlier in the series (fearless draft). The top of the screen stays clear for the camera. */
  const ROLE_SVG = {
    TOP: '<path d="M3 3h14v4H7v10H3z"/><path d="M10 10h7v7h-7z" opacity=".5"/>',
    JUNGLE: '<path d="M10 2c1 4 4 6 4 10a4 4 0 01-8 0c0-4 3-6 4-10zM4 6c0 4 2 6 3 8M16 6c0 4-2 6-3 8"/>',
    MIDDLE: '<path d="M14 3h3v3L6 17H3v-3z"/><path d="M3 3h5L3 8zM17 17h-5l5-5z" opacity=".5"/>',
    BOTTOM: '<path d="M17 17H3v-4h10V3h4z"/><path d="M3 3h7v7H3z" opacity=".5"/>',
    UTILITY: '<path d="M10 3l2 4 4-1-2 4 3 3h-5l-2 4-2-4H3l3-3-2-4 4 1z"/>',
  };
  const roleIcon = p => ROLE_SVG[p] ? `<svg viewBox="0 0 20 20" class="dr-role">${ROLE_SVG[p]}</svg>` : "";
  S.draft = (m) => {
    const ev = m.ev, D = CTX.draft || {}, d = D.snap, l = ev.live, [L, R] = m.sides;
    if (m.kind !== "lol") return { html: `<div class="h-full"><div class="h-eyebrow">CHAMPION SELECT</div><div class="h-title" style="font-size:70px">LEAGUE OF LEGENDS ONLY</div></div>`, cams: [] };
    const title = esc(l.seriesTitle || ev.tournament.name || ev.name);
    if (!d || !d.active) return { html: `<div class="h-full"><div class="h-eyebrow">${title}</div><div class="h-title" style="font-size:80px">CHAMPION SELECT</div><div class="h-strip">WAITING FOR THE LOBBY</div></div>`, cams: [] };
    const champ = id => (id && D.champs && D.champs[id]) || null, v = D.ddVersion;
    const art = id => { const c = champ(id); return c ? `/ddragon/cdn/img/champion/loading/${encodeURIComponent(c.key)}_0.jpg` : ""; };
    const icon = id => { const c = champ(id); return c && v ? `/ddragon/cdn/${esc(v)}/img/champion/${encodeURIComponent(c.key)}.png` : ""; };
    const secs = Math.max(0, Math.ceil(((d.endsAt || 0) - (Date.now() - (D.delayMs || 0))) / 1000));
    const col = side => esc(m.colors[side === "left" ? 0 : 1]);
    const card = (p, side, i) => {
      const shown = p.champ || p.intent, img = art(shown), x = side === "left" ? i * 107 : 747 + i * 107;
      const cls = ["dr-card", side, p.locked ? "locked" : shown ? "hover" : "empty", p.active ? "now" : ""].join(" ");
      return `<div class="${cls}" data-k="dr-${side}-${i}" style="left:${x}px;--c:${col(side)}">${img ? `<div class="art" style="background-image:url('${esc(img)}'),url('${esc(icon(shown))}')"></div>` : ""}
        <i class="slot">[${side === "left" ? "B" : "R"}${i + 1}]</i><b class="nm">${esc(p.name || (champ(shown) || {}).name || "")}</b>${roleIcon(p.pos)}</div>`;
    };
    const banRow = (list, side) => `<div class="dr-banbox ${side}" style="--c:${col(side)}"><small>${esc(((side === "left" ? L : R) || {}).tag || (side === "left" ? "BLUE" : "RED"))} BANS</small><div class="row">${[0, 1, 2, 3, 4].map(i => {
      const b = list[i] || {}, id = b.champ || b.hover, ic = icon(id);
      return `<div class="b${b.active ? " now" : ""}${b.done ? " done" : ""}${!id ? " open" : ""}" data-k="dr-b-${side}-${i}">${ic ? `<img src="${esc(ic)}" alt="">` : ""}</div>`; }).join("")}</div></div>`;
    const series = (D.series || []).slice(-5), past = series.length ? `<div class="dr-series"><small>SERIES BAN</small><div class="games">${series.map(g => `<div class="g">${[...(g.left || []), ...(g.right || [])].map(id => icon(id) ? `<img src="${esc(icon(id))}" alt="">` : "").join("")}</div>`).join("")}</div></div>` : "";
    const pips = (s) => { const n = Math.max(1, Math.ceil((+l.bestOf || 1) / 2)); return `<div class="pips">${Array.from({ length: n }, (_, k) => `<i class="${k < (m.series[s] || 0) ? "on" : ""}"></i>`).join("")}</div>`; };
    const phase = { BANS: "BAN PHASE", PICKS: "PICK PHASE", PLANNING: "DECLARE", FINALIZATION: "FINAL ADJUSTMENTS", STARTING: "GAME STARTING" }[d.phase] || d.phase;
    const turn = d.activeSide ? col(d.activeSide) : "#9db3a8";
    const patch = v ? "PATCH " + String(v).split(".").slice(0, 2).join(".") : "";
    return { html: `${banRow(d.left.bans, "left")}${past}${banRow(d.right.bans, "right")}<div class="dr-line" style="--l:${col("left")};--r:${col("right")}"></div>
      ${d.left.picks.map((p, i) => card(p, "left", i)).join("")}${d.right.picks.map((p, i) => card(p, "right", i)).join("")}
      <div class="dr-mid"><div class="tops">${pips(0)}${pips(1)}</div>
        <div class="logos">${lg(L)}${tourLogo(ev) ? `<div class="lgbox"><img class="lg" src="${esc(tourLogo(ev))}" alt=""></div>` : "<span></span>"}${lg(R)}</div>
        <div class="tags"><b>${esc(L ? L.tag : "BLUE")}</b><b>${esc(R ? R.tag : "RED")}</b></div>
        <div class="ph" style="color:${turn}"><span>${esc(phase)}</span>${d.endsAt ? `<b class="num">${secs}</b>` : ""}</div>
        <small class="patch">${esc(patch)}</small></div>`, cams: [] };
  };

  /* each of these scenes keeps its Rocket League / League version and swaps in the game's own for the others */
  const BASE = { statsteam: S.statsteam, statsplayer: S.statsplayer, lineup: S.lineup, starting: S.starting };
  const SWAP = {
    statsteam: { mc: mcStatsTeam, rb: rbStatsTeam, gen: genStatsTeam }, statsplayer: { mc: mcStatsPlayer, rb: rbStatsPlayer, gen: genStatsPlayer },
    lineup: { mc: mcLineup, rb: rbLineup }, starting: { mc: mcStarting, rb: rbStarting },
  };
  BASE.rankings = S.rankings;
  Object.assign(SWAP.statsteam, { fn: m => fnFull(m, 12), dbd: dbdTrials, val: genStatsTeam });
  Object.assign(SWAP.statsplayer, { fn: genStatsPlayer, dbd: genStatsPlayer, val: genStatsPlayer });
  Object.assign(SWAP.lineup, { fn: fnLineup, dbd: dbdLineup });
  Object.assign(SWAP.starting, { fn: kStarting, dbd: kStarting, val: kStarting });
  SWAP.rankings = { fn: m => fnFull(m, 12) };
  for (const name of Object.keys(SWAP)) S[name] = m => (SWAP[name][m.kind] || BASE[name])(m);

  /* pick the scene: "auto" follows the dashboard, and the in-game HUD
     switches itself to Replay during goal replays and Team Stats on the podium */
  function resolveScene(ev, m, scene) {
    let s = scene === "auto" || !scene ? ev.hud.scene : scene;
    // League: while champion select is on, the in-game scene shows it (the HUD Editor can switch this off)
    if (s === "ingame" && m.kind === "lol" && ev.hud.draftAuto !== false && CTX.draft && CTX.draft.snap && CTX.draft.snap.active) return "draft";
    if (s === "ingame" && m.kind === "lol") return "lolingame";
    if (s === "ingame" && m.kind === "gen") return "geningame";
    if (s === "ingame" && m.kind === "val") return "valingame";
    if (s === "ingame" && m.kind === "dbd") return "dbdingame";
    if (s === "ingame" && m.kind === "fn") return "fningame";
    if (s === "ingame" && m.kind === "mc") return "mcingame";
    if (s === "ingame" && m.kind === "rb") return "rbingame";
    if (s === "ingame" && m.replay) s = "replay";
    if (s === "ingame" && m.podium && ev.hud.autoBoard) s = "statsteam";
    return S[s] ? s : "ingame";
  }

  function syncCams(layer, cams) {
    const want = new Map(cams.map(c => [c.key, c]));
    [...layer.children].forEach(f => { if (!want.has(f.dataset.key)) f.remove(); });
    want.forEach((c, key) => {
      let f = [...layer.children].find(x => x.dataset.key === key);
      if (!f) { f = document.createElement("iframe"); f.dataset.key = key; f.allow = "autoplay;camera;microphone;fullscreen"; f.src = c.url; layer.appendChild(f); }
      Object.assign(f.style, { left: c.x + "px", top: c.y + "px", width: c.w + "px", height: c.h + "px", opacity: c.show === false ? "0" : "1", pointerEvents: c.show === false ? "none" : "" });
    });
  }

  /* Update the page in place instead of replacing it: unchanged elements stay put, so entry animations
     don't restart every second and bar widths can transition smoothly. Children are matched by a key
     (data-k, else class name plus its position among siblings with that class). */
  const keyOf = (el, seen) => { const base = el.getAttribute("data-k") || (el.getAttribute("class") || "").replace(/\b(hin|hino|hout|houto|bump|bumpf)\b/g, "").trim() || el.tagName; seen[base] = (seen[base] || 0) + 1; return base + "#" + seen[base]; };
  /* Motion. Only opacity, transform and filter are animated, with plain CSS keyframes, so it runs the same in OBS, vMix and the app.
     New elements slide in from the nearest edge, elements that go away fade out, numbers flash when they change, and a new scene
     staggers in. Turn it off with ?anim=off on the overlay link. Classes the script adds are kept across in-place patches (__fx). */
  const FX = { on: true, born: [], dying: new Set() };
  const FXKEEP = /^(hin|hino|hout|houto|bump|bumpf)$/;
  function syncAttrs(a, b) {
    const keep = a.__fx;
    for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of b.attributes) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    if (keep) keep.forEach(c => a.classList.add(c));
  }
  function fxAdd(el, cls, ms) {
    if (!el.__fx) el.__fx = new Set();
    el.__fx.forEach(c => { if (FXKEEP.test(c) && c !== cls) { el.classList.remove(c); el.__fx.delete(c); } });
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); el.__fx.add(cls);
    clearTimeout(el.__fxT); el.__fxT = setTimeout(() => { el.classList.remove(cls); el.__fx && el.__fx.delete(cls); }, ms);
  }
  const NOBUMP = /clk|timer|time|clock|\bcd\b/;
  function fxBump(el, val) {
    if (!FX.on || !el || el.nodeType !== 1 || !/^[\s\d.,+\-\u2013/%]+$/.test(val) || /:/.test(val) || NOBUMP.test(el.getAttribute("class") || "")) return;
    // values that change over and over (boost, health, a ticking stat) just update; a score or a count that changes now and then flashes
    const now = Date.now(), h = (el.__chg || []).filter(t => now - t < 3000); h.push(now); el.__chg = h;
    if (h.length > 2) return;
    fxAdd(el, getComputedStyle(el).display === "inline" ? "bumpf" : "bump", 520);
  }
  let fxIdx = 0;
  function patchKids(a, b, depth) {
    depth = depth || 0;
    const ac = [...a.childNodes], bc = [...b.childNodes], oldEl = new Map(), oldTxt = [], sa = {}, sb = {}, next = [], leaving = [];
    for (const x of ac) { if (x.__out) { leaving.push(x); continue; } if (x.nodeType === 1) oldEl.set(keyOf(x, sa), x); else if (x.nodeType === 3) oldTxt.push(x); }
    let ti = 0;
    for (const y of bc) {
      if (y.nodeType === 3) { const x = oldTxt[ti++]; if (x) { if (x.nodeValue !== y.nodeValue) { if (FX.on && a.__seen) fxBump(a, y.nodeValue); x.nodeValue = y.nodeValue; } next.push(x); } else next.push(y.cloneNode(true)); }
      else if (y.nodeType === 1) {
        const k = keyOf(y, sb), x = oldEl.get(k);
        if (x && x.tagName === y.tagName) { oldEl.delete(k); syncAttrs(x, y); patchKids(x, y, depth + 1); next.push(x); }
        else { const n = y.cloneNode(true); if (FX.on) { n.__idx = depth === 0 ? fxIdx++ : 0; FX.born.push(n); } next.push(n); }
      }
    }
    a.__seen = true;
    next.forEach((n, i) => { if (a.childNodes[i] !== n) a.insertBefore(n, a.childNodes[i] || null); });
    // elements that are gone: absolutely placed ones fade out where they are, the rest just leave
    const gone = new Set(oldEl.values()), keepTail = [];
    [...a.childNodes].forEach(n => {
      if (next.includes(n) || leaving.includes(n)) return;
      if (FX.on && gone.has(n) && n.nodeType === 1 && getComputedStyle(n).position === "absolute") { n.__out = true; keepTail.push(n); fxOut(n); } else a.removeChild(n);
    });
    leaving.forEach(n => { if (n.parentNode === a && !keepTail.includes(n)) keepTail.push(n); });
  }
  function fxDir(el, hr) {
    const r = el.getBoundingClientRect(); if (!hr.width) return [0, 12, false];
    const cx = (r.left + r.width / 2 - hr.left) / hr.width, cy = (r.top + r.height / 2 - hr.top) / hr.height, wide = r.width / hr.width > .5;
    let dx = 0, dy = 12;
    if (wide || cy < .22 || cy > .78) dy = cy < .5 ? -26 : 26;
    else dx = cx < .5 ? -44 : 44, dy = 0;
    return [dx * hr.width / 1280, dy * hr.height / 720, true];
  }
  function fxOut(n) {
    const hasT = getComputedStyle(n).transform !== "none";
    n.classList.add(hasT ? "houto" : "hout"); n.__fx = new Set([hasT ? "houto" : "hout"]);
    setTimeout(() => { if (n.parentNode) n.parentNode.removeChild(n); }, 320);
  }
  function fxFlush(hudEl) {
    const born = FX.born; FX.born = []; fxIdx = 0;
    if (!born.length) return;
    const hr = hudEl.getBoundingClientRect(), sc = hr.width ? hr.width / 1280 : 1;
    born.forEach(n => {
      if (!n.isConnected) return;
      const hasT = getComputedStyle(n).transform !== "none", [dx, dy] = fxDir(n, hr);
      n.style.setProperty("--dx", (dx / sc).toFixed(0) + "px"); n.style.setProperty("--dy", (dy / sc).toFixed(0) + "px");
      n.style.animationDelay = Math.min(n.__idx || 0, 8) * 55 + "ms";
      fxAdd(n, hasT ? "hino" : "hin", 900 + Math.min(n.__idx || 0, 8) * 55);
    });
  }

  let CTX = {}; // per-render extras: { icons } (the uploaded objective icons)
  function render(hudEl, ev, game, scene, ctx) {
    CTX = ctx || {};
    if (!hudEl.firstChild) hudEl.innerHTML = `<div class="lay"></div><div class="cams"></div>`;
    const m = model(ev, game);
    const s = resolveScene(ev, m, scene);
    const out = S[s](m);
    hudEl.style.setProperty("--L", m.colors[0]); hudEl.style.setProperty("--R", m.colors[1]);
    const lay = hudEl.firstChild;
    if (lay.dataset.scene !== s) { lay.dataset.scene = s; lay.className = "lay"; lay.textContent = ""; lay.__html = null; lay.__seen = false; }
    FX.on = !(typeof location !== "undefined" && /[?&]anim=off\b/.test(location.search));
    if (lay.__html !== out.html) { const tpl = document.createElement("div"); tpl.innerHTML = out.html; patchKids(lay, tpl); lay.__html = out.html; fxFlush(hudEl); }
    syncCams(hudEl.lastChild, out.cams);
    return m;
  }

  /* Preview backdrop, drawn at full 1280x720 so it stays crisp. It's a stand-in for game footage, not
     a picture of the game: "game" picks a neutral backdrop that fits the event's game, "image" uses your own screenshot. */
  function drawBg(c, kind, game, imageUrl) {
    const W = 1280, H = 720; c.width = W; c.height = H; const g = c.getContext("2d");
    const vignette = a => { const v = g.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, W * .72); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, `rgba(0,0,0,${a})`); g.fillStyle = v; g.fillRect(0, 0, W, H); };
    if (kind === "none") { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); return; }
    if (kind === "checker") { for (let y = 0; y < H; y += 40) for (let x = 0; x < W; x += 40) { g.fillStyle = ((x + y) / 40) % 2 ? "#2b2c31" : "#202126"; g.fillRect(x, y, 40, 40); } return; }
    if (kind === "image" && imageUrl) {
      g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
      const im = new Image();
      im.onload = () => { const k = Math.max(W / im.width, H / im.height), w = im.width * k, h = im.height * k; g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); };
      im.src = imageUrl; return;
    }
    if (game === "League of Legends") { // dark top-down map feel: teal vignette, hex grid, a river and the three lanes
      const bg = g.createRadialGradient(W * .5, H * .55, 60, W * .5, H * .55, W * .8); bg.addColorStop(0, "#1a3a44"); bg.addColorStop(1, "#061015"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.strokeStyle = "rgba(130,200,190,.06)"; g.lineWidth = 2; const s = 54, hh = s * Math.sqrt(3) / 2;
      for (let row = -1; row * hh < H + hh; row++) for (let col = -1; col * s * 1.5 < W + s; col++) {
        const x = col * s * 1.5, y = row * hh * 2 + (col % 2 ? hh : 0); g.beginPath();
        for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; g.lineTo(x + s * Math.cos(a), y + s * Math.sin(a)); } g.closePath(); g.stroke(); }
      g.fillStyle = "rgba(60,160,190,.13)"; g.beginPath(); g.moveTo(0, H * .78); g.lineTo(W * .22, H); g.lineTo(W, H * .2); g.lineTo(W * .78, 0); g.lineTo(0, H * .78); g.fill();
      g.strokeStyle = "rgba(220,200,140,.10)"; g.lineWidth = 36; g.lineCap = "round"; g.lineJoin = "round";
      g.beginPath(); g.moveTo(W * .1, H * .9); g.lineTo(W * .1, H * .12); g.lineTo(W * .88, H * .12); g.moveTo(W * .12, H * .88); g.lineTo(W * .88, H * .14); g.moveTo(W * .12, H * .9); g.lineTo(W * .9, H * .9); g.lineTo(W * .9, H * .14); g.stroke();
      vignette(.55); return;
    }
    if (game === "Rocket League") { // a dark arena with a lit pitch in perspective
      const sky = g.createLinearGradient(0, 0, 0, H * .5); sky.addColorStop(0, "#050b18"); sky.addColorStop(1, "#14305e"); g.fillStyle = sky; g.fillRect(0, 0, W, H);
      const y0 = H * .36; for (let i = 0; i < 14; i++) { const k0 = i / 14, k1 = (i + 1) / 14, ya = y0 + (H - y0) * k0 * k0 * .9 + (H - y0) * k0 * .1, yb = y0 + (H - y0) * k1 * k1 * .9 + (H - y0) * k1 * .1;
        const xa = W * (.3 - .38 * k0), xb = W * (.3 - .38 * k1); g.fillStyle = i % 2 ? "#14532b" : "#116027";
        g.beginPath(); g.moveTo(xa, ya); g.lineTo(W - xa, ya); g.lineTo(W - xb, yb); g.lineTo(xb, yb); g.fill(); }
      g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 4; g.beginPath(); g.moveTo(W * .3, y0); g.lineTo(W * .7, y0); g.moveTo(W / 2, y0); g.lineTo(W / 2, H); g.stroke();
      g.beginPath(); g.ellipse(W / 2, H * .66, 170, 56, 0, 0, Math.PI * 2); g.stroke();
      const glow = g.createLinearGradient(0, y0 - 60, 0, y0); glow.addColorStop(0, "rgba(255,140,30,0)"); glow.addColorStop(1, "rgba(255,140,30,.55)"); g.fillStyle = glow; g.fillRect(W * .42, y0 - 60, W * .16, 60);
      vignette(.6); return;
    }
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#0b1d17"); bg.addColorStop(1, "#050a09"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(255,255,255,.04)"; g.lineWidth = 2; for (let x = 0; x < W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = 0; y < H; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    vignette(.5);
  }

  /* Which live feed an event reads: its own game's feed unless its Live Game page picked another source. The server and the
     pages share this, so they always agree. "demo:<id>" is that event's own test match; "manual" has no feed (Riftbound). */
  const AUTO_FEED = { "Rocket League": "rl", "League of Legends": "lol", "Minecraft": "mc", "Riftbound": "manual", "Dead by Daylight": "manual", "Fortnite": "manual" };
  function feedKey(ev) {
    const s = (ev && ev.source) || "auto";
    return s === "auto" ? AUTO_FEED[ev && ev.game] || "ocr" : s === "demo" ? "demo:" + ev.id : s;
  }

  // the html a scene draws for an event and a live feed, without a page (used by the tests)
  function sceneHtml(ev, game, scene, ctx) { CTX = ctx || {}; const m = model(ev, game); return S[resolveScene(ev, m, scene)](m).html; }
  function sceneOut(ev, game, scene, ctx) { CTX = ctx || {}; const m = model(ev, game); return S[resolveScene(ev, m, scene)](m); } // markup and cameras (tests)

  const api = { SCENES, bbScore, model, render, drawBg, esc, fmt, feedKey, gdLabel, sceneHtml, sceneOut, nameMatch, GAMEDEF, fnPoints, fnTable, dbdScore };
  if (typeof window !== "undefined") window.SaintsHUD = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api; // the server uses the same model for the data outputs
})();
