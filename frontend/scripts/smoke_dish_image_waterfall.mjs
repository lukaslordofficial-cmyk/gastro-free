/**
 * Smoke waterfall matcher — node frontend/scripts/smoke_dish_image_waterfall.mjs
 * Testuje exact / tags / category + duck cases + packaging reject.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// Inline port of key matcher pieces (keep aligned with dishImageMatch.ts)
const STOP = new Set(['a', 'i', 'z', 'ze', 'w', 'na', 'do', 'od', 'po', 'dla', 'the', 'of', 'and', 'with', 'de', 'la']);

function normalizeDishName(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemToken(t) {
  let s = normalizeDishName(t);
  const pairs = [
    [/kaczk\w*/, 'kaczka'],
    [/udk[oa]|ud[oa]/, 'udo'],
    [/jablk\w*/, 'jablko'],
    [/chrupiac\w*/, 'chrupiace'],
    [/pieczon\w*/, 'pieczone'],
    [/pekin\w*/, 'pekinska'],
  ];
  for (const [re, rep] of pairs) if (re.test(s)) return rep;
  return s;
}

function significantTokens(n) {
  return n.split(' ').filter((t) => t.length >= 3 && !STOP.has(t));
}

function extractDishContextTags(name) {
  const n = normalizeDishName(name);
  const tags = new Set();
  const rules = [
    [/\bkaczk/, ['kaczka', 'drób']],
    [/\b(udko|udo)\b/, ['udo', 'pieczeń']],
    [/\b(pieczon|roast)/, ['pieczeń']],
    [/\bchrupiac/, ['chrupiące']],
    [/\bjablk/, ['jabłko']],
    [/\bpekin/, ['kaczka', 'azja']],
    [/\bpomidor|tomato/, ['pomidor']],
    [/\bzupa|gazpacho/, ['zupa']],
    [/\bwege|vegan/, ['wege']],
  ];
  for (const [re, add] of rules) if (re.test(n)) add.forEach((t) => tags.add(t));
  return [...tags];
}

function imageHasTag(lib, tag) {
  const want = normalizeDishName(tag);
  const stem = stemToken(want);
  for (const t of lib.fallbackTags || []) {
    const nt = normalizeDishName(t);
    if (nt === want || stemToken(nt) === stem) return true;
  }
  const blob = normalizeDishName(`${lib.primaryName} ${lib.slug}`);
  return blob.includes(want) || blob.split(' ').some((w) => stemToken(w) === stem);
}

function tagsConflict(lib, dishTags) {
  const forbid = new Set((lib.forbiddenTags || []).map(normalizeDishName));
  for (const t of dishTags.map(normalizeDishName)) if (forbid.has(t)) return true;
  if (dishTags.map(normalizeDishName).includes('wege')) {
    const img = (lib.fallbackTags || []).map(normalizeDishName);
    if (img.some((t) => /kaczka|kurczak|wolowina|wieprzowina|mieso/.test(t))) return true;
  }
  return false;
}

function bestScore(q, qTokens, entry) {
  const labels = [entry.labelPl, ...(entry.aliases || []), entry.slug.replace(/_/g, ' ')].map(normalizeDishName);
  let best = 0;
  for (const c of labels) {
    if (q === c) return 100;
    const cTokens = significantTokens(c);
    if (qTokens.length >= 2 && qTokens.every((t) => cTokens.includes(t) || c.includes(t) || cTokens.map(stemToken).includes(stemToken(t)))) {
      best = Math.max(best, 92);
      continue;
    }
    let hit = 0;
    const cStem = new Set(cTokens.map(stemToken));
    for (const t of qTokens) {
      if (cTokens.includes(t) || cStem.has(stemToken(t))) hit += 1;
    }
    if (qTokens.length) best = Math.max(best, Math.round(100 * (0.7 * (hit / qTokens.length) + 0.3 * Math.min(hit / Math.max(cTokens.length, 1), 1))));
  }
  return best;
}

function matchWaterfall(name, catalog, library) {
  const q = normalizeDishName(name);
  const qTokens = significantTokens(q);
  const contextTags = extractDishContextTags(name);
  const bySlug = new Map(catalog.map((e) => [e.slug, e]));

  for (const entry of catalog) {
    if (/opakowania|packaging/.test(entry.storagePath || '')) continue;
    const labels = [entry.labelPl, ...(entry.aliases || [])].map(normalizeDishName);
    if (labels.includes(q)) return { slug: entry.slug, tier: 'exact', score: 100 };
  }

  const exact = [];
  for (const entry of catalog) {
    if (/opakowania|packaging/.test(entry.storagePath || '')) continue;
    const score = bestScore(q, qTokens, entry);
    if (score >= 85) exact.push({ slug: entry.slug, score, tier: 'exact' });
  }
  exact.sort((a, b) => b.score - a.score);
  if (exact[0]) return exact[0];

  const proteins = ['kaczka', 'kurczak', 'wege', 'zupa', 'pomidor'].filter((p) =>
    contextTags.map(normalizeDishName).includes(normalizeDishName(p)),
  );
  const tagHits = [];
  for (const lib of library) {
    if (/opakowania|packaging/.test(lib.storagePath || '')) continue;
    if (tagsConflict(lib, contextTags)) continue;
    if (!bySlug.has(lib.slug)) continue;
    let hit = 0;
    for (const p of proteins) if (imageHasTag(lib, p)) hit += 1;
    if (hit < 1) continue;
    tagHits.push({ slug: lib.slug, score: 55 + hit * 12, tier: 'tags' });
  }
  tagHits.sort((a, b) => b.score - a.score);
  if (tagHits[0]) return tagHits[0];

  if (contextTags.includes('kaczka')) {
    for (const s of ['pieczona_kaczka', 'udo_kaczki', 'kaczka_pekinska']) {
      if (bySlug.has(s)) return { slug: s, tier: 'category', score: 45 };
    }
  }
  return { slug: undefined, tier: 'none', score: 0 };
}

const libPath = path.join(FRONTEND, 'assets', 'premium', 'imageLibrary.json');
const library = JSON.parse(fs.readFileSync(libPath, 'utf8'));
const images = library.images || [];

const CATALOG = [
  { slug: 'pieczona_kaczka', labelPl: 'Pieczona kaczka', aliases: ['kaczka pieczona z jabłkami', 'kaczka z jabłkami'], storagePath: 'dania/dinners/dinner_04.webp' },
  { slug: 'udo_kaczki', labelPl: 'Pieczone udo z kaczki', aliases: ['chrupiące udko z kaczki', 'udko z kaczki'], storagePath: 'dania/roasts/roast_06.webp' },
  { slug: 'kaczka_pekinska', labelPl: 'Kaczka po pekińsku', aliases: ['kaczka pekinska'], storagePath: 'dania/asian/asian_18.webp' },
  { slug: 'kaczka_chrupiaca', labelPl: 'Chrupiące paski kaczki', aliases: ['chrupiąca kaczka'], storagePath: 'dania/asian/asian_08.webp' },
  { slug: 'zupa_pomidorowa', labelPl: 'Zupa pomidorowa', aliases: ['pomidorowa', 'tomato soup'], storagePath: 'dania/soups_pl/soup_pl_02.webp' },
  { slug: 'gazpacho', labelPl: 'Gazpacho', aliases: ['gazpacho'], storagePath: 'dania/soups_pl/soup_pl_25.webp' },
  { slug: 'stek_kalafior_chimichurri', labelPl: 'Stek z kalafiora', aliases: ['wege'], storagePath: 'dania/vegan/vegan_01.webp' },
  { slug: 'miska_zupa_papierowa', labelPl: 'Miska na zupę', aliases: ['miska zupa'], storagePath: 'opakowania/miska_zupa_papierowa.png' },
];

// Ensure library entries exist for duck slugs (from generated file)
const duckLibs = images.filter((i) => /kaczka|duck/.test(`${i.slug} ${i.primaryName}`));
console.log(`Library: ${images.length} images, duck-tagged ≈ ${duckLibs.length}`);

let failed = 0;
const cases = [
  { name: 'Kaczka pieczona z jabłkami', expectAny: ['pieczona_kaczka', 'kaczka_porcja', 'udo_kaczki', 'kaczka_pekinska'], reject: ['miska_zupa_papierowa'] },
  { name: 'Chrupiące udko z kaczki', expectAny: ['udo_kaczki', 'kaczka_chrupiaca', 'pieczona_kaczka', 'kaczka_pekinska'], reject: ['miska_zupa_papierowa'] },
  { name: 'Kaczka po pekińsku', expectAny: ['kaczka_pekinska'], reject: ['miska_zupa_papierowa'] },
  { name: 'Zupa pomidorowa', expectAny: ['zupa_pomidorowa', 'gazpacho'], reject: ['miska_zupa_papierowa'] },
  { name: 'Gazpacho', expectAny: ['gazpacho', 'zupa_pomidorowa'], reject: ['miska_zupa_papierowa'] },
];

for (const c of cases) {
  const hit = matchWaterfall(c.name, CATALOG, images);
  if (c.expectAny && !c.expectAny.includes(hit.slug)) {
    console.error(`FAIL "${c.name}" → ${hit.slug} (${hit.tier}) want one of ${c.expectAny.join('|')}`);
    failed++;
  } else {
    console.log(`OK  "${c.name}" → ${hit.slug} [${hit.tier}] score=${hit.score}`);
  }
  if (c.reject && c.reject.includes(hit.slug)) {
    console.error(`FAIL packaging "${c.name}"`);
    failed++;
  }
}

// Packaging never in library dish paths
const packInLib = images.filter((i) => /opakowania|packaging/.test(i.storagePath || ''));
if (packInLib.length) {
  console.error(`FAIL library contains packaging: ${packInLib.length}`);
  failed++;
} else {
  console.log('OK  library has no packaging paths');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll waterfall smoke cases passed.');
