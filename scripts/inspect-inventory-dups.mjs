import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  let v = t.slice(i + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  env[t.slice(0, i).trim()] = v;
}

const url = env.SUPABASE_URL.replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;

async function get(params) {
  const r = await fetch(`${url}/rest/v1/inventory_items?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

for (const q of ['ser', 'rukol', 'kozi', 'ogorek', 'mieso', 'nabial']) {
  const rows = await get(
    `select=id,name,is_active,quantity,account_key&name=ilike.*${encodeURIComponent(q)}*&limit=40&order=name`,
  );
  console.log(`\n=== ilike ${q} (${rows.length}) ===`);
  for (const r of rows) {
    console.log(
      `${r.is_active === false ? 'OFF' : 'ON '} ${r.name} | ${(r.account_key || '').slice(0, 14)} | qty ${r.quantity}`,
    );
  }
}

const all = [];
let offset = 0;
for (;;) {
  const batch = await get(
    `select=id,name,is_active,quantity,account_key,category_id&limit=1000&offset=${offset}`,
  );
  if (!batch.length) break;
  all.push(...batch);
  if (batch.length < 1000) break;
  offset += 1000;
}

// near-dups: same first token / food stem among ACTIVE
const active = all.filter((r) => r.is_active !== false);
const byStem = new Map();
for (const r of active) {
  const n = norm(r.name);
  const stem = n.split(' ').slice(0, 2).join(' ');
  if (!stem) continue;
  if (!byStem.has(stem)) byStem.set(stem, []);
  byStem.get(stem).push(r);
}
const near = [...byStem.entries()]
  .filter(([, v]) => v.length >= 2)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 30);
console.log('\n=== near-dups (first 2 words, active) ===');
for (const [stem, items] of near) {
  console.log(`x${items.length} [${stem}] -> ${items.map((i) => i.name).join(' | ')}`);
}
