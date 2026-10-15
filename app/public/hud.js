// Shared HUD renderer for the dashboard previews and the OBS overlay.
(function () {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = s => { s = Math.max(0, Math.floor(+s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }; // whole seconds: the Minecraft and Riftbound clocks are fractional
  const low = s => String(s || "").toLowerCase().trim();

  const SCENES = {
    ingame: "Ingame HUD", bracket: "Bracket", casters: "Caster Nameplates", lowerthird: "Lower Thirds",
    rankings: "Rankings Screen", replay: "Replay", schedule: "Schedule", starting: "Starting Soon",
    statsplayer: "Stats Page Individual", statsteam: "Stats Page Team", lineup: "Team Lineup", timer: "Timer", title: "Title Screen",
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
        ev.teams.forEach(t => { const n = t.players.filter(p => names.includes(low(p.ign))).length; if (n > bn) { bn = n; best = t; } });
        if (best) { sides[s] = best; tracked[s] = true; }
      });
    }
    const kind = live && game.kind ? game.kind : ev.game === "League of Legends" ? "lol" : ev.game === "Minecraft" ? "mc" : ev.game === "Riftbound" ? "rb" : ev.game === "Rocket League" ? "rl" : "gen";
    const size = kind === "lol" ? 5 : 3;
    const roster = (t, name) => t && t.players.find(p => low(p.ign) === low(name));
    const blank = { score: 0, goals: 0, shots: 0, assists: 0, saves: 0, demos: 0, touches: 0, boost: 0, kills: 0, deaths: 0, cs: 0, level: 1, ward: 0 };
    const players = [0, 1].map(s => {
      const t = sides[s];
      let list = live
        ? game.players.filter(p => p.team === tn(s)).sort((a, b) => a.shortcut - b.shortcut).slice(0, size === 5 ? 5 : 4)
        : (t ? t.players.slice(0, size) : []).map((p, i) => Object.assign({ name: p.ign, shortcut: i + 1 + s * size }, blank));
      while (list.length < size && !live) list.push(Object.assign({ name: `Player ${list.length + 1}`, shortcut: 0 }, blank));
      return list.map(p => {
        const r = roster(t, p.name);
        return Object.assign({}, blank, p, { display: (r && (r.alias || r.ign)) || p.name, side: s, team: t,
          avatar: r ? r.avatar : "", country: r ? r.country : "", cam: r ? r.cam : "" });
      });
    });
    const all = players[0].concat(players[1]);
    const find = w => w && all.find(p => (w.shortcut && p.shortcut === w.shortcut) || low(p.name) === low(w.name));
    const score = l.autoScore && (live || hasScore) ? [game.teams[tn(0)].score, game.teams[tn(1)].score] : l.score;
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
      series: l.series, focus: live ? find(game.target) : null,
      clock: live || hasClock ? game.time : 300, clockLive: live || hasClock, ot: !!(game && game.overtime), replay: !!(game && game.replay), podium: !!(game && game.podium),
      connected: !!(game && game.connected), source: game ? game.source : "",
    };
  }

  const lg = (t, cls = "lgbox") => `<div class="${cls}">${!t ? `<div class="lg" style="background:#2a2b31">?</div>`
    : t.logos && t.logos[0] ? `<img class="lg" src="${esc(t.logos[0])}" alt="">`
    : `<div class="lg" style="background:${esc(t.color)}">${esc((t.tag || "?").slice(0, 4))}</div>`}</div>`;
  const tourLogo = ev => (ev.tournament.logos || []).find(Boolean);
  const sideTeam = (ev, id) => ev.teams.find(t => t.id === id);

  /* ---------------- scenes: each returns { html, cams } ---------------- */
  /* Player webcams: one slot per player (3 a side in Rocket League, 5 in League) down both edges of the screen. A slot shows when
     that player has a camera link on the roster; the left team's players are on the left. */
  function playerCams(m, top) {
    const w = 150, camH = 84, pitch = 111, cams = []; let html = "";
    [0, 1].forEach(s => m.players[s].forEach((p, i) => {
      if (!p.cam) return;
      const x = s ? 1280 - 8 - w : 8, y = top + i * pitch;
      html += `<div class="pc ${s ? "r" : "l"}" style="left:${x}px;top:${y}px;--c:${esc(m.colors[s])}"><span>${esc(p.display)}</span></div>`;
      cams.push({ key: "pc-" + s + "-" + i + p.cam, url: p.cam, x, y, w, h: camH });
    }));
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
      <div class="h-bug"><div class="h-team l">${lg(L)}<span class="tn">${esc(L ? L.name : "Blue")}</span><span class="gs num">${m.score[0]}</span></div>
      <div class="h-mid">${tl ? `<div class="lgbox"><img class="lg" src="${esc(tl)}" alt=""></div>` : `<span style="font-size:22px;color:#9a9ba3">${esc(ev.tournament.name || "VS")}</span>`}</div>
      <div class="h-team r">${lg(R)}<span class="tn">${esc(R ? R.name : "Orange")}</span><span class="gs num">${m.score[1]}</span></div></div>
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
      if (s.url) cams.push({ key: "seat" + i + s.url, url: s.url, x, y: Math.max(0, y - 150), w: 256, h: 144 });
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
    return { html: `<div class="h-full"><div style="display:flex;align-items:center;gap:30px;font-size:52px">${lg(L, "lgbox h-l")}<span class="num">${esc(L ? L.tag : "BLU")} ${m.score[0]} – ${m.score[1]} ${esc(R ? R.tag : "ORG")}</span>${lg(R, "lgbox h-l")}</div>
    ${lol ? `<div class="h-eyebrow" style="font-size:22px">${m.live ? "TEAM KILLS · " + fmt(m.clock) : "TEAM KILLS"}</div>` : ""}
    <table class="h-table" style="width:${lol ? 1040 : 960}px;font-size:${lol ? 23 : 26}px"><thead><tr><th>PLAYER</th>${cols.map(([, n]) => `<th>${n}</th>`).join("")}</tr></thead>
    <tbody>${m.players[0].map(p => r(p, "l")).join("")}<tr class="sep"><td colspan="7"></td></tr>${m.players[1].map(p => r(p, "r")).join("")}</tbody></table></div>`.replace(/lgbox h-l"/g, 'lgbox" style="width:76px;height:76px"'), cams: [] };
  };
  const DRAKE = { Infernal: "#ff6b3d", Ocean: "#3dbbff", Mountain: "#b5835a", Cloud: "#d9e6f2", Hextech: "#3de0d0", Chemtech: "#8fd14f", Elder: "#b48cff" };
  S.lolingame = (m) => {
    const ev = m.ev, l = ev.live, sh = ev.hud.show, [L, R] = m.sides;
    const o = m.lol || { ddVersion: "", counters: { dragons: true, heralds: true, grubs: true }, timers: {}, buffs: {} };
    const icon = p => o.ddVersion && p.champKey ? `<img src="/ddragon/cdn/${esc(o.ddVersion)}/img/champion/${encodeURIComponent(p.champKey)}.png" alt="">`
      : `<span>${esc(String(p.champion || p.display || "?").slice(0, 2))}</span>`;
    // objective counts are stored per game side (0 = blue); the HUD's left/right may be swapped
    const gs = s => (l.swap ? 1 - s : s);
    const K = n => (Math.max(0, n) / 1000).toFixed(1) + "K"; // gold is always shown as 12.0K, 0.5K, +0.3K
    // team totals come from the server (estimated gold, kills); every array is per game side, so index it with gs(hudSide)
    const kills = [0, 1].map(s => (o.kills ? o.kills[gs(s)] : m.players[s].reduce((a, p) => a + (p.kills || 0), 0)));
    const gold = [0, 1].map(s => (o.gold ? Math.round(o.gold[gs(s)]) : m.players[s].reduce((a, p) => a + (p.gold || 0), 0)));
    const diff = gold[0] - gold[1], lead = diff >= 100 ? 0 : diff <= -100 ? 1 : -1; // the lead tab shows on the leading side only
    const ICON = {
      sword: `<svg viewBox="0 0 24 24"><path d="M5 19 17 7M14 4h6v6M4 20l3-1-2-2z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      coin: `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="9" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="2.2"/></svg>`,
      tower: `<svg viewBox="0 0 24 24"><path d="M6 21V10h2V6h2v2h4V6h2v4h2v11zM10 21v-5h4v5" fill="currentColor"/></svg>`,
      drake: `<svg viewBox="0 0 24 24"><path d="M12 2 21 12 12 22 3 12z" fill="currentColor"/></svg>`,
      grub: `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8" ry="5.5" fill="currentColor"/><path d="M9 7v10M12.5 6.5v11M16 7.5v9" stroke="#07120e" stroke-width="1.4"/></svg>`,
      herald: `<svg viewBox="0 0 24 24"><path d="M2 12c3-5 7-7 10-7s7 2 10 7c-3 5-7 7-10 7S5 17 2 12z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>`,
    };
    ICON.elder = ICON.drake; ICON.baron = `<i>B</i>`;
    // Official objective icons are downloaded automatically (server.js); the shapes above are the fallback.
    const OI = k => (CTX.icons && CTX.icons[k] ? `<img class="oi" src="${esc(CTX.icons[k])}" alt="">` : "");
    const ic = (k, fallback) => OI(k) || fallback;
    const stat = (s, right) =>
      `<div class="l2-stat${right ? " r" : ""}"><span class="k">${ICON.sword}<b class="num">${kills[s]}</b></span><span class="g">${ICON.coin}<b class="num">${K(gold[s])}</b>${lead === s ? `<small>+${K(Math.abs(diff))}</small>` : ""}</span></div>`;
    const cnt = (k, s) => (o[k] ? o[k][gs(s)] : 0) || 0;
    const objs = (s, right) => { const t = gs(s), C = o.counters || {}, drag = (o.dragons && o.dragons[t]) || [];
      return `<div class="l2-obj${right ? " r" : ""}">`
        + (C.dragons !== false ? `<span class="drk">${drag.slice(0, 4).map(d => ic(d.toLowerCase(), `<i style="color:${DRAKE[d] || "#888"}">${ICON.drake}</i>`)).join("")}${cnt("elders", s) ? ic("elder", `<i style="color:${DRAKE.Elder}">${ICON.drake}</i>`) : ""}</span>` : "")
        + (C.heralds !== false ? `<span>${ic("herald", ICON.herald)}<b class="num">${cnt("heralds", s)}</b></span>` : "")
        + (C.grubs !== false ? `<span>${ic("grubs", ICON.grub)}<b class="num">${cnt("grubs", s)}</b></span>` : "")
        + (cnt("barons", s) ? `<span class="bar">B<b class="num">${cnt("barons", s)}</b></span>` : "") + `</div>`; };
    // Buff cards down each side of the screen: the objective, who took it, and the buff's countdown. They sit under the team's
    // own side (left or right of the HUD) and drain as the buff runs out.
    const BUFF = { baron: ["BARON BUFF", "baron", "#b48cff"], elder: ["ELDER BUFF", "elder", DRAKE.Elder] };
    const buffCards = (s, right) => ["baron", "elder"].map(b => { const f = o.buffs && o.buffs[b]; if (!f || f.side !== gs(s)) return "";
      const who = f.player != null ? m.players[s].find(p => p.shortcut === f.player + 1) : null, [label, key, col] = BUFF[b];
      return `<div class="l2-buff ${key}${right ? " r" : ""}" style="--c:${col}" data-k="bf-${key}"><div class="pt">${who ? icon(who) : ic(key, ICON[key])}${OI(key) && who ? "" : ""}</div>
        <div class="tx"><small>${label}</small><b>${esc(who ? who.display : f.killer || "")}</b></div><b class="num cd">${fmt(f.secs)}</b><i class="dr" style="width:${Math.max(0, Math.min(100, (f.secs / (f.total || 1)) * 100))}%"></i></div>`; }).join("");
    const buffSide = (s, right) => { const c = buffCards(s, right); return c ? `<div class="l2-buffs${right ? " r" : ""}${sh.playerCam ? " pc" : ""}">${c}</div>` : ""; };
    const NOTE = { dragon: 1, baron: 1, herald: 1, tower: 1, inhib: 1, ace: 1, fb: 1, multi: 1 };
    const note = m.feed.slice().reverse().find(x => NOTE[x.type]);
    const row = p => `<div class="l-p${p.dead ? " dead" : ""}"><div class="ch">${icon(p)}<b class="lv num">${p.level || 1}</b>${p.dead ? `<b class="rs num">${p.respawn || ""}</b>` : ""}</div>
      <div class="nm"><b>${esc(p.display)}</b><small class="num">${p.kills || 0}/${p.deaths || 0}/${p.assists || 0} · ${p.cs || 0} CS · ${K(p.gold || 0)}</small></div></div>`;
    // lower panel: each lane side by side with items, K/D/A, CS, gold and the lane's gold lead in the middle
    const item = id => (o.ddVersion && id ? `<img src="/ddragon/cdn/${esc(o.ddVersion)}/img/item/${id}.png" alt="">` : `<i></i>`);
    const slots = p => Array.from({ length: 6 }, (_, i) => item((p.items || [])[i])).join("");
    const slots7 = p => Array.from({ length: 7 }, (_, i) => item((p.items || [])[i])).join(""); // six items and the trinket
    const spell = k => (o.ddVersion && k ? `<img src="/ddragon/cdn/${esc(o.ddVersion)}/img/spell/${esc(k)}.png" alt="">` : `<i></i>`);
    const EYE = `<svg viewBox="0 0 24 24"><path d="M2 12c3-5 7-7 10-7s7 2 10 7c-3 5-7 7-10 7S5 17 2 12z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;
    // One row of the board, laid out like the in-game scoreboard: vision, items, spells, portrait with level, name and keystone, CS over K/D/A.
    // (Health and mana aren't in Riot's live data, so there are no bars.) The right side is the same row mirrored.
    const half = (p, right) => !p ? `<div class="lp-h${right ? " r" : ""}"></div>` : `<div class="lp-h${right ? " r" : ""}${p.dead ? " dead" : ""}">
      <div class="vs"><b class="num">${p.ward || 0}</b>${EYE}</div><div class="it">${slots7(p)}</div>
      <div class="sp">${spell((p.spells || [])[0])}${spell((p.spells || [])[1])}</div>
      <div class="ch">${icon(p)}<b class="lv num">${p.level || 1}</b>${p.dead ? `<b class="rs num">${p.respawn || ""}</b>` : ""}</div>
      <div class="nm"><b>${esc(p.display)}</b>${p.keystone ? `<img class="rk" src="/ddragon/cdn/img/${esc(p.keystone)}" alt="">` : ""}</div>
      <div class="st"><b class="num">${p.cs || 0}</b><small class="num">${p.kills || 0}/${p.deaths || 0}/${p.assists || 0}</small></div></div>`;
    const lanes = Math.max(m.players[0].length, m.players[1].length);
    const panel = Array.from({ length: lanes }, (_, i) => { const a = m.players[0][i], b = m.players[1][i], d = ((a && a.gold) || 0) - ((b && b.gold) || 0);
      return `${half(a, false)}<div class="lp-d${d > 0 ? " l" : d < 0 ? " r" : ""}"><b class="num">${Math.abs(d)}</b></div>${half(b, true)}`; }).join("");
    let h = "";
    if (sh.stats) { // objective timers, top-left corner: a countdown, LIVE, or hidden once the objective is gone for the game
      const chips = [["dragon", "DRAGON", "drake"], ["grubs", "VOID GRUBS", "grub"], ["herald", "HERALD", "herald"], ["elder", "ELDER", "elder"], ["baron", "BARON", "baron"]].map(([k, n, cls]) => {
        const t = (o.timers || {})[k]; if (!t || !t.label) return "";
        return `<div class="tm ${cls}" data-k="tm-${k}">${ic(k, ICON[cls])}<b class="${t.label === "LIVE" ? "up" : "num"}">${t.label}</b><small>${n}${k === "dragon" && o.nextDragonIsElder ? " (ELDER)" : ""}</small></div>`;
      }).join("");
      if (chips) h += `<div class="l2-timers">${chips}</div>`;
    }
    // Same layout as the in-game broadcast bar: [team] [turrets] [gold] [kills | kills] [gold] [turrets] [team], the clock underneath,
    // and the claimed objectives (dragons, herald, grubs, baron) in the row beside it.
    const need = Math.floor((+l.bestOf || 3) / 2) + 1;
    const pipsOf = s => `<span class="pips">${Array.from({ length: need }, (_, i) => `<i class="${m.series[s] > i ? "on" : ""}"></i>`).join("")}</span>`;
    const gdBlock = s => `<div class="l2-gd ${s ? "r" : "l"}"><span class="g">${ICON.coin}<b class="num">${K(gold[s])}</b></span>${lead === s ? `<small>+${K(Math.abs(diff))}</small>` : ""}</div>`;
    const twBlock = s => `<div class="l2-tw ${s ? "r" : "l"}">${ic("tower", ICON.tower)}<b class="num">${cnt("towers", s)}</b></div>`;
    if (sh.score) h += `<div class="l2-bar"><div class="l2-team l">${lg(L)}<span class="tg">${esc(L ? L.tag : "BLUE")}</span>${pipsOf(0)}</div>${twBlock(0)}${gdBlock(0)}
      <div class="l2-kc"><b class="num">${kills[0]}</b><b class="num">${kills[1]}</b></div>
      ${gdBlock(1)}${twBlock(1)}<div class="l2-team r">${pipsOf(1)}<span class="tg">${esc(R ? R.tag : "RED")}</span>${lg(R)}</div></div>
      <div class="l2-sub">${objs(0, false)}<div class="l2-time"><b class="num">${fmt(m.clock)}</b></div>${objs(1, true)}</div>
      ${note ? `<div class="l2-note" style="--c:${m.colors[note.side] || "#FDC82F"}"><b>${esc(((note.main && note.main.name && m.sides[note.side]) ? m.sides[note.side].tag : "") )}</b> ${esc(note.label)}${note.main ? ` · ${esc(note.main.display || note.main.name)}` : ""}</div>` : ""}`;
    if (sh.score) h += buffSide(0, false) + buffSide(1, true);
    if (sh.boost) h += `<div class="l-side l" style="top:130px">${m.players[0].map(row).join("")}</div><div class="l-side r" style="top:130px">${m.players[1].map(row).join("")}</div>`; // optional: off by default, the board at the bottom has the same info
    // Auto: the lane panel normally, a compact strip while a teamfight is on. Health, mana and ultimate timers
    // aren't in Riot's live data, so the strip shows what is: level, items, K/D/A and death timers.
    const fight = o.fight || { active: false, kills: [0, 0] }, showFight = ev.hud.lolPanel === "fight"; // switched by the operator (F9 or the dashboard), never automatic
    const tile = p => !p ? "" : `<div class="tf-p${p.dead ? " dead" : ""}"><div class="it">${slots(p)}</div><div class="ch">${icon(p)}<b class="lv num">${p.level || 1}</b>${p.dead ? `<b class="rs num">${p.respawn || ""}</b>` : ""}</div><b class="nm">${esc(p.display)}</b><small class="num">${p.kills || 0}/${p.deaths || 0}/${p.assists || 0}</small></div>`;
    if (sh.card && showFight) h += `<div class="tf"><div class="tf-s">${m.players[0].map(tile).join("")}</div><div class="tf-m"><small>TEAMFIGHT</small><b class="num"><span style="color:var(--L)">${fight.kills[gs(0)]}</span> – <span style="color:var(--R)">${fight.kills[gs(1)]}</span></b></div><div class="tf-s">${m.players[1].map(tile).join("")}</div></div>`;
    else if (sh.card) h += `<div class="lp">${panel}</div>`;
    if (sh.feed && m.feed.length) h += `<div class="h-feed" style="top:${sh.boost ? 420 : 110}px${sh.playerCam ? ";right:170px" : ""}">${m.feed.map(x => `<div><span style="color:${m.colors[x.side]}">${esc(x.main ? x.main.display || x.main.name : "")}</span><i>${esc(x.label)}</i>${x.second ? `<span style="color:${m.colors[1 - x.side]}">${esc(x.second.display || x.second.name)}</span>` : ""}</div>`).join("")}</div>`;
    const pc = sh.playerCam ? playerCams(m, 100) : { html: "", cams: [] };
    return { html: h + pc.html, cams: pc.cams };
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
  function mcHunger(m, d) {
    const cfg = d.cfg, byKills = d.list.filter(p => p.kills > 0).sort((a, b) => b.kills - a.kills).slice(0, 5);
    const spot = d.list.find(p => p.name === cfg.spotlight) || d.list.slice().sort((a, b) => b.kills - a.kills || (b.alive ? 1 : 0) - (a.alive ? 1 : 0))[0];
    const n = d.list.length, tw = Math.max(26, Math.min(56, Math.floor(1210 / Math.max(1, n))));
    let h = `<div class="mc-top"><div class="t">${esc(cfg.title || "HUNGER GAMES")}</div><div class="a"><b class="num">${d.alive ?? "–"}</b><small>/ ${d.total || "–"} ALIVE</small></div>
      <div class="c"><b class="num">${fmt(d.elapsed)}</b>${d.border != null ? `<small>BORDER ${Math.round(d.border)}</small>` : ""}</div></div>`;
    if (byKills.length) h += `<div class="mc-kills"><h4>KILLS</h4>${byKills.map((p, i) => `<div data-k="k${esc(p.name)}">${head(p.name)}<span class="nm">${esc(p.name)}</span><b class="num">${p.kills}</b></div>`).join("")}</div>`;
    if (d.feed.length) h += `<div class="mc-feed">${d.feed.map(f => `<div data-k="f${f.id}">${f.killer ? `<b>${esc(f.killer)}</b><i>${esc(f.weapon || "ELIMINATED")}</i>` : ""}<span>${esc(f.victim)}</span>${f.killer ? "" : "<i>OUT</i>"}</div>`).join("")}</div>`;
    if (spot) h += `<div class="mc-spot">${head(spot.name, "big")}<div class="nm"><b>${esc(spot.name)}</b><small>${spot.team ? esc(spot.team.tag) : ""}${spot.alive ? "" : " · OUT"}</small></div>
      <div class="hearts">${hearts(spot.health)}</div><div class="r2"><span class="fd"><i style="width:${Math.max(0, Math.min(100, ((spot.food || 0) / 20) * 100))}%"></i></span><span class="kl num">${spot.kills} KILLS</span></div></div>`;
    if (n) h += `<div class="mc-grid" style="--w:${tw}px">${d.list.map(p => `<div class="tile${p.alive ? "" : " out"}" data-k="p${esc(p.name)}">${head(p.name)}<span class="hpb"><i style="width:${Math.max(0, Math.min(100, ((p.health || 0) / 20) * 100))}%"></i></span>${p.kills ? `<b class="kb num">${p.kills}</b>` : ""}</div>`).join("")}</div>`;
    return { html: h, cams: [] };
  }
  function mcBuild(m, d) {
    const bb = d.cfg.bb || {}, oc = d.oc, phase = (oc && oc.phase && phaseOf(String(oc.phase))) || bb.phase || "waiting";
    const theme = (oc && oc.theme) || bb.theme || "", rem = oc && oc.clock != null ? oc.clock : bb.endsAt ? Math.max(0, (bb.endsAt - Date.now()) / 1000) : bb.remaining || 0;
    const scores = bb.scores || {};
    if (phase === "results") {
      const names = [...new Set([...Object.keys(scores), ...d.list.map(p => p.name)])];
      const rows = names.map(n => ({ n, s: scores[n] })).sort((a, b) => (b.s ?? -1) - (a.s ?? -1)).slice(0, 10);
      return { html: `<div class="h-full"><div class="h-eyebrow">${esc(theme || d.cfg.title || "BUILD BATTLE")}</div><div class="h-title" style="font-size:90px">RESULTS</div>
        <table class="h-table" style="width:760px"><tbody>${rows.map((r, i) => `<tr class="${i === 0 ? "top" : ""}"><td class="num" style="width:60px">${i + 1}</td><td class="tm" style="text-align:left">${head(r.n, "sm")}${esc(r.n)}</td><td class="num">${r.s ?? "–"}</td></tr>`).join("")}</tbody></table></div>`, cams: [] };
    }
    let h = `<div class="bb-top"><div class="th"><small>THEME</small><b>${esc(theme || "–")}</b></div><div class="ph">${PHASE[phase]}</div><div class="tm num">${fmt(rem)}</div></div>`;
    h += `<div class="bb-list">${d.list.slice(0, 14).map(p => `<div data-k="b${esc(p.name)}" class="${p.online ? "" : "off"}">${head(p.name, "sm")}<span class="nm">${esc(p.name)}</span>${scores[p.name] != null ? `<b class="num">${scores[p.name]}</b>` : ""}</div>`).join("")}</div>`;
    if (phase === "judging" && bb.judging) h += `<div class="bb-judge">${head(bb.judging, "big")}<div><small>NOW JUDGING</small><b>${esc(bb.judging)}</b></div><div class="sc"><b class="num">${scores[bb.judging] ?? "–"}</b><small>/ 10</small></div></div>`;
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
  const GD_LABEL = { "Rocket League": "GOAL DIFF", "League of Legends": "GAME DIFF", "Riftbound": "POINT DIFF", "Minecraft": "POINTS" };
  const gdLabel = g => GD_LABEL[g] || "DIFF";
  const lgBig = t => lg(t).replace('class="lgbox"', 'class="lgbox" style="width:76px;height:76px"');
  const noLive = g => String(g || "").toUpperCase();

  S.geningame = (m) => {
    const ev = m.ev, l = ev.live, [L, R] = m.sides, tl = tourLogo(ev);
    const sponsors = ev.tournament.sponsors.map(x => x.name).filter(Boolean);
    const tick = [l.seriesTitle, l.eventTitle, l.roundTitle, ...sponsors].filter(Boolean).join("  |  ") || ev.name;
    return { html: `<div class="h-tick"><span>${esc(tick)}  |  ${esc(tick)}  |  </span></div>
      <div class="h-bug"><div class="h-team l">${lg(L)}<span class="tn">${esc(L ? L.name : "Team A")}</span><span class="gs num">${m.score[0]}</span></div>
      <div class="h-mid">${tl ? `<div class="lgbox"><img class="lg" src="${esc(tl)}" alt=""></div>` : `<span style="font-size:22px;color:#9a9ba3">${esc(ev.tournament.name || "VS")}</span>`}</div>
      <div class="h-team r">${lg(R)}<span class="tn">${esc(R ? R.name : "Team B")}</span><span class="gs num">${m.score[1]}</span></div></div>
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

  /* each of these scenes keeps its Rocket League / League version and swaps in the game's own for the others */
  const BASE = { statsteam: S.statsteam, statsplayer: S.statsplayer, lineup: S.lineup, starting: S.starting };
  const SWAP = {
    statsteam: { mc: mcStatsTeam, rb: rbStatsTeam, gen: genStatsTeam }, statsplayer: { mc: mcStatsPlayer, rb: rbStatsPlayer, gen: genStatsPlayer },
    lineup: { mc: mcLineup, rb: rbLineup }, starting: { mc: mcStarting, rb: rbStarting },
  };
  for (const name of Object.keys(SWAP)) S[name] = m => (SWAP[name][m.kind] || BASE[name])(m);

  /* pick the scene: "auto" follows the dashboard, and the in-game HUD
     switches itself to Replay during goal replays and Team Stats on the podium */
  function resolveScene(ev, m, scene) {
    let s = scene === "auto" || !scene ? ev.hud.scene : scene;
    if (s === "ingame" && m.kind === "lol") return "lolingame";
    if (s === "ingame" && m.kind === "gen") return "geningame";
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
      Object.assign(f.style, { left: c.x + "px", top: c.y + "px", width: c.w + "px", height: c.h + "px" });
    });
  }

  /* Update the page in place instead of replacing it: unchanged elements stay put, so entry animations
     don't restart every second and bar widths can transition smoothly. Children are matched by a key
     (data-k, else class name plus its position among siblings with that class). */
  const keyOf = (el, seen) => { const base = el.getAttribute("data-k") || el.getAttribute("class") || el.tagName; seen[base] = (seen[base] || 0) + 1; return base + "#" + seen[base]; };
  function syncAttrs(a, b) {
    for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of b.attributes) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  }
  function patchKids(a, b) {
    const ac = [...a.childNodes], bc = [...b.childNodes], oldEl = new Map(), oldTxt = [], sa = {}, sb = {}, next = [];
    for (const x of ac) { if (x.nodeType === 1) oldEl.set(keyOf(x, sa), x); else if (x.nodeType === 3) oldTxt.push(x); }
    let ti = 0;
    for (const y of bc) {
      if (y.nodeType === 3) { const x = oldTxt[ti++]; if (x) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; next.push(x); } else next.push(y.cloneNode(true)); }
      else if (y.nodeType === 1) { const k = keyOf(y, sb), x = oldEl.get(k); if (x && x.tagName === y.tagName) { oldEl.delete(k); syncAttrs(x, y); patchKids(x, y); next.push(x); } else next.push(y.cloneNode(true)); }
    }
    next.forEach((n, i) => { if (a.childNodes[i] !== n) a.insertBefore(n, a.childNodes[i] || null); });
    while (a.childNodes.length > next.length) a.removeChild(a.lastChild);
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
    if (lay.dataset.scene !== s) { lay.dataset.scene = s; lay.className = "lay fade"; lay.textContent = ""; lay.__html = null; void lay.offsetWidth; } else lay.className = "lay";
    if (lay.__html !== out.html) { const tpl = document.createElement("div"); tpl.innerHTML = out.html; patchKids(lay, tpl); lay.__html = out.html; }
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
  const AUTO_FEED = { "Rocket League": "rl", "League of Legends": "lol", "Minecraft": "mc", "Riftbound": "manual" };
  function feedKey(ev) {
    const s = (ev && ev.source) || "auto";
    return s === "auto" ? AUTO_FEED[ev && ev.game] || "ocr" : s === "demo" ? "demo:" + ev.id : s;
  }

  // the html a scene draws for an event and a live feed, without a page (used by the tests)
  function sceneHtml(ev, game, scene, ctx) { CTX = ctx || {}; const m = model(ev, game); return S[resolveScene(ev, m, scene)](m).html; }

  const api = { SCENES, model, render, drawBg, esc, fmt, feedKey, gdLabel, sceneHtml };
  if (typeof window !== "undefined") window.SaintsHUD = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api; // the server uses the same model for the data outputs
})();
