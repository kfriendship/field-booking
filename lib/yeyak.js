// 화성시 통합예약 조회 공통 로직 — Node 18+와 Cloudflare Workers 양쪽에서 그대로 동작 (fetch만 사용)

export const BASE = 'https://yeyak.hscity.go.kr';
export const LIST_URL =
  `${BASE}/1053/3026/stadiumList.do?searchYn=Y&searchTab=operator&searchCondition=stadiumNm` +
  '&searchAreaEmd=&searchKeyword=%EC%B6%95%EA%B5%AC%EC%9E%A5';
const API = `${BASE}/stadium/stadiumReserveUseList.do`;
const STATUS = { AP: 'booked', CLOSE: 'closed' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({ concurrency = 3, delayMs = 300, cacheMs = 5 * 60_000 } = {}) {
  let cookie = '';
  let cookieInit = null;
  let active = 0;
  const waiting = [];
  const monthCache = new Map();
  const inflight = new Map();

  async function upstream(url, opts = {}) {
    if (active >= concurrency) await new Promise((r) => waiting.push(r));
    active++;
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie, ...opts.headers } });
      const set = res.headers.getSetCookie?.() ?? [];
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      if (!res.ok) throw new Error(`예약 사이트 응답 ${res.status}`);
      await sleep(delayMs);
      return res;
    } finally {
      active--;
      waiting.shift()?.();
    }
  }

  async function fetchMonth(idx, y, m) {
    if (!cookie) await (cookieInit ??= upstream(LIST_URL).finally(() => { cookieInit = null; }));
    const res = await upstream(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${BASE}/1053/3026/stadiumDetail.do?stadiumIdx=${idx}`,
      },
      body: new URLSearchParams({ stadiumIdx: idx, searchYear: String(y), searchMonth: String(m).padStart(2, '0') }),
    });
    const list = (await res.json()).useCntList ?? [];
    // 예약자 이름 등은 버리고 필요한 필드만 남김
    return list.map((r) => ({
      date: r.sorDate,
      begin: r.stadiumBeginHm,
      end: r.stadiumEndHm,
      state: STATUS[r.applyStatusCd] ?? (r.applyStatusCd ? 'other' : 'open'),
    }));
  }

  async function getMonth(idx, y, m) {
    const key = `${idx}:${y}-${m}`;
    const hit = monthCache.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.rows;
    if (inflight.has(key)) return inflight.get(key);
    const p = fetchMonth(idx, y, m)
      .then((rows) => { monthCache.set(key, { at: Date.now(), rows }); return rows; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  // 한 날짜의 구장별 슬롯. onResult로 끝나는 순서대로 하나씩 넘겨줌
  async function checkDate(date, ids, onResult) {
    const [y, m] = date.split('-').map(Number);
    await Promise.all(ids.map(async (idx) => {
      try {
        const slots = (await getMonth(idx, y, m)).filter((r) => r.date === date).map(({ date: _, ...s }) => s);
        await onResult({ idx, slots });
      } catch (e) {
        await onResult({ idx, error: e.message });
      }
    }));
  }

  // 목록 페이지를 넘기며 구장 후보를 모으고, 예약현황 API가 시간대를 주는 번호만 채택
  async function buildStadiums() {
    const clean = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const re = /<a\b[^>]*?(?:stadiumIdx=(\d+)|on[Cc]lick="[^"]*?\(\s*['"]?(\d+)['"]?[^"]*")[^>]*>([\s\S]*?)<\/a>/g;
    const cand = new Map();
    for (let page = 1; page <= 20; page++) {
      const html = await (await upstream(`${LIST_URL}&currentPageNo=${page}`)).text();
      let added = 0;
      for (const m of html.matchAll(re)) {
        const idx = m[1] ?? m[2];
        let name = clean(m[3]);
        if (!name || name.length < 2 || /^\d+$/.test(name)) {
          name = clean(html.slice(m.index, m.index + 800)).match(/[가-힣A-Za-z0-9()·\-\s]{0,30}(축구장|구장|경기장|운동장)/)?.[0].trim() ?? '';
        }
        const prev = cand.get(idx);
        if (!prev) { cand.set(idx, { idx, name }); added++; }
        else if (!prev.name && name) prev.name = name;
      }
      if (!added) break;
    }
    const now = new Date();
    const valid = [];
    await Promise.all([...cand.values()].filter((c) => c.name).map(async (c) => {
      try {
        if ((await getMonth(c.idx, now.getFullYear(), now.getMonth() + 1)).length) valid.push(c);
      } catch {}
    }));
    return valid.sort((a, b) => Number(b.idx) - Number(a.idx));
  }

  return { getMonth, checkDate, buildStadiums };
}

// 요청 파라미터 검증 (워커가 아무 데나 찌르는 프록시가 되지 않도록)
export function parseCheckParams(searchParams, maxIds = 40) {
  const date = searchParams.get('date') ?? '';
  const ids = (searchParams.get('ids') ?? '').split(',').filter(Boolean);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '날짜 형식이 올바르지 않아요.' };
  if (!ids.length) return { error: '구장을 하나 이상 골라주세요.' };
  if (ids.length > maxIds || ids.some((i) => !/^\d{1,6}$/.test(i))) return { error: '구장 번호가 올바르지 않아요.' };
  return { date, ids: [...new Set(ids)] };
}
