/**
 * Smoke / random dish image matching — family hit-rate.
 *
 * Usage:
 *   node frontend/scripts/smoke_dish_image_family.mjs
 *
 * Inline port of dishImageMatch.ts key rules (keep aligned).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, '..');

const STOP = new Set(['a', 'i', 'z', 'ze', 'w', 'na', 'do', 'od', 'po', 'dla', 'the', 'of', 'and', 'with', 'de', 'la']);
const WEAK_COOK = new Set(['pieczeń', 'pieczone', 'pieczony', 'grill', 'bbq', 'mięso pieczone', 'mieso pieczone', 'danie główne', 'danie glowne', 'chrupiące', 'chrupiace', 'obiad']);
const PROTEINS = ['kaczka', 'kurczak', 'indyk', 'wołowina', 'wieprzowina', 'ryba', 'owoce morza', 'wege'];

function normalize(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/ą/g, 'a')
    .replace(/ę/g, 'e')
    .replace(/ó/g, 'o')
    .replace(/ń/g, 'n')
    .replace(/ś/g, 's')
    .replace(/ć/g, 'c')
    .replace(/ź|ż/g, 'z')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(t) {
  let s = normalize(t);
  const pairs = [
    [/kaczk\w*/, 'kaczka'], [/kurczak\w*/, 'kurczak'], [/wolow\w*|beef/, 'wolowina'],
    [/wieprz\w*|schab\w*/, 'wieprzowina'], [/frytk\w*|fries/, 'frytki'],
    [/ziemni\w*|potato/, 'ziemniak'], [/pieczon\w*|roast/, 'pieczone'],
  ];
  for (const [re, rep] of pairs) if (re.test(s)) return rep;
  return s;
}

function tokens(n) {
  return n.split(' ').filter((t) => t.length >= 3 && !STOP.has(t));
}

function detectFamily(name) {
  const n = normalize(name);
  if (/\b(zupa|krem|rosol|barszcz|zurek|gazpacho|bulion|pho|ramen)\b/.test(n)) return 'soups';
  if (/\b(burger)\b/.test(n)) return 'burgers';
  if (/\b(makaron|pasta|spaghetti)\b/.test(n)) return 'pasta';
  if (/\b(pizza)\b/.test(n)) return 'pizza';
  if (/\b(salatk|salad)\b/.test(n)) return 'salad';
  if (/\b(frytk|fries|ziemniak|potato|batat|coleslaw|surowk|warzyw.*grill|dodatk)\b/.test(n)) return 'sides';
  if (/\b(deser|ciasto|lody|tiramisu)\b/.test(n)) return 'dessert';
  if (/\b(filet|piers|kurczak|schab|kotlet|stek|zeberk|wolow|wieprz|indyk|kaczka|poledwic|udko|udo|piecen|roast|boczek)\b/.test(n)) return 'meat';
  return 'other';
}

function extractTags(name) {
  const n = normalize(name);
  const tags = new Set();
  const rules = [
    [/\bkaczk/, ['kaczka']],
    [/\b(kurczak|chicken|nugget|de volaille)/, ['kurczak']],
    [/\b(wolow|beef|stek|ribeye|tatar|piecen wol)/, ['wołowina']],
    [/\b(piecen)\b/, ['mięso']],
    [/\b(wieprz|schab|golonk|boczek|zeberk)/, ['wieprzowina']],
    [/\b(ryb|losos|dorsz|tunczyk|fish|sushi)/, ['ryba']],
    [/\b(wege|vegan|tofu)/, ['wege']],
    [/\b(zupa|rosol|barszcz|zurek|gazpacho|ramen|pho|krem z )/, ['zupa']],
    [/\bburger/, ['burger']],
    [/\bpizza/, ['pizza']],
    [/\b(makaron|pasta|spaghetti)/, ['makaron']],
    [/\bsalatk|salad/, ['sałatka']],
    [/\b(deser|ciasto|lody)/, ['deser']],
    [/\b(frytk|fries)/, ['frytki']],
    [/\b(ziemniak|potato|batat)/, ['ziemniak']],
  ];
  for (const [re, add] of rules) if (re.test(n)) add.forEach((t) => tags.add(t));
  return [...tags];
}

function familyKey(name) {
  const tags = extractTags(name);
  const fam = detectFamily(name);
  if (tags.includes('kaczka')) return 'duck';
  if (tags.includes('kurczak')) return 'chicken';
  if (tags.includes('wołowina')) return 'beef';
  if (tags.includes('wieprzowina')) return 'pork';
  if (tags.includes('ryba')) return 'fish';
  if (tags.includes('wege')) return 'veg';
  if (tags.includes('zupa') || fam === 'soups') return 'soup';
  if (tags.includes('burger') || fam === 'burgers') return 'burger';
  if (tags.includes('pizza') || fam === 'pizza') return 'pizza';
  if (tags.includes('makaron') || fam === 'pasta') return 'pasta';
  if (tags.includes('sałatka') || fam === 'salad') return 'salad';
  if (tags.includes('deser') || fam === 'dessert') return 'dessert';
  if (tags.includes('frytki') || tags.includes('ziemniak') || fam === 'sides') return 'sides';
  if (fam === 'meat') return 'meat';
  return 'other';
}

function compatible(a, b) {
  if (a === 'other' || b === 'other') return true;
  if (a === b) return true;
  const meatish = new Set(['meat', 'beef', 'pork', 'chicken', 'duck']);
  if (meatish.has(a) && meatish.has(b)) {
    if ((a === 'chicken' || a === 'duck') && (b === 'chicken' || b === 'duck')) return true;
    if (a === 'meat' || b === 'meat') return true;
    return false;
  }
  // Cezar z kurczakiem ≈ sałatka
  if ((a === 'salad' && b === 'chicken') || (a === 'chicken' && b === 'salad')) return true;
  return false;
}

function isSide(lib) {
  const blob = normalize(`${lib.primaryName} ${lib.slug} ${(lib.aliases || []).join(' ')}`);
  return /\b(frytk|fries|chips|ziemniak|potato|batat|coleslaw|surowk|warzywa grill|pieczone warzyw|puree|mix ziemni)\b/.test(blob)
    || /side|fries|frytk|ziemniak|potato|coleslaw/.test(normalize(lib.storagePath || ''));
}

function isSoup(lib) {
  const blob = normalize(`${lib.primaryName} ${lib.slug}`);
  return /\b(zupa|rosol|barszcz|gazpacho|bulion|krem z )\b/.test(blob) || /soup|zupa/.test(normalize(lib.storagePath || ''));
}

function effTags(lib) {
  let tags = [...(lib.fallbackTags || [])];
  if (isSide(lib)) {
    tags = tags.filter((t) => {
      const n = normalize(t);
      if (WEAK_COOK.has(n)) return false;
      if (/^(mieso|mięso|wolowina|wołowina|wieprzowina|kurczak|kaczka|indyk|bbq)$/.test(n)) return false;
      return true;
    });
  }
  return tags;
}

function imageHasTag(lib, tag) {
  const want = normalize(tag);
  const st = stem(want);
  for (const t of effTags(lib)) {
    const nt = normalize(t);
    if (nt === want || stem(nt) === st) return true;
  }
  const blob = normalize(`${lib.primaryName} ${lib.slug} ${(lib.aliases || []).join(' ')}`);
  return blob.includes(want) || blob.split(' ').some((w) => stem(w) === st);
}

function conflict(lib, dishTags) {
  const dish = dishTags.map(normalize);
  const forbid = new Set((lib.forbiddenTags || []).map(normalize));
  for (const t of dish) if (forbid.has(t)) return true;
  if (dish.includes('zupa') && !isSoup(lib) && !effTags(lib).map(normalize).includes('zupa')) return true;
  const wantMeat = dish.some((t) => ['kaczka', 'kurczak', 'wołowina', 'wieprzowina', 'mięso', 'mieso', 'pieczeń'].includes(t));
  if (wantMeat && !dish.includes('zupa') && isSide(lib) && !dish.includes('frytki') && !dish.includes('ziemniak')) return true;
  // cross protein
  for (const p of PROTEINS) {
    if (!dish.some((t) => t === normalize(p) || stem(t) === stem(p))) continue;
    const rivals = {
      kaczka: ['wołowina', 'wieprzowina', 'kurczak', 'ryba'],
      kurczak: ['wołowina', 'wieprzowina', 'kaczka', 'ryba'],
      wołowina: ['wieprzowina', 'kurczak', 'kaczka', 'ryba'],
      wieprzowina: ['wołowina', 'kurczak', 'kaczka', 'ryba'],
      ryba: ['wołowina', 'wieprzowina', 'kurczak', 'kaczka'],
      wege: ['wołowina', 'wieprzowina', 'kurczak', 'kaczka', 'ryba'],
    }[p] || [];
    const eff = effTags(lib).map(normalize);
    if (rivals.some((r) => eff.includes(normalize(r)))) return true;
  }
  return false;
}

function bestScore(q, qTokens, lib) {
  const labels = [lib.primaryName, ...(lib.aliases || []), lib.slug.replace(/_/g, ' ')].map(normalize);
  let best = 0;
  for (const c of labels) {
    if (q === c) return 100;
    const ct = tokens(c);
    if (qTokens.length >= 2 && qTokens.every((t) => ct.includes(t) || c.includes(t) || ct.map(stem).includes(stem(t)))) {
      best = Math.max(best, 92);
      continue;
    }
    let hit = 0;
    const cStem = new Set(ct.map(stem));
    for (const t of qTokens) {
      if (ct.includes(t) || cStem.has(stem(t))) hit += 1;
    }
    if (qTokens.length) {
      best = Math.max(best, Math.round(100 * (0.7 * (hit / qTokens.length) + 0.3 * Math.min(hit / Math.max(ct.length, 1), 1))));
    }
  }
  return best;
}

function match(name, library) {
  const q = normalize(name);
  const qTokens = tokens(q);
  const contextTags = extractTags(name);
  const wantFam = detectFamily(name);

  for (const lib of library) {
    if (/opakowania|packaging/.test(lib.storagePath || '')) continue;
    if (conflict(lib, contextTags)) continue;
    const labels = [lib.primaryName, ...(lib.aliases || [])].map(normalize);
    if (labels.includes(q)) return { slug: lib.slug, name: lib.primaryName, tier: 'exact', score: 100 };
  }

  const exact = [];
  for (const lib of library) {
    if (/opakowania|packaging/.test(lib.storagePath || '')) continue;
    if (conflict(lib, contextTags)) continue;
    let score = bestScore(q, qTokens, lib);
    const imgFam = detectFamily(lib.primaryName);
    if (wantFam !== 'other' && imgFam === wantFam) score = Math.min(100, score + 10);
    else if (wantFam === 'meat' && isSide(lib)) score = Math.max(0, score - 60);
    else if (wantFam === 'soups' && !isSoup(lib)) score = Math.max(0, score - 50);
    else if (wantFam !== 'other' && imgFam !== 'other' && imgFam !== wantFam) score = Math.max(0, score - 28);
    if (score >= 85) exact.push({ slug: lib.slug, name: lib.primaryName, tier: 'exact', score });
  }
  exact.sort((a, b) => b.score - a.score);
  if (exact[0]) return exact[0];

  const proteins = ['kaczka', 'kurczak', 'wołowina', 'wieprzowina', 'ryba', 'wege', 'zupa', 'burger', 'pizza', 'makaron', 'frytki', 'ziemniak', 'deser', 'sałatka']
    .filter((p) => contextTags.map(normalize).includes(normalize(p)));
  const tagHits = [];
  for (const lib of library) {
    if (/opakowania|packaging/.test(lib.storagePath || '')) continue;
    if (conflict(lib, contextTags)) continue;
    let hit = 0;
    let strong = 0;
    for (const p of proteins) {
      if (imageHasTag(lib, p)) {
        hit += 1;
        if (!WEAK_COOK.has(normalize(p))) strong += 1;
      }
    }
    if (hit < 1) continue;
    if (proteins.some((p) => PROTEINS.includes(p)) && strong < 1) continue;
    let score = 55 + hit * 12 + strong * 6;
    if (wantFam === 'meat' && isSide(lib)) score -= 60;
    if (wantFam === 'soups' && !isSoup(lib)) score -= 50;
    tagHits.push({ slug: lib.slug, name: lib.primaryName, tier: 'tags', score });
  }
  tagHits.sort((a, b) => b.score - a.score);
  if (tagHits[0] && tagHits[0].score >= 55) return tagHits[0];

  // category-ish fallback from library by family
  const prefer = {
    duck: [/kaczka|duck/],
    chicken: [/kurczak|volaille|chicken/],
    beef: [/wolow|beef|stek|ribeye|tatar/],
    pork: [/schab|wieprz|kotlet|golonk/],
    fish: [/ryb|losos|dorsz|fish|tuna/],
    soup: [/zupa|rosol|gazpacho|soup/],
    sides: [/frytk|fries|ziemniak|warzywa_grill|coleslaw/],
    burger: [/burger/],
    pizza: [/pizza/],
    pasta: [/spaghetti|pasta|makaron/],
    salad: [/salad|salatk/],
    dessert: [/ciasto|deser|tiramisu|lody/],
    meat: [/kotlet|stek|schab|roast|grill/],
  };
  const key = familyKey(name);
  const regs = prefer[key] || [];
  for (const lib of library) {
    if (/opakowania|packaging/.test(lib.storagePath || '')) continue;
    if (conflict(lib, contextTags)) continue;
    const blob = `${lib.slug} ${lib.primaryName}`;
    if (regs.some((re) => re.test(blob))) {
      return { slug: lib.slug, name: lib.primaryName, tier: 'category', score: 45 };
    }
  }
  return { slug: undefined, name: undefined, tier: 'none', score: 0 };
}

const libPath = path.join(FRONTEND, 'assets', 'premium', 'imageLibrary.json');
const library = JSON.parse(fs.readFileSync(libPath, 'utf8')).images || [];

const FIXED_CASES = [
  'Kaczka pieczona z jabłkami',
  'Pieczeń wołowa',
  'Schab pieczony',
  'Zupa pomidorowa',
  'Rosół z makaronem',
  'Kotlet schabowy',
  'Frytki belgijskie',
  'Stek ribeye',
  'Dorsz smażony',
  'Burger wołowy',
  'Spaghetti bolognese',
  'Gazpacho',
  'Sałatka Cezar',
  'Kurczak pieczony',
  'Zupa ogórkowa',
  'Żeberka BBQ',
  'Tatar wołowy',
  'Łosoś grillowany',
  'Pizza Margherita',
  'Warzywa grillowane',
  'Krem z brokułów',
  'Udko z kaczki',
  'De volaille',
  'Golonka pieczona',
  'Fish and chips',
];

// Random sample from library primaryNames (diverse)
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
const rnd = seededRandom(20260801);
const pool = library.filter((i) => !/opakowania|packaging/.test(i.storagePath || ''));
const randomNames = [];
const used = new Set();
while (randomNames.length < 80 && used.size < pool.length) {
  const idx = Math.floor(rnd() * pool.length);
  const n = pool[idx].primaryName;
  if (!n || used.has(n)) continue;
  used.add(n);
  randomNames.push(n);
}

const allCases = [...FIXED_CASES, ...randomNames];
let hits = 0;
let misses = 0;
const failures = [];

console.log(`Library: ${library.length} images`);
console.log(`Cases: ${allCases.length} (${FIXED_CASES.length} fixed + ${randomNames.length} random)\n`);

for (const name of allCases) {
  const want = familyKey(name);
  const hit = match(name, library);
  const got = hit.name ? familyKey(hit.name) : 'none';
  const ok = hit.slug && compatible(want, got);
  if (ok) {
    hits += 1;
  } else {
    misses += 1;
    if (failures.length < 25) {
      failures.push({ name, want, got, slug: hit.slug, matched: hit.name, tier: hit.tier });
    }
  }
}

const rate = (100 * hits) / allCases.length;
console.log(`Hit rate (compatible family): ${hits}/${allCases.length} = ${rate.toFixed(1)}%`);

// Critical regressions
const critical = [
  { name: 'Pieczeń wołowa', rejectFam: ['sides', 'fish', 'pork'] },
  { name: 'Zupa pomidorowa', rejectFam: ['sides', 'meat', 'beef', 'pork'] },
  { name: 'Kaczka pieczona', rejectFam: ['sides', 'fish', 'pork', 'beef'] },
  { name: 'Frytki', rejectFam: ['soup', 'beef', 'duck'] },
];
let critFail = 0;
for (const c of critical) {
  const hit = match(c.name, library);
  const got = hit.name ? familyKey(hit.name) : 'none';
  if (!hit.slug || c.rejectFam.includes(got)) {
    console.error(`CRITICAL FAIL "${c.name}" → ${hit.name || 'none'} (${got})`);
    critFail += 1;
  } else {
    console.log(`CRITICAL OK  "${c.name}" → ${hit.name} [${got}]`);
  }
}

if (failures.length) {
  console.log('\nSample mismatches:');
  for (const f of failures.slice(0, 15)) {
    console.log(`  "${f.name}" (${f.want}) → ${f.matched || 'none'} (${f.got}) [${f.tier}]`);
  }
}

// Missing category placeholders report
const wantPlaceholders = [
  ['kotlet_de_volaille', 'chicken cutlet (de volaille)'],
  ['pieczona_kaczka', 'duck roast'],
  ['kotlet_schabowy', 'pork cutlet'],
  ['stek_ribeye', 'beef steak'],
  ['dorsz_pieczony', 'baked fish'],
  ['losos_maslo_ziolowe', 'salmon fillet'],
  ['rosol', 'broth soup'],
  ['zupa_pomidorowa', 'tomato soup'],
  ['french_fries', 'fries'],
  ['warzywa_grillowane', 'grilled veg'],
  ['garden_salad', 'salad'],
  ['classic_cheeseburger', 'burger'],
  ['spaghetti_carbonara', 'pasta'],
  ['pizza_margherita', 'pizza'],
  ['palki_bbq', 'chicken BBQ drums'],
];
const slugSet = new Set(library.map((i) => i.slug));
const missing = wantPlaceholders.filter(([s]) => !slugSet.has(s));
console.log('\nCategory placeholder assets:');
if (!missing.length) console.log('  All key placeholders present in imageLibrary.');
else {
  for (const [s, why] of missing) console.log(`  MISSING ${s} — ${why}`);
}

if (critFail || rate < 70) {
  console.error(`\nFAILED (crit=${critFail}, rate=${rate.toFixed(1)}%)`);
  process.exit(1);
}
console.log(`\nPASSED family smoke (rate ${rate.toFixed(1)}%).`);
