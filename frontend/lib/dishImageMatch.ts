/**
 * Cascading dish image matcher (waterfall):
 *  1) Exact / near-exact primaryName / alias
 *  2) Strict fallbackTags (main protein) + forbiddenTags
 *  3) Category placeholder (never packaging / warehouse crates)
 *
 * Zachowuje tomato-family i family penalties z poprzedniej wersji.
 */
import type { DishImageEntry } from '@/lib/dishImagesCatalog';
import {
  getLibraryEntryBySlug,
  loadImageLibrary,
  type ImageLibraryEntry,
} from '@/lib/imageLibrary';

const STOP = new Set([
  'a', 'i', 'z', 'ze', 'w', 'na', 'do', 'od', 'po', 'dla',
  'the', 'of', 'and', 'with', 'de', 'la',
]);

/** Rodzina katalogu z storagePath / slug — do preferencji kategorii. */
export type DishFamily =
  | 'sauces'
  | 'soups'
  | 'burgers'
  | 'pasta'
  | 'pizza'
  | 'salad'
  | 'dessert'
  | 'drink'
  | 'meat'
  | 'sides'
  | 'other';

export type MatchTier = 'exact' | 'tags' | 'category';

export type DishMatchResult = {
  slug: string;
  score: number;
  entry: DishImageEntry;
  tier: MatchTier;
  /** Etykieta badge UI, np. „Drób” gdy placeholder / tag match */
  placeholderLabel?: string;
};

export function normalizeDishName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lekki stem PL dla mięs / części tuszy (udko↔udo, kaczki↔kaczka). */
export function stemToken(t: string): string {
  let s = normalizeDishName(t);
  if (s.length < 3) return s;
  const pairs: [RegExp, string][] = [
    [/kaczk\w*/, 'kaczka'],
    [/kurczak\w*|kurczac\w*/, 'kurczak'],
    [/indyk\w*/, 'indyk'],
    [/wolow\w*|beef/, 'wolowina'],
    [/wieprz\w*|schab\w*|golonk\w*/, 'wieprzowina'],
    [/udk[oa]|ud[oa]/, 'udo'],
    [/piersi?/, 'piers'],
    [/jablk\w*|apple/, 'jablko'],
    [/pomidor\w*|tomato/, 'pomidor'],
    [/chrupiac\w*|crispy/, 'chrupiace'],
    [/pieczon\w*|roast/, 'pieczone'],
    [/pekin\w*|peking/, 'pekinska'],
  ];
  for (const [re, rep] of pairs) {
    if (re.test(s)) return rep;
  }
  if (s.endsWith('ami') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('ach') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('ami')) s = s.slice(0, -3);
  else if ((s.endsWith('ki') || s.endsWith('ka')) && s.length > 4) s = s.slice(0, -1);
  else if (s.endsWith('y') && s.length > 4) s = s.slice(0, -1);
  return s;
}

export function significantTokens(normalized: string): string[] {
  return normalized
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

export function detectDishFamily(name: string): DishFamily {
  const n = normalizeDishName(name);
  if (/\b(sos|sauce|aioli|gravy|bbq|demi glace|bearnaise|holendersk|bernensk|fondue|satay|bolognese|carbonara)\b/.test(n) || n.startsWith('sos ')) {
    return 'sauces';
  }
  if (/\b(zupa|krem|rosol|barszcz|zurek|flaki|chowder|bisque|gazpacho|bulion|chlodnik|krupnik|kapusniak|grochowk|pho|ramen|miso|tom yum|tom kha)\b/.test(n)) {
    return 'soups';
  }
  if (/\b(pomidorow|tomato|gazpacho|passata|marinara|arrabbiata|napoletana|napoli)\b/.test(n)) {
    if (/\b(sos|sauce|dip)\b/.test(n) || n.startsWith('sos ')) return 'sauces';
    return 'soups';
  }
  if (/\b(burger|sandwich|kanapka|bagel|panini)\b/.test(n)) return 'burgers';
  if (/\b(makaron|pasta|spaghetti|tagliatelle|penne|lasagne|ravioli|gnocchi)\b/.test(n)) return 'pasta';
  if (/\b(pizza|calzone)\b/.test(n)) return 'pizza';
  if (/\b(salatk|salad)\b/.test(n)) return 'salad';
  if (/\b(warzyw.*grill|grillowan.*warzyw|pieczon.*warzyw|sides|surowk|coleslaw|frytk|dodatk)\b/.test(n)) {
    return 'sides';
  }
  if (/\b(ciasto|tort|deser|lody|pancake|nalesnik|tiramisu|panna cotta)\b/.test(n)) return 'dessert';
  if (/\b(kawa|herbata|lemoniad|sok |smoothie|drink|koktajl|piwo|wino|energetyk|cola|woda)\b/.test(n)) return 'drink';
  if (
    /\b(filet|piers|kurczak|schab|kotlet|stek|zeberk|wolow|wieprz|indyk|kaczka|de volaille|poledwic|antrykot|karkowk|udziec|udko|udo|skrzyde|nugget|confitur|glazur|boczek)\b/.test(n)
  ) {
    return 'meat';
  }
  return 'other';
}

/** Rodzina czerwonych / pomidorowych zup i sosów. */
export function isRedTomatoFamily(name: string): boolean {
  const n = normalizeDishName(name);
  return /\b(pomidor|tomato|gazpacho|passata|marinara|arrabbiata|napoletana|napoli|ketchup|salsa roja|sos pomidor)\b/.test(n);
}

function familyFromEntry(entry: DishImageEntry): DishFamily {
  const mf = (entry as DishImageEntry & { menuFamily?: string }).menuFamily;
  if (mf === 'zupy') return 'soups';
  if (mf === 'burgery') return 'burgers';
  if (mf === 'makarony') return 'pasta';
  if (mf === 'pizze') return 'pizza';
  if (mf === 'salatki') return 'salad';
  if (mf === 'sides') return 'sides';
  if (mf === 'napoje') return 'drink';
  if (mf === 'desery') return 'dessert';
  if (mf === 'sosy') return 'sauces';
  if (mf === 'miesa' || mf === 'bbq') return 'meat';
  const path = `${entry.storagePath} ${entry.slug}`.toLowerCase();
  if (/sauce|sosy|dipy/.test(path)) return 'sauces';
  if (/soup|zupa/.test(path)) return 'soups';
  if (/burger/.test(path)) return 'burgers';
  if (/pasta|makaron/.test(path)) return 'pasta';
  if (/pizza/.test(path)) return 'pizza';
  if (/salad|salatk/.test(path)) return 'salad';
  if (/side|warzywa_grill|surowk/.test(path)) return 'sides';
  if (/dessert|cake|ice_cream|pancake|pastr|french_dessert/.test(path)) return 'dessert';
  if (/coffee|tea|lemonade|juice|cocktail|beer|wine|spirit|energy/.test(path)) return 'drink';
  if (/steak|meat|mieso|grill|bbq|kotlet|schab|kurczak|beef|pork|ribs|roast/.test(path) && !/soup|zupa/.test(path)) {
    return 'meat';
  }
  return detectDishFamily(entry.labelPl);
}

const WEAK_ALONE = new Set([
  'kurczak', 'wolow', 'wieprz', 'indyk', 'mieso', 'ryba', 'ser', 'sos', 'zupa', 'krem',
]);

/** Główne tagi białka / diety z nazwy dania (+ opcjonalne AI tags). */
export function extractDishContextTags(name: string, extraTags: string[] = []): string[] {
  const n = normalizeDishName(name);
  const tags = new Set<string>();
  const rules: { re: RegExp; tags: string[] }[] = [
    { re: /\bkaczk/, tags: ['kaczka', 'drób', 'mięso pieczone', 'ptactwo'] },
    { re: /\b(kurczak|chicken|nugget|de volaille)/, tags: ['kurczak', 'drób'] },
    { re: /\bindyk/, tags: ['indyk', 'drób'] },
    { re: /\b(wolow|beef|stek|ribeye|tatar)/, tags: ['wołowina', 'mięso'] },
    { re: /\b(wieprz|schab|golonk|boczek|zeberk)/, tags: ['wieprzowina', 'mięso'] },
    { re: /\b(ryb|losos|dorsz|pstrag|tunczyk|fish)/, tags: ['ryba'] },
    { re: /\b(krewet|owoc.?morz)/, tags: ['owoce morza', 'ryba'] },
    { re: /\b(wege|vegan|tofu|falafel)/, tags: ['wege'] },
    { re: /\b(zupa|rosol|barszcz|zurek|gazpacho|ramen|pho)/, tags: ['zupa'] },
    { re: /\bpomidor|tomato/, tags: ['pomidor', 'czerwone'] },
    { re: /\bburger/, tags: ['burger'] },
    { re: /\bpizza/, tags: ['pizza'] },
    { re: /\b(makaron|pasta|spaghetti)/, tags: ['makaron'] },
    { re: /\bsalatk|salad/, tags: ['sałatka'] },
    { re: /\b(pierog|kluski|kopytk)/, tags: ['pierogi'] },
    { re: /\bsos |sauce/, tags: ['sos'] },
    { re: /\b(deser|ciasto|lody|tiramisu)/, tags: ['deser'] },
    { re: /\b(udko|udo)\b/, tags: ['udo', 'pieczeń'] },
    { re: /\b(pieczon|roast|grill)/, tags: ['pieczeń', 'mięso pieczone'] },
    { re: /\bchrupiac|crispy/, tags: ['chrupiące'] },
    { re: /\bjablk|apple/, tags: ['jabłko'] },
    { re: /\bpekin|peking/, tags: ['kaczka', 'azja'] },
    { re: /\bsushi|nigiri|maki/, tags: ['sushi', 'ryba'] },
  ];
  for (const r of rules) {
    if (r.re.test(n)) r.tags.forEach((t) => tags.add(t));
  }
  for (const t of extraTags) {
    const nt = normalizeDishName(t);
    if (nt) tags.add(nt);
  }
  return [...tags];
}

/** Tag diety dania, którego obraz NIE może naruszać (forbiddenTags obrazu). */
export function dishDietaryGuards(name: string, contextTags: string[]): string[] {
  const guards = new Set<string>();
  const all = new Set([...contextTags.map(normalizeDishName), normalizeDishName(name)]);
  const blob = [...all].join(' ');
  if (/\bwege|vegan|tofu|falafel|roslin|wegetaria/.test(blob)) {
    ['wołowina', 'wieprzowina', 'kurczak', 'kaczka', 'mięso', 'ryba', 'indyk'].forEach((g) => guards.add(g));
  }
  if (/\bryba|losos|sushi|owoc.?morz/.test(blob) && !/\bmieso|wolow|wieprz|kurczak|kaczka/.test(blob)) {
    ['wołowina', 'wieprzowina', 'kurczak', 'kaczka'].forEach((g) => guards.add(g));
  }
  if (/\bdeser|ciasto|lody|tiramisu|slodk/.test(blob)) {
    ['mięso', 'wołowina', 'wieprzowina', 'zupa'].forEach((g) => guards.add(g));
  }
  return [...guards];
}

function tokenOverlapScore(qTokens: string[], cTokens: string[]): number {
  if (!qTokens.length || !cTokens.length) return 0;
  const cSet = new Set(cTokens);
  const cStem = new Set(cTokens.map(stemToken));
  let hit = 0;
  for (const t of qTokens) {
    if (cSet.has(t)) {
      hit += 1;
      continue;
    }
    const st = stemToken(t);
    if (cStem.has(st)) {
      hit += 0.95;
      continue;
    }
    if (t.length >= 5 && [...cSet].some((ct) => ct.length >= 5 && (ct.includes(t) || t.includes(ct)))) {
      hit += 0.85;
    }
  }
  const coverQ = hit / qTokens.length;
  const coverC = hit / cTokens.length;
  let score = Math.round(100 * (0.7 * coverQ + 0.3 * Math.min(coverC, 1)));
  if (hit < 1.5 && qTokens.length >= 2) {
    score = Math.min(score, 52);
  }
  return score;
}

function bestCandidateScore(q: string, qTokens: string[], entry: DishImageEntry, lib?: ImageLibraryEntry): number {
  const labels = [
    entry.labelPl,
    ...entry.aliases,
    entry.slug.replace(/_/g, ' '),
    lib?.primaryName,
    ...(lib?.aliases || []),
  ]
    .filter(Boolean)
    .map((x) => normalizeDishName(String(x)));
  let best = 0;
  for (const c of labels) {
    if (!c) continue;
    if (q === c) return 100;
    const cTokens = significantTokens(c);
    if (qTokens.length >= 2 && qTokens.every((t) => cTokens.includes(t) || c.includes(t) || cTokens.map(stemToken).includes(stemToken(t)))) {
      best = Math.max(best, 92);
      continue;
    }
    if (qTokens.length === 1 && (cTokens.includes(qTokens[0]) || cTokens.map(stemToken).includes(stemToken(qTokens[0]))) && cTokens.length <= 3) {
      const alone = qTokens[0];
      best = Math.max(best, WEAK_ALONE.has(alone) ? 70 : 90);
      continue;
    }
    // Near-exact: różnica 1–2 tokenów przy wspólnym białku
    const overlap = tokenOverlapScore(qTokens, cTokens);
    best = Math.max(best, overlap);
  }
  return best;
}

function isPackagingPath(storagePath?: string): boolean {
  return /opakowania\/|packaging\//.test(storagePath || '');
}

function applyFamilyAdjustments(
  name: string,
  score: number,
  entry: DishImageEntry,
  wantFamily: DishFamily,
): number {
  let s = score;
  const fam = familyFromEntry(entry);
  if (wantFamily !== 'other' && fam === wantFamily) s = Math.min(100, s + 8);
  else if (wantFamily !== 'other' && fam !== 'other' && fam !== wantFamily) {
    if ((wantFamily === 'meat' && fam === 'soups') || (wantFamily === 'soups' && fam === 'meat')) {
      s = Math.max(0, s - 45);
    } else {
      s = Math.max(0, s - 25);
    }
  }
  if (isRedTomatoFamily(name)) {
    const redSlug = /pomidor|gazpacho|bolognese|buffalo|marinara|tomato|passata/.test(
      `${entry.slug} ${entry.labelPl} ${entry.aliases.join(' ')}`.toLowerCase(),
    );
    if (redSlug) s = Math.min(100, s + 10);
    else if (fam === 'soups' || fam === 'sauces') s = Math.max(0, s - 8);
  }
  return s;
}

function placeholderLabelFor(name: string, category?: string): string {
  const tags = extractDishContextTags(name);
  if (tags.includes('kaczka') || tags.includes('drób')) return 'Drób';
  if (tags.includes('wołowina')) return 'Wołowina';
  if (tags.includes('wieprzowina')) return 'Wieprzowina';
  if (tags.includes('ryba') || tags.includes('sushi')) return 'Ryby';
  if (tags.includes('wege')) return 'Wege';
  if (tags.includes('zupa')) return 'Zupy';
  if (tags.includes('burger')) return 'Burgery';
  if (tags.includes('pizza')) return 'Pizza';
  if (tags.includes('makaron')) return 'Makarony';
  if (tags.includes('sałatka')) return 'Sałatki';
  if (tags.includes('deser')) return 'Desery';
  if (tags.includes('sos')) return 'Sosy';
  const fam = detectDishFamily(name);
  const map: Record<DishFamily, string> = {
    sauces: 'Sosy',
    soups: 'Zupy',
    burgers: 'Burgery',
    pasta: 'Makarony',
    pizza: 'Pizza',
    salad: 'Sałatki',
    dessert: 'Desery',
    drink: 'Napoje',
    meat: 'Danie mięsne',
    sides: 'Dodatki',
    other: category?.trim() || 'Danie',
  };
  return map[fam];
}

const TAG_THRESHOLD = 1; // at least one strong protein tag hit

function mainProteinTags(tags: string[]): string[] {
  const priority = [
    'kaczka', 'kurczak', 'indyk', 'wołowina', 'wieprzowina', 'ryba', 'owoce morza',
    'wege', 'burger', 'pizza', 'makaron', 'zupa', 'sos', 'sałatka', 'sushi', 'pierogi', 'deser',
  ];
  const norm = tags.map(normalizeDishName);
  return priority.filter((p) => norm.some((t) => t === normalizeDishName(p) || stemToken(t) === stemToken(p)));
}

/**
 * Konflikt diety:
 * - dishContextTag ∈ image.forbiddenTags → odrzuć (np. wege vs mięso)
 * - dish jest wege/deser → obraz nie może mieć białek mięsnych w fallbackTags
 */
function tagsConflict(
  lib: ImageLibraryEntry,
  dishContextTags: string[],
  dietaryGuards: string[],
): boolean {
  const dishNorm = dishContextTags.map(normalizeDishName);
  const forbid = new Set((lib.forbiddenTags || []).map(normalizeDishName));
  for (const t of dishNorm) {
    if (forbid.has(t)) return true;
  }
  if (!dietaryGuards.length) return false;
  const img = (lib.fallbackTags || []).map(normalizeDishName);
  for (const g of dietaryGuards) {
    const ng = normalizeDishName(g);
    if (img.some((t) => t === ng || stemToken(t) === stemToken(ng))) return true;
  }
  return false;
}

function imageHasTag(lib: ImageLibraryEntry, tag: string): boolean {
  const want = normalizeDishName(tag);
  const stem = stemToken(want);
  for (const t of lib.fallbackTags || []) {
    const nt = normalizeDishName(t);
    if (nt === want || stemToken(nt) === stem || nt.includes(want) || want.includes(nt)) return true;
  }
  const blob = normalizeDishName(`${lib.primaryName} ${lib.slug} ${(lib.aliases || []).join(' ')}`);
  return blob.includes(want) || blob.split(' ').some((w) => stemToken(w) === stem);
}

/**
 * Waterfall match. Zwraca undefined tylko gdy brak katalogu —
 * UI powinno użyć categoryPlaceholderSlug jako ostateczność.
 */
export function findDishImageMatch(
  name: string,
  catalog: DishImageEntry[],
  opts?: { extraTags?: string[]; menuCategory?: string; excludeSlugs?: Set<string> | string[] },
): DishMatchResult | undefined {
  const q = normalizeDishName(name);
  if (!q || !catalog.length) return undefined;
  const qTokens = significantTokens(q);
  const wantFamily = detectDishFamily(name);
  const contextTags = extractDishContextTags(name, opts?.extraTags || []);
  const guards = dishDietaryGuards(name, contextTags);
  const catalogBySlug = new Map(catalog.map((e) => [e.slug, e]));
  const library = loadImageLibrary();
  const excluded =
    opts?.excludeSlugs == null
      ? null
      : opts.excludeSlugs instanceof Set
        ? opts.excludeSlugs
        : new Set(opts.excludeSlugs);
  const allowed = (slug: string) => !excluded || !excluded.has(slug);

  // Exact label equality → 100 (Step 1a)
  for (const entry of catalog) {
    if (!allowed(entry.slug) || isPackagingPath(entry.storagePath)) continue;
    const lib = getLibraryEntryBySlug(entry.slug);
    if (lib && tagsConflict(lib, contextTags, guards)) continue;
    const labels = [entry.labelPl, ...entry.aliases, lib?.primaryName]
      .filter(Boolean)
      .map((x) => normalizeDishName(String(x)));
    if (labels.includes(q)) {
      return { slug: entry.slug, score: 100, entry, tier: 'exact' };
    }
  }

  // ── Step 1b: Near-exact / strong token overlap ─────────────────────────
  const exactRanked: DishMatchResult[] = [];
  for (const entry of catalog) {
    if (!allowed(entry.slug) || isPackagingPath(entry.storagePath)) continue;
    const lib = getLibraryEntryBySlug(entry.slug);
    if (lib && tagsConflict(lib, contextTags, guards)) continue;
    let score = bestCandidateScore(q, qTokens, entry, lib);
    score = applyFamilyAdjustments(name, score, entry, wantFamily);
    if (score >= 85) {
      exactRanked.push({
        slug: entry.slug,
        score,
        entry,
        tier: 'exact',
      });
    }
  }
  exactRanked.sort((a, b) => b.score - a.score);
  if (exactRanked[0]) return exactRanked[0];

  // ── Step 2: Strict tags (main protein / dish type) ──────────────────────
  const proteins = mainProteinTags(contextTags);
  if (proteins.length && library.length) {
    const tagRanked: { slug: string; score: number; entry: DishImageEntry; hitCount: number }[] = [];
    for (const lib of library) {
      if (!allowed(lib.slug) || isPackagingPath(lib.storagePath)) continue;
      if (tagsConflict(lib, contextTags, guards)) continue;
      const entry = catalogBySlug.get(lib.slug);
      if (!entry) continue;
      let hitCount = 0;
      for (const p of proteins) {
        if (imageHasTag(lib, p)) hitCount += 1;
      }
      if (hitCount < TAG_THRESHOLD) continue;
      let score = 55 + hitCount * 12;
      score = applyFamilyAdjustments(name, score, entry, wantFamily);
      const secondary = contextTags.filter((t) => !proteins.includes(t));
      for (const t of secondary) {
        if (imageHasTag(lib, t)) score = Math.min(84, score + 4);
      }
      tagRanked.push({ slug: lib.slug, score, entry, hitCount });
    }
    tagRanked.sort((a, b) => b.score - a.score || b.hitCount - a.hitCount);
    if (tagRanked[0] && tagRanked[0].score >= 55) {
      return {
        slug: tagRanked[0].slug,
        score: Math.min(84, tagRanked[0].score),
        entry: tagRanked[0].entry,
        tier: 'tags',
        placeholderLabel: placeholderLabelFor(name, opts?.menuCategory),
      };
    }
  }

  // ── Step 3: Category placeholder (handled by caller via categoryPlaceholderSlug)
  return undefined;
}

/** Compat: tylko slug. */
export function findSlugForDishName(
  name: string,
  catalog: DishImageEntry[],
): string | undefined {
  return findDishImageMatch(name, catalog)?.slug;
}

/** Placeholder slug z katalogu dań wg rodziny (gdy brak mocnego matcha). */
export function categoryPlaceholderSlug(name: string, catalog: DishImageEntry[]): string | undefined {
  const fam = detectDishFamily(name);
  const pick = (...slugs: string[]) => {
    for (const s of slugs) {
      if (catalog.some((e) => e.slug === s)) return s;
    }
    return undefined;
  };
  if (isRedTomatoFamily(name)) {
    if (fam === 'sauces') {
      return pick('sos_bolognese', 'sos_buffalo', 'zupa_pomidorowa', 'gazpacho');
    }
    return pick('zupa_pomidorowa', 'gazpacho', 'sos_bolognese', 'sos_buffalo');
  }
  // Drób / kaczka — preferuj pieczoną kaczkę zamiast schabowego
  const tags = extractDishContextTags(name);
  if (tags.includes('kaczka')) {
    return pick('pieczona_kaczka', 'kaczka_porcja', 'udo_kaczki', 'kaczka_pekinska', 'kaczka_chrupiaca');
  }
  if (tags.includes('kurczak') || tags.includes('drób')) {
    return pick('de_volaille', 'kotlet_schabowy', 'pieczona_kaczka');
  }
  switch (fam) {
    case 'sauces':
      return pick('sos_smietankowo_ziolowy', 'sos_curry')
        ?? catalog.find((e) => /sauce|sos/.test(e.storagePath) && !/opakowan|packaging|pudelko|miska_zupa_papier/.test(e.storagePath))?.slug;
    case 'soups':
      return pick('rosol', 'zupa_ogorkowa_pl', 'zupa_pomidorowa');
    case 'burgers':
      return pick('classic_cheeseburger');
    case 'pasta':
      return pick('spaghetti_carbonara');
    case 'pizza':
      return pick('pizza_margherita');
    case 'salad':
      return pick('garden_salad');
    case 'meat':
      return pick('kotlet_schabowy', 'stek_ribeye', 'de_volaille')
        ?? catalog.find((e) => /steak|kotlet|grill|mieso|roast/.test(e.storagePath))?.slug;
    case 'sides':
      return pick('warzywa_grillowane', 'french_fries', 'coleslaw');
    case 'drink':
      return pick('espresso', 'lemoniada_cytrynowa')
        ?? catalog.find((e) => /coffee|tea|lemonade|juice/.test(e.storagePath))?.slug;
    default:
      return undefined;
  }
}

export function resolveDishMatchWithFallback(
  name: string,
  catalog: DishImageEntry[],
  opts?: { extraTags?: string[]; menuCategory?: string; excludeSlugs?: Set<string> | string[] },
): DishMatchResult | undefined {
  const hit = findDishImageMatch(name, catalog, opts);
  if (hit) return hit;
  const excluded =
    opts?.excludeSlugs == null
      ? null
      : opts.excludeSlugs instanceof Set
        ? opts.excludeSlugs
        : new Set(opts.excludeSlugs);
  const phCandidates = [
    categoryPlaceholderSlug(name, catalog),
    ...(['pieczona_kaczka', 'kaczka_porcja', 'udo_kaczki', 'kaczka_pekinska', 'kotlet_schabowy', 'rosol', 'garden_salad'] as const),
  ].filter(Boolean) as string[];
  for (const phSlug of phCandidates) {
    if (excluded?.has(phSlug)) continue;
    const entry = catalog.find((e) => e.slug === phSlug);
    if (!entry || isPackagingPath(entry.storagePath)) continue;
    return {
      slug: entry.slug,
      score: 45,
      entry,
      tier: 'category',
      placeholderLabel: placeholderLabelFor(name, opts?.menuCategory),
    };
  }
  return undefined;
}
