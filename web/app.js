/* AKM Tube – TV-tauglicher Player für YouTube (offizieller IFrame-Player) und eigene Audio-/Videodateien.
 * Läuft im Browser, als installierbare PWA und in der Android-/Fire-TV-Hülle. */
'use strict';

const CFG = window.AKM_CONFIG || {};

/* =========================================================================
 * Speicher
 * ========================================================================= */
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
  history: [],       // {key, item, pos, dur, at}
  settings: { apiKey: '', autoplay: true, speed: 1, tvMode: 'auto', nocookie: true, syncUrl: '', syncCode: '' },
  meta: { updatedAt: 0, catalogSeen: [], lastSync: 0 },
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const s = JSON.parse(raw);
    const st = { ...structuredClone(DEFAULT_STATE), ...s,
      settings: { ...DEFAULT_STATE.settings, ...(s.settings || {}) },
      meta: { ...DEFAULT_STATE.meta, ...(s.meta || {}) } };
    st.history = (st.history || []).filter((h) => h.item).map((h) => ({ ...h, key: h.key || keyOf(h.item) }));
    return st;
  } catch { return structuredClone(DEFAULT_STATE); }
}
let state;
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }
/** Bibliothek geändert → speichern und (falls aktiv) synchronisieren. */
function changed() { state.meta.updatedAt = Date.now(); save(); Sync.schedulePush(); }

/* =========================================================================
 * Helfer
 * ========================================================================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const isFile = (it) => it && (it.type === 'media' || it.type === 'local');
const keyOf = (it) => it.type === 'local' ? 'local:' + it.fileId : it.type === 'media' ? 'media:' + it.src : (it.type === 'playlist' ? 'pl:' : 'yt:') + it.ytId;
const AUDIO_EXT = /\.(mp3|wav|wave|flac|m4a|aac|ogg|oga|opus|aif|aiff)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv|ogv)(\?|#|$)/i;
const isAudio = (it) => it.type === 'local' ? /^audio\//.test(it.mime || '') : AUDIO_EXT.test(it.src || '');
function thumbOf(it) {
  if (it.thumb) return it.thumb;
  if (it.type === 'video') return `https://i.ytimg.com/vi/${it.ytId}/hqdefault.jpg`;
  return '';
}
const fmtTime = (s) => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800); }
function decodeEntities(s) { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; }
function fileTitle(name) { return decodeURIComponent(name.split('/').pop().split('?')[0]).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' '); }

/** Erkennt YouTube-Videos, Playlists, Kanäle sowie direkte Datei-Links. */
function parseInput(input) {
  input = (input || '').trim();
  if (!input) return null;
  if (/^@[\w.-]+$/.test(input)) return { type: 'channel', handle: input };
  if (/^UC[\w-]{22}$/.test(input)) return { type: 'channel', channelId: input };
  if (/^(PL|UU|OL|RD|FL)[\w-]{10,}$/.test(input)) return { type: 'playlist', ytId: input };
  if (/^[\w-]{11}$/.test(input)) return { type: 'video', ytId: input };
  let u; try { u = new URL(input.startsWith('http') ? input : 'https://' + input); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');

  // Direkte Mediendateien (eigener Webspace, Dropbox, Cloud-Speicher …)
  if (host.endsWith('dropbox.com') && (AUDIO_EXT.test(u.pathname) || VIDEO_EXT.test(u.pathname))) {
    u.searchParams.delete('dl'); u.searchParams.set('raw', '1');
    return { type: 'media', src: u.toString() };
  }
  if (AUDIO_EXT.test(u.pathname) || VIDEO_EXT.test(u.pathname)) return { type: 'media', src: u.toString() };

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
const parseYouTube = parseInput; // Alias (Abwärtskompatibilität)

/* =========================================================================
 * Lokale Dateien (IndexedDB – bleiben auf dem jeweiligen Gerät)
 * ========================================================================= */
const FileStore = {
  _db: null,
  open() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      const r = indexedDB.open('akmtube-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('files', mode); const q = fn(t.objectStore('files')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); },
  put(id, blob) { return this.tx('readwrite', (s) => s.put(blob, id)); },
  get(id) { return this.tx('readonly', (s) => s.get(id)); },
  del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
};

async function addLocalFiles(files, sectionId) {
  const sec = state.sections.find((s) => s.id === sectionId) || state.sections[0];
  let n = 0;
  for (const f of files) {
    if (!/^(audio|video)\//.test(f.type) && !AUDIO_EXT.test(f.name) && !VIDEO_EXT.test(f.name)) continue;
    const fileId = uid() + uid();
    try { await FileStore.put(fileId, f); } catch { toast('Speicher voll – Datei zu groß?'); continue; }
    sec.items.unshift({ id: uid(), type: 'local', fileId, mime: f.type || (AUDIO_EXT.test(f.name) ? 'audio/*' : 'video/*'), title: fileTitle(f.name), channel: 'Lokale Datei · ' + (f.size / 1048576).toFixed(1) + ' MB' });
    n++;
  }
  if (n) { changed(); toast(`${n} Datei(en) → ${sec.name}`); } else toast('Keine Audio-/Videodatei gefunden');
}

/* =========================================================================
 * YouTube Data API (optional, eigener API-Key)
 * ========================================================================= */
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
  if (p.type === 'media') return { title: fileTitle(new URL(p.src).pathname), channel: isAudio(p) ? 'Audio' : 'Video' };
  if (state.settings.apiKey) {
    try {
      const j = await yt(p.type === 'video' ? 'videos' : 'playlists', { part: 'snippet', id: p.ytId });
      const s = j.items?.[0]?.snippet; if (s) return { title: s.title, channel: s.channelTitle, thumb: bestThumb(s.thumbnails) };
    } catch {}
  }
  const url = p.type === 'video' ? `https://www.youtube.com/watch?v=${p.ytId}` : `https://www.youtube.com/playlist?list=${p.ytId}`;
  for (const ep of ['https://www.youtube.com/oembed?format=json&url=', 'https://noembed.com/embed?url=']) {
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
  }));
}

/** Uploads eines Kanals (10 Min. zwischengespeichert, damit mehrere Zeilen nur einen API-Aufruf brauchen). */
const uploadCache = new Map();
function cachedUploads(listId) {
  const c = uploadCache.get(listId);
  if (c && Date.now() - c.at < 600000) return c.p;
  const p = playlistVideos(listId, 50);
  uploadCache.set(listId, { at: Date.now(), p });
  p.catch(() => uploadCache.delete(listId));
  return p;
}
/** Ordnet ein Upload anhand des Titels einem Projekt-Bereich zu (Kanal-Regel "sort"). */
const normTitle = (t) => (t || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
function sectionForUpload(ch, v) {
  const t = normTitle(v.title);
  for (const [sec, words] of Object.entries(ch.sort || {})) if (words.some((w) => t.includes(normTitle(w)))) return sec;
  return ch.section;
}

/* =========================================================================
 * AKM-Katalog (catalog.json) – feste Releases für alle Geräte
 * ========================================================================= */
async function loadCatalog() {
  let cat;
  try { const r = await fetch('catalog.json', { cache: 'no-cache' }); if (!r.ok) return; cat = await r.json(); } catch { return; }
  const seen = new Set(state.meta.catalogSeen);
  let added = 0;
  for (const cs of cat.sections || []) {
    let sec = state.sections.find((s) => s.id === cs.id);
    if (!sec) { sec = { id: cs.id || uid(), name: cs.name || 'Katalog', items: [] }; state.sections.splice(Math.max(0, state.sections.length - 1), 0, sec); }
    const pending = [];
    for (const ci of cs.items || []) {
      const p = parseInput(ci.url || ci);
      if (!p || p.type === 'channel') continue;
      const item = { id: uid(), ...p, title: ci.title || '', channel: ci.subtitle || sec.name, thumb: ci.thumb || '', catalog: true };
      delete item.list;
      const k = keyOf(item);
      if (seen.has(k)) continue;           // bereits übernommen (oder bewusst gelöscht)
      seen.add(k);
      if (sec.items.some((x) => keyOf(x) === k)) continue;
      pending.push(item);
    }
    sec.items.push(...pending); added += pending.length;
    pending.filter((i) => !i.title).forEach(async (i) => { Object.assign(i, await fetchMeta(i), { channel: i.channel }); save(); if (currentView === 'home' && $('#player-layer').hidden) render('home'); });
  }
  if (state.settings.apiKey) {
    for (const ch of cat.channels || []) {
      const p = parseInput(ch.url || ch.handle || ch);
      if (!p || p.type !== 'channel') continue;
      const k = 'ch:' + (p.channelId || p.handle); if (seen.has(k)) continue;
      try {
        const c = await resolveChannel(p); seen.add(k);
        if (ch.section) c.section = ch.section;
        if (ch.sort) c.sort = ch.sort;
        const ex = state.channels.find((x) => x.id === c.id);
        if (ex) { if (ch.section && !ex.section) ex.section = ch.section; if (ch.sort) ex.sort = ch.sort; added++; } else { state.channels.push(c); added++; }
      } catch {}
    }
  }
  state.meta.catalogSeen = [...seen];
  if (added) { changed(); if ($('#player-layer').hidden) render(currentView); }
  else save();
}

/* =========================================================================
 * Sync zwischen Geräten (eigener kleiner Server, siehe /server)
 * ========================================================================= */
const Sync = {
  ALPHA: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  status: '', ok: true, _t: null, _busy: false,
  url() { return (state.settings.syncUrl || CFG.syncUrl || '').replace(/\/+$/, ''); },
  active() { return !!(this.url() && state.settings.syncCode); },
  newCode() { const a = new Uint32Array(12); crypto.getRandomValues(a); return [...a].map((x) => this.ALPHA[x % this.ALPHA.length]).join(''); },
  norm(c) { return (c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); },
  pretty(c) { return (c || '').match(/.{1,4}/g)?.join('-') || ''; },
  endpoint() { return `${this.url()}/v1/${state.settings.syncCode}`; },
  setStatus(msg, ok = true) { this.status = msg; this.ok = ok; const el = $('#sync-status'); if (el) { el.textContent = msg; el.className = 'status ' + (ok ? 'ok' : 'err'); } },

  payload() {
    const noLocal = (arr) => arr.filter((i) => i.type !== 'local');
    return {
      app: 'akmtube', v: 2, updatedAt: state.meta.updatedAt,
      sections: state.sections.map((s) => ({ ...s, items: noLocal(s.items) })),
      channels: state.channels, favorites: noLocal(state.favorites),
      history: state.history.filter((h) => h.item.type !== 'local').slice(0, 60),
      apiKey: state.settings.apiKey, catalogSeen: state.meta.catalogSeen,
    };
  },
  /** union=true: beide Stände zusammenführen (beim Koppeln). Sonst gewinnt der neuere Stand. */
  apply(r, union) {
    const byKey = (a, b) => { const m = new Map(); [...a, ...b].forEach((i) => { if (!m.has(keyOf(i))) m.set(keyOf(i), i); }); return [...m.values()]; };
    const localOf = (sid) => (state.sections.find((s) => s.id === sid)?.items || []).filter((i) => i.type === 'local');
    if (union) {
      const secs = state.sections.map((s) => ({ ...s }));
      for (const rs of r.sections || []) {
        const ls = secs.find((s) => s.id === rs.id);
        if (ls) ls.items = byKey(ls.items, rs.items || []); else secs.push(rs);
      }
      state.sections = secs;
      const ch = new Map([...state.channels, ...(r.channels || [])].map((c) => [c.id, c])); state.channels = [...ch.values()];
      state.favorites = byKey(state.favorites, r.favorites || []);
    } else {
      const remoteIds = new Set((r.sections || []).map((s) => s.id));
      const orphanLocal = state.sections.filter((s) => !remoteIds.has(s.id)).flatMap((s) => s.items.filter((i) => i.type === 'local'));
      state.sections = (r.sections || []).map((s) => ({ ...s, items: [...localOf(s.id), ...(s.items || [])] }));
      if (orphanLocal.length) (state.sections.find((s) => s.id === 'mine') || state.sections[0])?.items.push(...orphanLocal);
      state.channels = r.channels || [];
      state.favorites = [...state.favorites.filter((i) => i.type === 'local'), ...(r.favorites || [])];
    }
    const h = new Map();
    [...state.history, ...(r.history || [])].forEach((x) => { const k = x.key || keyOf(x.item); if (!h.has(k) || h.get(k).at < x.at) h.set(k, { ...x, key: k }); });
    state.history = [...h.values()].sort((a, b) => b.at - a.at).slice(0, 100);
    if (!state.settings.apiKey && r.apiKey) state.settings.apiKey = r.apiKey;
    state.meta.catalogSeen = [...new Set([...(state.meta.catalogSeen || []), ...(r.catalogSeen || [])])];
    state.meta.updatedAt = union ? Date.now() : r.updatedAt;
  },
  async get() {
    const r = await fetch(this.endpoint(), { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Server ' + r.status);
    return r.json();
  },
  async push() {
    if (!this.active()) return;
    const r = await fetch(this.endpoint(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.payload()) });
    if (!r.ok) throw new Error('Server ' + r.status);
    state.meta.lastSync = Date.now(); save();
    this.setStatus('Synchronisiert ' + new Date().toLocaleTimeString('de-DE'));
  },
  schedulePush() { if (!this.active()) return; clearTimeout(this._t); this._t = setTimeout(() => this.push().catch((e) => this.setStatus('Sync-Fehler: ' + e.message, false)), 1500); },
  async pull(silent) {
    if (!this.active() || this._busy) return;
    this._busy = true;
    try {
      const r = await this.get();
      if (!r) await this.push();
      else if ((r.updatedAt || 0) > state.meta.updatedAt) {
        this.apply(r, false); save();
        this.setStatus('Aktualisiert ' + new Date().toLocaleTimeString('de-DE'));
        if ($('#player-layer').hidden && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) rerenderKeepFocus();
        if (!silent) toast('Bibliothek aktualisiert');
      } else if ((r.updatedAt || 0) < state.meta.updatedAt) await this.push();
      else this.setStatus('Aktuell · ' + new Date().toLocaleTimeString('de-DE'));
    } catch (e) { this.setStatus('Sync-Fehler: ' + e.message, false); }
    finally { this._busy = false; }
  },
  async connect(code, url) {
    if (url !== undefined) state.settings.syncUrl = url.trim();
    if (!this.url()) throw new Error('Keine Server-Adresse.');
    state.settings.syncCode = this.norm(code);
    if (state.settings.syncCode.length < 8) throw new Error('Code zu kurz.');
    save();
    const r = await this.get();
    if (r) this.apply(r, true);
    state.meta.updatedAt = Date.now(); save();
    await this.push();
  },
  disconnect() { state.settings.syncCode = ''; save(); this.setStatus('Nicht verbunden', true); },
};

function rerenderKeepFocus() {
  const id = document.activeElement?.closest?.('.nav-item')?.dataset.view;
  render(currentView);
  if (id) $(`.nav-item[data-view="${id}"]`)?.focus(); else if (document.body.classList.contains('tv')) $('#main .focusable')?.focus();
}

/* =========================================================================
 * Rendering
 * ========================================================================= */
let currentView = 'home';
const cardRegistry = new Map(); // DOM-id -> {item, queue}

function card(item, queue) {
  const domId = 'c' + uid();
  cardRegistry.set(domId, { item, queue });
  const h = state.history.find((x) => x.key === keyOf(item));
  const pct = h && h.dur ? Math.min(100, (h.pos / h.dur) * 100) : 0;
  const th = thumbOf(item);
  const badge = item.type === 'playlist' ? 'Playlist' : item.type === 'local' ? 'Lokal' : item.type === 'media' ? (isAudio(item) ? 'Audio' : 'Datei') : '';
  return `<button class="card focusable" id="${domId}" data-card>
    <div class="thumb${th ? '' : ' noimg'}" ${th ? `style="background-image:url('${esc(th)}')"` : ''}>${th ? '' : (isFile(item) && isAudio(item) ? '♫' : '▶')}
      ${badge ? `<span class="badge">${badge}</span>` : ''}
      ${pct > 2 ? `<span class="progress" style="width:${pct}%"></span>` : ''}
    </div>
    <div class="meta"><div class="title">${esc(item.title || '…')}</div><div class="sub">${esc(item.channel || '')}</div></div>
  </button>`;
}
const row = (title, items, emptyText) => `<h2>${esc(title)}</h2><div class="row">${
  items.length ? items.map((i) => card(i, items)).join('') : `<button class="card empty focusable" data-goto="add">${esc(emptyText || 'Noch leer – hinzufügen')}</button>`}</div>`;

const views = {
  home() {
    const cont = state.history.filter((h) => h.dur && h.pos / h.dur < 0.95 && h.pos > 5).map((h) => h.item);
    let html = `<h1>Start</h1>`;
    if (!state.sections.some((s) => s.items.length) && !state.channels.length)
      html += `<p class="hint">Willkommen bei AKM Tube. Füge unter <b>Hinzufügen</b> YouTube-Links, Playlists oder eigene Audio-/Videodateien hinzu. Mit einem YouTube-API-Key (Einstellungen) gibt es zusätzlich Suche und Kanal-Feeds.</p>`;
    if (cont.length) html += row('Weiterschauen', cont);
    for (const s of state.sections) {
      const feeds = state.settings.apiKey ? state.channels.filter((c) => c.section === s.id || c.sort?.[s.id]) : [];
      if (!feeds.length) { html += row(s.name, s.items, `${s.name}: Video, Playlist oder Datei hinzufügen`); continue; }
      html += `<h2>${esc(s.name)}</h2>`;
      if (s.items.length) html += `<div class="row">${s.items.map((i) => card(i, s.items)).join('')}</div>`;
      for (const c of feeds) html += `<div class="row" data-feed="${esc(c.uploads)}" data-ch="${esc(c.id)}" data-sec="${esc(s.id)}"><div class="hint">Lade Uploads von ${esc(c.title)}…</div></div>`;
    }
    if (state.favorites.length) html += row('Favoriten', state.favorites);
    return html;
  },
  search() {
    return `<h1>Suche</h1>
      ${state.settings.apiKey ? '' : '<p class="hint">Für die YouTube-Suche brauchst du einen kostenlosen API-Key (Einstellungen). Ohne Key durchsuchst du nur deine Bibliothek.</p>'}
      <form class="search-bar" id="search-form"><input type="search" id="q" class="focusable" placeholder="Suchbegriff…" value="${esc(views._lastQ || '')}" autocomplete="off">
      <button class="btn focusable">Suchen</button></form><div id="results"></div>`;
  },
  subs() {
    if (!state.settings.apiKey) return `<h1>Kanäle</h1><p class="hint">Kanal-Feeds benötigen einen YouTube-API-Key (Einstellungen).</p>`;
    let html = `<h1>Kanäle</h1>`;
    if (!state.channels.length) html += `<p class="hint">Noch keine Kanäle. Unter <b>Hinzufügen</b> einen Kanal-Link oder @Handle eingeben.</p>`;
    html += state.channels.map((c) => `<h2>${esc(c.title)}</h2><div class="row" data-feed="${esc(c.uploads)}"><div class="hint">Lade…</div></div>`).join('');
    return html;
  },
  library() {
    const tag = (it) => ({ playlist: 'Playlist · ', local: 'Lokal · ', media: 'Datei · ' }[it.type] || '');
    let html = `<h1>Bibliothek</h1>`;
    state.sections.forEach((s, si) => {
      html += `<h2>${esc(s.name)} <span class="hint">(${s.items.length})</span></h2>`;
      html += s.items.length ? `<div class="list">${s.items.map((it) => `
        <div class="list-item"><div class="grow"><div class="title">${esc(it.title)}</div><div class="sub">${tag(it)}${esc(it.channel || '')}</div></div>
        <button class="btn secondary focusable" data-play-sec="${s.id}" data-item="${it.id}" title="Abspielen">▶</button>
        <button class="btn secondary focusable" data-move="${s.id}" data-item="${it.id}" data-dir="-1" title="Nach oben">↑</button>
        <button class="btn secondary focusable" data-move="${s.id}" data-item="${it.id}" data-dir="1" title="Nach unten">↓</button>
        <button class="btn danger focusable" data-del="${s.id}" data-item="${it.id}" title="Entfernen">✕</button></div>`).join('')}</div>` : '<p class="hint">Leer.</p>';
      html += `<div class="btn-row" style="margin-top:8px">
        <button class="btn secondary focusable" data-secmove="${s.id}" data-dir="-1" ${si === 0 ? 'disabled' : ''}>Bereich ↑</button>
        <button class="btn secondary focusable" data-secmove="${s.id}" data-dir="1" ${si === state.sections.length - 1 ? 'disabled' : ''}>Bereich ↓</button>
        <button class="btn secondary focusable" data-secren="${s.id}">Umbenennen</button>
        ${s.items.length ? '' : `<button class="btn danger focusable" data-secdel="${s.id}">Bereich löschen</button>`}</div>`;
    });
    if (state.channels.length) {
      html += `<h2>Kanäle</h2><div class="list">${state.channels.map((c) => `<div class="list-item"><img src="${esc(c.thumb)}" alt=""><div class="grow"><div class="title">${esc(c.title)}</div><div class="sub">Neueste Uploads auf der Startseite in:</div></div>
        <select class="focusable" data-chsec="${c.id}"><option value="">– nur unter „Kanäle“ –</option>${state.sections.map((s) => `<option value="${s.id}" ${c.section === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <button class="btn danger focusable" data-delch="${c.id}">✕</button></div>`).join('')}</div>`;
    }
    html += `<h2>Neuer Bereich</h2><form class="search-bar" id="section-form"><input type="text" id="secname" class="focusable" placeholder="z. B. DJ-Sets, Pre-Vinyl-Master"><button class="btn focusable">Anlegen</button></form>`;
    return html;
  },
  add() {
    const opts = state.sections.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    return `<h1>Hinzufügen</h1>
      <form class="form" id="add-form">
        <div class="field"><label for="url">YouTube-Link, Playlist, Kanal (@Handle) oder direkter Datei-Link (WAV, FLAC, MP3, MP4 …)</label>
          <input type="text" id="url" class="focusable" placeholder="https://youtu.be/…  ·  @kanal  ·  https://…/track.wav" autocomplete="off"></div>
        <div class="field"><label for="sec">Bereich</label><select id="sec" class="focusable">${opts}</select></div>
        <div class="field"><label for="ttl">Eigener Titel (optional)</label><input type="text" id="ttl" class="focusable" autocomplete="off"></div>
        <div class="btn-row"><button class="btn focusable">Hinzufügen</button></div>
      </form>
      <h2>Dateien vom Gerät</h2>
      <p class="hint">Audio- oder Videodateien (z. B. Pre-Vinyl-Master, Club-Master, Previews) direkt auf diesem Gerät speichern. Sie bleiben lokal und werden nicht synchronisiert. Für alle Geräte: Datei auf deinen Webspace oder in Dropbox legen und den Link oben einfügen.</p>
      <div class="btn-row"><label class="btn secondary focusable" tabindex="0" id="filebtn">Dateien auswählen…<input type="file" id="files" accept="audio/*,video/*,.wav,.flac,.aif,.aiff" multiple hidden></label></div>`;
  },
  settings() {
    const s = state.settings;
    return `<h1>Einstellungen</h1>
      <h2>Sync zwischen Geräten</h2>
      <p class="hint">Koppelt Handy, Browser und TV über einen gemeinsamen Code. Bibliothek, Favoriten, „Weiterschauen“ und API-Key werden automatisch abgeglichen.</p>
      <div class="form">
        ${CFG.syncUrl ? '' : `<div class="field"><label for="syncurl">Sync-Server-Adresse</label><input type="text" id="syncurl" class="focusable" value="${esc(s.syncUrl)}" placeholder="https://akmtube-sync.deinname.workers.dev" autocomplete="off"></div>`}
        ${Sync.active() ? `<div>Verbunden mit Code<br><span class="code">${esc(Sync.pretty(s.syncCode))}</span></div>
          <div class="btn-row"><button class="btn focusable" id="syncnow">Jetzt synchronisieren</button><button class="btn danger focusable" id="syncoff">Trennen</button></div>`
        : `<div class="btn-row"><button class="btn focusable" id="syncnew">Neuen Code erzeugen</button></div>
          <div class="field"><label for="synccode">…oder Code von einem anderen Gerät eingeben</label><input type="text" id="synccode" class="focusable" placeholder="ABCD-EFGH-JKLM" autocomplete="off" autocapitalize="characters"></div>
          <div class="btn-row"><button class="btn secondary focusable" id="syncjoin">Verbinden</button></div>`}
        <div id="sync-status" class="status ${Sync.ok ? 'ok' : 'err'}">${esc(Sync.status || (Sync.active() ? '' : 'Nicht verbunden'))}</div>
      </div>
      <h2>Wiedergabe & API</h2>
      <form class="form" id="settings-form">
        <div class="field"><label for="apikey">YouTube Data API v3 Key (optional – für Suche & Kanäle)</label>
          <input type="password" id="apikey" class="focusable" value="${esc(s.apiKey)}" autocomplete="off"></div>
        <label class="check"><input type="checkbox" id="autoplay" class="focusable" ${s.autoplay ? 'checked' : ''}> Nächstes automatisch abspielen</label>
        <label class="check"><input type="checkbox" id="nocookie" class="focusable" ${s.nocookie ? 'checked' : ''}> Datenschutz-Modus (youtube-nocookie.com)</label>
        <div class="field"><label for="tvmode">TV-Modus</label>
          <select id="tvmode" class="focusable">
            <option value="auto" ${s.tvMode === 'auto' ? 'selected' : ''}>Automatisch erkennen</option>
            <option value="on" ${s.tvMode === 'on' ? 'selected' : ''}>Immer an</option>
            <option value="off" ${s.tvMode === 'off' ? 'selected' : ''}>Aus</option></select></div>
        <div class="btn-row"><button class="btn focusable">Speichern</button></div>
      </form>
      <h2>Backup</h2>
      <p class="hint">Bibliothek als Text oder Datei sichern und wiederherstellen (auch ohne Sync-Server).</p>
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
  if (focusFirst) main.querySelector('.focusable')?.focus();
}

const afterRender = {
  search() {
    $('#search-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#q').value.trim(); views._lastQ = q;
      const out = $('#results');
      if (!q) return;
      const local = state.sections.flatMap((s) => s.items).filter((i) => ((i.title || '') + ' ' + (i.channel || '')).toLowerCase().includes(q.toLowerCase()));
      const html = local.length ? `<h2>In deiner Bibliothek</h2><div class="grid">${local.map((i) => card(i, local)).join('')}</div>` : '';
      out.innerHTML = html + (state.settings.apiKey ? '<p class="hint">Suche auf YouTube…</p>' : (local.length ? '' : '<p class="hint">Keine Treffer.</p>'));
      if (!state.settings.apiKey) return;
      try {
        const j = await yt('search', { part: 'snippet', q, type: 'video,playlist', maxResults: 24 });
        const items = j.items.map((r) => ({
          id: uid(), type: r.id.kind === 'youtube#playlist' ? 'playlist' : 'video',
          ytId: r.id.videoId || r.id.playlistId, title: decodeEntities(r.snippet.title),
          channel: r.snippet.channelTitle, thumb: bestThumb(r.snippet.thumbnails),
        })).filter((i) => i.ytId);
        out.innerHTML = html + `<h2>YouTube</h2><div class="grid">${items.map((i) => card(i, items.filter((x) => x.type === 'video'))).join('')}</div>`;
      } catch (err) { out.innerHTML = html + `<p class="hint">Fehler: ${esc(err.message)}</p>`; }
    });
    if (views._lastQ) $('#search-form').requestSubmit();
  },
  home() { afterRender.subs(); },
  subs() {
    document.querySelectorAll('[data-feed]').forEach(async (el) => {
      try {
        let vids = await cachedUploads(el.dataset.feed);
        const c = el.dataset.sec && state.channels.find((x) => x.id === el.dataset.ch);
        if (c) vids = vids.filter((v) => sectionForUpload(c, v) === el.dataset.sec);
        if (!vids.length && el.dataset.sec) { el.innerHTML = '<div class="hint">Noch keine Uploads für dieses Projekt.</div>'; return; }
        el.innerHTML = vids.map((v) => card(v, vids)).join('') || '<div class="hint">Keine Videos.</div>';
      } catch (err) { el.innerHTML = `<div class="hint">Fehler: ${esc(err.message)}</div>`; }
    });
  },
  library() {
    $('#section-form').addEventListener('submit', (e) => {
      e.preventDefault(); const n = $('#secname').value.trim(); if (!n) return;
      state.sections.push({ id: uid(), name: n, items: [] }); changed(); render('library'); toast('Bereich angelegt');
    });
  },
  add() {
    $('#add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p = parseInput($('#url').value);
      if (!p) return toast('Link nicht erkannt');
      if (p.type === 'channel') {
        try {
          const c = await resolveChannel(p);
          if (state.channels.some((x) => x.id === c.id)) return toast('Kanal bereits vorhanden');
          state.channels.push(c); changed(); toast(`Kanal „${c.title}“ hinzugefügt`); $('#url').value = '';
        } catch (err) { toast(err.message); }
        return;
      }
      if (p.list && p.type === 'video' && confirm('Der Link enthält eine Playlist. Ganze Playlist hinzufügen?')) { p.type = 'playlist'; p.ytId = p.list; }
      delete p.list;
      toast('Lade Infos…');
      const meta = await fetchMeta(p);
      const custom = $('#ttl').value.trim();
      const item = { id: uid(), ...p, title: custom || meta.title, channel: meta.channel || '', thumb: meta.thumb || '' };
      const sec = state.sections.find((s) => s.id === $('#sec').value);
      sec.items.unshift(item); changed();
      $('#url').value = ''; $('#ttl').value = '';
      toast(`„${item.title}“ → ${sec.name}`);
    });
    $('#files').addEventListener('change', (e) => { addLocalFiles([...e.target.files], $('#sec').value); e.target.value = ''; });
    $('#filebtn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.keyCode === 23) { e.preventDefault(); $('#files').click(); } });
  },
  settings() {
    $('#settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      Object.assign(state.settings, { apiKey: $('#apikey').value.trim(), autoplay: $('#autoplay').checked, nocookie: $('#nocookie').checked, tvMode: $('#tvmode').value });
      changed(); applyTvMode(); toast('Gespeichert');
      if (state.settings.apiKey) loadCatalog();
    });
    const urlVal = () => $('#syncurl') ? $('#syncurl').value : undefined;
    const run = async (fn, okMsg) => { try { Sync.setStatus('Verbinde…'); await fn(); toast(okMsg); render('settings'); } catch (e) { Sync.setStatus('Fehler: ' + e.message, false); } };
    $('#syncnew')?.addEventListener('click', () => run(() => Sync.connect(Sync.newCode(), urlVal()), 'Sync aktiv – Code auf dem anderen Gerät eingeben'));
    $('#syncjoin')?.addEventListener('click', () => run(() => Sync.connect($('#synccode').value, urlVal()), 'Geräte gekoppelt'));
    $('#syncnow')?.addEventListener('click', () => Sync.pull(false));
    $('#syncoff')?.addEventListener('click', () => { Sync.disconnect(); render('settings'); });

    const exportJson = () => JSON.stringify(Sync.payload(), null, 1);
    $('#exp').onclick = () => { $('#backup').value = exportJson(); $('#backup').select(); navigator.clipboard?.writeText($('#backup').value).then(() => toast('In Zwischenablage kopiert'), () => {}); };
    $('#dl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' })); a.download = 'akmtube-backup.json'; a.click(); };
    const doImport = (txt) => {
      try { const j = JSON.parse(txt); if (j.app !== 'akmtube') throw 0; Sync.apply(j, true); changed(); toast('Import erfolgreich'); render('home'); }
      catch { toast('Ungültige Backup-Daten'); }
    };
    $('#imp').onclick = () => doImport($('#backup').value);
    $('#impfile').onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then(doImport); };
    $('#clearhist').onclick = () => { state.history = []; changed(); toast('Verlauf gelöscht'); };
  },
};

/* =========================================================================
 * Klick-Handling
 * ========================================================================= */
const findSec = (id) => state.sections.find((x) => x.id === id);
document.addEventListener('click', (e) => {
  const t = e.target;
  const nav = t.closest('.nav-item'); if (nav) return render(nav.dataset.view);
  const go = t.closest('[data-goto]'); if (go) return render(go.dataset.goto, true);
  const c = t.closest('[data-card]');
  if (c) { const r = cardRegistry.get(c.id); if (r) openItem(r.item, r.queue); return; }
  const pb = t.closest('[data-play-sec]');
  if (pb) { const s = findSec(pb.dataset.playSec); return openItem(s.items.find((x) => x.id === pb.dataset.item), s.items); }
  const del = t.closest('[data-del]');
  if (del) {
    const s = findSec(del.dataset.del); const it = s.items.find((x) => x.id === del.dataset.item);
    s.items = s.items.filter((x) => x !== it);
    if (it?.type === 'local') FileStore.del(it.fileId).catch(() => {});
    changed(); return render('library');
  }
  const mv = t.closest('[data-move]');
  if (mv) {
    const s = findSec(mv.dataset.move); const i = s.items.findIndex((x) => x.id === mv.dataset.item); const j = i + Number(mv.dataset.dir);
    if (j >= 0 && j < s.items.length) { [s.items[i], s.items[j]] = [s.items[j], s.items[i]]; changed(); render('library');
      document.querySelector(`[data-move="${s.id}"][data-item="${mv.dataset.item}"][data-dir="${mv.dataset.dir}"]`)?.focus(); }
    return;
  }
  const sm = t.closest('[data-secmove]');
  if (sm) { const i = state.sections.findIndex((x) => x.id === sm.dataset.secmove); const j = i + Number(sm.dataset.dir);
    if (j >= 0 && j < state.sections.length) { [state.sections[i], state.sections[j]] = [state.sections[j], state.sections[i]]; changed(); render('library');
      document.querySelector(`[data-secmove="${sm.dataset.secmove}"][data-dir="${sm.dataset.dir}"]`)?.focus(); } return; }
  const sr = t.closest('[data-secren]');
  if (sr) { const s = findSec(sr.dataset.secren); const n = prompt('Neuer Name für den Bereich:', s.name); if (n?.trim()) { s.name = n.trim(); changed(); render('library'); } return; }
  const sd = t.closest('[data-secdel]');
  if (sd) { state.sections = state.sections.filter((x) => x.id !== sd.dataset.secdel); changed(); return render('library'); }
  const dc = t.closest('[data-delch]');
  if (dc) { state.channels = state.channels.filter((x) => x.id !== dc.dataset.delch); changed(); return render('library'); }
});

// Rechtsklick / langes Drücken auf eine Karte: Favorit umschalten
document.addEventListener('change', (e) => {
  const cs = e.target.closest('[data-chsec]');
  if (cs) { const c = state.channels.find((x) => x.id === cs.dataset.chsec); if (c) { c.section = cs.value || undefined; changed(); toast('Gespeichert'); } }
});

document.addEventListener('contextmenu', (e) => {
  const c = e.target.closest('[data-card]'); if (!c) return;
  e.preventDefault(); toggleFav(cardRegistry.get(c.id)?.item);
});
function toggleFav(item) {
  if (!item) return;
  const k = keyOf(item);
  const i = state.favorites.findIndex((f) => keyOf(f) === k);
  if (i >= 0) { state.favorites.splice(i, 1); toast('Aus Favoriten entfernt'); }
  else { state.favorites.unshift({ ...item, id: uid() }); toast('Zu Favoriten hinzugefügt'); }
  changed(); updateFavBtn();
}

/* =========================================================================
 * Player (YouTube-IFrame + HTML5 für eigene Dateien)
 * ========================================================================= */
let ytReady = null, player = null, kind = null, queue = [], qIndex = 0, current = null, progressTimer = null, barTimer = null, objUrl = null;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const media = () => $('#media-el');
const YT_PLAYING = 1, YT_PAUSED = 2, YT_ENDED = 0;

const P = {
  play() { kind === 'yt' ? player?.playVideo?.() : media().play().catch(() => {}); },
  pause() { kind === 'yt' ? player?.pauseVideo?.() : media().pause(); },
  playing() { return kind === 'yt' ? player?.getPlayerState?.() === YT_PLAYING : !media().paused; },
  toggle() { this.playing() ? this.pause() : this.play(); },
  time() { return (kind === 'yt' ? player?.getCurrentTime?.() : media().currentTime) || 0; },
  dur() { const d = kind === 'yt' ? player?.getDuration?.() : media().duration; return isFinite(d) ? d || 0 : 0; },
  seekTo(t) { kind === 'yt' ? player?.seekTo?.(t, true) : (media().currentTime = t); },
  rate(r) { kind === 'yt' ? player?.setPlaybackRate?.(r) : (media().playbackRate = r); },
};

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
  queue = item.type === 'playlist' ? [] : (list || [item]).filter((i) => i.type !== 'playlist');
  qIndex = Math.max(0, queue.findIndex((i) => keyOf(i) === keyOf(item)));
  current = item;
  $('#player-layer').hidden = false;
  $('#player-title').textContent = item.title;
  updateFavBtn(); showBar();
  const resume = state.history.find((h) => h.key === keyOf(item)) || {};
  const start = resume.dur && resume.pos / resume.dur < 0.95 && resume.pos > 5 ? Math.floor(resume.pos) : 0;
  clearInterval(progressTimer);
  progressTimer = setInterval(recordProgress, 5000);
  setTimeout(() => $('#player-bar [data-act="toggle"]').focus(), 50);

  if (isFile(item)) return openFile(item, start);

  // YouTube
  if (kind === 'html') stopMedia();
  kind = 'yt';
  $('#yt-box').hidden = false; media().hidden = true; $('#audio-art').hidden = true;
  await loadYtApi();
  if (current !== item) return;
  const tv = document.body.classList.contains('tv');
  if (player) {
    if (item.type === 'playlist') player.loadPlaylist({ listType: 'playlist', list: item.ytId });
    else player.loadVideoById({ videoId: item.ytId, startSeconds: start });
  } else {
    const vars = { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, controls: tv ? 0 : 1, origin: location.origin };
    if (item.type === 'playlist') Object.assign(vars, { listType: 'playlist', list: item.ytId });
    else if (start) vars.start = start;
    player = new YT.Player('yt-player', {
      host: state.settings.nocookie ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com',
      videoId: item.type === 'video' ? item.ytId : undefined,
      playerVars: vars,
      events: {
        onReady: (e) => { e.target.setPlaybackRate(state.settings.speed || 1); if (kind === 'yt') e.target.playVideo(); },
        onStateChange: onYtState,
        onError: (e) => { toast('Video nicht abspielbar (Fehler ' + e.data + ')'); if (state.settings.autoplay) setTimeout(next, 1500); },
      },
    });
  }
}

async function openFile(item, start) {
  if (kind === 'yt') player?.pauseVideo?.();
  kind = 'html';
  const m = media();
  $('#yt-box').hidden = true; m.hidden = false;
  const audio = isAudio(item);
  const art = $('#audio-art');
  art.hidden = !audio;
  art.querySelector('.art-title').textContent = item.title;
  art.querySelector('.art-sub').textContent = item.channel || '';
  m.controls = !document.body.classList.contains('tv');
  if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
  let src = item.src;
  if (item.type === 'local') {
    const blob = await FileStore.get(item.fileId).catch(() => null);
    if (!blob) { toast('Datei ist nur auf dem Gerät verfügbar, auf dem sie hinzugefügt wurde.'); return; }
    src = objUrl = URL.createObjectURL(blob);
  }
  m.src = src;
  m.playbackRate = state.settings.speed || 1;
  m.onloadedmetadata = () => { if (start && start < m.duration - 5) m.currentTime = start; m.playbackRate = state.settings.speed || 1; };
  m.play().catch(() => showBar(true));
}

function stopMedia() { const m = media(); m.pause(); m.removeAttribute('src'); m.load(); $('#audio-art').hidden = true; if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; } }

function onPlaying() { $('#player-wrap').classList.add('playing'); hideBarSoon(); }
function onPaused() { $('#player-wrap').classList.remove('playing'); showBar(true); }
function onEnded() { $('#player-wrap').classList.remove('playing'); recordProgress(); if (state.settings.autoplay && current?.type !== 'playlist') next(); else showBar(true); }

function onYtState(e) {
  if (kind !== 'yt') return;
  if (e.data === YT_PLAYING) {
    const d = player.getVideoData?.();
    if (d?.title) $('#player-title').textContent = d.title;
    onPlaying();
  }
  if (e.data === YT_PAUSED) onPaused();
  if (e.data === YT_ENDED) onEnded();
}
media().addEventListener('playing', () => kind === 'html' && onPlaying());
media().addEventListener('pause', () => kind === 'html' && !media().ended && onPaused());
media().addEventListener('ended', () => kind === 'html' && onEnded());
media().addEventListener('error', () => { if (kind === 'html' && media().getAttribute('src')) { toast('Datei nicht abspielbar (Format/Link prüfen)'); if (state.settings.autoplay) setTimeout(next, 2000); } });

function recordProgress() {
  if (!current) return;
  let item = current;
  if (kind === 'yt' && current.type === 'playlist') {
    const d = player?.getVideoData?.() || {};
    if (!d.video_id) return;
    item = { id: uid(), type: 'video', ytId: d.video_id, title: d.title || current.title, channel: d.author || current.channel };
  }
  const pos = P.time(), dur = P.dur();
  if (!dur) return;
  const key = keyOf(item);
  state.history = [{ key, item, pos, dur, at: Date.now() }, ...state.history.filter((h) => h.key !== key)].slice(0, 100);
  save();
}

function next() {
  if (kind === 'yt' && current?.type === 'playlist') return player?.nextVideo();
  if (qIndex < queue.length - 1) { qIndex++; openItem(queue[qIndex], queue); } else { toast('Ende der Liste'); showBar(true); }
}
function prev() {
  if (kind === 'yt' && current?.type === 'playlist') return player?.previousVideo();
  if (P.time() > 5) return P.seekTo(0);
  if (qIndex > 0) { qIndex--; openItem(queue[qIndex], queue); }
}
function seek(d) { const t = Math.max(0, P.time() + d); P.seekTo(t); toast(fmtTime(t) + ' / ' + fmtTime(P.dur())); }
function cycleSpeed() {
  const i = (SPEEDS.indexOf(state.settings.speed) + 1) % SPEEDS.length; state.settings.speed = SPEEDS[i]; save();
  P.rate(SPEEDS[i]); $('[data-act="speed"]').textContent = SPEEDS[i] + '×'; toast('Geschwindigkeit ' + SPEEDS[i] + '×');
}
function updateFavBtn() { const b = $('[data-act="fav"]'); if (b && current) b.textContent = state.favorites.some((f) => keyOf(f) === keyOf(current)) ? '★' : '☆'; }
function closePlayer() {
  recordProgress(); clearInterval(progressTimer);
  if (kind === 'yt') player?.stopVideo?.(); else stopMedia();
  $('#player-layer').hidden = true; current = null;
  changed();
  render(currentView); $('#main .focusable')?.focus();
}
function showBar(stay) { $('#player-bar').classList.remove('hide'); clearTimeout(barTimer); if (!stay) hideBarSoon(); }
function hideBarSoon() { clearTimeout(barTimer); barTimer = setTimeout(() => { if (document.body.classList.contains('tv') && P.playing()) $('#player-bar').classList.add('hide'); }, 4000); }

$('#player-bar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  ({ prev, next, toggle: () => P.toggle(), back10: () => seek(-10), fwd10: () => seek(10), speed: cycleSpeed, fav: () => toggleFav(current), close: closePlayer })[b.dataset.act]?.();
  showBar();
});

/* =========================================================================
 * Fernbedienung / Tastatur (Spatial Navigation)
 * ========================================================================= */
function focusables() {
  const layer = $('#player-layer');
  const scope = layer.hidden ? document : layer;
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

/** Zurück-Taste (Browser: Esc/Backspace, Android: Hardware-Back via akmBack()). true = behandelt. */
window.akmBack = function () {
  if (!$('#player-layer').hidden) { closePlayer(); return true; }
  if (currentView !== 'home') { render('home'); $('.nav-item[data-view="home"]').focus(); return true; }
  if (!$('#sidebar').contains(document.activeElement)) { $('.nav-item.active')?.focus(); return true; }
  return false;
};

const KEY = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 21: 'left', 19: 'up', 22: 'right', 20: 'down' };
document.addEventListener('keydown', (e) => {
  document.body.classList.add('kbd');
  const ae = document.activeElement;
  const tag = ae?.tagName;
  const typing = (tag === 'INPUT' && !['checkbox', 'file'].includes(ae.type)) || tag === 'TEXTAREA';
  const inPlayer = !$('#player-layer').hidden;

  if (inPlayer) {
    const mk = { MediaPlayPause: () => P.toggle(), MediaPlay: () => P.play(), MediaPause: () => P.pause(),
      MediaTrackNext: next, MediaTrackPrevious: prev, MediaFastForward: () => seek(30), MediaRewind: () => seek(-30), ' ': () => P.toggle() }[e.key];
    if (mk && !(e.key === ' ' && ae?.tagName === 'BUTTON')) { e.preventDefault(); mk(); showBar(); return; }
    if ($('#player-bar').classList.contains('hide')) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(-10); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(10); return; }
      if (e.key === 'Enter' || e.keyCode === 23) { e.preventDefault(); P.toggle(); showBar(); return; }
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
      const atStart = ae.selectionStart === 0, atEnd = ae.selectionEnd === ae.value.length;
      if (!(dir === 'left' && atStart) && !(dir === 'right' && atEnd)) return;
    }
    if (tag === 'SELECT' && (dir === 'up' || dir === 'down') && !document.body.classList.contains('tv')) return;
    e.preventDefault(); moveFocus(dir);
  }
  if (e.keyCode === 23 && ae?.click) { e.preventDefault(); ae.click(); }
});
document.addEventListener('mousedown', () => document.body.classList.remove('kbd'));

/* =========================================================================
 * TV-Erkennung & Start
 * ========================================================================= */
function applyTvMode() {
  const auto = /AKMTube-TV|Android TV|AFT[A-Z]|BRAVIA|SmartTV|Tizen|Web0S|GoogleTV|CrKey/i.test(navigator.userAgent);
  const m = state.settings.tvMode;
  document.body.classList.toggle('tv', m === 'on' || (m === 'auto' && auto));
}

state = loadState();
$('[data-act="speed"]').textContent = (state.settings.speed || 1) + '×';
applyTvMode();
render('home');
if (document.body.classList.contains('tv')) $('.nav-item[data-view="home"]').focus();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// Teilen-Ziel (PWA share_target bzw. Android "Teilen"): Link direkt in "Hinzufügen" übernehmen
const qs = new URLSearchParams(location.search);
const shared = qs.get('url') || (qs.get('text') || '').match(/https?:\/\/\S+/)?.[0];
if (shared) { render('add'); $('#url').value = shared; history.replaceState(null, '', location.pathname); }

loadCatalog();
Sync.pull(true);
setInterval(() => { if (document.visibilityState === 'visible' && $('#player-layer').hidden) Sync.pull(true); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.pull(true); });
