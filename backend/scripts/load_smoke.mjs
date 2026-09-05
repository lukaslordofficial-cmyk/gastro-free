/**
 * Node load smoke (gdy brak Pythona na maszynie).
 * node backend/scripts/load_smoke.mjs --base https://xxx.up.railway.app --users 10 --requests 80
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    users: { type: 'string', default: '10' },
    requests: { type: 'string', default: '100' },
    path: { type: 'string', default: '/api/health' },
  },
});

const base = (values.base || '').replace(/\/$/, '');
const concurrency = Math.max(1, Number(values.users) || 10);
const total = Math.max(1, Number(values.requests) || 100);
const path = values.path || '/api/health';
const url = `${base}${path}`;

if (!base) {
  console.error('Podaj --base https://...');
  process.exit(1);
}

async function hit() {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return { ms: performance.now() - t0, code: r.status };
  } catch {
    return { ms: performance.now() - t0, code: 0 };
  }
}

async function run() {
  const latencies = [];
  const codes = {};
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < total) {
      const idx = i++;
      if (idx >= total) break;
      const { ms, code } = await hit();
      latencies.push(ms);
      codes[code] = (codes[code] || 0) + 1;
    }
  });
  const t0 = performance.now();
  await Promise.all(workers);
  const elapsed = (performance.now() - t0) / 1000;
  latencies.sort((a, b) => a - b);
  const pct = (p) => {
    if (!latencies.length) return 0;
    const i = Math.min(latencies.length - 1, Math.round((p / 100) * (latencies.length - 1)));
    return latencies[i];
  };
  const rps = elapsed ? total / elapsed : 0;
  const result = {
    path,
    concurrency,
    total,
    elapsed_s: Math.round(elapsed * 100) / 100,
    rps: Math.round(rps * 10) / 10,
    p50_ms: Math.round(pct(50) * 10) / 10,
    p95_ms: Math.round(pct(95) * 10) / 10,
    p99_ms: Math.round(pct(99) * 10) / 10,
    status_counts: codes,
  };
  console.log(`Load: ${concurrency} concurrent × ${total} → ${url}`);
  for (const [k, v] of Object.entries(result)) console.log(`  ${k}:`, v);
  const safe = rps * 0.8;
  console.log(`
Zmierzono ~${result.rps} RPS (p95=${result.p95_ms} ms) na lekkim endpoincie.
Bezpieczny bufor ~${Math.round(safe)} RPS → orientacyjnie:
  • 10 użytkowników (1 req/s) — OK jeśli < ${Math.round(safe)} RPS
  • 50 użytkowników (0.5 req/s ≈ 25 RPS) — ${safe >= 25 ? 'OK' : 'ryzyko'}
  • 200 użytkowników (0.5 req/s ≈ 100 RPS) — ${safe >= 100 ? 'OK' : 'potrzebny scaling (więcej workerów / Railway)'}
Uwaga: skany Vision/OCR są 10–50× cięższe — limituj równoległe skany kredytami + queue.

Multi-user / to samo konto:
  • Ten sam e-mail+hasło na telefonie barmana i tablecie kuchni = OK (Supabase multi-session).
  • Osobne konta pracowników ze wspólnym magazynem = jeszcze NIE (1 user = 1 account_key).
  • Role (barman/kucharz/manager) = roadmapa team/invite, na razie współdzielcie login restauracji.
`);
}

await run();
