/**
 * Soft-delete duplicate inventory_items (same normalized name per account_key).
 * Keeps 1 winner per (account_key, name_key).
 * Usage:
 *   node scripts/dedup-inventory.mjs --dry-run
 *   node scripts/dedup-inventory.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

function loadEnv(path) {
  const d = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    d[k] = v;
  }
  return d;
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

const env = loadEnv(resolve(root, '.env'));
const url = (env.SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

async function req(method, path, { body, params = '' } = {}) {
  const res = await fetch(`${url}/rest/v1/${path}${params}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${method} ${path} ${res.status}: ${t.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const rows = [];
let offset = 0;
for (;;) {
  const batch = await req('GET', 'inventory_items', {
    params:
      `?select=id,name,quantity,category_id,created_at,is_active,account_key&limit=1000&offset=${offset}`,
  });
  if (!batch?.length) break;
  rows.push(...batch);
  if (batch.length < 1000) break;
  offset += 1000;
}

const named = rows.filter(
  (r) =>
    String(r.name || '').trim() &&
    !String(r.name || '').toLowerCase().includes('(dup)'),
);

const groups = new Map();
for (const r of named) {
  const k = `${r.account_key || 'default'}::${norm(r.name)}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const dupGroups = [...groups.entries()].filter(([, v]) => v.length >= 2);
const activeCount = named.filter((r) => r.is_active !== false).length;
console.log(
  `Total: ${rows.length} | named: ${named.length} | active: ${activeCount} | dup groups: ${dupGroups.length}` +
    (dryRun ? ' [DRY-RUN]' : ''),
);

for (const [k, items] of dupGroups
  .slice()
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 25)) {
  const [, nameKey] = k.split('::');
  const flags = items
    .map((i) => `${i.is_active === false ? 'OFF' : 'ON'}:${i.name}`)
    .join(' | ');
  console.log(`  x${items.length} ${nameKey} -> ${flags}`);
}

/** Keep one winner (prefer active, category, qty, older). Soft-delete rest; hard-delete already-inactive extras. */
const softLosers = [];
const hardLosers = [];
for (const [, items] of dupGroups) {
  const ranked = items.slice().sort((a, b) => {
    const act = (b.is_active !== false ? 1 : 0) - (a.is_active !== false ? 1 : 0);
    if (act) return act;
    const cat = (b.category_id ? 1 : 0) - (a.category_id ? 1 : 0);
    if (cat) return cat;
    const q = Number(b.quantity || 0) - Number(a.quantity || 0);
    if (q) return q;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
  const [winner, ...rest] = ranked;
  for (const r of rest) {
    if (r.is_active === false) hardLosers.push(r);
    else softLosers.push(r);
  }
  // if winner somehow inactive but rest exist — keep winner inactive, hard-delete rest already handled
  void winner;
}

console.log(
  `Soft-delete active extras: ${softLosers.length} | Hard-delete inactive extras: ${hardLosers.length}`,
);

if (dryRun) {
  console.log('Dry-run only — no changes written.');
  process.exit(0);
}

let n = 0;
for (const r of softLosers) {
  await req('PATCH', 'inventory_items', {
    body: { is_active: false },
    params: `?id=eq.${r.id}`,
  });
  n += 1;
  if (n % 25 === 0 || n === softLosers.length) console.log(`  soft ${n}/${softLosers.length}`);
}
let h = 0;
for (const r of hardLosers) {
  await req('DELETE', 'inventory_items', { params: `?id=eq.${r.id}` });
  h += 1;
  if (h % 25 === 0 || h === hardLosers.length) console.log(`  hard ${h}/${hardLosers.length}`);
}
console.log('DONE soft=', softLosers.length, 'hard=', hardLosers.length);
