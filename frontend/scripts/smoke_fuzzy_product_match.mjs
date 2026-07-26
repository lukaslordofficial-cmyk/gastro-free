/**
 * Smoke fuzzy product match — czysty Node.
 * node frontend/scripts/smoke_fuzzy_product_match.mjs
 */

const STOP = new Set([
  'a', 'i', 'z', 'ze', 'w', 'we', 'na', 'do', 'od', 'po', 'pod', 'nad', 'przy',
  'bez', 'dla', 'oraz', 'lub', 'albo', 'the', 'of', 'and', 'with', 'de', 'la',
  'swiezy', 'swieze', 'swieza', 'fresh', 'bio', 'eko', 'premium', 'classic',
  'extra', 'light', 'opak', 'opakowanie', 'virgin', 'organic', 'selection',
]);

const SYNONYM = {
  filet: 'piers', filety: 'piers', filetem: 'piers', filetu: 'piers',
  piersi: 'piers', piersiami: 'piers', piers: 'piers',
  kurczaka: 'kurczak', kurczakiem: 'kurczak', kurczaki: 'kurczak',
  drobiowy: 'kurczak', drobiowa: 'kurczak', drobiowe: 'kurczak',
  oliwek: 'oliw', oliwa: 'oliw', oliwy: 'oliw', olive: 'oliw',
};

function normalizePolish(raw) {
  return (raw || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lightStem(token) {
  if (SYNONYM[token]) return SYNONYM[token];
  const suffixes = ['ami', 'ach', 'owi', 'iem', 'ow', 'om', 'em', 'ie'];
  for (const suf of suffixes) {
    if (token.length > suf.length + 3 && token.endsWith(suf)) {
      const stem = token.slice(0, -suf.length);
      return SYNONYM[stem] ?? stem;
    }
  }
  if (token.length >= 6 && /[ayiue]$/.test(token)) {
    const stem = token.slice(0, -1);
    return SYNONYM[stem] ?? stem;
  }
  return token;
}

function productTokens(raw) {
  return [...new Set(
    normalizePolish(raw)
      .split(' ')
      .filter((t) => t.length >= 2 && !STOP.has(t))
      .map(lightStem)
      .filter((t) => t.length >= 2 && !STOP.has(t)),
  )].sort();
}

function productMatchKey(raw) {
  return productTokens(raw).join(' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

function tokenJaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const bSet = new Set(b);
  let inter = 0;
  for (const t of a) if (bSet.has(t)) inter += 1;
  const union = a.length + b.length - inter;
  return union > 0 ? inter / union : 0;
}

function softTokenOverlap(a, b) {
  if (!a.length || !b.length) return 0;
  let hit = 0;
  for (const t of a) {
    if (b.includes(t)) { hit += 1; continue; }
    if (t.length >= 4 && b.some((bt) => bt.length >= 4 && (bt.includes(t) || t.includes(bt) || levenshtein(t, bt) <= 1))) {
      hit += 0.85;
    }
  }
  return hit / a.length;
}

function scoreProductNames(a, b) {
  const ka = productMatchKey(a);
  const kb = productMatchKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 100;
  const ta = productTokens(a);
  const tb = productTokens(b);
  const jaccard = tokenJaccard(ta, tb);
  const cover = 0.55 * softTokenOverlap(ta, tb) + 0.45 * softTokenOverlap(tb, ta);
  const maxLen = Math.max(ka.length, kb.length);
  const levSim = maxLen > 0 ? 1 - levenshtein(ka, kb) / maxLen : 0;
  let score = 100 * (0.5 * cover + 0.35 * jaccard + 0.15 * levSim);
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  if (shorter.length >= 2 && shorter.every((t) => longer.includes(t) || longer.some((l) => l.includes(t) || t.includes(l)))) {
    score = Math.max(score, 88);
  }
  if (shorter.length === 1 && longer.includes(shorter[0]) && longer.length <= 3) {
    score = Math.max(score, 82);
  }
  return Math.round(Math.min(100, Math.max(0, score)));
}

let failed = 0;
const cases = [
  { a: 'Filet z piersi kurczaka', b: 'pierś z kurczaka', min: 72 },
  { a: 'oliwa z oliwek', b: 'Oliwa Extra Virgin', min: 72 },
  { a: 'mięso mielone wołowe', b: 'mielone wołowe', min: 72 },
  { a: 'Filet z piersi kurczaka', b: 'rosół z makaronem', max: 55 },
  { a: 'ser mozzarella', b: 'majonez', max: 50 },
];

for (const c of cases) {
  const score = scoreProductNames(c.a, c.b);
  if (c.min != null && score < c.min) {
    console.error(`FAIL "${c.a}" ↔ "${c.b}": score=${score} < ${c.min}`);
    failed++;
  } else if (c.max != null && score > c.max) {
    console.error(`FAIL "${c.a}" ↔ "${c.b}": score=${score} > ${c.max}`);
    failed++;
  } else {
    console.log(`OK  ${c.a} ↔ ${c.b} → ${score}`);
  }
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll fuzzy smoke cases passed.');
