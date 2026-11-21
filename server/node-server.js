#!/usr/bin/env node
/**
 * AKM Tube Sync – Variante zum Selbst-Hosten (Node.js ≥ 18, keine Abhängigkeiten).
 * Start:  PORT=8787 DATA_DIR=./data node node-server.js
 * Gleiche Schnittstelle wie worker.js. Für den Betrieb im Internet hinter HTTPS (z. B. Caddy/nginx) betreiben.
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

http.createServer((req, res) => {
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
