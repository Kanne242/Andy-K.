/**
 * AKM Tube Sync – Cloudflare Worker (kostenloser Tarif reicht).
 * Speichert pro Kopplungscode ein JSON-Dokument im KV-Speicher "SYNC".
 *   GET  /v1/<CODE>  → gespeicherte Bibliothek (404 wenn leer)
 *   PUT  /v1/<CODE>  → Bibliothek speichern (max. 1 MB)
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
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
