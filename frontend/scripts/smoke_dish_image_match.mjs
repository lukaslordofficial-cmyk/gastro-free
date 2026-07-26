/**
 * Smoke matcher — czysty Node (bez tsx / aliasów).
 * node frontend/scripts/smoke_dish_image_match.mjs
 *
 * Inline port of dishImageMatch.ts (keep in sync).
 */

const STOP = new Set(['a', 'i', 'z', 'ze', 'w', 'na', 'do', 'od', 'po', 'dla', 'the', 'of', 'and', 'with', 'de', 'la']);

function normalizeDishName(raw) {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(normalized) {
  return normalized.split(' ').filter((t) => t.length >= 3 && !STOP.has(t));
}

function detectDishFamily(name) {
  const n = normalizeDishName(name);
  if (/\b(sos|sauce|aioli|gravy|bbq|demi glace|bearnaise|holendersk|bernensk|fondue|satay|bolognese|carbonara)\b/.test(n) || n.startsWith('sos ')) {
    return 'sauces';
  }
  if (/\b(zupa|krem|rosol|barszcz|zurek|flaki|chowder|bisque|gazpacho|bulion|chlodnik|krupnik|kapusniak|grochowk|pho|ramen|miso|tom yum|tom kha)\b/.test(n)) {
    return 'soups';
  }
  if (/\b(filet|piers|kurczak|schab|kotlet|stek|zeberk|wolow|wieprz|indyk|kaczka|de volaille|poledwic|antrykot)\b/.test(n)) {
    return 'meat';
  }
  return 'other';
}

function familyFromEntry(entry) {
  const pathS = `${entry.storagePath} ${entry.slug}`.toLowerCase();
  if (/sauce|sosy|dipy/.test(pathS)) return 'sauces';
  if (/soup|zupa/.test(pathS)) return 'soups';
  return detectDishFamily(entry.labelPl);
}

function tokenOverlapScore(qTokens, cTokens) {
  if (!qTokens.length || !cTokens.length) return 0;
  const cSet = new Set(cTokens);
  let hit = 0;
  for (const t of qTokens) {
    if (cSet.has(t)) {
      hit += 1;
      continue;
    }
    if (t.length >= 5 && [...cSet].some((ct) => ct.length >= 5 && (ct.includes(t) || t.includes(ct)))) {
      hit += 0.85;
    }
  }
  const coverQ = hit / qTokens.length;
  const coverC = hit / cTokens.length;
  return Math.round(100 * (0.7 * coverQ + 0.3 * Math.min(coverC, 1)));
}

function bestCandidateScore(q, qTokens, entry) {
  const candidates = [entry.labelPl, ...entry.aliases, entry.slug.replace(/_/g, ' ')].map(normalizeDishName);
  let best = 0;
  for (const c of candidates) {
    if (!c) continue;
    if (q === c) return 100;
    const cTokens = significantTokens(c);
    if (qTokens.length >= 2 && qTokens.every((t) => cTokens.includes(t) || c.includes(t))) {
      best = Math.max(best, 92);
      continue;
    }
    if (qTokens.length === 1 && cTokens.includes(qTokens[0]) && cTokens.length <= 3) {
      best = Math.max(best, 90);
      continue;
    }
    best = Math.max(best, tokenOverlapScore(qTokens, cTokens));
  }
  return best;
}

function findDishImageMatch(name, catalog) {
  const q = normalizeDishName(name);
  if (!q || !catalog.length) return undefined;
  const qTokens = significantTokens(q);
  const wantFamily = detectDishFamily(name);

  for (const entry of catalog) {
    const labels = [entry.labelPl, ...entry.aliases].map(normalizeDishName);
    if (labels.includes(q)) return { slug: entry.slug, score: 100, entry };
  }

  const ranked = [];
  for (const entry of catalog) {
    let score = bestCandidateScore(q, qTokens, entry);
    if (score <= 0) continue;
    const fam = familyFromEntry(entry);
    if (wantFamily !== 'other' && fam === wantFamily) score = Math.min(100, score + 8);
    else if (wantFamily !== 'other' && fam !== 'other' && fam !== wantFamily) score = Math.max(0, score - 25);
    if (score >= 85) ranked.push({ slug: entry.slug, score, entry });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0];
}

const CATALOG = [
  { slug: 'sos_smietankowo_ziolowy', labelPl: 'Sos śmietankowo-ziołowy', aliases: ['sos śmietankowy', 'cream herb sauce'], storagePath: 'dania/sauces/sauce_01.webp' },
  { slug: 'sos_aioli_pieczony_czosnek', labelPl: 'Sos czosnkowy aioli z pieczonym czosnkiem', aliases: ['aioli', 'sos czosnkowy', 'garlic aioli'], storagePath: 'dania/sauces/sauce_15.webp' },
  { slug: 'hummus_klasyczny', labelPl: 'Hummus klasyczny', aliases: ['hummus', 'hummus z czosnkiem'], storagePath: 'dania/mediterranean/mediterranean_20.webp' },
  { slug: 'hummus_veg_sticks', labelPl: 'Hummus z warzywami', aliases: ['hummus', 'pasta sezamowa'], storagePath: 'dania/starters/starter_06.webp' },
  { slug: 'rosol', labelPl: 'Rosół', aliases: ['rosół', 'chicken soup'], storagePath: 'dania/soups_pl/soup_pl_01.webp' },
  { slug: 'zupa_ogorkowa_pl', labelPl: 'Zupa ogórkowa', aliases: ['ogórkowa', 'pickle soup'], storagePath: 'dania/soups_polish/soup_pl_classic_01.webp' },
];

let failed = 0;
const cases = [
  { name: 'Sos śmietankowo-ziołowy', expectSlug: 'sos_smietankowo_ziolowy', expectFamily: 'sauces' },
  { name: 'sos śmietankowo ziołowy', expectSlug: 'sos_smietankowo_ziolowy' },
  { name: 'Sos czosnkowy aioli', expectSlug: 'sos_aioli_pieczony_czosnek', rejectSlug: 'hummus_klasyczny' },
  { name: 'hummus', expectSlug: 'hummus_klasyczny' },
  { name: 'Zupa ogórkowa', expectSlug: 'zupa_ogorkowa_pl', expectFamily: 'soups' },
  { name: 'Filet z piersi kurczaka', expectFamily: 'meat', rejectSlug: 'rosol' },
  { name: 'losowy krem czosnkowy xyz', rejectSlug: 'hummus_klasyczny' },
];

for (const c of cases) {
  if (c.expectFamily) {
    const fam = detectDishFamily(c.name);
    if (fam !== c.expectFamily) {
      console.error(`FAIL family "${c.name}": got ${fam}, want ${c.expectFamily}`);
      failed++;
    }
  }
  const hit = findDishImageMatch(c.name, CATALOG);
  if (c.expectSlug) {
    if (hit?.slug !== c.expectSlug) {
      console.error(`FAIL match "${c.name}": got ${hit?.slug ?? 'undefined'} (score=${hit?.score}), want ${c.expectSlug}`);
      failed++;
    } else {
      console.log(`OK  ${c.name} → ${hit.slug} (${hit.score})`);
    }
  } else if (!hit) {
    console.log(`OK  ${c.name} → no strong match`);
  }
  if (c.rejectSlug && hit?.slug === c.rejectSlug) {
    console.error(`FAIL reject "${c.name}" matched forbidden ${c.rejectSlug}`);
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll smoke cases passed.');
