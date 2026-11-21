/**
 * AKM Tube Sync – Cloudflare Worker (kostenloser Tarif reicht).
 * Speichert pro Kopplungscode ein JSON-Dokument im KV-Speicher "SYNC".
 *   GET  /v1/<CODE>  → gespeicherte Bibliothek (404 wenn leer)
 *   PUT  /v1/<CODE>  → Bibliothek speichern (max. 1 MB)
 *   GET  /yt/feed?handle=@kanal | ?channel=UC…  → neueste Videos eines Kanals (ohne API-Key)
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });


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

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === '/yt/feed' && req.method === 'GET') {
      const cache = caches.default;
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = json(await channelFeed(url.searchParams));
        res.headers.set('Cache-Control', 'public, max-age=1800'); // 30 Minuten
        await cache.put(req, res.clone());
        return res;
      } catch (e) { return json({ error: e.message }, 502); }
    }
    const m = new URL(req.url).pathname.match(/^\/v1\/([A-Z0-9]{8,32})$/);
    if (!m) return json({ ok: true, service: 'akmtube-sync' }, m === null && new URL(req.url).pathname === '/' ? 200 : 404);
    const key = 'lib:' + m[1];
    if (req.method === 'GET') {
      const v = await env.SYNC.get(key);
      return v ? json(v) : json({ error: 'not found' }, 404);
    }
    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > 1_000_000) return json({ error: 'too large' }, 413);
      try { const j = JSON.parse(text); if (j.app !== 'akmtube') throw 0; } catch { return json({ error: 'invalid' }, 400); }
      await env.SYNC.put(key, text, { expirationTtl: 60 * 60 * 24 * 365 * 2 }); // 2 Jahre nach letzter Änderung
      return json({ ok: true });
    }
    return json({ error: 'method' }, 405);
  },
};
