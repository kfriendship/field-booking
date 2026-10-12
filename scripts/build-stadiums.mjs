// 구장 목록(docs/stadiums.json) 새로 만들기 — 구장이 추가/변경됐을 때만 실행
// node scripts/build-stadiums.mjs
import fs from 'node:fs/promises';
import { createClient } from '../lib/yeyak.js';

const list = await createClient().buildStadiums();
await fs.writeFile(new URL('../docs/stadiums.json', import.meta.url), JSON.stringify(list, null, 2) + '\n');
console.log(`구장 ${list.length}곳 저장`);
for (const s of list) console.log(`  ${s.idx.padStart(4)}  ${s.name}`);
