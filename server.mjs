// 로컬 개발용 서버: docs/를 정적으로 띄우고 /api/check를 직접 처리 (워커 없이 테스트할 때)
// node server.mjs  →  http://localhost:3000
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, parseCheckParams } from './lib/yeyak.js';

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs');
const PORT = Number(process.env.PORT ?? 3000);
const client = createClient();
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/check') {
    const p = parseCheckParams(url.searchParams);
    if (p.error) { res.writeHead(400, { 'Content-Type': TYPES['.json'] }); return res.end(JSON.stringify(p)); }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    let closed = false;
    req.on('close', () => { closed = true; });
    await client.checkDate(p.date, p.ids, (line) => { if (!closed) res.write(JSON.stringify(line) + '\n'); });
    return res.end();
  }
  const file = path.join(DOCS, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(DOCS)) { res.writeHead(403); return res.end(); }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
