#!/usr/bin/env node
/**
 * AKM Tube Sync – Variante zum Selbst-Hosten (Node.js ≥ 18, keine Abhängigkeiten).
 * Start:  PORT=8787 DATA_DIR=./data node node-server.js
 * Gleiche Schnittstelle wie worker.js (Sync + /yt/feed). Benötigt Node 18+ (fetch). Für den Betrieb im Internet hinter HTTPS (z. B. Caddy/nginx) betreiben.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(DIR, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const send = (res, status, body) => { res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };


/* ---- YouTube-Kanal-Feed ohne API-Key (öffentlicher RSS-Feed, max. 15 neueste Videos) ---- */
const UA = { 'User-Agent': 'Mozilla/5.0 (AKM Tube Feed)', 'Accept-Language': 'de-DE,de;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+' };
const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
async function resolveHandle(handle) {
  const r = await fetch('https://www.youtube.com/' + encodeURIComponent(handle).replace('%40', '@'), { headers: UA });
  if (!r.ok) throw new Error('Kanal nicht gefunden');
  const html = await r.text();
  const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/"channelId":"(UC[\w-]{22})"/);
  if (!m) throw new Error('Kanal-ID nicht gefunden');
  return m[1];
}
async function channelFeed(q) {
  let id = q.get('channel');
  const handle = q.get('handle');
  if (!id && handle && /^@[\w.-]{2,100}$/.test(handle)) id = await resolveHandle(handle);
  if (!id || !/^UC[\w-]{22}$/.test(id)) throw new Error('Ungültiger Kanal');
  const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + id, { headers: UA });
  if (!r.ok) throw new Error('Feed nicht erreichbar (' + r.status + ')');
  const xml = await r.text();
  const title = decodeXml((xml.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    ytId: (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1],
    title: decodeXml((e.match(/<title>([^<]*)<\/title>/) || [])[1] || ''),
    channel: decodeXml((e.match(/<name>([^<]*)<\/name>/) || [])[1] || title),
    publishedAt: (e.match(/<published>([^<]*)<\/published>/) || [])[1] || '',
  })).filter((v) => v.ytId);
  return { id, title, videos };
}

const feedCache = new Map();
async function cachedFeed(q) {
  const k = q.toString(); const c = feedCache.get(k);
  if (c && Date.now() - c.at < 1800000) return c.data;
  const data = await channelFeed(q); feedCache.set(k, { at: Date.now(), data }); return data;
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/yt/feed')) {
    cachedFeed(new URL(req.url, 'http://x').searchParams).then((d) => send(res, 200, d), (e) => send(res, 502, { error: e.message }));
    return;
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const m = req.url.split('?')[0].match(/^\/v1\/([A-Z0-9]{8,32})$/);
  if (!m) return send(res, req.url === '/' ? 200 : 404, { ok: true, service: 'akmtube-sync' });
  const file = path.join(DIR, m[1] + '.json');
  if (req.method === 'GET') {
    fs.readFile(file, 'utf8', (err, data) => err ? send(res, 404, { error: 'not found' }) : send(res, 200, data));
    return;
  }
  if (req.method === 'PUT') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1_000_000) { send(res, 413, { error: 'too large' }); req.destroy(); } });
    req.on('end', () => {
      try { if (JSON.parse(body).app !== 'akmtube') throw 0; } catch { return send(res, 400, { error: 'invalid' }); }
      const tmp = file + '.tmp';
      fs.writeFile(tmp, body, (err) => err ? send(res, 500, { error: 'write' }) : fs.rename(tmp, file, () => send(res, 200, { ok: true })));
    });
    return;
  }
  send(res, 405, { error: 'method' });
}).listen(PORT, () => console.log(`AKM Tube Sync läuft auf Port ${PORT}, Daten in ${DIR}`));
