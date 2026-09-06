/**
 * Seed trial + SIM_SUP dostawców dla konkretnego e-maila (Deal Hunter).
 * Usage: node scripts/seed_mithril_deal_hunter.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EMAIL = 'mithril.cane@gmail.com';
const SIM_TAG = '[SIM_SUP]';

function loadEnv() {
  for (const p of [resolve(ROOT, '.env'), resolve(ROOT, 'backend', '.env'), resolve(ROOT, '..', '.env')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].replace(/^['"]|['"]$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
}

loadEnv();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  ''
).trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Brak SUPABASE_URL / SERVICE_ROLE_KEY');
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function sb(method, table, { params, body, prefer } = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method,
    headers: prefer ? { ...headers, Prefer: prefer } : headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${table}: ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const SUPPLIERS = [
  { name: 'Makro Gastro Cash', category: 'Ogólnospożywczy', mult: 1.0, min: 1500, ship: 89, free: 2500, color: '#2563EB' },
  { name: 'EuroCash FoodService', category: 'Ogólnospożywczy', mult: 1.08, min: 800, ship: 49, free: 1200, color: '#DC2626' },
  { name: 'MEAT&FRESH Hurt', category: 'Mięso & Wędliny', mult: 0.88, min: 500, ship: 35, free: 900, color: '#7C3AED' },
  { name: 'Zielony Koszyk Fresh', category: 'Warzywa & Owoce', mult: 0.85, min: 300, ship: 25, free: 550, color: '#16A34A' },
  { name: 'DairyPro Nabiał', category: 'Nabiał & Sery', mult: 0.9, min: 400, ship: 30, free: 700, color: '#0891B2' },
  { name: 'Pantry & Bar Dry', category: 'Suche & Sypkie', mult: 0.92, min: 200, ship: 19, free: 450, color: '#D97706' },
];

function packsFor(unit) {
  const u = (unit || 'kg').toLowerCase();
  if (u === 'l' || u === 'ml') {
    return [
      { variant: '1 l', unit: 'l', unit_count: 1, liters_total: 1, kg_total: 0, qty: 1 },
      { variant: '5 l', unit: 'l', unit_count: 1, liters_total: 5, kg_total: 0, qty: 5 },
    ];
  }
  if (u === 'szt' || u === 'opak') {
    return [
      { variant: '1 szt', unit: 'szt', unit_count: 1, liters_total: 0, kg_total: 0, qty: 1 },
      { variant: 'opak. 10 szt', unit: 'opak', unit_count: 10, liters_total: 0, kg_total: 0, qty: 10 },
    ];
  }
  return [
    { variant: '1 kg', unit: 'kg', unit_count: 1, liters_total: 0, kg_total: 1, qty: 1 },
    { variant: '5 kg', unit: 'kg', unit_count: 1, liters_total: 0, kg_total: 5, qty: 5 },
  ];
}

function basePrice(name, unit) {
  const n = (name || '').toLowerCase();
  if (/wołow|steak|łosoś|krewet/.test(n)) return 55;
  if (/kurczak|indyk|mięso|szynka/.test(n)) return 22;
  if (/ser|mozzarella|śmietan|mleko|jaj/.test(n)) return 18;
  if (/oliw|olej/.test(n)) return 28;
  if (/pomidor|cebula|sałat|ogórek|ziemniak/.test(n)) return 6;
  if ((unit || '').toLowerCase() === 'l') return 12;
  if ((unit || '').toLowerCase() === 'szt') return 3;
  return 14;
}

async function main() {
  const profiles = await sb('GET', 'profiles', {
    params: { select: 'id,email,account_key', email: `ilike.${EMAIL}`, limit: '1' },
  });
  if (!profiles?.length) throw new Error(`Brak profilu ${EMAIL}`);
  const ak = profiles[0].account_key;
  console.log('account_key=', ak);

  const ends = new Date(Date.now() + 30 * 864e5).toISOString();
  const subs = await sb('GET', 'subscriptions', {
    params: { select: 'id,credits_balance,trial_ends_at,tier_level', account_key: `eq.${ak}`, limit: '1' },
  });
  const patch = { trial_ends_at: ends, updated_at: new Date().toISOString() };
  const credits = Number(subs?.[0]?.credits_balance || 0);
  if (credits < 500) patch.credits_balance = 500;
  if (subs?.length) {
    await sb('PATCH', 'subscriptions', { params: { account_key: `eq.${ak}` }, body: patch });
  } else {
    await sb('POST', 'subscriptions', {
      body: {
        account_key: ak,
        tier_level: 0,
        credits_balance: 500,
        trial_ends_at: ends,
        status: 'active',
        free_starter_claimed: true,
      },
    });
  }
  console.log('trial_ends_at=', ends, 'credits_balance>=', patch.credits_balance ?? credits);

  // wipe poprzednie SIM_SUP tego tenanta
  const old = await sb('GET', 'suppliers', {
    params: {
      select: 'id',
      account_key: `eq.${ak}`,
      notes: `like.*${SIM_TAG}*`,
      limit: '100',
    },
  });
  for (const s of old || []) {
    await sb('DELETE', 'supplier_catalog', {
      params: { supplier_id: `eq.${s.id}` },
      prefer: 'return=minimal',
    }).catch(() => null);
    await sb('DELETE', 'suppliers', {
      params: { id: `eq.${s.id}` },
      prefer: 'return=minimal',
    });
  }
  console.log('wiped SIM_SUP:', (old || []).length);

  const inv = await sb('GET', 'inventory_items', {
    params: {
      select: 'id,name,unit,unit_cost',
      account_key: `eq.${ak}`,
      limit: '2000',
    },
  });
  const products = (inv || []).filter((i) => (i.name || '').trim());
  console.log('inventory products:', products.length);
  if (!products.length) throw new Error('Magazyn pusty — dodaj produkty albo uruchom bez --no-inventory w Pythonie');

  const supplierIds = [];
  for (let i = 0; i < SUPPLIERS.length; i++) {
    const s = SUPPLIERS[i];
    const row = await sb('POST', 'suppliers', {
      body: {
        account_key: ak,
        name: s.name,
        category: s.category,
        nip: `5250001${String(i + 1).padStart(3, '0')}`,
        contact_person: 'SIM Test',
        phone: `+48 22 111 22 ${String(i + 1).padStart(2, '0')}`,
        email: `sim${i + 1}@gastro-test.pl`,
        icon_color: s.color,
        notes: `${SIM_TAG} Seed Deal Hunter dla ${EMAIL}`,
        min_order_value: s.min,
        shipping_cost: s.ship,
        free_shipping_threshold: s.free,
        is_active: true,
      },
    });
    supplierIds.push({ id: Array.isArray(row) ? row[0].id : row.id, def: s });
    console.log('+', s.name);
  }

  const catalog = [];
  for (const p of products) {
    const name = p.name.trim();
    const unit = (p.unit || 'kg').toLowerCase();
    const base = Number(p.unit_cost) > 0 ? Number(p.unit_cost) : basePrice(name, unit);
    // każdy produkt u 2–3 dostawców
    const picks = [...supplierIds].sort(() => Math.random() - 0.5).slice(0, 2 + (Math.random() > 0.5 ? 1 : 0));
    for (const { id, def } of picks) {
      const packs = packsFor(unit);
      const pack = packs[Math.floor(Math.random() * packs.length)];
      const price = Math.round(base * def.mult * pack.qty * (0.94 + Math.random() * 0.12) * 100) / 100;
      catalog.push({
        supplier_id: id,
        name,
        variant: pack.variant,
        volume_label: pack.variant,
        unit: pack.unit,
        unit_count: pack.unit_count,
        price_pln: price,
        liters_total: pack.liters_total,
        kg_total: pack.kg_total,
        sort_order: catalog.length,
        is_visible: true,
      });
    }
  }

  for (let i = 0; i < catalog.length; i += 80) {
    const chunk = catalog.slice(i, i + 80);
    try {
      await sb('POST', 'supplier_catalog', { body: chunk, prefer: 'return=minimal' });
    } catch (e) {
      const slim = chunk.map(({ kg_total, ...r }) => r);
      await sb('POST', 'supplier_catalog', { body: slim, prefer: 'return=minimal' });
    }
    console.log('catalog batch', i / 80 + 1, chunk.length);
  }

  console.log('DONE suppliers=', supplierIds.length, 'catalog=', catalog.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
