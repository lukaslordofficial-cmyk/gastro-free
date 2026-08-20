/**
 * Smoke: normalizeIngredientName — „ser biały” nie może stać się „ser ser”.
 * node frontend/scripts/smoke_normalize_ingredient_name.mjs
 *
 * Logika zsynchronizowana z frontend/lib/fuzzyProductMatch.ts (SINGULAR_DISPLAY + productTokens).
 */

const STOP = new Set([
  'a', 'i', 'z', 'ze', 'w', 'we', 'na', 'do', 'od', 'po', 'pod', 'nad', 'przy',
  'bez', 'dla', 'oraz', 'lub', 'albo', 'the', 'of', 'and', 'with', 'de', 'la',
  'swiezy', 'swieze', 'swieza', 'fresh', 'bio', 'eko', 'premium', 'classic',
  'extra', 'light', 'opak', 'opakowanie', 'virgin', 'organic', 'selection',
  'rolka', 'rolki', 'rolke', 'kostka', 'kostki', 'blok', 'bloki', 'plastry',
]);

const SYNONYM = {
  sera: 'ser', serem: 'ser', sery: 'ser', cheese: 'ser',
  pomidory: 'pomidor', pomidorow: 'pomidor', pomidora: 'pomidor',
  jajka: 'jajko', jajek: 'jajko',
};

const SINGULAR_DISPLAY = {
  pomidor: 'pomidor',
  jajko: 'jajko',
  ser: 'ser',
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

function normalizeIngredientName(raw) {
  const trimmed = (raw || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;
  const tokens = productTokens(trimmed);
  if (!tokens.length) return trimmed;
  if (tokens.length === 1) {
    return SINGULAR_DISPLAY[tokens[0]] ?? trimmed;
  }
  const parts = trimmed.split(/\s+/);
  const lastRaw = parts[parts.length - 1] || '';
  if (!/y$|i$|e$|ów$|ow$/i.test(lastRaw)) return trimmed;
  const lastTok = productTokens(lastRaw)[0];
  const lastDisp = lastTok ? SINGULAR_DISPLAY[lastTok] : undefined;
  if (!lastDisp) return trimmed;
  parts[parts.length - 1] = lastDisp;
  return parts.join(' ');
}

let failed = 0;
function assertEq(input, expected) {
  const got = normalizeIngredientName(input);
  if (got !== expected) {
    console.error(`FAIL normalize("${input}") → "${got}" (expected "${expected}")`);
    failed++;
  } else {
    console.log(`OK  "${input}" → "${got}"`);
  }
}

assertEq('ser biały', 'ser biały');
assertEq('ser bialy', 'ser bialy');
assertEq('pomidory', 'pomidor');
// „świeże” jest STOP → zostaje jeden token „pomidor”
assertEq('świeże pomidory', 'pomidor');
assertEq('jajka', 'jajko');
assertEq('czerwone pomidory', 'czerwone pomidor');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll normalizeIngredientName smoke cases passed.');
