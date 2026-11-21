/* AKM Tube – TV-tauglicher YouTube-Client auf Basis des offiziellen IFrame-Players.
 * Läuft im Browser, als installierbare PWA und in der Android-/Fire-TV-Hülle. */
'use strict';

/* ---------- Speicher ---------- */
const STORE_KEY = 'akmtube.v1';
const DEFAULT_STATE = {
  sections: [
    { id: 'andykay', name: 'Andy Kay', items: [] },
    { id: 'comradeeast', name: 'Comrade East', items: [] },
    { id: 'akunit', name: 'AK UNIT', items: [] },
    { id: 'phaseforge', name: 'PHASE//FORGE', items: [] },
    { id: 'mine', name: 'Meine Videos', items: [] },
  ],
  channels: [],      // {id, title, thumb, uploads}
  favorites: [],     // item
  history: [],       // {item, pos, dur, at}
  settings: { apiKey: '', autoplay: true, speed: 1, tvMode: 'auto', nocookie: true },
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const s = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...s, settings: { ...DEFAULT_STATE.settings, ...(s.settings || {}) } };
  } catch { return structuredClone(DEFAULT_STATE); }
}
let state = loadState();
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }

/* ---------- Helfer ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const thumbOf = (it) => it.thumb || (it.type === 'video' ? `https://i.ytimg.com/vi/${it.ytId}/hqdefault.jpg` : '');
const fmtTime = (s) => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2500); }
const uid = () => Math.random().toString(36).slice(2, 10);

/** Erkennt Video-, Playlist- und Kanal-Links bzw. reine IDs. */
function parseYouTube(input) {
  input = (input || '').trim();
  if (!input) return null;
  if (/^@[\w.-]+$/.test(input)) return { type: 'channel', handle: input };
  if (/^UC[\w-]{22}$/.test(input)) return { type: 'channel', channelId: input };
  if (/^(PL|UU|OL|RD|FL)[\w-]{10,}$/.test(input)) return { type: 'playlist', ytId: input };
  if (/^[\w-]{11}$/.test(input)) return { type: 'video', ytId: input };
  let u; try { u = new URL(input.startsWith('http') ? input : 'https://' + input); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
  const list = u.searchParams.get('list');
  if (host === 'youtu.be') { const v = u.pathname.slice(1, 12); return list ? { type: 'video', ytId: v, list } : { type: 'video', ytId: v }; }
  if (!/youtube(-nocookie)?\.com$/.test(host)) return null;
  const v = u.searchParams.get('v');
  if (v) return list ? { type: 'video', ytId: v, list } : { type: 'video', ytId: v };
  let m;
  if ((m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/))) return { type: 'video', ytId: m[2] };
  if (list) return { type: 'playlist', ytId: list };
  if ((m = u.pathname.match(/^\/channel\/(UC[\w-]{22})/))) return { type: 'channel', channelId: m[1] };
  if ((m = u.pathname.match(/^\/(@[\w.-]+)/))) return { type: 'channel', handle: m[1] };
  return null;
}

/* ---------- YouTube Data API (optional, eigener API-Key) ---------- */
async function yt(path, params) {
  const key = state.settings.apiKey;
  if (!key) throw new Error('Kein API-Key hinterlegt (Einstellungen).');
  const q = new URLSearchParams({ ...params, key });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${q}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'API-Fehler ' + r.status);
  return j;
}
const bestThumb = (t) => (t?.high || t?.medium || t?.default || {}).url || '';

async function fetchMeta(p) {
  // 1) Data API, 2) oEmbed, 3) Fallback ID
  if (state.settings.apiKey) {
    try {
      if (p.type === 'video') {
        const j = await yt('videos', { part: 'snippet', id: p.ytId });
        const s = j.items?.[0]?.snippet; if (s) return { title: s.title, channel: s.channelTitle, thumb: bestThumb(s.thumbnails) };
      } else if (p.type === 'playlist') {
        const j = await yt('playlists', { part: 'snippet', id: p.ytId });
        const s = j.items?.[0]?.snippet; if (s) return { title: s.title, channel: s.channelTitle, thumb: bestThumb(s.thumbnails) };
      }
    } catch {}
  }
  const url = p.type === 'video' ? `https://www.youtube.com/watch?v=${p.ytId}` : `https://www.youtube.com/playlist?list=${p.ytId}`;
  for (const ep of [`https://www.youtube.com/oembed?format=json&url=`, `https://noembed.com/embed?url=`]) {
    try {
      const r = await fetch(ep + encodeURIComponent(url));
      if (r.ok) { const j = await r.json(); if (j.title) return { title: j.title, channel: j.author_name || '', thumb: j.thumbnail_url || '' }; }
    } catch {}
  }
  return { title: p.type === 'video' ? `Video ${p.ytId}` : `Playlist ${p.ytId}`, channel: '' };
}

async function resolveChannel(p) {
  const params = { part: 'snippet,contentDetails' };
  if (p.channelId) params.id = p.channelId; else params.forHandle = p.handle;
  const j = await yt('channels', params);
  const c = j.items?.[0];
  if (!c) throw new Error('Kanal nicht gefunden.');
  return { id: c.id, title: c.snippet.title, thumb: bestThumb(c.snippet.thumbnails), uploads: c.contentDetails.relatedPlaylists.uploads };
}

async function playlistVideos(listId, max = 25) {
  const j = await yt('playlistItems', { part: 'snippet', playlistId: listId, maxResults: max });
  return (j.items || []).filter((i) => i.snippet?.resourceId?.videoId).map((i) => ({
    id: uid(), type: 'video', ytId: i.snippet.resourceId.videoId, title: i.snippet.title,
    channel: i.snippet.videoOwnerChannelTitle || i.snippet.channelTitle, thumb: bestThumb(i.snippet.thumbnails),
    publishedAt: i.snippet.publishedAt,
  }));
}

/* ---------- Rendering ---------- */
let currentView = 'home';
const cardRegistry = new Map(); // DOM-id -> {item, queue}

function card(item, queue, extra = {}) {
  const domId = 'c' + uid();
  cardRegistry.set(domId, { item, queue, ...extra });
  const h = state.history.find((x) => x.item.ytId === item.ytId);
  const pct = h && h.dur ? Math.min(100, (h.pos / h.dur) * 100) : 0;
  return `<button class="card focusable" id="${domId}" data-card>
    <div class="thumb" style="background-image:url('${esc(thumbOf(item))}')">
      ${item.type === 'playlist' ? '<span class="badge">Playlist</span>' : ''}
      ${pct > 2 ? `<span class="progress" style="width:${pct}%"></span>` : ''}
    </div>
    <div class="meta"><div class="title">${esc(item.title)}</div><div class="sub">${esc(item.channel || '')}</div></div>
  </button>`;
}
const row = (title, items, emptyText) => `<h2>${esc(title)}</h2><div class="row">${
  items.length ? items.map((i) => card(i, items)).join('') : `<button class="card empty focusable" data-goto="add">${esc(emptyText || 'Noch leer – Video hinzufügen')}</button>`}</div>`;

const views = {
  home() {
    const cont = state.history.filter((h) => h.dur && h.pos / h.dur < 0.95 && h.pos > 5).map((h) => h.item);
    let html = `<h1>Start</h1>`;
    if (!state.sections.some((s) => s.items.length) && !state.channels.length)
      html += `<p class="hint">Willkommen bei AKM Tube. Füge unter <b>Hinzufügen</b> Videos oder Playlists per Link hinzu – z. B. deine Releases. Mit einem eigenen YouTube-API-Key (Einstellungen) bekommst du zusätzlich Suche und Kanal-Feeds.</p>`;
    if (cont.length) html += row('Weiterschauen', cont);
    for (const s of state.sections) html += row(s.name, s.items, `${s.name}: Video oder Playlist hinzufügen`);
    if (state.favorites.length) html += row('Favoriten', state.favorites);
    return html;
  },
  search() {
    const hasKey = !!state.settings.apiKey;
    return `<h1>Suche</h1>
      ${hasKey ? '' : '<p class="hint">Für die Suche brauchst du einen kostenlosen YouTube-Data-API-Key (Einstellungen). Ohne Key durchsuchst du nur deine Bibliothek.</p>'}
      <form class="search-bar" id="search-form"><input type="search" id="q" class="focusable" placeholder="Suchbegriff…" value="${esc(views._lastQ || '')}" autocomplete="off">
      <button class="btn focusable">Suchen</button></form><div id="results"></div>`;
  },
  subs() {
    if (!state.settings.apiKey) return `<h1>Kanäle</h1><p class="hint">Kanal-Feeds benötigen einen YouTube-API-Key (Einstellungen).</p>`;
    let html = `<h1>Kanäle</h1>`;
    if (!state.channels.length) html += `<p class="hint">Noch keine Kanäle. Unter <b>Hinzufügen</b> einen Kanal-Link oder @Handle eingeben.</p>`;
    html += `<div id="channel-feeds">${state.channels.map((c) => `<h2>${esc(c.title)}</h2><div class="row" data-feed="${esc(c.uploads)}"><div class="hint">Lade…</div></div>`).join('')}</div>`;
    return html;
  },
  library() {
    let html = `<h1>Bibliothek</h1>`;
    for (const s of state.sections) {
      html += `<h2>${esc(s.name)} <span class="hint">(${s.items.length})</span></h2>`;
      html += s.items.length ? `<div class="list">${s.items.map((it) => `
        <div class="list-item"><div class="grow"><div class="title">${esc(it.title)}</div><div class="sub">${it.type === 'playlist' ? 'Playlist · ' : ''}${esc(it.channel || '')}</div></div>
        <button class="btn secondary focusable" data-play-sec="${s.id}" data-item="${it.id}">▶</button>
        <button class="btn secondary focusable" data-move="${s.id}" data-item="${it.id}" data-dir="-1">↑</button>
        <button class="btn secondary focusable" data-move="${s.id}" data-item="${it.id}" data-dir="1">↓</button>
        <button class="btn danger focusable" data-del="${s.id}" data-item="${it.id}">✕</button></div>`).join('')}</div>` : '<p class="hint">Leer.</p>';
    }
    if (state.channels.length) {
      html += `<h2>Kanäle</h2><div class="list">${state.channels.map((c) => `<div class="list-item"><img src="${esc(c.thumb)}" alt=""><div class="grow"><div class="title">${esc(c.title)}</div></div>
        <button class="btn danger focusable" data-delch="${c.id}">✕</button></div>`).join('')}</div>`;
    }
    html += `<h2>Bereiche</h2><form class="search-bar" id="section-form"><input type="text" id="secname" class="focusable" placeholder="Neuer Bereich, z. B. DJ-Sets"><button class="btn focusable">Anlegen</button></form>`;
    return html;
  },
  add() {
    return `<h1>Hinzufügen</h1>
      <form class="form" id="add-form">
        <div class="field"><label for="url">YouTube-Link, Video-ID, Playlist-Link oder Kanal (@Handle)</label>
          <input type="text" id="url" class="focusable" placeholder="https://youtu.be/… oder @kanalname" autocomplete="off"></div>
        <div class="field"><label for="sec">Bereich</label>
          <select id="sec" class="focusable">${state.sections.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ttl">Eigener Titel (optional)</label><input type="text" id="ttl" class="focusable" autocomplete="off"></div>
        <div class="btn-row"><button class="btn focusable">Hinzufügen</button></div>
        <p class="hint">Tipp für TV: Bibliothek am Handy pflegen, unter Einstellungen exportieren und am TV wieder importieren.</p>
      </form>`;
  },
  settings() {
    const s = state.settings;
    return `<h1>Einstellungen</h1>
      <form class="form" id="settings-form">
        <div class="field"><label for="apikey">YouTube Data API v3 Key (optional – für Suche & Kanäle)</label>
          <input type="password" id="apikey" class="focusable" value="${esc(s.apiKey)}" autocomplete="off"></div>
        <label class="check"><input type="checkbox" id="autoplay" class="focusable" ${s.autoplay ? 'checked' : ''}> Nächstes Video automatisch abspielen</label>
        <label class="check"><input type="checkbox" id="nocookie" class="focusable" ${s.nocookie ? 'checked' : ''}> Datenschutz-Modus (youtube-nocookie.com)</label>
        <div class="field"><label for="tvmode">TV-Modus</label>
          <select id="tvmode" class="focusable">
            <option value="auto" ${s.tvMode === 'auto' ? 'selected' : ''}>Automatisch erkennen</option>
            <option value="on" ${s.tvMode === 'on' ? 'selected' : ''}>Immer an</option>
            <option value="off" ${s.tvMode === 'off' ? 'selected' : ''}>Aus</option></select></div>
        <div class="btn-row"><button class="btn focusable">Speichern</button></div>
      </form>
      <h2>Backup & Übertragen</h2>
      <p class="hint">Exportiere deine Bibliothek als Text/Datei und importiere sie auf einem anderen Gerät.</p>
      <div class="form">
        <textarea id="backup" class="focusable" placeholder="Hier JSON einfügen und „Importieren“ drücken"></textarea>
        <div class="btn-row">
          <button class="btn secondary focusable" id="exp">Exportieren</button>
          <button class="btn secondary focusable" id="dl">Als Datei speichern</button>
          <button class="btn secondary focusable" id="imp">Importieren</button>
          <label class="btn secondary focusable" tabindex="0">Datei laden<input type="file" id="impfile" accept="application/json" hidden></label>
          <button class="btn danger focusable" id="clearhist">Verlauf löschen</button>
        </div>
      </div>
      <p class="hint" style="margin-top:30px">AKM Tube nutzt den offiziellen YouTube-Player. Werbung wird von YouTube gesteuert und nicht entfernt.</p>`;
  },
};

function render(view = currentView, focusFirst = false) {
  currentView = view;
  cardRegistry.clear();
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  const main = $('#main');
  main.innerHTML = views[view]();
  main.scrollTop = 0;
  afterRender[view]?.();
  if (focusFirst) { const f = main.querySelector('.focusable'); f?.focus(); }
}

const afterRender = {
  search() {
    $('#search-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#q').value.trim(); views._lastQ = q;
      const out = $('#results');
      if (!q) return;
      const local = state.sections.flatMap((s) => s.items).filter((i) => (i.title + ' ' + i.channel).toLowerCase().includes(q.toLowerCase()));
      let html = local.length ? `<h2>In deiner Bibliothek</h2><div class="grid">${local.map((i) => card(i, local)).join('')}</div>` : '';
      out.innerHTML = html + (state.settings.apiKey ? '<p class="hint">Suche auf YouTube…</p>' : '');
      if (!state.settings.apiKey) { if (!local.length) out.innerHTML = '<p class="hint">Keine Treffer.</p>'; return; }
      try {
        const j = await yt('search', { part: 'snippet', q, type: 'video,playlist', maxResults: 24, safeSearch: 'none' });
        const items = j.items.map((r) => ({
          id: uid(), type: r.id.kind === 'youtube#playlist' ? 'playlist' : 'video',
          ytId: r.id.videoId || r.id.playlistId, title: decodeEntities(r.snippet.title),
          channel: r.snippet.channelTitle, thumb: bestThumb(r.snippet.thumbnails),
        })).filter((i) => i.ytId);
        cardRegistry.forEach((v, k) => { if (!document.getElementById(k)) cardRegistry.delete(k); });
        out.innerHTML = html + `<h2>YouTube</h2><div class="grid">${items.map((i) => card(i, items.filter((x) => x.type === 'video'), { addable: true })).join('')}</div>`;
      } catch (err) { out.innerHTML = html + `<p class="hint">Fehler: ${esc(err.message)}</p>`; }
    });
    if (views._lastQ) $('#search-form').requestSubmit();
  },
  subs() {
    document.querySelectorAll('[data-feed]').forEach(async (el) => {
      try {
        const vids = await playlistVideos(el.dataset.feed, 20);
        el.innerHTML = vids.map((v) => card(v, vids, { addable: true })).join('') || '<div class="hint">Keine Videos.</div>';
      } catch (err) { el.innerHTML = `<div class="hint">Fehler: ${esc(err.message)}</div>`; }
    });
  },
  library() {
    $('#section-form').addEventListener('submit', (e) => {
      e.preventDefault(); const n = $('#secname').value.trim(); if (!n) return;
      state.sections.push({ id: uid(), name: n, items: [] }); save(); render('library'); toast('Bereich angelegt');
    });
  },
  add() {
    $('#add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p = parseYouTube($('#url').value);
      if (!p) return toast('Link nicht erkannt');
      if (p.type === 'channel') {
        try {
          const c = await resolveChannel(p);
          if (state.channels.some((x) => x.id === c.id)) return toast('Kanal bereits vorhanden');
          state.channels.push(c); save(); toast(`Kanal „${c.title}“ hinzugefügt`); $('#url').value = '';
        } catch (err) { toast(err.message); }
        return;
      }
      if (p.list && p.type === 'video' && confirm('Link enthält eine Playlist. Ganze Playlist hinzufügen?')) { p.type = 'playlist'; p.ytId = p.list; }
      toast('Lade Infos…');
      const meta = await fetchMeta(p);
      const custom = $('#ttl').value.trim();
      const item = { id: uid(), type: p.type, ytId: p.ytId, title: custom || meta.title, channel: meta.channel, thumb: meta.thumb || '' };
      const sec = state.sections.find((s) => s.id === $('#sec').value);
      sec.items.unshift(item); save();
      $('#url').value = ''; $('#ttl').value = '';
      toast(`„${item.title}“ → ${sec.name}`);
    });
  },
  settings() {
    $('#settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      Object.assign(state.settings, { apiKey: $('#apikey').value.trim(), autoplay: $('#autoplay').checked, nocookie: $('#nocookie').checked, tvMode: $('#tvmode').value });
      save(); applyTvMode(); toast('Gespeichert');
    });
    const exportJson = () => JSON.stringify({ app: 'akmtube', v: 1, sections: state.sections, channels: state.channels, favorites: state.favorites }, null, 1);
    $('#exp').onclick = () => { $('#backup').value = exportJson(); $('#backup').select(); navigator.clipboard?.writeText($('#backup').value).then(() => toast('In Zwischenablage kopiert'), () => {}); };
    $('#dl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' })); a.download = 'akmtube-backup.json'; a.click(); };
    const doImport = (txt) => {
      try {
        const j = JSON.parse(txt); if (j.app !== 'akmtube') throw 0;
        state.sections = j.sections || state.sections; state.channels = j.channels || []; state.favorites = j.favorites || [];
        save(); toast('Import erfolgreich'); render('home');
      } catch { toast('Ungültige Backup-Daten'); }
    };
    $('#imp').onclick = () => doImport($('#backup').value);
    $('#impfile').onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then(doImport); };
    $('#clearhist').onclick = () => { state.history = []; save(); toast('Verlauf gelöscht'); };
  },
};

function decodeEntities(s) { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; }

/* ---------- Klick-Handling ---------- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('.nav-item'); if (nav) return render(nav.dataset.view);
  const go = e.target.closest('[data-goto]'); if (go) return render(go.dataset.goto, true);
  const c = e.target.closest('[data-card]');
  if (c) { const r = cardRegistry.get(c.id); if (r) openItem(r.item, r.queue); return; }
  const pb = e.target.closest('[data-play-sec]');
  if (pb) { const s = state.sections.find((x) => x.id === pb.dataset.playSec); const it = s.items.find((x) => x.id === pb.dataset.item); return openItem(it, s.items); }
  const del = e.target.closest('[data-del]');
  if (del) { const s = state.sections.find((x) => x.id === del.dataset.del); s.items = s.items.filter((x) => x.id !== del.dataset.item); save(); return render('library'); }
  const mv = e.target.closest('[data-move]');
  if (mv) { const s = state.sections.find((x) => x.id === mv.dataset.move); const i = s.items.findIndex((x) => x.id === mv.dataset.item); const j = i + Number(mv.dataset.dir);
    if (j >= 0 && j < s.items.length) { [s.items[i], s.items[j]] = [s.items[j], s.items[i]]; save(); render('library'); document.querySelector(`[data-move="${s.id}"][data-item="${mv.dataset.item}"][data-dir="${mv.dataset.dir}"]`)?.focus(); } return; }
  const dc = e.target.closest('[data-delch]');
  if (dc) { state.channels = state.channels.filter((x) => x.id !== dc.dataset.delch); save(); return render('library'); }
});

// Langes Drücken / Kontextmenü auf Karte: zu Favoriten oder Bereich hinzufügen
document.addEventListener('contextmenu', (e) => {
  const c = e.target.closest('[data-card]'); if (!c) return;
  e.preventDefault(); toggleFav(cardRegistry.get(c.id)?.item);
});
function toggleFav(item) {
  if (!item) return;
  const i = state.favorites.findIndex((f) => f.ytId === item.ytId);
  if (i >= 0) { state.favorites.splice(i, 1); toast('Aus Favoriten entfernt'); }
  else { state.favorites.unshift({ ...item, id: uid() }); toast('Zu Favoriten hinzugefügt'); }
  save(); updateFavBtn();
}

/* ---------- Player ---------- */
let ytReady = null, player = null, queue = [], qIndex = 0, current = null, progressTimer = null, barTimer = null;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function loadYtApi() {
  if (ytReady) return ytReady;
  ytReady = new Promise((res) => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  });
  return ytReady;
}

async function openItem(item, list) {
  if (!item) return;
  queue = (list || [item]).filter((i) => i.type === 'video');
  if (item.type === 'playlist') queue = [];
  qIndex = Math.max(0, queue.findIndex((i) => i.ytId === item.ytId));
  current = item;
  $('#player-layer').hidden = false;
  $('#player-title').textContent = item.title;
  updateFavBtn(); showBar();
  await loadYtApi();
  const resume = item.type === 'video' ? (state.history.find((h) => h.item.ytId === item.ytId) || {}) : {};
  const start = resume.dur && resume.pos / resume.dur < 0.95 ? Math.floor(resume.pos) : 0;
  const vars = { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, controls: document.body.classList.contains('tv') ? 0 : 1, origin: location.origin };
  if (item.type === 'playlist') Object.assign(vars, { listType: 'playlist', list: item.ytId });
  else if (start) vars.start = start;

  if (player) {
    if (item.type === 'playlist') player.loadPlaylist({ listType: 'playlist', list: item.ytId });
    else player.loadVideoById({ videoId: item.ytId, startSeconds: start });
  } else {
    player = new YT.Player('yt-player', {
      host: state.settings.nocookie ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com',
      videoId: item.type === 'video' ? item.ytId : undefined,
      playerVars: vars,
      events: {
        onReady: (e) => { e.target.setPlaybackRate(state.settings.speed || 1); e.target.playVideo(); },
        onStateChange: onPlayerState,
        onError: (e) => { toast('Video nicht abspielbar (Fehler ' + e.data + ')'); if (state.settings.autoplay) setTimeout(next, 1500); },
      },
    });
  }
  clearInterval(progressTimer);
  progressTimer = setInterval(recordProgress, 5000);
  setTimeout(() => $('#player-bar [data-act="toggle"]').focus(), 50);
}

function onPlayerState(e) {
  if (e.data === YT.PlayerState.PLAYING) {
    const d = player.getVideoData?.();
    if (d?.video_id && current?.type === 'playlist') $('#player-title').textContent = d.title || current.title;
    else if (d?.title && current) $('#player-title').textContent = d.title;
    hideBarSoon();
  }
  if (e.data === YT.PlayerState.PAUSED) showBar(true);
  if (e.data === YT.PlayerState.ENDED) { recordProgress(); if (state.settings.autoplay && current?.type === 'video') next(); }
}

function recordProgress() {
  if (!player?.getCurrentTime || !current) return;
  const d = player.getVideoData?.() || {};
  const ytId = d.video_id || current.ytId;
  const item = current.type === 'playlist' ? { id: uid(), type: 'video', ytId, title: d.title || current.title, channel: d.author || current.channel } : current;
  const pos = player.getCurrentTime(), dur = player.getDuration();
  if (!dur) return;
  state.history = [{ item, pos, dur, at: Date.now() }, ...state.history.filter((h) => h.item.ytId !== ytId)].slice(0, 100);
  save();
}

function next() { if (current?.type === 'playlist') return player?.nextVideo(); if (qIndex < queue.length - 1) { qIndex++; openItem(queue[qIndex], queue); } else toast('Ende der Liste'); }
function prev() { if (current?.type === 'playlist') return player?.previousVideo(); if (player?.getCurrentTime() > 5) return player.seekTo(0, true); if (qIndex > 0) { qIndex--; openItem(queue[qIndex], queue); } }
function seek(d) { if (player?.getCurrentTime) { player.seekTo(Math.max(0, player.getCurrentTime() + d), true); toast(fmtTime(player.getCurrentTime() + d) + ' / ' + fmtTime(player.getDuration())); } }
function togglePlay() { if (!player?.getPlayerState) return; player.getPlayerState() === YT.PlayerState.PLAYING ? player.pauseVideo() : player.playVideo(); }
function cycleSpeed() { const i = (SPEEDS.indexOf(state.settings.speed) + 1) % SPEEDS.length; state.settings.speed = SPEEDS[i]; save(); player?.setPlaybackRate(SPEEDS[i]); $('[data-act="speed"]').textContent = SPEEDS[i] + '×'; toast('Geschwindigkeit ' + SPEEDS[i] + '×'); }
function updateFavBtn() { const b = $('[data-act="fav"]'); if (b && current) b.textContent = state.favorites.some((f) => f.ytId === current.ytId) ? '★' : '☆'; }
function closePlayer() {
  recordProgress(); clearInterval(progressTimer);
  player?.stopVideo?.(); $('#player-layer').hidden = true; current = null;
  render(currentView); $('#main .focusable')?.focus();
}
function showBar(stay) { const b = $('#player-bar'); b.classList.remove('hide'); clearTimeout(barTimer); if (!stay) hideBarSoon(); }
function hideBarSoon() { clearTimeout(barTimer); barTimer = setTimeout(() => { if (document.body.classList.contains('tv') && player?.getPlayerState?.() === YT.PlayerState.PLAYING) $('#player-bar').classList.add('hide'); }, 4000); }

$('#player-bar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  ({ prev, next, toggle: togglePlay, back10: () => seek(-10), fwd10: () => seek(10), speed: cycleSpeed, fav: () => toggleFav(current), close: closePlayer })[b.dataset.act]?.();
  showBar();
});
$('[data-act="speed"]').textContent = (state.settings.speed || 1) + '×';

/* ---------- Fernbedienung / Tastatur (Spatial Navigation) ---------- */
function focusables(root = document) {
  const layer = $('#player-layer');
  const scope = layer.hidden ? root : layer;
  return [...scope.querySelectorAll('.focusable')].filter((el) => el.offsetParent !== null && !el.disabled && !(layer.hidden && layer.contains(el)));
}
function moveFocus(dir) {
  const cur = document.activeElement;
  const els = focusables();
  if (!cur || !els.includes(cur)) { els[0]?.focus(); return true; }
  const a = cur.getBoundingClientRect(); const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of els) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect(); const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    let main, cross;
    if (dir === 'left') { if (b.right > a.left + 1) continue; main = -dx; cross = Math.abs(dy); }
    if (dir === 'right') { if (b.left < a.right - 1) continue; main = dx; cross = Math.abs(dy); }
    if (dir === 'up') { if (b.bottom > a.top + 1) continue; main = -dy; cross = Math.abs(dx); }
    if (dir === 'down') { if (b.top < a.bottom - 1) continue; main = dy; cross = Math.abs(dx); }
    const score = main + cross * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); return true; }
  return false;
}

/** Zurück-Taste (Browser: Esc/Backspace, Android: Hardware-Back via akmBack()). Gibt true zurück, wenn behandelt. */
window.akmBack = function () {
  if (!$('#player-layer').hidden) { closePlayer(); return true; }
  if (currentView !== 'home') { render('home'); $('.nav-item[data-view="home"]').focus(); return true; }
  if (!$('#sidebar').contains(document.activeElement)) { $('.nav-item.active')?.focus(); return true; }
  return false;
};

const KEY = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 21: 'left', 19: 'up', 22: 'right', 20: 'down' };
document.addEventListener('keydown', (e) => {
  document.body.classList.add('kbd');
  const tag = document.activeElement?.tagName;
  const typing = (tag === 'INPUT' && !['checkbox', 'file'].includes(document.activeElement.type)) || tag === 'TEXTAREA';
  const inPlayer = !$('#player-layer').hidden;

  // Medientasten der Fernbedienung
  if (inPlayer) {
    const media = { MediaPlayPause: togglePlay, MediaPlay: () => player?.playVideo(), MediaPause: () => player?.pauseVideo(),
      MediaTrackNext: next, MediaTrackPrevious: prev, MediaFastForward: () => seek(30), MediaRewind: () => seek(-30) }[e.key];
    if (media) { e.preventDefault(); media(); showBar(); return; }
    // Leiste versteckt: Pfeile spulen, OK = Pause
    if ($('#player-bar').classList.contains('hide')) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(-10); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(10); return; }
      if (e.key === 'Enter' || e.keyCode === 23) { e.preventDefault(); togglePlay(); showBar(); return; }
      if (KEY[e.keyCode]) { e.preventDefault(); showBar(); return; }
    }
    showBar();
  }

  if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || (e.key === 'Backspace' && !typing)) {
    if (window.akmBack()) e.preventDefault(); return;
  }
  const dir = KEY[e.keyCode];
  if (dir) {
    if (typing && (dir === 'left' || dir === 'right')) {
      const el = document.activeElement; const atStart = el.selectionStart === 0, atEnd = el.selectionEnd === el.value.length;
      if (!(dir === 'left' && atStart) && !(dir === 'right' && atEnd)) return;
    }
    if (tag === 'SELECT' && (dir === 'up' || dir === 'down') && !document.body.classList.contains('tv')) return;
    e.preventDefault(); moveFocus(dir);
  }
  if (e.keyCode === 23 && document.activeElement?.click) { e.preventDefault(); document.activeElement.click(); }
});
document.addEventListener('mousedown', () => document.body.classList.remove('kbd'));

/* ---------- TV-Erkennung ---------- */
function applyTvMode() {
  const ua = navigator.userAgent;
  const auto = /AKMTube-TV|Android TV|AFT[A-Z]|BRAVIA|SmartTV|Tizen|Web0S|GoogleTV|CrKey/i.test(ua);
  const m = state.settings.tvMode;
  document.body.classList.toggle('tv', m === 'on' || (m === 'auto' && auto));
}

/* ---------- Start ---------- */
applyTvMode();
render('home');
if (document.body.classList.contains('tv')) $('.nav-item[data-view="home"]').focus();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
// Teilen-Ziel (PWA share_target): ?url=… direkt in "Hinzufügen" übernehmen
const shared = new URLSearchParams(location.search).get('url') || new URLSearchParams(location.search).get('text');
if (shared) { render('add'); $('#url').value = shared; history.replaceState(null, '', location.pathname); }
