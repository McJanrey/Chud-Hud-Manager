// Shared HUD renderer for the dashboard previews and the OBS overlay.
(function () {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
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
    const kind = live && game.kind ? game.kind : ev.game === "League of Legends" ? "lol" : "rl";
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
      ev, live, kind, lol: game && game.lol, sides, tracked, players, all, score, colors, feed, goal, lastGoal, mvp,
      series: l.series, focus: live ? find(game.target) : null,
      clock: live || hasClock ? game.time : 300, ot: !!(game && game.overtime), replay: !!(game && game.replay), podium: !!(game && game.podium),
      connected: !!(game && game.connected), source: game ? game.source : "",
    };
  }

  const lg = (t, cls = "lgbox") => `<div class="${cls}">${!t ? `<div class="lg" style="background:#2a2b31">?</div>`
    : t.logos && t.logos[0] ? `<img class="lg" src="${esc(t.logos[0])}" alt="">`
    : `<div class="lg" style="background:${esc(t.color)}">${esc((t.tag || "?").slice(0, 4))}</div>`}</div>`;
  const tourLogo = ev => (ev.tournament.logos || []).find(Boolean);
  const sideTeam = (ev, id) => ev.teams.find(t => t.id === id);

  /* ---------------- scenes: each returns { html, cams } ---------------- */
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
    if (sh.feed && m.feed.length) h += `<div class="h-feed" style="top:${sh.boost ? 160 : 20}px">${m.feed.map(x => `<div><span style="color:${m.colors[x.side]}">${esc(x.main ? x.main.display || x.main.name : "")}</span><i>${esc(x.label)}</i>${x.second ? `<span style="color:${m.colors[1 - x.side]}">${esc(x.second.display || x.second.name)}</span>` : ""}</div>`).join("")}</div>`;
    if (sh.card && f) {
      h += `<div class="h-card" style="--c:${fc}">${lg(f.team)}<div class="who"><b>${esc(f.display)}</b><small>${esc(f.team ? f.team.tag : "")}${f.supersonic ? " · SUPERSONIC" : ""}</small></div><div class="st">${[["score", "SCORE"], ["goals", "GOALS"], ["assists", "ASSISTS"], ["saves", "SAVES"], ["shots", "SHOTS"]].map(([k, n]) => `<div><b class="num">${f[k] || 0}</b><small>${n}</small></div>`).join("")}</div>${f.avatar ? `<img class="cut" src="${esc(f.avatar)}" alt="">` : ""}</div>
      <div class="h-gauge"><svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="58" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="9" stroke-dasharray="${arc} 999"/><circle cx="70" cy="70" r="58" fill="none" stroke="${fc}" stroke-width="9" stroke-dasharray="${arc * (f.boost || 0) / 100} 999"/></svg><b class="num">${f.boost ?? 0}</b><small>BOOST</small></div>`;
      if (sh.playerCam && f.cam) cams.push({ key: "pc-" + f.cam, url: f.cam, x: 16, y: 440, w: 256, h: 144 });
    }
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
  S.casters = (m) => {
    const ev = m.ev, n = { solo: 1, duo: 2, trio: 3 }[ev.camera.layout] || 2;
    const seats = ev.camera.seats.slice(0, n).map(s => ({ s, t: ev.talent.find(x => x.id === s.talent) }));
    const cams = [];
    // camera iframes sit above the feed boxes; positions mirror the flex layout below
    const gap = 24, area = 1280 - 120, w = Math.min(560, (area - gap * (n - 1)) / n), total = w * n + gap * (n - 1), x0 = 60 + (area - total) / 2;
    seats.forEach(({ s }, i) => { if (s.url) cams.push({ key: "seat" + i + s.url, url: s.url, x: x0 + i * (w + gap) + 3, y: 103, w: w - 6, h: 720 - 70 - 64 - 103 }); });
    return { html: `<div class="h-full" style="justify-content:flex-start"><div class="h-desk"><div class="top">${esc([ev.live.seriesTitle, ev.live.eventTitle].filter(Boolean).join("  ·  ") || ev.name)}</div></div>
    <div class="h-cams">${seats.map(({ t }) => `<div class="h-cam"><div class="feed">${t && t.portrait ? `<img src="${esc(t.portrait)}" alt="">` : `<div class="h-sil"></div>`}</div>
      <div class="h-plate"><span class="bar"></span><div><b>${esc(t ? t.name : "Open seat")}</b><small>${esc(t ? t.role : "")}</small></div><span class="soc">${t && t.socials[0] ? esc(t.socials[0].h) : ""}</span></div></div>`).join("")}</div></div>`, cams };
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
    const o = m.lol || { towers: [0, 0], inhibs: [0, 0], dragons: [[], []], barons: [0, 0], heralds: [0, 0], ddVersion: "" };
    const icon = p => o.ddVersion && p.champKey ? `<img src="https://ddragon.leagueoflegends.com/cdn/${esc(o.ddVersion)}/img/champion/${encodeURIComponent(p.champKey)}.png" alt="">`
      : `<span>${esc(String(p.champion || p.display || "?").slice(0, 2))}</span>`;
    // objective counts are stored per game side (0 = blue); the HUD's left/right may be swapped
    const gs = s => (l.swap ? 1 - s : s);
    const K = n => (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n | 0));
    const gold = [0, 1].map(s => m.players[s].reduce((a, p) => a + (p.gold || 0), 0));
    const kills = [0, 1].map(s => m.players[s].reduce((a, p) => a + (p.kills || 0), 0));
    const lead = gold[0] === gold[1] ? -1 : gold[0] > gold[1] ? 0 : 1;
    const ICON = {
      sword: `<svg viewBox="0 0 24 24"><path d="M5 19 17 7M14 4h6v6M4 20l3-1-2-2z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      coin: `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="9" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="2.2"/></svg>`,
      tower: `<svg viewBox="0 0 24 24"><path d="M6 21V10h2V6h2v2h4V6h2v4h2v11zM10 21v-5h4v5" fill="currentColor"/></svg>`,
      drake: `<svg viewBox="0 0 24 24"><path d="M12 2 21 12 12 22 3 12z" fill="currentColor"/></svg>`,
    };
    const stat = (s, right) => { const t = gs(s);
      return `<div class="l2-stat${right ? " r" : ""}"><span class="k">${ICON.sword}<b class="num">${kills[t]}</b></span><span class="g">${ICON.coin}<b class="num">${K(gold[t])}</b>${lead === t ? `<small>+${K(Math.abs(gold[0] - gold[1]))}</small>` : ""}</span></div>`; };
    const objs = (s, right) => { const t = gs(s);
      return `<div class="l2-obj${right ? " r" : ""}"><span>${ICON.tower}<b class="num">${o.towers[t] || 0}</b></span><span class="drk">${(o.dragons[t] || []).slice(0, 4).map(d => `<i style="color:${DRAKE[d] || "#888"}">${ICON.drake}</i>`).join("")}</span>${o.barons[t] ? `<span class="bar">B<b class="num">${o.barons[t]}</b></span>` : ""}</div>`; };
    const NOTE = { dragon: 1, baron: 1, herald: 1, tower: 1, inhib: 1, ace: 1, fb: 1, multi: 1 };
    const note = m.feed.slice().reverse().find(x => NOTE[x.type]);
    const row = p => `<div class="l-p${p.dead ? " dead" : ""}"><div class="ch">${icon(p)}<b class="lv num">${p.level || 1}</b>${p.dead ? `<b class="rs num">${p.respawn || ""}</b>` : ""}</div>
      <div class="nm"><b>${esc(p.display)}</b><small class="num">${p.kills || 0}/${p.deaths || 0}/${p.assists || 0} · ${p.cs || 0} CS · ${K(p.gold || 0)}</small></div></div>`;
    // lower panel: each lane side by side with items, K/D/A, CS, gold and the lane's gold lead in the middle
    const item = id => (o.ddVersion && id ? `<img src="https://ddragon.leagueoflegends.com/cdn/${esc(o.ddVersion)}/img/item/${id}.png" alt="">` : `<i></i>`);
    const slots = p => Array.from({ length: 6 }, (_, i) => item((p.items || [])[i])).join("");
    const half = (p, right) => !p ? `<div class="lp-h${right ? " r" : ""}"></div>` : `<div class="lp-h${right ? " r" : ""}${p.dead ? " dead" : ""}"><div class="it">${slots(p)}</div><div class="ch">${icon(p)}<b class="lv num">${p.level || 1}</b></div>
      <div class="nm"><b>${esc(p.display)}</b><small class="num">${p.kills || 0}/${p.deaths || 0}/${p.assists || 0}</small></div><div class="st"><b class="num">${K(p.gold || 0)}</b><small class="num">${p.cs || 0} CS</small></div></div>`;
    const lanes = Math.max(m.players[0].length, m.players[1].length);
    const panel = Array.from({ length: lanes }, (_, i) => { const a = m.players[0][i], b = m.players[1][i], d = ((a && a.gold) || 0) - ((b && b.gold) || 0);
      return `${half(a, false)}<div class="lp-d${d > 0 ? " l" : d < 0 ? " r" : ""}"><b class="num">${Math.abs(d)}</b></div>${half(b, true)}`; }).join("");
    let h = "";
    if (sh.stats) { // objective timers, top-left corner
      const sp = o.spawn || { dragon: 300, baron: 1200 };
      const t = k => { const r = Math.round(sp[k] - m.clock); return r <= 0 ? `<b class="up">UP</b>` : `<b class="num">${fmt(r)}</b>`; };
      h += `<div class="l2-timers"><div class="tm drake">${ICON.drake}${t("dragon")}<small>DRAGON</small></div><div class="tm baron"><i>B</i>${t("baron")}<small>BARON</small></div></div>`;
    }
    if (sh.score) h += `<div class="l2-bar"><div class="l2-team l">${lg(L)}<span class="tg">${esc(L ? L.tag : "BLUE")}</span></div>${stat(0, false)}
      <div class="l2-mid"><b class="num">${m.series[0]}</b><small>${esc(l.gameSeries || "BO" + l.bestOf)}</small><b class="num">${m.series[1]}</b></div>
      ${stat(1, true)}<div class="l2-team r"><span class="tg">${esc(R ? R.tag : "RED")}</span>${lg(R)}</div></div>
      <div class="l2-sub">${objs(0, false)}<div class="l2-time">${ICON.drake}<b class="num">${fmt(m.clock)}</b></div>${objs(1, true)}</div>
      ${note ? `<div class="l2-note" style="--c:${m.colors[note.side] || "#FDC82F"}"><b>${esc(((note.main && note.main.name && m.sides[note.side]) ? m.sides[note.side].tag : "") )}</b> ${esc(note.label)}${note.main ? ` · ${esc(note.main.display || note.main.name)}` : ""}</div>` : ""}`;
    if (sh.boost) h += `<div class="l-side l">${m.players[0].map(row).join("")}</div><div class="l-side r">${m.players[1].map(row).join("")}</div>`;
    if (sh.card) h += `<div class="lp">${panel}</div>`;
    if (sh.feed && m.feed.length) h += `<div class="h-feed" style="top:${sh.boost ? 420 : 110}px">${m.feed.map(x => `<div><span style="color:${m.colors[x.side]}">${esc(x.main ? x.main.display || x.main.name : "")}</span><i>${esc(x.label)}</i>${x.second ? `<span style="color:${m.colors[1 - x.side]}">${esc(x.second.display || x.second.name)}</span>` : ""}</div>`).join("")}</div>`;
    return { html: h, cams: [] };
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
    <table class="h-table" style="width:820px"><thead><tr><th>#</th><th style="text-align:left">TEAM</th><th>W</th><th>L</th><th>GOAL DIFF</th></tr></thead><tbody>
    ${rows.map((r, i) => { const t = sideTeam(ev, r.team); return `<tr class="${i === 0 ? "top" : ""}"><td class="num">${i + 1}</td><td class="tm" style="text-align:left">${lg(t)}${esc(t ? t.name : "TBD")}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td></tr>`; }).join("")}</tbody></table></div>`, cams: [] };
  };
  S.timer = (m) => {
    const t = m.ev.timer, rem = t.endsAt ? Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) : t.remaining;
    return { html: `<div class="h-full"><div class="h-eyebrow">${esc(m.ev.live.seriesTitle || m.ev.name)}</div><div class="h-title" style="font-size:80px">${esc(t.label)}</div><div class="h-timer num">${fmt(rem)}</div></div>`, cams: [] };
  };

  /* pick the scene: "auto" follows the dashboard, and the in-game HUD
     switches itself to Replay during goal replays and Team Stats on the podium */
  function resolveScene(ev, m, scene) {
    let s = scene === "auto" || !scene ? ev.hud.scene : scene;
    if (s === "ingame" && m.kind === "lol") return "lolingame";
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

  function render(hudEl, ev, game, scene) {
    if (!hudEl.firstChild) hudEl.innerHTML = `<div class="lay"></div><div class="cams"></div>`;
    const m = model(ev, game);
    const s = resolveScene(ev, m, scene);
    const out = S[s](m);
    hudEl.style.setProperty("--L", m.colors[0]); hudEl.style.setProperty("--R", m.colors[1]);
    const lay = hudEl.firstChild;
    if (lay.dataset.scene !== s) { lay.dataset.scene = s; lay.className = "lay fade"; void lay.offsetWidth; } else lay.className = "lay";
    if (lay.__html !== out.html) { lay.innerHTML = out.html; lay.__html = out.html; }
    syncCams(hudEl.lastChild, out.cams);
    return m;
  }

  function drawBg(c, kind) {
    const W = 320, H = 180; c.width = W; c.height = H; const g = c.getContext("2d");
    if (kind === "none") { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); return; }
    if (kind === "checker") { for (let y = 0; y < H; y += 10) for (let x = 0; x < W; x += 10) { g.fillStyle = ((x + y) / 10) % 2 ? "#2b2c31" : "#202126"; g.fillRect(x, y, 10, 10); } return; }
    const sky = g.createLinearGradient(0, 0, 0, H * .45); sky.addColorStop(0, "#081226"); sky.addColorStop(1, "#1b3566"); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = "#0c1427"; g.fillRect(0, 44, W, 26);
    for (let i = 0; i < 260; i++) { g.fillStyle = `hsla(${i % 2 ? 215 : 28},70%,${40 + (i * 37 % 30)}%,.55)`; g.fillRect((i * 97) % W, 46 + (i * 13) % 22, 1, 1); }
    for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? "#23763a" : "#1f6a34"; const y0 = 70 + i * 11, y1 = y0 + 11, k0 = (y0 - 70) / 110, k1 = (y1 - 70) / 110;
      g.beginPath(); g.moveTo(80 - 80 * k0, y0); g.lineTo(240 + 80 * k0, y0); g.lineTo(240 + 80 * k1, y1); g.lineTo(80 - 80 * k1, y1); g.fill(); }
    g.strokeStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.moveTo(80, 70); g.lineTo(240, 70); g.moveTo(160, 70); g.lineTo(160, H); g.stroke();
    g.beginPath(); g.ellipse(160, 120, 40, 14, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "rgba(255,140,30,.65)"; g.fillRect(140, 58, 40, 12);
    g.fillStyle = "#cfd5e0"; g.beginPath(); g.arc(176, 106, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#1d5bff"; g.fillRect(120, 150, 26, 9); g.fillStyle = "#ff8a1a"; g.fillRect(205, 98, 14, 6);
  }

  window.SquishHUD = { SCENES, model, render, drawBg, esc, fmt };
})();
