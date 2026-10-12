// Cloudflare Worker: GitHub Pages 페이지 대신 예약 사이트를 조회해주는 중계 서버
// GET /api/check?date=YYYY-MM-DD&ids=241,203  →  구장별 결과를 NDJSON으로 스트리밍
import { createClient, parseCheckParams } from '../../lib/yeyak.js';

// 같은 워커 인스턴스가 살아있는 동안은 캐시·쿠키가 유지됨 (콜드 스타트 시 초기화)
const client = createClient({ concurrency: 3, delayMs: 300, cacheMs: 5 * 60_000 });

function cors(req, env) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || origin.startsWith('http://localhost');
  return { ok, headers: ok ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {} };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const c = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...c.headers, 'Access-Control-Allow-Methods': 'GET' } });
    if (url.pathname !== '/api/check' || req.method !== 'GET') return json({ error: 'not found' }, 404, c.headers);
    if (!c.ok) return json({ error: '허용되지 않은 출처예요.' }, 403);

    const p = parseCheckParams(url.searchParams);
    if (p.error) return json(p, 400, c.headers);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const job = client
      .checkDate(p.date, p.ids, (line) => writer.write(enc.encode(JSON.stringify(line) + '\n')))
      .catch((e) => writer.write(enc.encode(JSON.stringify({ error: e.message }) + '\n')))
      .finally(() => writer.close());
    ctx.waitUntil(job);

    return new Response(readable, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...c.headers },
    });
  },
};
