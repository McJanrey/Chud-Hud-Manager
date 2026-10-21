// Shared HUD renderer for the dashboard previews and the OBS overlay.
(function () {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = s => { s = Math.max(0, Math.floor(+s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }; // whole seconds: the Minecraft and Riftbound clocks are fractional
  const PH = `<img class="ph-ph" src="/brand/placeholder.png" alt="">`; // stand-in person when a player has no photo
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
    statsplayer: "Stats Page Individual", statsteam: "Stats Page Team", lineup: "Team Lineup", timer: "Timer", title: "Title Screen", ads: "Ad Rotation", draft: "Champion Select", mapveto: "Map Selection", agents: "Agent Select",
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
    const size = kind === "lol" ? 5 : kind === "val" ? Math.max(2, Math.min(5, Math.round(+(ev.val && ev.val.squad)) || 2)) : (GAMEDEF[ev.game] && GAMEDEF[ev.game].squad) || 3; // VALORANT's squad is a setting (2 to 5)
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
          avatar: r ? r.avatar : "", country: r ? r.country : "", cam: r ? r.cam : "", camHide: !!(r && r.camHide), pid: r ? r.id : "", agent: r && r.agent ? r.agent : "" });
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
      clock: live || hasClock ? game.time : 300, clockLive: live || hasClock, clockAt: (game && game.clockAt) || 0, squad: size, ot: !!(game && game.overtime), replay: !!(game && game.replay), podium: !!(game && game.podium),
      connected: !!(game && game.connected), source: game ? game.source : "",
    };
  }

  const lg = (t, cls = "lgbox") => `<div class="${cls}">${!t ? `<div class="lg" style="background:#2a2b31">?</div>`
    : t.logos && t.logos[0] ? `<img class="lg" src="${esc(t.logos[0])}" alt="">`
    : `<svg class="lg" viewBox="0 0 100 100" style="background:${esc(t.color)}"><text x="50" y="52" text-anchor="middle" dominant-baseline="central" fill="currentColor" font-size="${[0, 60, 54, 46, 36, 30][Math.min(5, Math.max(1, (t.tag || "?").slice(0, 5).length))]}">${esc((t.tag || "?").slice(0, 5))}</text></svg>`}</div>`;
  const tourLogo = ev => (ev.tournament.logos || []).find(Boolean) || "/brand/chud-hud.png"; // the app's logo until the tournament has its own
  const sideTeam = (ev, id) => ev.teams.find(t => t.id === id);

  /* ---------------- scenes: each returns { html, cams } ---------------- */
  const camUrlOf = (ev, p) => (p && !p.camHide && (p.cam || (p.pid ? ownCam(ev, p.pid) : ""))) || ""; // camHide: hidden on the Camera feed page
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
  /* Where caster nameplates sit (1280 x 720 stage), taken from MJ's 1920 x 1080 desk reference: the plates stand on the dark front of the
     desk (about y 940 to 1040 at 1080p), centred under each caster. Two casters are at the reference's x 460 and x 1360, one caster is
     centred, and more share the desk evenly; when a row can't hold them (four plates for the standard 296 px plate, three for LOTD's
     380 px one) they go in rows, the upper row first. Every plate is one size. LOTD has its own plate artwork, so its size differs. */
  const EDITION = typeof document !== "undefined" && document.documentElement ? document.documentElement.getAttribute("data-variant") || "" : "";
  const NP = EDITION === "lotd" ? { w: 380, y: 639, gap: 80 } : { w: 296, y: 623, gap: 96 };
  const NP_CAP = Math.floor(1240 / (NP.w + 10)); // plates a row can hold, with room between them
  const npRowX = (m, k) => (m === 1 ? 640 - NP.w / 2 : m === 2 ? [307, 907][k] - NP.w / 2 : Math.round(27 + k * (1280 - NP.w - 54) / (m - 1)));
  function casterSpot(i, n) {
    const rows = Math.ceil(n / NP_CAP), base = Math.floor(n / rows), extra = n % rows; // the upper rows take the extra plate
    let r = 0, first = 0;
    for (; r < rows; r++) { const c = base + (r < extra ? 1 : 0); if (i < first + c) return { x: Math.round(npRowX(c, i - first)), y: NP.y - (rows - 1 - r) * NP.gap }; first += c; }
    return { x: 0, y: NP.y };
  }
  S.casters = (m) => {
    const ev = m.ev, kit = (CTX.kits || {})[ev.kit], n = Math.max(1, Math.min(8, Math.round(+(kit && kit.seats) || { solo: 1, duo: 2, trio: 3 }[ev.camera.layout] || 2)));
    const cams = []; let html = "";
    ev.camera.seats.slice(0, n).forEach((s, i) => {
      const t = ev.talent.find(x => x.id === s.talent), social = t && t.socials && t.socials[0] && t.socials[0].h ? t.socials[0].p + "/" + t.socials[0].h : "";
      const { x, y } = casterSpot(i, n); // fixed spots, one size: nothing is dragged or resized
      const sub = [s.role || (t && t.role) || "", social].filter(Boolean).join(" | ");
      html += `<div class="np" data-i="${i}" style="left:${x}px;top:${y}px"><i class="sh"></i><div class="bd"><b data-fit>${esc(t ? t.name : "Caster " + (i + 1))}</b>${sub ? `<small data-fit>${esc(sub)}</small>` : ""}</div></div>`;
      const seatUrl = s.url || ownCam(ev, "seat" + i);
      if (seatUrl) cams.push({ key: "seat" + i + seatUrl, url: seatUrl, x: x + (NP.w - 256) / 2, y: Math.max(0, y - 150), w: 256, h: 144 });
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
    const sponsor = cur || logoAds(ev) ? `<div class="l3-sp" data-k="l3-sp"><div class="in">${logoBox(ev, order)}</div></div>` : ""; // cur, si: kept for the vMix fields
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
    <div class="pic">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : PH}</div>
    <div class="info"><div style="display:flex;align-items:center;gap:14px;font-size:30px;color:${c}">${lg(p.team).replace('class="lgbox"', 'class="lgbox" style="width:44px;height:44px"')}${esc(p.team ? p.team.name : "")}</div><b>${esc(p.display)}</b>
    <div class="grid">${cols.map(([k, n]) => `<div><b class="num">${p[k] || 0}</b><small>${n}</small></div>`).join("")}</div></div></div></div>`, cams: [] };
  };
  S.lineup = (m) => {
    const side = (t, s) => `<div class="side" style="--c:${m.colors[s]}"><div class="hd">${lg(t)}<span>${esc(t ? t.name : "TBD")}</span></div>
      ${(t ? t.players : []).map(p => `<div class="p"><div class="av">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : PH}</div><b>${esc(p.alias || p.ign)}</b>${p.country ? `<span class="h-cc">${esc(p.country)}</span>` : ""}</div>`).join("") || `<div class="p" style="padding-left:16px"><small>ROSTER NOT SET</small></div>`}</div>`;
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
    const ev = m.ev, o = so(ev, "rankings"), rows = ev.standings.slice().sort((a, b) => b.w - a.w || a.l - b.l || b.gd - a.gd).slice(0, 10);
    const head = o.title ? `<div class="h-eyebrow">${esc(ev.tournament.name || "")}</div><div class="h-title" style="font-size:90px">STANDINGS</div>` : "";
    const body = rows.map((r, i) => { const t = sideTeam(ev, r.team); return `<tr class="${i === 0 ? "top" : ""}"><td class="num">${i + 1}</td><td class="tm"><div class="tmi">${o.logos ? lg(t) : ""}${esc(t ? t.name : "TBD")}</div></td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td></tr>`; }).join("");
    return { html: `<div class="h-full${o.bg ? "" : " nobg"}">${head}<table class="h-table" style="width:820px"><thead><tr><th>#</th><th style="text-align:left">TEAM</th><th>W</th><th>L</th><th>${gdLabel(ev.game)}</th></tr></thead><tbody>${body}</tbody></table></div>${o.banner ? bpBanner(ev) : ""}${o.ticker ? bpTicker(ev) : ""}`, cams: [] };
  };
  S.timer = (m) => {
    const t = m.ev.timer, rem = t.endsAt ? Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) : t.remaining;
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(m.ev.live.seriesTitle || m.ev.name)}</div><div class="h-title" style="font-size:80px">${esc(t.label)}</div><div class="h-timer num">${fmt(rem)}</div></div>`, cams: [] };
  };

  /* ---------------- broadcast pack: lower third, schedule, team and player stats, lineup, bracket, starting soon, title ----------------
     Laid out on MJ's references at 1280x720. Shared pieces: a top bar (series title over a gold rule), the tournament banner (a pennant
     with the tournament logo, top right), the match text (title and gold subline), a sponsor box, and the bottom announcement ticker.
     Each scene has its own switches in hud.sc[scene] (Background, Bottom Announcement, Match Text, ...), set in the HUD Editor. */
  const SC_DEF = {
    lowerthird: { ticker: true, match: true },
    schedule: { bg: true, ticker: true, match: true },
    statsteam: { bg: false, ticker: true, match: true, top: true, banner: true },
    statsplayer: { bg: false, ticker: true, top: true, banner: true, stats: true, team: true, pid: "" },
    lineup: { bg: true, top: true, banner: true, lineup: true, side: 0 },
    bracket: { bg: true, logo: true },
    starting: { bg: false, border: true, count: true, logo: true, sponsors: true, img: "" },
    title: { bg: false, border: true, logo: true, sponsors: true, img: "" },
    rankings: { bg: true, title: true, logos: true, banner: false, ticker: false },
    agents: { bg: false, map: true, lineup: true },
  };
  const so = (ev, sc) => Object.assign({}, SC_DEF[sc], ((ev.hud || {}).sc || {})[sc]);
  const bpClock = () => { try { return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).toUpperCase(); } catch { return ""; } };
  const tickerMsgs = ev => String((ev.lowerThird || {}).ticker || "").split(/\n|\|/).map(s => s.trim()).filter(Boolean);
  // the announcement is two lines (Line 1, Line 2) and a speed; `ticker` keeps them joined as "a | b" so every scene and older events read it the same way
  const tickerSpeed = ev => Math.max(10, Math.min(200, Math.round(+((ev.lowerThird || {}).tickerSpeed)) || 60));
  const tickerLines = ev => { const l = ev.lowerThird || {}, base = tickerMsgs(ev);
    return l.line1 !== undefined || l.line2 !== undefined ? { l1: String(l.line1 || ""), l2: String(l.line2 || ""), more: Array.isArray(l.lineMore) ? l.lineMore.map(String) : [] } : { l1: base[0] || "", l2: base[1] || "", more: base.slice(2) }; };
  const tickerJoin = (l1, l2, more) => [l1, l2].concat(more || []).map(x => String(x || "").replace(/\s*\|\s*/g, " ").trim()).filter(Boolean).join(" | ");
  function bpTicker(ev, fallback) { // fallback: with no typed announcement, scroll the event name and the sponsors instead of nothing
    const msgs = tickerMsgs(ev).length || !fallback ? tickerMsgs(ev) : [ev.tournament.name || ev.name].concat(sponsorsOf(ev).map(x => x.name)).filter(Boolean); if (!msgs.length) return "";
    const one = msgs.map(x => `<span>${esc(x.toUpperCase())}</span><i></i>`).join(""), reps = Math.max(2, Math.ceil(12 / msgs.length));
    const group = one.repeat(reps), secs = Math.round(Math.max(18, msgs.join(" ").length * reps * 0.22) * 60 / tickerSpeed(ev)); // speed 60 is the long-standing pace; 200 is over three times faster
    return `<div class="bp-tk" data-k="bp-tk"><div class="rl" style="animation-duration:${secs}s"><div class="g">${group}</div><div class="g">${group}</div></div></div>`;
  }
  const bpSeries = ev => esc(String(ev.live.seriesTitle || ev.tournament.name || ev.name || "").toUpperCase());
  const bpTop = ev => `<div class="bp-top" data-k="bp-top"><b>${bpSeries(ev)}</b><i></i></div>`;
  const bpBanner = ev => `<div class="bp-ban" data-k="bp-ban"><svg viewBox="0 0 136 250" preserveAspectRatio="none" aria-hidden="true"><polygon points="1.5,0 134.5,0 134.5,206 68,248 1.5,206" fill="#02140c" stroke="#FDC82F" stroke-width="2.5"/></svg><img src="${esc(tourLogo(ev))}" alt=""></div>`;
  const bpMatch = ev => { const l = ev.lowerThird || {}, t = l.title || ev.tournament.name || ev.game, s = l.subtitle || ev.live.roundTitle || ev.live.gameSeries || "";
    return { t: esc(String(t).toUpperCase()), s: esc(String(s).toUpperCase()) }; };
  const sponsorsOf = ev => (ev.tournament.sponsors || []).filter(x => x && (x.logo || x.name));
  function bpSponsor(ev, cls) {
    return `<div class="bp-spon ${cls || ""}" data-k="bp-spon">${logoBox(ev, sponsorsOf(ev))}</div>`;
  }
  function bpSponsorRun(ev) { // the sponsor strip under the bottom line on Starting Soon and Title: logos glide past between two slanted gold lines
    const sp = sponsorsOf(ev); if (!sp.length) return "";
    const one = sp.map(x => x.logo ? `<img src="${esc(x.logo)}" alt="">` : `<b>${esc(x.name)}</b>`).join(""), reps = Math.max(2, Math.ceil(6 / sp.length));
    return `<div class="bp-run" data-k="bp-run"><div class="rl" style="animation-duration:${Math.max(12, sp.length * reps * 3)}s"><div class="g">${one.repeat(reps)}</div><div class="g">${one.repeat(reps)}</div></div></div>`;
  }
  const tagOf = (t, s, kind) => esc(t ? (t.tag || t.name) : kind === "lol" ? (s ? "RED" : "BLUE") : s ? "ORG" : "BLU");
  // per-player stats: what a live game reports, unless a number was typed on the Stats page (roster player's stats)
  const rosterP = (ev, pid) => { for (const t of ev.teams) { const p = t.players.find(x => x.id === pid); if (p) return p; } return null; };
  const stv = (ev, p, k) => { const r = p && p.pid ? rosterP(ev, p.pid) : null, typed = r && r.stats ? r.stats[k] : undefined;
    return typed != null && typed !== "" ? typed : p && p[k] != null ? p[k] : 0; };
  const BPCOLS = {
    rl: [["goals", "GOALS"], ["assists", "ASSISTS"], ["saves", "SAVES"], ["score", "SCORE"]],
    lol: [["kills", "KILLS"], ["deaths", "DEATHS"], ["assists", "ASSISTS"], ["cs", "CS"]],
    def: [["kills", "KILLS"], ["deaths", "DEATHS"], ["assists", "ASSISTS"], ["score", "PERFORMANCE SCORE"]],
  };
  const bpCols = m => BPCOLS[m.kind] || BPCOLS.def;
  // only real players: a named roster player, or one a live game reports (never a padded "Player 3" seat)
  const bpPlayers = (m, s) => m.players[s].filter(p => { if (!p || p.shortcut === 0 || !p.display) return false;
    if (m.live) return true; const r = p.pid ? rosterP(m.ev, p.pid) : null; return !!(r && (r.ign || r.alias)); });
  const pic = (p, cls) => { const url = p && (p.agent && VAL_UUID.test(String(p.agent)) ? `/val-agent/${p.agent}/displayicon.png` : p.avatar);
    return `<span class="${cls}">${url ? `<img src="${esc(url)}" alt="">` : PH}</span>`; };

  S.lowerthird = (m) => {
    const ev = m.ev, o = so(ev, "lowerthird"), [L, R] = m.sides, mt = bpMatch(ev), lbl = esc(String((ev.lowerThird || {}).label || "LOCAL TIME").toUpperCase());
    let h = `<div class="bp-l3" data-k="bp-l3"><div class="ck"><b class="num">${esc(bpClock())}</b><small>${lbl}</small></div><i class="sl"></i>`;
    if (o.match) h += `<div class="scb">${lg(L)}<b class="num">${+m.series[0] || 0}</b><i></i><b class="num">${+m.series[1] || 0}</b>${lg(R)}</div><i class="sl"></i>`;
    h += `<div class="mt"><b>${mt.t}</b><small>${mt.s}</small></div>${bpSponsor(ev)}</div>`;
    if (o.ticker) h += bpTicker(ev);
    return { html: h, cams: [] };
  };
  /* LOTD's Schedule, laid out on MJ's 1920 x 1080 wireframe: the video segment on the left (a frame), UPCOMING with two activity cards that
     step in, the ad rotation under them, a wide bar with the event name, the game and UP NEXT, and the ticker. Same ticks as the standard
     Schedule: Background, Match Text (the bar) and Bottom Announcement (the ticker). Long names shrink to fit their boxes. */
  function lotdSchedule(m) {
    const ev = m.ev, o = so(ev, "schedule"), open = x => x.sa === "" || x.sb === "";
    const list = ev.schedule.filter(open).concat(ev.schedule.filter(x => !open(x)));
    const nm = (x, side) => { const t = sideTeam(ev, side ? x.right : x.left); return t ? (t.name || t.tag || "TBD") : "TBD"; };
    // however many activities there are, up to five: cards keep the wireframe's 82 px until the stack (165 to 365) is full, then share it
    const shown = list.slice(0, 5), n = shown.length, GAP = 7, ch = Math.max(30, Math.min(82.7, Math.floor((200 - (n - 1) * GAP) / Math.max(1, n))));
    const cards = shown.map((x, i) => { const teams = x.left || x.right ? `${nm(x, 0)} VS ${nm(x, 1)}` : "", sub = [x.time, teams].filter(Boolean).join(" | ");
      return `<div class="lc${ch < 58 ? " tight" : ""}" data-k="lsc${i}" style="top:${(164.7 + i * (ch + GAP)).toFixed(1)}px;height:${ch}px;width:${342 - 12.4 * i}px;--f:${Math.min(33, Math.round(ch * 0.4))}px"><b data-fit>${esc(String(x.label || "ACTIVITY " + (i + 1)).toUpperCase())}</b>${ch < 58 || !sub ? "" : `<small data-fit>${esc(sub.toUpperCase())}</small>`}</div>`; }).join("");
    const ads = adList(ev).length ? adRot(ev, "", false) : logoBox(ev, sponsorsOf(ev));
    let h = o.bg ? `<div class="bp-bg"></div>` : "";
    h += `<div class="lsch" data-k="lsch"><div class="vid"></div><em class="up">UPCOMING</em>${cards || `<div class="lc" style="top:164.7px;height:82.7px;width:342px"><small>NOTHING SCHEDULED</small></div>`}<div class="adb">${ads}</div><em class="act" data-k="lsact">ACTIVITIES</em>
      ${o.match ? `<div class="bar"><b class="ev" data-fit>${esc(String(ev.tournament.name || ev.name || "").toUpperCase())}</b><i class="dv"></i><div class="nx"><b data-fit>${esc(String(ev.game).toUpperCase())}</b><b class="un">UP NEXT</b></div></div>` : ""}
      ${o.ticker ? bpTicker(ev, true) : ""}</div>`;
    return { html: h, cams: [] };
  }
  S.schedule = (m) => {
    if (EDITION === "lotd") return lotdSchedule(m);
    const ev = m.ev, o = so(ev, "schedule"), [L, R] = m.sides, mt = bpMatch(ev);
    const cards = ev.schedule.slice(0, 3).map((x, i) => { const a = sideTeam(ev, x.left), b = sideTeam(ev, x.right), done = x.sa !== "" && x.sb !== "";
      return `<div class="card" data-k="sc${i}"><b>${esc(String(x.label || "MATCH " + (i + 1)).toUpperCase())}</b><em>${esc(String(ev.game).toUpperCase())}</em>
        <small>${esc((a ? a.name : "TBD").toUpperCase())} VS. ${esc((b ? b.name : "TBD").toUpperCase())}${done ? ` · ${esc(x.sa)}-${esc(x.sb)}` : ""}</small><small class="tm">${esc(String(x.time || "").toUpperCase())}</small></div>`; }).join("");
    let h = `${o.bg ? `<div class="bp-bg"></div>` : ""}<div class="bp-frame" data-k="bp-frame"></div>
      <div class="bp-sch" data-k="bp-sch"><em>UPCOMING</em><b>SCHEDULE</b>${cards || `<div class="card"><small>NO MATCHES SCHEDULED</small></div>`}</div>${bpSponsor(ev, "big")}
      <div class="bp-bar" data-k="bp-bar"><div class="ck"><b class="num">${esc(bpClock())}</b><small>LOCAL TIME</small></div>
        <div class="sb">${L && R && !["mc", "rb", "fn"].includes(m.kind) ? `${lg(L)}<b class="tg">${tagOf(L, 0, m.kind)}</b><b class="num sc">${+m.series[0] || 0}</b><i></i><b class="num sc">${+m.series[1] || 0}</b><b class="tg">${tagOf(R, 1, m.kind)}</b>${lg(R)}` : ""}</div>
        ${o.match ? `<div class="mt"><b>${mt.t}</b><small>${mt.s}</small></div>` : ""}</div>`;
    if (o.ticker) h += bpTicker(ev);
    return { html: h, cams: [] };
  };
  S.statsteam = (m) => {
    const ev = m.ev, o = so(ev, "statsteam"), [L, R] = m.sides, mt = bpMatch(ev), cols = bpCols(m);
    const table = s => `<div class="tb ${s ? "r" : "l"}" style="--c:${esc(m.colors[s])}"><div class="thd"><span></span><span></span>${cols.map(([, n]) => `<span class="${n.length > 8 ? "sm" : ""}">${n}</span>`).join("")}</div>
      ${bpPlayers(m, s).slice(0, 5).map((p, i) => `<div class="rw" data-k="p${s}${i}">${pic(p, "pf")}<b class="nm">${esc(noTag(p.display).toUpperCase())}</b>${cols.map(([k]) => `<b class="num">${esc(stv(ev, p, k))}</b>`).join("")}</div>`).join("")}</div>`;
    let h = `${o.bg ? `<div class="bp-bg"></div>` : ""}${o.top ? bpTop(ev) : ""}${o.banner ? bpBanner(ev) : ""}
      <div class="bp-st" data-k="bp-st">${o.match ? `<div class="mt"><b>${mt.t}</b><small>${mt.s}</small></div>` : ""}
        <div class="sbar"><div class="h l" style="--c:${esc(m.colors[0])}">${lg(L)}<b class="tg">${tagOf(L, 0, m.kind)}</b><b class="num">${+m.score[0] || 0}</b></div><div class="h r" style="--c:${esc(m.colors[1])}"><b class="num">${+m.score[1] || 0}</b><b class="tg">${tagOf(R, 1, m.kind)}</b>${lg(R)}</div></div>
        <div class="tbs">${table(0)}${table(1)}</div></div>`;
    if (o.ticker) h += bpTicker(ev);
    return { html: h, cams: [] };
  };
  S.statsplayer = (m) => {
    const ev = m.ev, o = so(ev, "statsplayer"), all = [...bpPlayers(m, 0), ...bpPlayers(m, 1)];
    const p = (o.pid && all.find(x => x.pid === o.pid)) || all.find(x => x === m.focus) || all.find(x => x === m.mvp) || all[0];
    let h = `${o.bg ? `<div class="bp-bg"></div>` : ""}${o.top ? bpTop(ev) : ""}${o.banner ? bpBanner(ev) : ""}`;
    if (p) {
      const t = p.team, rows = m.kind === "rl" ? [["GOALS", stv(ev, p, "goals")], ["ASSISTS", stv(ev, p, "assists")], ["SAVES", stv(ev, p, "saves")], ["SCORE", stv(ev, p, "score")]]
        : m.kind === "lol" ? [["K/D/A", `${stv(ev, p, "kills")} / ${stv(ev, p, "deaths")} / ${stv(ev, p, "assists")}`], ["CS", stv(ev, p, "cs")], ["LEVEL", stv(ev, p, "level")], ["VISION", stv(ev, p, "ward")]]
        : [["K/D/A", `${stv(ev, p, "kills")} / ${stv(ev, p, "deaths")} / ${stv(ev, p, "assists")}`], ["PERFORMANCE SCORE", stv(ev, p, "score")], ["FIRST KILLS", stv(ev, p, "fk")], ["MULTI KILLS", stv(ev, p, "mk")]];
      const photo = p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : PH;
      h += `<div class="bp-ind" data-k="bp-ind-${esc(p.pid || p.display)}">${o.team && t ? `<span class="vt">${esc(t.name.toUpperCase())}</span>` : ""}<div class="ph">${photo}</div><b class="pn">${esc(noTag(p.display).toUpperCase())}</b>
        ${o.stats ? `<div class="rows">${rows.map(([n, v], i) => `<div class="r" data-k="r${i}"><span>${n}</span><b class="num">${esc(v)}</b></div>`).join("")}</div>` : ""}</div>`;
    }
    if (o.ticker) h += bpTicker(ev);
    return { html: h, cams: [] };
  };
  const flag = cc => /^[a-z]{2}$/i.test(String(cc || "")) ? `<img class="fl" src="https://flagcdn.com/w40/${String(cc).toLowerCase()}.png" alt="" onerror="this.remove()">` : "";
  S.lineup = (m) => {
    const ev = m.ev, o = so(ev, "lineup"), s = +o.side ? 1 : 0, t = m.sides[s], ps = (t ? t.players : []).filter(p => p.ign || p.alias).slice(0, 5);
    let h = `${o.bg ? `<div class="bp-bg"></div>` : ""}${o.top ? bpTop(ev) : ""}${o.banner ? bpBanner(ev) : ""}`;
    if (o.lineup) h += `<div class="bp-lu" data-k="bp-lu${s}" style="--n:${Math.max(1, ps.length)}"><div class="ppl">${ps.map((p, i) => `<div class="pp" data-k="pp${i}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : PH}</div>`).join("")}</div>
      <div class="nms">${ps.map((p, i) => `<div class="nm" data-k="nm${i}">${flag(p.country)}<b>${esc(String(p.alias || p.ign).toUpperCase())}</b></div>`).join("") || `<div class="nm"><b>${esc(t ? t.name.toUpperCase() : "PICK A TEAM")}</b></div>`}</div></div>`;
    return { html: h, cams: [] };
  };
  S.bracket = (m) => {
    const ev = m.ev, o = so(ev, "bracket"), R = (ev.bracket.rounds || []).filter(r => r.matches && r.matches.length).slice(0, 4);
    const W = 156, RH = 30, GAP = 4, X0 = 104, DX = 190, TOP = 158, BOT = 640;
    const ys = []; // y of each match's centre, per round
    R.forEach((r, ri) => { ys[ri] = r.matches.map((_, j) => { const prev = ys[ri - 1]; if (prev && prev[2 * j] != null && prev[2 * j + 1] != null) return (prev[2 * j] + prev[2 * j + 1]) / 2;
      const n = r.matches.length, step = (BOT - TOP) / n; return TOP + step * (j + .5); }); });
    const row = (id, sc, seed, win) => { const t = sideTeam(ev, id); return `<div class="tr${win ? " w" : ""}">${seed ? `<i>${seed}</i>` : ""}<span>${esc(t ? (t.tag || t.name).toUpperCase() : "TBD")}</span><b class="num">${esc(sc)}</b></div>`; };
    let h = `${o.bg ? `<div class="bp-bg"></div>` : ""}<div class="bp-cn tl"></div><div class="bp-cn tr"></div><div class="bp-cn bl"></div><div class="bp-cn br"></div>
      <div class="bp-hd">${esc(String(ev.tournament.name || "TOURNAMENT").toUpperCase())}</div><div class="bp-ft">${esc(String(ev.live.seriesTitle || ev.tournament.format || "").toUpperCase())}</div>
      <div class="bp-bt">${(R[0] ? R[0].matches.length * 2 : 0)} COMPETITOR BRACKET</div>`;
    let seed = 0;
    R.forEach((r, ri) => r.matches.forEach((x, j) => {
      const y = ys[ri][j], x0 = X0 + ri * DX, a = +x.sa, b = +x.sb, d = x.sa !== "" && x.sb !== "";
      h += `<div class="bp-mt" data-k="m${ri}-${j}" style="left:${x0}px;top:${y - RH - GAP / 2}px;width:${W}px">${row(x.a, x.sa, ri ? "" : String(++seed).padStart(2, "0"), d && a > b)}${row(x.b, x.sb, ri ? "" : String(++seed).padStart(2, "0"), d && b > a)}</div>`;
      if (ri < R.length - 1 && j % 2 === 0 && ys[ri][j + 1] != null) { // bracket line joining this pair to the next round
        const y2 = ys[ri][j + 1], xm = x0 + W + 12;
        h += `<i class="bp-ln" style="left:${x0 + W}px;top:${y}px;width:12px;height:2px"></i><i class="bp-ln" style="left:${x0 + W}px;top:${y2}px;width:12px;height:2px"></i>
          <i class="bp-ln" style="left:${xm}px;top:${y}px;width:2px;height:${y2 - y + 2}px"></i><i class="bp-ln" style="left:${xm}px;top:${(y + y2) / 2}px;width:${DX - W - 12}px;height:2px"></i>`;
      }
    }));
    if (R.length) { const last = R.length - 1, y = ys[last][0], x0 = X0 + last * DX + W, fm = R[last].matches[0], a = +fm.sa, b = +fm.sb, d = fm.sa !== "" && fm.sb !== "";
      const champ = d ? sideTeam(ev, a > b ? fm.a : fm.b) : null;
      h += `<i class="bp-ln" style="left:${x0}px;top:${y}px;width:36px;height:2px"></i><div class="bp-win" style="left:${x0 + 36}px;top:${y - 30}px"><span>${champ ? esc((champ.name || "").toUpperCase()) : ""}</span></div>`; }
    if (o.logo) h += `<div class="bp-tl"><img src="${esc(tourLogo(ev))}" alt=""></div>`;
    return { html: h, cams: [] };
  };
  const bpFrame = (o, ev) => `${o.bg ? `<div class="bp-bg"></div>` : ""}${o.border ? `<i class="bp-gl t"></i><i class="bp-gl b"></i>` : ""}${o.sponsors ? bpSponsorRun(ev) : ""}`;
  S.starting = (m) => {
    const ev = m.ev, o = so(ev, "starting"), t = ev.timer, rem = t.endsAt ? Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) : t.remaining;
    let h = bpFrame(o, ev);
    if (o.logo) h += `<div class="bp-slogo" data-k="bp-slogo"><img src="${esc(o.img || tourLogo(ev))}" alt=""></div>`;
    if (o.count) h += `<div class="bp-cd" data-k="bp-cd"><small>${esc(String(t.label && t.label !== "BACK SOON" ? t.label : "STREAM STARTING IN").toUpperCase())}</small><b class="num">${fmt(rem)}</b></div>`;
    return { html: h, cams: [] };
  };
  S.title = (m) => {
    const ev = m.ev, o = so(ev, "title");
    let h = bpFrame(o, ev);
    if (o.logo) h += `<div class="bp-tlogo" data-k="bp-tlogo"><img src="${esc(o.img || tourLogo(ev))}" alt=""></div>`;
    return { html: h, cams: [] };
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
      if (r && r.cam && !r.camHide) cams.push({ key: "mccam-" + r.cam, url: r.cam, x: 324, y: 480, w: 256, h: 144 });
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
  /* Riftbound, laid out on MJ's Regional Qualifier references (1080p pixels / 1.5): a column per player (name, legend, camera, battlefield
     with 1ST/2ND and game markers, then the hand list or the featured card), the 1-8 score track on top, the showdown bar at the bottom and
     the event with the clock. Cards are Riftcodex ids with their name, energy, might and domain saved alongside, so the overlay needs no list. */
  const RB_DOM = { fury: "#c8323c", calm: "#3f9a4a", mind: "#2f6fc4", body: "#d9822b", chaos: "#7b3fbf", order: "#c9a227" };
  const rbCard = x => (x && typeof x === "object" && /^[a-z0-9-]{3,40}$/.test(String(x.id || "")) ? x : null);
  const rbImg = (c, cls) => (c ? artImg(`/rb-card/${c.id}.png`, cls) : "");
  S.rbingame = (m) => {
    const ev = m.ev, rb = ev.rb || {}, A = (k, s) => (Array.isArray(rb[k]) ? rb[k][s] : null);
    const elapsed = clk(rb.clock), shown = rb.limitMinutes ? Math.max(0, rb.limitMinutes * 60 - elapsed) : elapsed;
    const nm = s => (rb.names && rb.names[s]) || (m.sides[s] && m.sides[s].name) || `PLAYER ${s + 1}`, col = s => (rb.colors && rb.colors[s]) || m.colors[s];
    const pts = s => Math.max(0, Math.round(+((rb.points || [])[s]) || 0)), target = Math.max(1, Math.round(+rb.target) || 8);
    const need = Math.max(1, Math.ceil((+rb.bestOf || 3) / 2)), won = s => Math.max(0, Math.round(+((rb.games || [])[s]) || 0));
    const feat = rbCard(rb.feat) && (rb.feat.side === 0 || rb.feat.side === 1) ? rb.feat : null;
    let h = "";
    const side = s => {
      const lgd = rbCard(A("legend", s)), ch = rbCard(A("champ", s)), bf = rbCard(A("bf", s)), first = (rb.first === 1 ? 1 : 0) === s;
      let x = `<div class="rb3-col ${s ? "r" : "l"}" data-k="rb3-col-${s}" style="--c:${esc(col(s))}"><b class="nm${String(nm(s)).length > 16 ? " xs" : String(nm(s)).length > 11 ? " sm" : ""}">${esc(String(nm(s)).toUpperCase())}</b><i class="dv"></i>
        <div class="lg" data-k="rb3-lg-${s}-${lgd ? lgd.id : "x"}">${rbImg(lgd, "art")}<span class="t1">${esc(String(lgd ? lgd.name : (rb.legends || [])[s] || "").toUpperCase())}</span>${ch ? `<span class="t2">${esc(String(ch.name).toUpperCase())}</span>` : ""}</div>
        <div class="cm"></div>
        <div class="bf" data-k="rb3-bf-${s}-${bf ? bf.id : "x"}">${rbImg(bf, "art")}${bf ? `<span class="t1">${esc(String(bf.name).toUpperCase())}</span>` : ""}</div><b class="bft">${first ? "1ST" : "2ND"}</b>
        <div class="gm">${Array.from({ length: need }, (_, k) => `<i class="${k < won(s) ? "on" : ""}"></i>`).join("")}</div>`;
      const hand = (A("hand", s) || []).map(rbCard).filter(Boolean).slice(0, 6);
      if (feat && feat.side === s) x += `<div class="ft" data-k="rb3-ft-${feat.id}">${rbImg(feat, "card")}</div>`;
      else if (hand.length) x += `<div class="hd" data-k="rb3-hd-${s}">${hand.map((c, i) => { const d = RB_DOM[String(c.d || "").toLowerCase()] || "#4a5568";
        return `<div class="hr" data-k="hr-${s}-${i}-${c.id}" style="--d:${d}">${rbImg(c, "art")}<i class="sh"></i><span class="ct num">&times;${Math.max(1, Math.round(+c.n) || 1)}</span>${c.e != null && c.e !== "" ? `<b class="en num">${+c.e}</b>` : ""}<span class="cn">${esc(c.name)}</span>${c.m != null && c.m !== "" ? `<b class="mi num">${+c.m}</b>` : ""}</div>`; }).join("")}</div>`;
      else if (!s) { // the event and the clock fill the left column when nobody's hand is listed there
        const emb = (ev.tournament.logos || []).find(Boolean), tn = String(ev.tournament.name || "").trim();
        x += `<div class="evt">${emb ? `<img src="${esc(emb)}" alt="" onerror="this.style.display='none'">` : ""}${tn ? `<b>${esc(tn.toUpperCase())}</b>` : ""}${rb.roundTitle ? `<span class="rt">${esc(String(rb.roundTitle).toUpperCase())}</span>` : ""}<span class="ck num">${fmt(shown)}</span></div>`;
      }
      return x + `</div>`;
    };
    h += side(0) + side(1);
    // the score track: 1..7 from each end and the target in the middle; each player's points light up from their own end
    const half = target - 1, step = 26;
    const dot = (n, lit, cls, k) => `<i class="${cls}${lit ? " on" : ""}" data-k="${k}"><b class="num">${n}</b></i>`;
    h += `<div class="rb3-track" data-k="rb3-track" style="width:${(2 * half) * step + 32}px;margin-left:${-((2 * half) * step + 32) / 2}px">${Array.from({ length: half }, (_, i) => dot(i + 1, pts(0) >= i + 1, "d l", "tl" + i)).join("")}${dot(target, pts(0) >= target || pts(1) >= target, "d mid", "tm")}${Array.from({ length: half }, (_, i) => dot(half - i, pts(1) >= half - i, "d r", "tr" + i)).join("")}</div>`;
    // the showdown on a battlefield, with each side's might
    const sd = rb.sd && typeof rb.sd === "object" ? rb.sd : {}, sbf = rbCard(sd.bf);
    if (sd.on) h += `<div class="rb3-sd" data-k="rb3-sd">${rbImg(sbf, "art")}<b class="tag">SHOWDOWN</b><span class="t1">${esc(String(sbf ? sbf.name : "").toUpperCase())}</span>${[0, 1].map(s => `<b class="mt ${s ? "r" : "l"} num" style="--c:${esc(col(s))}">${Math.max(0, Math.round(+((sd.might || [])[s]) || 0))}</b>`).join("")}</div>`;
    // cameras: the player's own camera link, else their team's first player's
    const cams = [];
    [0, 1].forEach(s => { const t = m.sides[s], p = t && t.players && t.players[0], u = String((rb.cams || [])[s] || "") || (p && !p.camHide && (p.cam || ownCam(ev, p.id))) || "";
      if (/^https?:\/\//i.test(u)) cams.push({ key: "pc-rb-" + s + u, url: u, x: s ? 1070 : 26.7, y: 166, w: 184, h: 196 }); });
    return { html: h, cams };
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

  /* ---------------- VALORANT in-game scene (classes v3-*, sizes and colours are variables in hud.css) ----------------
     Laid out like a VALORANT broadcast over the game's own minimap and scoreboard: a top bar (team, one score each side, round line and
     the clock only while a screen-read clock keeps arriving), a players-left tab, sponsor boxes, and a bottom-anchored panel per player.
     Nothing is invented: HP, ultimate points and credits are drawn only if a player object ever carries them (none does today). */
  const VAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const VAL_FRESH = 5000, VAL_PITCH = 196 / 3; // VAL_PITCH: one player row, 98 px at 1080p; // a screen-read clock older than this is not drawn
  const artBad = new Map(); // picture url -> when it failed to load; left out of the markup for a minute (the initials tile shows), then tried again
  const artFail = url => { artBad.set(String(url), Date.now()); };
  const artImg = (url, cls) => (artBad.get(url) > Date.now() - 60000 ? "" : `<img class="${cls}" src="${esc(url)}" alt="" onerror="SaintsHUD.artFail(this.getAttribute('src'))">`);
  const noTag = s => String(s || "").replace(/#[^#]*$/, "").trim(); // a Riot ID without its #TAG
  const initials = s => { const w = String(s || "?").trim().split(/\s+/).map(x => Array.from(x)); return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2).join("")).toUpperCase(); }; // whole characters, so an emoji is never split
  // round line, players left and the clock for the scene and the vMix fields (one place, so they always agree)
  function valInfo(m) {
    const v = m.ev.val || {}, t = Math.max(1, Math.round(+v.target) || 10), n = m.squad || 2, dead = v.dead || {};
    const left = [0, 1].map(s => Math.max(0, n - m.players[s].filter(p => p.shortcut !== 0 && p.pid && dead[p.pid]).length));
    const sum = (+m.score[0] || 0) + (+m.score[1] || 0);
    const round = Math.max(1, Math.min(sum + 1, 2 * t - 1)), reg = Math.max(1, 2 * t - 2); // first to 13 is ROUND n/24; past that it is overtime
    return { target: t, squad: n, round, label: n === 2 ? `ROUND ${round}/${2 * t - 1}` : t > 1 && round > reg ? "OVERTIME" : `ROUND ${round}/${reg}`, left, used: !!v.aliveUsed, dead, // 2v2 Skirmish: no halves, no overtime
      fresh: !!(m.clockLive && m.clockAt && Date.now() - m.clockAt <= VAL_FRESH) };
  }
  /* cameras: "all" = a 116 x 65 tile on the inner side of each player's panel row; "action" = one 240 x 135 box a side near the bottom.
     Same keys and show rules as the shared camera rows, so the cameras stay loaded and switch instantly. */
  function valCams(m) {
    const cams = []; let html = "";
    if ((m.ev.camera || {}).director === "action") {
      const w = 240, h = 135, y = 564;
      [0, 1].forEach(s => {
        const x = s ? 795 : 245, act = actionIndex(m, s);
        m.players[s].forEach((p, i) => { const u = camUrlOf(m.ev, p); if (u) cams.push({ key: "ac-" + s + "-" + i + u, url: u, x, y, w, h, show: i === act }); });
        const p = act >= 0 ? m.players[s][act] : null;
        if (p) html += `<div class="pc act ${s ? "r" : "l"}" data-k="ac-${s}" style="left:${x}px;top:${y + h}px;width:${w}px;--c:${esc(m.colors[s])}"><span>${esc(noTag(p.display))}</span></div>`;
      });
      return { html, cams };
    }
    const top = 720 - (m.squad || 2) * VAL_PITCH;
    [0, 1].forEach(s => m.players[s].forEach((p, i) => { const u = camUrlOf(m.ev, p); if (u) cams.push({ key: "pc-" + s + "-" + i + u, url: u, x: s ? 928 : 236, y: Math.round(top + i * VAL_PITCH), w: 116, h: 65 }); }));
    return { html, cams };
  }
  S.valingame = (m) => {
    const ev = m.ev, sh = ev.hud.show, v = ev.val || {}, [L, R] = m.sides, info = valInfo(m);
    const vs = ["buy", "timeout"].includes(v.state) ? v.state : "main"; // HUD state: buy and timeout swap the side panels for the buy-round board
    let h = "";
    if (sh.score !== false) {
      // top bar, laid out on MJ's reference: two team halves, a centre plate with the score, clock and round, the players-left chips
      // and the ornament under it. Style: solid (the reference look), clear (no fills), or media (the operator's picture or video behind it).
      const style = ["solid", "clear", "media"].includes(v.barStyle) ? v.barStyle : "solid", bg = style === "media" ? String(v.barBg || "") : "";
      const nm = (t, s) => noTag(t ? t.name || (t.players[0] && t.players[0].ign) || t.tag : "") || (s ? "TEAM B" : "TEAM A");
      const wm = (t, s) => String((t && (t.tag || t.name)) || (s ? "B" : "A")).slice(0, 4).toUpperCase();
      const half = (t, s) => `<div class="hf ${s ? "r" : "l"}" data-k="v3-hf-${s}" style="--c:${esc(m.colors[s])}"><div class="mx"><i class="fill"></i><svg class="ol" viewBox="0 0 294 49" preserveAspectRatio="none"><polyline points="${s ? "3,48.5 3,26 26,4.5 175,4.5" : "94,4 3,4 3,23.5 26,45 291,45"}"/></svg><i class="sl"><b></b><b></b></i></div>
        <b class="wm">${esc(wm(t, s))}</b>${lg(t)}<div class="nw"><b class="nm">${esc(nm(t, s))}</b><i class="ln"></i></div><i class="mk"></i></div>`;
      const media = !bg ? "" : /\.(mp4|webm|mov)$/i.test(bg) ? `<video src="${esc(bg)}" autoplay muted loop playsinline disablepictureinpicture></video>` : `<img src="${esc(bg)}" alt="" onerror="this.style.display='none'">`;
      const chip = s => `<span class="cp ${s ? "r" : "l"}" data-k="cp-${s}" style="--c:${esc(m.colors[s])}"><b class="num${fnDrop("vcp" + s, info.left[s]) ? " dn" : ""}" data-k="cpn-${s}-${info.left[s]}">${info.left[s]}</b></span>`; // the number jumps when it drops
      h += `<div class="v3-top ${style}" data-k="v3-top-${style}">${media ? `<div class="v3-bg" data-k="v3-bg-${esc(bg)}">${media}</div>` : ""}<i class="hl"></i>${half(L, 0)}${half(R, 1)}
        <div class="ct" data-k="v3-ct"><b class="sc l num">${Math.max(0, Math.round(+m.score[0]) || 0)}</b><div class="mid" data-k="v3-mid">${info.fresh ? `<b class="tm num">${fmt(m.clock)}</b>` : ""}<small>${esc(info.label)}</small></div><b class="sc r num">${Math.max(0, Math.round(+m.score[1]) || 0)}</b>
        ${chip(0)}<small class="pl">PLAYERS LEFT</small>${chip(1)}</div>
        <svg class="orn" viewBox="0 0 80 40"><path d="M3 6 L13 10 L67 10 L77 6 M24 10 L40 20 L56 10 M13 10 C21 12 25 16 29 22 L37 30 L40 34 L43 30 L51 22 C55 16 59 12 67 10 M40 34 L40 39"/></svg></div>`;
      const emb = (ev.tournament.logos || []).find(Boolean);
      if (emb) h += `<div class="v3-emb" data-k="v3-emb"><img src="${esc(emb)}" alt="" onerror="this.style.display='none'"></div>`;
    }
    // sponsor boxes: the main sponsor on the left, the others (one at a time, 8 seconds each) on the right
    if (sh.sponsor !== false && vs === "main") {
      const sp = (ev.tournament.sponsors || []).filter(x => x && (x.name || x.logo)), main = sp.find(x => x.type === "main"), rest = sp.filter(x => x !== main);
      const body = (x, k) => `<div class="in" data-k="${k}">${x.logo ? `<img src="${esc(x.logo)}" alt="${esc(x.name || "")}" onerror="this.style.display='none'">` : `<b>${esc(x.name)}</b>`}</div>`;
      const spTop = (720 - info.squad * VAL_PITCH - 60 - 110 / 3).toFixed(2); // the reference gap above the first panel: 5v5 lands on its 445 px, 2v2 sits just over its two panels
      if (main) h += `<div class="v3-sp l" data-k="v3-sp-l" style="top:${spTop}px">${body(main, "spm")}</div>`;
      if (rest.length || logoAds(ev)) h += `<div class="v3-sp r" data-k="v3-sp-r" style="top:${spTop}px"><div class="in">${logoBox(ev, rest)}</div></div>`; // the others take turns; in "logo box" mode, the ads
    }
    // player panels, bottom-anchored; a padded "Player N" seat (shortcut 0) is never drawn. HP, ultimate, gun and credits are what the
    // operator types on the Skirmish page (a live feed's own values win if one ever sends them); HP starts at 100 and is 0 when out.
    if (sh.boost !== false && vs === "main") {
      const top = 720 - info.squad * VAL_PITCH, stats = (v.p && typeof v.p === "object") ? v.p : {};
      [0, 1].forEach(s => m.players[s].forEach((p, i) => {
        const name = p ? noTag(p.display) : "";
        if (!name || p.shortcut === 0) return; // no padded seat, and no seat nobody has named yet
        const dead = !!(p.pid && info.dead[p.pid]), st = (p.pid && stats[p.pid]) || {}, has = x => x != null && x !== "";
        const hp = dead ? 0 : Math.max(0, Math.min(150, Math.round(+(has(p.hp) ? p.hp : has(st.hp) ? st.hp : 100)) || 0));
        const um = Math.max(1, Math.min(9, Math.round(+(p.ultMax || st.ultMax)) || 8)), ul = Math.max(0, Math.min(um, Math.round(+(has(p.ult) ? p.ult : st.ult)) || 0));
        const cr = has(p.credits) ? p.credits : has(st.cr) ? st.cr : "", gun = VAL_UUID.test(String(st.gun || "")) ? `/val-weapon/${st.gun}.png` : "";
        const agent = VAL_UUID.test(String(p.agent || "")) ? `/val-agent/${p.agent}/displayicon.png` : "";
        const art = (agent ? artImg(agent, "ag") : "") || (p.avatar ? artImg(p.avatar, "av") : "");
        const pips = Array.from({ length: um }, (_, k) => `<i class="${k >= um - ul ? "on" : ""}"></i>`).join(""); // lit from the centre side
        h += `<div class="v3-p ${s ? "r" : "l"}${dead ? " dead" : ""}${p.pid && v.spec === p.pid ? " spec" : ""}" data-k="vp-${s}-${i}" style="top:${(top + i * VAL_PITCH).toFixed(2)}px;--c:${esc(m.colors[s])}"><div class="mx">
          <i class="st"></i><i class="lo"></i><span class="hb"><i class="ht"></i><i class="hl" style="transform:scaleX(${(Math.min(100, hp) / 100).toFixed(3)})"></i><i class="he"></i></span>
          <b class="nm t">${esc(name)}</b><span class="ul" data-k="ul-${s}-${i}">${pips}</span><em class="hv t num">${hp}</em>
          ${gun ? artImg(gun, "gn") : ""}<span class="cr"><small class="t num">${esc(String(cr).slice(0, 6))}</small></span>
          <div class="pt">${art || `<span class="in t">${esc(initials(name))}</span>`}</div></div></div>`;
      }));
    }
    // killfeed, top right like the game's own: killer, their agent, the gun, the victim's agent and name; each row stays 10 seconds
    const feed = (Array.isArray(v.feed) ? v.feed : []).filter(x => x && Date.now() - (+x.t || 0) < 10000).slice(-4);
    if (sh.feed !== false && vs === "main" && feed.length) {
      const ag = (u, cls) => (VAL_UUID.test(String(u || "")) ? artImg(`/val-agent/${u}/displayicon.png`, cls) : "");
      h += `<div class="v3-kf" data-k="v3-kf">${feed.map(x => `<div class="kr" data-k="kf-${+x.t || 0}" style="--k:${esc(m.colors[x.ks ? 1 : 0])};--v:${esc(m.colors[x.vs ? 1 : 0])}"><span class="kn">${esc(x.k)}</span>${ag(x.ka, "ka")}${VAL_UUID.test(String(x.gun || "")) ? artImg(`/val-weapon/${x.gun}.png`, "gn") : `<i class="gx"></i>`}${ag(x.va, "va")}<span class="vn">${esc(x.v)}</span></div>`).join("")}</div>`;
    }
    // series maps, top left: the picked maps and the decider in play order; the one being played is bright, a box shows who picked it
    if (sh.maps !== false) {
      const vt = vetoFix(v.veto, v.squad), maps = vt.steps.filter(x => x.map && x.act !== "ban"), cur = (+m.series[0] || 0) + (+m.series[1] || 0);
      if (maps.length) h += `<div class="v3-mp" data-k="v3-mp">${maps.map((x, i) => `<span class="${i === cur ? "on" : i < cur ? "done" : ""}" data-k="mp-${i}">${x.team < 0 ? `<i class="dc"></i>` : lg(m.sides[x.team], "lgbox mb")}<b>${esc(String(x.name || "").toUpperCase())}</b></span>`).join("")}</div>`;
    }
    if (vs !== "main" && sh.stats !== false) h += valBoard(m, info);
    if (vs === "timeout") h += valTimeout(m);
    if (vs === "main" && sh.feed !== false) h += valRoundWin(m, info);
    const pc = sh.playerCam ? valCams(m) : { html: "", cams: [] };
    if (vs !== "main") { pc.html = ""; pc.cams.forEach(c => { c.show = false; }); } // kept loaded behind the board, so they come back at once
    return { html: h + pc.html, cams: pc.cams };
  };
  /* Buy-round board: the main sponsor, the round history and the event's emblem over two player tables (agent, name, K/D/A,
     ultimate, gun, credits). Abilities and shields have no source (no live VALORANT feed), so they are not drawn. */
  function valBoard(m, info) {
    const ev = m.ev, v = ev.val || {}, stats = v.p && typeof v.p === "object" ? v.p : {}, n = info.squad, RH = 37.4, top = 713 - n * RH;
    const regs = n === 2 ? 2 * info.target - 1 : 2 * info.target - 2, rounds = Array.isArray(v.rounds) ? v.rounds : [], cols = Math.max(regs, rounds.length);
    const tag = s => esc(String((m.sides[s] && (m.sides[s].tag || m.sides[s].name)) || (s ? "B" : "A")).slice(0, 5).toUpperCase());
    const sp = (ev.tournament.sponsors || []).filter(x => x && (x.name || x.logo)), main = sp.find(x => x.type === "main") || sp[0], emb = (ev.tournament.logos || []).find(Boolean);
    let h = `<div class="v3-bd" data-k="v3-bd" style="top:${(top - 100).toFixed(1)}px">`;
    h += `<div class="sp" data-k="bd-sp">${main ? main.logo ? `<img src="${esc(main.logo)}" alt="" onerror="this.style.display='none'">` : `<b>${esc(main.name)}</b>` : ""}</div>`;
    h += `<div class="rh" data-k="bd-rh" style="--n:${cols}"><div class="rhd"><small>${n === 2 ? "ROUNDS" : "1ST HALF"}</small>${Array.from({ length: cols }, (_, i) => `<span class="${i >= rounds.length ? "fut" : ""}">${String(i + 1).padStart(2, "0")}</span>`).join("")}</div>
      ${[0, 1].map(s => `<div class="tr" style="--c:${esc(m.colors[s])}"><small>${lg(m.sides[s])}<b>${tag(s)}</b></small>${Array.from({ length: cols }, (_, i) => `<span>${rounds[i] === s ? "<i></i>" : ""}</span>`).join("")}</div>`).join("")}</div>`;
    h += `<div class="em" data-k="bd-em">${emb ? `<img src="${esc(emb)}" alt="" onerror="this.style.display='none'">` : ""}</div></div>`;
    [0, 1].forEach(s => {
      const ps = m.players[s].filter(p => p && p.shortcut !== 0 && noTag(p.display)).slice(0, n), has = x => x != null && x !== "";
      h += `<div class="v3-tb ${s ? "r" : "l"}" data-k="v3-tb-${s}" style="top:${(top - 14).toFixed(1)}px;--c:${esc(m.colors[s])}"><div class="th">${(s ? ["cr", "lo", "ul", "k", "d", "a", "pl", "pt"] : ["pt", "pl", "k", "d", "a", "ul", "lo", "cr"]).map(c => `<span class="${c}">${{ pl: "PLAYER", k: "K", d: "D", a: "A", ul: "ULTIMATE", lo: "LOADOUT", cr: "CREDS", pt: "" }[c]}</span>`).join("")}</div>
        ${ps.map((p, i) => {
          const st = (p.pid && stats[p.pid]) || {}, name = noTag(p.display), dead = !!(p.pid && info.dead[p.pid]);
          const um = Math.max(1, Math.min(9, Math.round(+(p.ultMax || st.ultMax)) || 8)), ul = Math.max(0, Math.min(um, Math.round(+(has(p.ult) ? p.ult : st.ult)) || 0));
          const agent = VAL_UUID.test(String(p.agent || "")) ? artImg(`/val-agent/${p.agent}/displayicon.png`, "ag") : p.avatar ? artImg(p.avatar, "ag") : PH;
          const gun = VAL_UUID.test(String(st.gun || "")) ? artImg(`/val-weapon/${st.gun}.png`, "gn") : "", cr = has(p.credits) ? p.credits : has(st.cr) ? st.cr : "";
          const cell = { pt: `<span class="pt">${agent}</span>`, pl: `<b class="pl">${esc(name)}</b>`, k: `<span class="num">${esc(stv(ev, p, "kills"))}</span>`, d: `<span class="num">${esc(stv(ev, p, "deaths"))}</span>`,
            a: `<span class="num">${esc(stv(ev, p, "assists"))}</span>`, ul: `<span class="ul">${Array.from({ length: um }, (_, k) => `<i class="${k < ul ? "on" : ""}"></i>`).join("")}</span>`,
            lo: `<span class="lo">${gun}</span>`, cr: `<span class="cr num">${esc(String(cr).slice(0, 6))}</span>` };
          return `<div class="rw${dead ? " dead" : ""}" data-k="tb-${s}-${i}">${(s ? ["cr", "lo", "ul", "k", "d", "a", "pl", "pt"] : ["pt", "pl", "k", "d", "a", "ul", "lo", "cr"]).map(c => cell[c]).join("")}</div>`;
        }).join("")}</div>`;
    });
    return h;
  }
  /* ROUND WIN banner, centre screen for 4 seconds after "+ Round": the winner's side on this map (from the veto's side pick,
     swapped after half time), their logo and tag. */
  function valRoundWin(m, info) {
    const w = (m.ev.val || {}).win || {}, s = +w.side === 1 ? 1 : 0, age = Date.now() - (+w.at || 0);
    if (!w.at || age > 4000 || age < -5000) return ""; // a little clock skew is fine
    const A = agsInfo(m.ev), first = A.side(s), rounds = (+m.score[0] || 0) + (+m.score[1] || 0), half = Math.max(1, info.target - 1);
    const role = !first ? "" : info.squad === 2 || rounds <= half ? first : first === "ATK" ? "DEF" : "ATK"; // 2v2 Skirmish has no halves
    const t = m.sides[s], tag = String((t && (t.tag || t.name)) || (s ? "TEAM B" : "TEAM A")).toUpperCase();
    return `<div class="v3-rw" data-k="v3-rw-${+w.at}" style="--c:${esc(m.colors[s])}"><i class="cn tl"></i><i class="cn tr"></i><i class="cn bl"></i><i class="cn br"></i>
      <div class="rwh">${role ? `<b class="ro">${role}</b>` : ""}${lg(t)}<b class="tg">${esc(tag)}</b></div><b class="big">ROUND WIN</b></div>`;
  }
  // timeout banner: the side's role, the team and a bar that empties over the timeout's length
  function valTimeout(m) {
    const to = (m.ev.val || {}).to || {}, s = +to.side === 1 ? 1 : 0, t = m.sides[s], secs = Math.max(10, +to.secs || 60);
    const left = to.at ? Math.max(0, secs - (Date.now() - to.at) / 1000) : secs, role = to.role === "atk" ? "ATTACKERS" : to.role === "def" ? "DEFENDERS" : "";
    const name = noTag(t ? t.name || t.tag : "") || (s ? "TEAM B" : "TEAM A");
    return `<div class="v3-to" data-k="v3-to-${s}" style="--c:${esc(m.colors[s])}">${role ? `<small class="ro">${role}</small>` : ""}<small class="tn">${esc(name)}</small><b class="big">TIMEOUT ACTIVE</b>
      <div class="bar"><i style="transform:scaleX(${(left / secs).toFixed(3)})"></i><b class="num">${fmt(Math.ceil(left))}</b></div></div>`;
  }

  /* Map selection (VALORANT veto). A step is { team: 0 left | 1 right | -1 decider, act: "ban" | "pick" | "decider", map: uuid, name,
     side: "" | "atk" | "def", by: the side (0/1) that chose it }. Presets follow the usual orders: the competitive pool has seven maps,
     2v2 Skirmish five. vetoFix makes any stored value safe, so the server, the dashboard and the scene read the same thing. */
  const VETO_FMT = { bo1: "Best of 1", bo3: "Best of 3", bo5: "Best of 5", bo7: "Best of 7", bo9: "Best of 9" };
  /* The order for any pool size, used by the Map Veto page: two bans, then the picks, then the remaining bans, then the decider.
     first: the side (0 or 1) that bans first. A pick's side is chosen by the other team; the decider's by the team that did not
     ban last. Null when the pool is too small for the format. */
  function vetoOrder(fmt, n, first) {
    const k = +String(fmt).slice(2) || 3, bans = n - k, f = +first === 1 ? 1 : 0; if (!(n >= k) || k < 1) return null;
    const out = []; let t = f;
    const B = () => { out.push({ team: t, act: "ban", by: 1 - t }); t = 1 - t; }, P = () => { out.push({ team: t, act: "pick", by: 1 - t }); t = 1 - t; };
    for (let i = 0; i < Math.min(2, bans); i++) B();
    for (let i = 0; i < k - 1; i++) P();
    for (let i = 2; i < bans; i++) B();
    const lastBan = out.filter(x => x.act === "ban").pop();
    out.push({ team: -1, act: "decider", by: lastBan ? 1 - lastBan.team : f });
    return out.map(x => Object.assign({ map: "", name: "", side: "" }, x));
  }
  // what the veto waits for: { i: step index, kind: "ban" | "pick" | "decider" | "side" }, or null when it is finished
  function vetoNext(V) {
    for (let i = 0; i < V.steps.length; i++) { const x = V.steps[i]; if (!x.map) return { i, kind: x.act }; if (x.act !== "ban" && !x.side) return { i, kind: "side" }; }
    return null;
  }
  function vetoPreset(fmt, pool) {
    const B = t => ({ team: t, act: "ban" }), P = t => ({ team: t, act: "pick" }), D = { team: -1, act: "decider" };
    const seq = pool === "skirmish"
      ? { bo1: [B(0), B(1), B(0), B(1), D], bo3: [B(0), B(1), P(0), P(1), D], bo5: [P(0), P(1), P(0), P(1), D] }[fmt]
      : { bo1: [B(0), B(1), B(0), B(1), B(0), B(1), D], bo3: [B(0), B(1), P(0), P(1), B(0), B(1), D], bo5: [B(0), B(1), P(0), P(1), P(0), P(1), D] }[fmt];
    return (seq || []).map(x => Object.assign({ map: "", name: "", side: "", by: x.team === 0 ? 1 : 0 }, x));
  }
  function vetoFix(v, squad) {
    const o = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    const pool = o.pool === "skirmish" || o.pool === "comp" ? o.pool : (+squad || 2) === 2 ? "skirmish" : "comp", fmt = VETO_FMT[o.fmt] ? o.fmt : "bo3";
    const steps = Array.isArray(o.steps) && o.steps.length ? o.steps.slice(0, 15) : vetoPreset(fmt, pool) || [];
    // maps: the pool picked on the Map Veto page; started: the veto is running; first: who bans first; mvt: reveal speed; replay: when the reveal was replayed
    const maps = (Array.isArray(o.maps) ? o.maps : []).filter(u => VAL_UUID.test(String(u))).slice(0, 15);
    return { fmt, pool, maps, started: !!o.started, first: +o.first === 1 ? 1 : 0, mvt: Math.max(100, Math.min(3000, Math.round(+o.mvt) || 750)), replay: +o.replay || 0, steps: steps.map(x => { x = x && typeof x === "object" ? x : {};
      const team = x.team === 0 || x.team === 1 ? x.team : -1, act = ["ban", "pick", "decider"].includes(x.act) ? x.act : team < 0 ? "decider" : "ban";
      return { team, act, map: VAL_UUID.test(String(x.map || "")) ? x.map : "", name: String(x.name || "").slice(0, 30), side: x.side === "atk" || x.side === "def" ? x.side : "", by: x.by === 0 || x.by === 1 ? x.by : team === 0 ? 1 : 0 }; }) };
  }
  S.mapveto = (m) => {
    const ev = m.ev, [L, R] = m.sides, v = vetoFix((ev.val || {}).veto, (ev.val || {}).squad), n = v.steps.length || 1, rp = v.replay && Date.now() - v.replay < 15000; // rp: a replay staggers the cards in
    const tag = s => { const t = s ? R : L; return String((t && (t.tag || t.name)) || (s ? "TEAM B" : "TEAM A")).toUpperCase(); };
    const logo = (s, cls) => { const t = s ? R : L, u = t && (t.logos || []).find(Boolean); return u ? `<img class="${cls}" src="${esc(u)}" alt="" onerror="this.style.display='none'">` : ""; };
    const emb = (ev.tournament.logos || []).find(Boolean);
    const decider = emb ? `<img class="lg" src="${esc(emb)}" alt="" onerror="this.style.display='none'">`
      : `<svg class="dc" viewBox="0 0 100 100"><path d="M20 8 L42 30 L34 38 L12 16 Z M80 8 L58 30 L66 38 L88 16 Z M20 92 L42 70 L34 62 L12 84 Z M80 92 L58 70 L66 62 L88 84 Z M50 36 L64 50 L50 64 L36 50 Z"/></svg>`;
    const cards = v.steps.map((x, i) => {
      const who = x.team < 0 ? "DECIDER" : tag(x.team), what = x.act === "ban" ? "VETO MAP" : x.act === "pick" ? "SELECT MAP" : "MAP";
      let body;
      if (!x.map) body = x.team < 0 ? decider : (logo(x.team, "lg dim") || `<b class="tg">${esc(tag(x.team))}</b>`); // waiting: the team's logo, dimmed
      else {
        const art = artImg(`/val-map/${x.map}/listviewicontall.png`, "art"), nm = esc(String(x.name || "").toUpperCase());
        body = x.act === "ban" ? `${art}<b class="mn ghost">${nm}</b><svg class="no" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42"/><line x1="21" y1="79" x2="79" y2="21"/></svg>`
          : `${art}${x.side ? `<span class="sd">${esc(tag(x.by))} PICKS<br>${x.side === "atk" ? "ATTACK" : "DEFENSE"}</span>` : ""}<b class="mn">${nm}</b>`;
      }
      return `<div class="vc ${x.map ? x.act : "wait"}${x.team < 0 ? " dec" : ""}" data-k="vc-${i}-${x.map || "w"}" style="--c:${esc(x.team < 0 ? "#c9b27c" : m.colors[x.team])}${rp ? `;--d:${Math.round(i * v.mvt * 0.4)}ms` : ""}"><div class="cd">${body}</div><span class="lb">${esc(who)}<br>${what}</span></div>`;
    }).join("");
    return { html: `<div class="v3-veto" data-k="v3-veto-${v.replay}" style="--n:${n};--mvt:${v.mvt}ms"><div class="vt-hd"><b class="tt">MAP SELECTION</b><span class="vs">${logo(0, "tl")}<b>${esc(tag(0))}</b><i>VS</i><b>${esc(tag(1))}</b>${logo(1, "tl")}</span></div><div class="vt-row">${cards}</div></div>`, cams: [] };
  };

  /* Agent select, on MJ's reference: team name, logo, series dots and side on each end, the tournament in the middle, then a card per
     player either side of the map being played. A card is empty (the team colour glows: still picking), hovering (the agent under a team
     tint) or locked (the agent, clean, with the team underline). val.ags = { step: which veto step is being played, st: player id -> "hover" | "none" }. */
  function agsInfo(ev) {
    const v = ev.val || {}, V = vetoFix(v.veto, v.squad), a = v.ags && typeof v.ags === "object" ? v.ags : {};
    const played = V.steps.map((x, i) => i).filter(i => V.steps[i].map && V.steps[i].act !== "ban");
    const step = played.includes(+a.step) ? +a.step : played.length ? played[0] : -1, x = step >= 0 ? V.steps[step] : null;
    const side = s => !x || !x.side ? "" : (x.by === s) === (x.side === "atk") ? "ATK" : "DEF"; // the side each team plays first on this map
    return { step, map: x, side, st: a.st && typeof a.st === "object" ? a.st : {} };
  }
  S.agents = (m) => {
    const ev = m.ev, [L, R] = m.sides, A = agsInfo(ev), n = Math.max(2, Math.min(5, m.squad || 2)), o = so(ev, "agents");
    const roster = {}; ev.teams.forEach(t => (t.players || []).forEach(p => { roster[p.id] = p; }));
    const tag = s => { const t = s ? R : L; return String((t && (t.tag || t.name)) || (s ? "TEAM B" : "TEAM A")).toUpperCase(); };
    const logo = s => { const t = s ? R : L, u = t && (t.logos || []).find(Boolean); return u ? `<img class="tl" src="${esc(u)}" alt="" onerror="this.style.display='none'">` : ""; };
    const need = Math.max(1, Math.ceil((+ev.live.bestOf || 1) / 2)), won = s => Math.max(0, Math.min(need, +m.series[s] || 0));
    const dots = s => `<span class="dt">${Array.from({ length: need }, (_, k) => `<i class="${k < won(s) ? "on" : ""}"></i>`).join("")}</span>`;
    const end = s => `<div class="en ${s ? "r" : "l"}" data-k="ag-en-${s}"><b class="nm">${esc(tag(s))}</b>${logo(s)}${dots(s)}${A.side(s) ? `<b class="sd">${A.side(s)}</b>` : ""}</div>`;
    const emb = (ev.tournament.logos || []).find(Boolean), tname = String(ev.tournament.name || "").trim();
    const mid = emb || tname ? `<div class="tn" data-k="ag-tn">${emb ? `<img src="${esc(emb)}" alt="" onerror="this.style.display='none'">` : ""}${tname ? `<b>${esc(tname.toUpperCase())}</b>` : ""}</div>` : "";
    const card = (s, i) => {
      const p = m.players[s][i], r = (p && p.pid && roster[p.pid]) || {}, name = p && p.shortcut !== 0 ? noTag(p.display) : "";
      const ag = VAL_UUID.test(String((p && p.agent) || "")) ? p.agent : "", st = !ag ? "none" : A.st[p.pid] === "hover" ? "hover" : "lock";
      const art = ag ? artImg(`/val-agent/${ag}/fullportrait.png`, "art") : "", role = ag ? artImg(`/val-agent/${ag}/role.png`, "ro") : "";
      return `<div class="ac ${s ? "r" : "l"} ${st}" data-k="ag-${s}-${i}-${ag || "x"}-${st}" style="--c:${esc(m.colors[s])}"><i class="gl"></i>${art}${st === "hover" ? `<i class="tint"></i>` : ""}${role}
        ${name ? `<span class="tx"><b>${esc(name.toUpperCase())}</b>${r.agentName && ag ? `<small>${esc(String(r.agentName).toUpperCase())}</small>` : ""}</span>` : ""}<i class="ul"></i></div>`;
    };
    const mp = A.map ? `<div class="ac mp" data-k="ag-map-${A.map.map}">${artImg(`/val-map/${A.map.map}/listviewicontall.png`, "art")}${o.map ? `<b class="mn">${esc(String(A.map.name || "").toUpperCase())}</b>` : ""}</div>`
      : `<div class="ac mp" data-k="ag-map-none"></div>`;
    const cards = Array.from({ length: n }, (_, i) => card(0, i)).join("") + mp + Array.from({ length: n }, (_, i) => card(1, i)).join("");
    return { html: `${o.bg ? `<div class="bp-bg"></div>` : ""}<div class="v3-ags" data-k="v3-ags" style="--k:${2 * n + 1}">${end(0)}${mid}${end(1)}${o.lineup ? `<div class="ag-row">${cards}</div>` : ""}</div>`, cams: [] };
  };

  S.dbdingame = (m) => {
    const ev = m.ev, [L, R] = m.sides, d = dbdScore(ev), n = d.trials.length, cur = d.trials[n - 1];
    const role = s => (!cur ? "" : cur.killer === s ? "KILLER" : "SURVIVORS");
    return { html: bugHead(m) + `<div class="h-series"><div class="ss l num" style="font-size:14px">${role(0)}</div><div class="clk"><b class="num">${n ? "TRIAL " + n : "DEAD BY DAYLIGHT"}</b><small>${esc(ev.live.gameSeries || "")}</small></div><div class="ss r num" style="font-size:14px">${role(1)}</div></div>`, cams: [] };
  };

  /* Fortnite in-game, laid out on MJ's FNCS 2026 references (1080p pixels / 1.5). Fortnite gives a caster no live data, so the game is
     run from the dashboard: "X eliminated Y" feeds the killfeed, the killer's elims, players and teams left and the live leaderboard.
     fn.live = { dead: {pid}, knocked: {pid}, ps: {pid: {el, hp, sh, mats, lvl}}, feed: [{k, v, kind, t}], focus: {team, p}, storm, thr: {n, dir},
     tr: "rotate" | "board" | "sponsor", show: {part: false} }. */
  const fnPrev = {}; // last value per counter, so a drop can jump (browser only; the server never draws)
  function fnLive(ev) {
    const fn = ev.fn || {}, L = fn.live && typeof fn.live === "object" ? fn.live : {}, ob = x => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
    const dead = ob(L.dead), ps = ob(L.ps), teams = ev.teams || [];
    const named = t => (t.players || []).filter(p => p && (p.ign || p.alias));
    const max = Math.max(0, Math.round(+L.max) || teams.reduce((a, t) => a + named(t).length, 0));
    const deadN = teams.reduce((a, t) => a + named(t).filter(p => dead[p.id]).length, 0);
    const out = t => named(t).length > 0 && named(t).every(p => dead[p.id]);
    const alive = Math.max(0, max - deadN), teamsMax = teams.filter(t => named(t).length).length, teamsLeft = teams.filter(t => named(t).length && !out(t)).length;
    const gel = t => named(t).reduce((a, p) => a + Math.max(0, Math.round(+(ps[p.id] || {}).el) || 0), 0); // this game's elims
    return { L, dead, knocked: ob(L.knocked), ps, named, max, alive, teamsMax, teamsLeft, out, gel, show: ob(L.show),
      storm: Math.max(0, Math.round(+L.storm) || 0), stormOf: Math.max(1, Math.round(+L.stormOf) || 12), games: Math.max(1, Math.round(+fn.games) || 6), game: (fn.matches || []).length + 1,
      feed: (Array.isArray(L.feed) ? L.feed : []).filter(x => x && Date.now() - (+x.t || 0) < 20000).slice(-3), focus: ob(L.focus), thr: ob(L.thr), tr: ["board", "sponsor"].includes(L.tr) ? L.tr : "rotate" };
  }
  const fnName = p => String((p && (p.alias || p.ign)) || "").replace(/#[^#]*$/, "").trim();
  const fnDrop = (k, v) => { const o = fnPrev[k]; if (!o || o.v !== v) fnPrev[k] = { v, dn: !!o && v < o.v }; return fnPrev[k].dn; }; // did this value just drop?
  const FN_ICON = {
    one: `<svg viewBox="0 0 20 28"><circle cx="10" cy="6" r="5.5"/><path d="M2 27 V18 Q2 12 10 12 Q18 12 18 18 V27 Z"/></svg>`,
    two: `<svg viewBox="0 0 30 28"><circle cx="20" cy="6" r="5"/><path d="M13 27 V17 Q13 12 20 12 Q27 12 27 17 V27 Z"/><circle cx="10" cy="9" r="5"/><path d="M3 28 V20 Q3 15 10 15 Q17 15 17 20 V28 Z"/></svg>`,
    ret: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke-width="2.6"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke-width="2.6"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16" stroke-width="4"/></svg>`,
    shield: `<svg viewBox="0 0 20 22"><path d="M10 1 L19 4 V10 Q19 18 10 21 Q1 18 1 10 V4 Z"/></svg>`,
    mats: `<svg viewBox="0 0 26 22"><path d="M2 9h22v3H2zM6 4h3v14H6zM15 2l5 3-1.5 2.5-5-3zM15 12h3v8h-3z"/></svg>`,
    storm: `<svg viewBox="0 0 28 26"><path d="M7 12 Q2 12 2 8 Q2 4 7 4 Q8 0 13 0 Q19 0 20 5 Q26 5 26 9 Q26 12 21 12 Z"/><path d="M13 13 L8 21 H12 L10 26 L18 17 H14 L17 13 Z"/></svg>`,
    check: `<svg viewBox="0 0 26 22"><path d="M2 12 L9 19 L24 3" fill="none" stroke-width="4.4"/></svg>`,
    thr: `<svg viewBox="0 0 52 46"><path d="M26 2 L50 44 H2 Z" fill="rgba(255,255,255,.18)" stroke="rgba(255,255,255,.75)" stroke-width="2.4"/><path d="M27 13 L20 27 H26 L22 38 L33 22 H27 L31 13 Z" fill="#fff"/></svg>`,
  };
  S.fningame = (m) => {
    const ev = m.ev, l = ev.live, F = fnLive(ev), on = k => F.show[k] !== false, rows = fnTable(ev);
    let h = "";
    if (on("counts")) { // players and teams left; a drop makes the number jump
      const n = (k, v, mx, ic, cls) => `<div class="fn3-ct ${cls}" data-k="fn3-${k}">${FN_ICON[ic]}<b class="num${fnDrop(k, v) ? " dn" : ""}" data-k="fn3-${k}-${v}">${v}</b><small>/${mx}</small></div>`;
      h += n("pl", F.alive, F.max, "one", "a") + n("tm", F.teamsLeft, F.teamsMax, "two", "b");
    }
    if (on("feed") && F.feed.length) h += `<div class="fn3-feed" data-k="fn3-feed">${F.feed.map(x => `<div class="kr" data-k="kf-${+x.t || 0}"><span class="kk">${esc(x.k)}</span><i class="ki">${FN_ICON[x.kind === "knock" ? "plus" : "ret"]}</i><span class="kv">${esc(x.v)}</span></div>`).join("")}</div>`;
    // top right: the event box, then the leaderboard or the sponsor box (alternating every 15 s unless one is chosen), then the damage threshold
    if (on("event")) {
      const emb = (ev.tournament.logos || []).find(Boolean);
      h += `<div class="fn3-ev" data-k="fn3-ev">${emb ? `<img src="${esc(emb)}" alt="" onerror="this.style.display='none'">` : ""}<b>${esc(String(l.roundTitle || l.seriesTitle || ev.tournament.name || "").toUpperCase())}<br>GAME ${Math.min(F.game, F.games)}/${F.games}</b></div>`;
    }
    const sp = (ev.tournament.sponsors || []).filter(x => x && (x.name || x.logo)), spx = sp.length ? sp[Math.floor(Date.now() / 15000) % sp.length] : null;
    const showBoard = on("board") && rows.length && (F.tr === "board" || !(spx || logoAds(ev)) || (F.tr === "rotate" && Math.floor(Date.now() / 15000) % 2 === 0));
    if (showBoard) {
      const live = rows.map(r => ({ r, pts: r.pts + F.gel(r.team) * (+((ev.fn || {}).elimPts) || 0), out: F.out(r.team) })).sort((a, b) => b.pts - a.pts);
      const pages = Math.max(1, Math.ceil(live.length / 5)), pg = Math.floor(Date.now() / 8000) % pages, page = live.slice(pg * 5, pg * 5 + 5);
      h += `<div class="fn3-lb" data-k="fn3-lb" style="height:${56 + 46 * page.length + 6}px"><i class="cn"></i><b class="tt">LEADERBOARD</b><span class="pp">POINTS</span>${page.map((x, i) => { const ns = F.named(x.r.team).map(fnName).filter(Boolean);
        return `<div class="lr${x.out ? " out" : ""}" data-k="lr-${esc(x.r.team.id)}"><b class="rk num">${pg * 5 + i + 1}</b><span class="nms">${(ns.length ? ns.slice(0, 2) : [x.r.team.name]).map(s => `<span>${esc(String(s).toUpperCase())}</span>`).join("")}</span><b class="pt num">${x.pts}</b></div>`; }).join("")}</div>`;
    } else if (on("sponsor") && (spx || logoAds(ev))) h += `<div class="fn3-sp" data-k="fn3-sp">${logoAds(ev) ? logoBox(ev) : spx.logo ? `<img src="${esc(spx.logo)}" alt="" onerror="this.style.display='none'">` : `<b>${esc(String(spx.name).toUpperCase())}</b>`}</div>`;
    const tn = Math.round(+F.thr.n);
    if (on("thr") && F.thr.n !== "" && F.thr.n != null && isFinite(tn)) h += `<div class="fn3-th${showBoard ? "" : " lo"}" data-k="fn3-th"><b class="num">${Math.abs(tn)} ${F.thr.dir === "below" ? "BELOW" : "ABOVE"}</b><div class="bx">${FN_ICON.thr}<span>DAMAGE THRESHOLD</span></div></div>`;
    // bottom right, under the game's minimap: storm phase and the timer (only while a screen-read clock is fresh)
    if (on("storm")) {
      const fresh = !!(m.clockLive && m.clockAt && Date.now() - m.clockAt <= 5000);
      h += `<div class="fn3-st" data-k="fn3-st">${FN_ICON.storm}<b class="num">${F.storm || "-"}</b><small>/${F.stormOf}</small></div>${fresh ? `<div class="fn3-tmr" data-k="fn3-tmr">${FN_ICON.check}<b class="num">${fmt(m.clock)}</b></div>` : ""}`;
    }
    // the spectated player (chosen on the dashboard, else nobody): name and elims, shield, health and materials as typed
    const ft = ev.teams.find(t => t.id === F.focus.team), fps = ft ? F.named(ft) : [], fp = fps[Math.max(0, Math.min(fps.length - 1, +F.focus.p || 0))];
    if (fp) {
      const st = F.ps[fp.id] || {}, num = (x, d) => (x === "" || x == null || !isFinite(+x) ? d : Math.max(0, Math.round(+x)));
      const dead = !!F.dead[fp.id], hp = dead ? 0 : num(st.hp, 100), sh = dead ? 0 : num(st.sh, 0), el = num(st.el, 0), w = v => Math.min(100, v) / 100 * 288.7;
      if (on("card")) h += `<div class="fn3-card" data-k="fn3-card"><div class="nb"><b class="nm">${esc(fnName(fp))}</b><span class="el">${FN_ICON.ret}<b class="num">${el}</b></span></div>
        <div class="bars"><i class="bar s" style="width:${w(sh).toFixed(1)}px"></i><span class="bt s">${FN_ICON.shield}<b class="num">${sh}</b><em>|</em><b class="num">100</b></span><i class="bar h" style="width:${w(hp).toFixed(1)}px"></i><span class="bt h">${FN_ICON.plus}<b class="num">${hp}</b><em>|</em><b class="num">100</b></span></div>
        ${st.mats !== "" && st.mats != null ? `<span class="mt">${FN_ICON.mats}<b class="num">${num(st.mats, 0)}</b></span>` : ""}${st.lvl !== "" && st.lvl != null ? `<span class="lv"><b class="num">${num(st.lvl, 0)}</b></span>` : ""}</div>`;
      const mates = fps.filter(p => p !== fp);
      if (on("team") && mates.length) h += `<div class="fn3-team" data-k="fn3-team"><div class="tab">${FN_ICON.two}<b>TEAM</b></div>${mates.slice(0, 3).map(p => { const q = F.ps[p.id] || {}, d = !!F.dead[p.id], kn = !!F.knocked[p.id];
        return `<div class="tr${d ? " dead" : ""}" data-k="ftr-${esc(p.id)}"><span class="nm">${esc(fnName(p))}</span>${d || kn ? `<b class="x">${d ? "&#x2715;" : "+"}</b>` : `<span class="mb"><i style="width:${(Math.min(100, num(q.sh, 0)) * .45).toFixed(1)}px"></i><i class="h" style="width:${(Math.min(100, num(q.hp, 100)) * .45).toFixed(1)}px"></i></span>`}<span class="el">${FN_ICON.ret}<b class="num">${num(q.el, 0)}</b></span></div>`; }).join("")}</div>`;
    }
    return { html: h, cams: [] };
  };
  // the spectated player's camera in the white frame bottom left (falls back to the old spotlight team's first camera)
  function fnCams(ev) {
    const F = fnLive(ev), rows = fnTable(ev), pick = (ev.fn || {}).spotlight, ft = ev.teams.find(t => t.id === F.focus.team) || ev.teams.find(t => t.id === pick) || (rows[0] && rows[0].team);
    const fps = ft ? F.named(ft) : [], fp = fps[ft && ft.id === F.focus.team ? Math.max(0, Math.min(fps.length - 1, +F.focus.p || 0)) : 0];
    if (!fp || F.show.cam === false) return { html: "", cams: [] };
    const u = fp.camHide ? "" : fp.cam || ownCam(ev, fp.id);
    return u ? { html: `<div class="fn3-cam" data-k="fn3-cam"></div>`, cams: [{ key: "pc-fn-" + fp.id + u, url: u, x: 22, y: 440, w: 280.7, h: 154.7 }] } : { html: "", cams: [] };
  }
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
    statsteam: { mc: mcStatsTeam, rb: rbStatsTeam }, statsplayer: { mc: mcStatsPlayer, rb: rbStatsPlayer },
    lineup: { mc: mcLineup, rb: rbLineup }, starting: { mc: mcStarting, rb: rbStarting },
  };
  BASE.rankings = S.rankings;
  Object.assign(SWAP.statsteam, { fn: m => fnFull(m, 12), dbd: dbdTrials }); // VALORANT and the screen-read games use the broadcast pack's two-team board
  Object.assign(SWAP.statsplayer, { fn: genStatsPlayer, dbd: genStatsPlayer });
  Object.assign(SWAP.lineup, { fn: fnLineup, dbd: dbdLineup });
  Object.assign(SWAP.starting, { fn: kStarting, dbd: kStarting });
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
  /* Ad rotation: the event's ads take turns, each for its own number of seconds. The clock decides which one is up, so every
     overlay and preview shows the same ad without the server ticking. */
  function adNow(ev) {
    const a = ev.ads || {}, list = (a.items || []).filter(x => x && x.url && x.on !== false);
    if (!list.length) return null;
    const secs = x => Math.max(2, +x.secs || 10), total = list.reduce((n, x) => n + secs(x), 0);
    let t = (((Date.now() - (+a.start || 0)) / 1000) % total + total) % total;
    for (const x of list) { if (t < secs(x)) return x; t -= secs(x); }
    return list[0];
  }
  const adMedia = x => /\.(mp4|webm|mov)$/i.test(x.url) ? `<video src="${esc(x.url)}" autoplay muted loop playsinline></video>` : `<img src="${esc(x.url)}" alt="">`;
  /* One rotation for every logo box and ad spot: every item stays on the page and only the shown one changes, so the CSS
     transition cross-fades (or slides or zooms) between them instead of popping. Ads use their own seconds; sponsors 8 each.
     Images are always scaled to fit the box they are in. */
  const ROT_ANIMS = ["fade", "slide", "zoom", "cut"];
  const adList = ev => ((ev.ads || {}).items || []).filter(x => x && x.url && x.on !== false);
  function rotHtml(ev, list, start, cls) {
    if (!list.length) return "";
    const a = ev.ads || {}, anim = ROT_ANIMS.includes(a.anim) ? a.anim : "fade", ms = Math.max(0, Math.min(3000, Math.round(+(a.fadeMs ?? 800)) || 0));
    const secs = x => Math.max(2, +x.secs || 8), total = list.reduce((n, x) => n + secs(x), 0);
    let t = (((Date.now() - (+start || 0)) / 1000) % total + total) % total, cur = 0;
    for (let i = 0; i < list.length; i++) { if (t < secs(list[i])) { cur = i; break; } t -= secs(list[i]); }
    const prev = list.length > 1 ? (cur - 1 + list.length) % list.length : -1;
    return `<div class="rot rot-${anim}${cls ? " " + cls : ""}" style="--rt:${ms}ms">${list.map((x, i) => `<div class="ri${x.cover ? " cover" : ""}${i === cur ? " on" : i === prev ? " was" : ""}" data-k="ri-${esc(x.id)}">${x.html}</div>`).join("")}</div>`;
  }
  const adRot = (ev, cls, fit) => rotHtml(ev, adList(ev).map(x => ({ id: "ad" + x.id, html: adMedia(x), secs: x.secs, cover: fit && x.fit === "cover" })), (ev.ads || {}).start, cls);
  // a logo box: the ads when "In the logo box" is on and there are ads, else the given sponsors (8 seconds each)
  function logoBox(ev, sponsors) {
    if ((ev.ads || {}).mode === "logo" && adList(ev).length) return adRot(ev, "", false);
    return rotHtml(ev, (sponsors || []).map((x, i) => ({ id: "sp" + i + (x.logo || x.name), html: x.logo ? `<img src="${esc(x.logo)}" alt="${esc(x.name || "")}" onerror="this.style.display='none'">` : `<b>${esc(x.name)}</b>`, secs: 8 })), 0);
  }
  const logoAds = ev => (ev.ads || {}).mode === "logo" && adList(ev).length > 0;
  S.ads = (m) => ({ html: adList(m.ev).length ? `<div class="ad-full" data-k="ad-full">${adRot(m.ev, "", true)}</div>` : "", cams: [] });
  function adOverlay(ev, s) {
    const a = ev.ads || {};
    if (!["corner", "banner"].includes(a.mode) || s === "ads") return "";
    return adList(ev).length ? `<div class="ad-box ad-${a.mode}" data-k="adb-${a.mode}">${adRot(ev, "", false)}</div>` : "";
  }
  /* Text that must fit a fixed box (caster names and roles): shrinks the line a half pixel at a time until it fits, down to 55% of its
     size; only then does it fall back to the "..." cut. The box never changes size. Re-run on every draw, because a patch resets the size. */
  function fitText(root) {
    root.querySelectorAll("[data-fit]").forEach(el => {
      el.style.fontSize = "";
      if (el.scrollWidth <= el.clientWidth + 1) return;
      const base = parseFloat(getComputedStyle(el).fontSize) || 16; let sz = base;
      while (el.scrollWidth > el.clientWidth + 1 && sz > base * 0.55) { sz -= 0.5; el.style.fontSize = sz + "px"; }
    });
  }
  function render(hudEl, ev, game, scene, ctx) {
    CTX = ctx || {};
    if (!hudEl.firstChild) hudEl.innerHTML = `<div class="lay"></div><div class="cams"></div>`;
    const m = model(ev, game);
    const s = resolveScene(ev, m, scene);
    const out = S[s](m);
    out.html += adOverlay(ev, s); // the ad corner box or banner, over every scene when switched on
    hudEl.style.setProperty("--L", m.colors[0]); hudEl.style.setProperty("--R", m.colors[1]);
    const lay = hudEl.firstChild;
    if (lay.dataset.scene !== s) { lay.dataset.scene = s; lay.className = "lay"; lay.textContent = ""; lay.__html = null; lay.__seen = false; }
    FX.on = !(typeof location !== "undefined" && /[?&]anim=off\b/.test(location.search));
    if (lay.__html !== out.html) { const tpl = document.createElement("div"); tpl.innerHTML = out.html; patchKids(lay, tpl); lay.__html = out.html; fxFlush(hudEl); }
    fitText(hudEl);
    syncCams(hudEl.lastChild, out.cams);
    return m;
  }

  /* Preview backdrop, drawn at full 1280x720 so it stays crisp. It's a stand-in for game footage, not
     a picture of the game: "game" picks a neutral backdrop that fits the event's game, "image" uses your own screenshot. */
  function drawBg(c, kind, game, imageUrl) {
    const W = 1280, H = 720; c.width = W; c.height = H; const g = c.getContext("2d");
    const vignette = a => { const v = g.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, W * .72); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, `rgba(0,0,0,${a})`); g.fillStyle = v; g.fillRect(0, 0, W, H); };
    if (kind === "none") { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); return; }
    if (kind === "checker") { for (let y = 0; y < H; y += 40) for (let x = 0; x < W; x += 40) { g.fillStyle = ((x + y) / 40) % 2 ? "#7a7b84" : "#62636b"; g.fillRect(x, y, 40, 40); } return; }
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
  function sceneHtml(ev, game, scene, ctx) { CTX = ctx || {}; const m = model(ev, game), s = resolveScene(ev, m, scene); return S[s](m).html + adOverlay(ev, s); }
  function sceneOut(ev, game, scene, ctx) { CTX = ctx || {}; const m = model(ev, game); return S[resolveScene(ev, m, scene)](m); } // markup and cameras (tests)

  const api = { SCENES, SC_DEF, adNow, bbScore, model, render, drawBg, esc, fmt, feedKey, gdLabel, sceneHtml, sceneOut, nameMatch, GAMEDEF, fnPoints, fnTable, dbdScore, valInfo, artFail, fnLive, tickerLines, tickerJoin, tickerSpeed, vetoPreset, vetoFix, vetoOrder, vetoNext, VETO_FMT, agsInfo };
  if (typeof window !== "undefined") window.SaintsHUD = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api; // the server uses the same model for the data outputs
})();
