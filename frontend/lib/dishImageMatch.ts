import {
  normalizeFoodName,
} from '@/lib/foodNameNormalize';
import type { DishImageEntry } from '@/lib/dishImagesCatalog';
import {
  getLibraryEntryBySlug,
  loadImageLibrary,
  type ImageLibraryEntry,
} from '@/lib/imageLibrary';
import {
  detectTaxonomyFamily,
  expandDishQuery,
  imageFamilyConflictsQuery,
  taxonomyContextTags,
  taxonomyPlaceholderSlugs,
  taxonomyToLegacyFamily,
  type TaxonomyFamily,
} from '@/lib/dishTaxonomy';

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
  /** Etykieta badge UI (kategoria) — bez słowa „Placeholder” */
  placeholderLabel?: string;
};

let libraryCache: ImageLibraryEntry[] | null = null;

function getImageLibraryCached(): ImageLibraryEntry[] {
  if (!libraryCache) libraryCache = loadImageLibrary();
  return libraryCache;
}

export function normalizeDishName(raw: string): string {
  return normalizeFoodName(raw);
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
    [/frytk\w*|fries/, 'frytki'],
    [/ziemni\w*|potato/, 'ziemniak'],
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
  const tax = detectTaxonomyFamily(name);
  if (tax !== 'other') return taxonomyToLegacyFamily(tax);
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
  if (/\b(frytk|fries|chips|ziemniak|potato|batat|warzyw.*grill|grillowan.*warzyw|pieczon.*warzyw|sides|surowk|coleslaw|dodatk|puree|mix ziemni)\b/.test(n)) {
    return 'sides';
  }
  if (/\b(ciasto|tort|deser|lody|pancake|nalesnik|tiramisu|panna cotta)\b/.test(n)) return 'dessert';
  if (/\b(kawa|herbata|lemoniad|sok |smoothie|drink|koktajl|piwo|wino|energetyk|cola|woda)\b/.test(n)) return 'drink';
  if (
    /\b(filet|piers|kurczak|schab|kotlet|stek|zeberk|wolow|wieprz|indyk|kaczka|de volaille|poledwic|antrykot|karkowk|udziec|udko|udo|skrzyde|nugget|confitur|glazur|boczek|piecen|roast)\b/.test(n)
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
  if (mf === 'rybne') return 'meat';
  const path = `${entry.storagePath} ${entry.slug}`.toLowerCase();
  if (/sauce|sosy|dipy/.test(path)) return 'sauces';
  if (/soup|zupa/.test(path)) return 'soups';
  if (/burger/.test(path)) return 'burgers';
  if (/pasta|makaron/.test(path)) return 'pasta';
  if (/pizza/.test(path)) return 'pizza';
  if (/salad|salatk/.test(path)) return 'salad';
  if (/side|warzywa_grill|surowk|fries|frytk|ziemniak|potato/.test(path)) return 'sides';
  if (/dessert|cake|ice_cream|pancake|pastr|french_dessert/.test(path)) return 'dessert';
  if (/coffee|tea|lemonade|juice|cocktail|beer|wine|spirit|energy/.test(path)) return 'drink';
  if (/steak|meat|mieso|grill|bbq|kotlet|schab|kurczak|beef|pork|ribs|roast|dinner/.test(path) && !/soup|zupa/.test(path)) {
    return 'meat';
  }
  return detectDishFamily(entry.labelPl);
}

const WEAK_ALONE = new Set([
  'kurczak', 'wolow', 'wieprz', 'indyk', 'mieso', 'ryba', 'ser', 'sos', 'zupa', 'krem',
]);

/** Słabe tagi gotowania — same nie powinny wygrywać matchingu (frytki mają „pieczeń”). */
const WEAK_COOK_TAGS = new Set([
  'pieczeń', 'pieczone', 'pieczony', 'pieczen', 'grill', 'bbq', 'mięso pieczone', 'mieso pieczone',
  'danie główne', 'danie glowne', 'chrupiące', 'chrupiace', 'obiad',
]);

const PROTEIN_TAGS = [
  'kaczka', 'kurczak', 'indyk', 'wołowina', 'wieprzowina', 'ryba', 'owoce morza', 'wege',
] as const;

const CROSS_PROTEIN: Record<string, string[]> = {
  kaczka: ['wołowina', 'wieprzowina', 'kurczak', 'ryba', 'indyk'],
  kurczak: ['wołowina', 'wieprzowina', 'kaczka', 'ryba'],
  indyk: ['wołowina', 'wieprzowina', 'kaczka', 'ryba', 'kurczak'],
  wołowina: ['wieprzowina', 'kurczak', 'kaczka', 'ryba', 'indyk'],
  wieprzowina: ['wołowina', 'kurczak', 'kaczka', 'ryba', 'indyk'],
  ryba: ['wołowina', 'wieprzowina', 'kurczak', 'kaczka', 'indyk'],
  'owoce morza': ['wołowina', 'wieprzowina', 'kurczak', 'kaczka'],
  wege: ['wołowina', 'wieprzowina', 'kurczak', 'kaczka', 'mięso', 'ryba', 'indyk'],
};

function imageBlob(lib: ImageLibraryEntry): string {
  return normalizeDishName(
    `${lib.primaryName} ${lib.slug} ${(lib.aliases || []).join(' ')} ${(lib.fallbackTags || []).join(' ')}`,
  );
}

function isSideLikeImage(lib: ImageLibraryEntry, entry?: DishImageEntry): boolean {
  const blob = imageBlob(lib);
  const path = normalizeDishName(`${lib.storagePath || ''} ${entry?.storagePath || ''}`);
  if (familyFromEntry(entry || ({ storagePath: lib.storagePath, slug: lib.slug, labelPl: lib.primaryName, aliases: lib.aliases || [], category: '' } as DishImageEntry)) === 'sides') {
    return true;
  }
  return /\b(frytk|fries|chips|ziemniak|potato|batat|coleslaw|surowk|warzywa grill|pieczone warzyw|puree|puree ziemn|mix ziemni|faszerowany.*ziemniak)\b/.test(blob)
    || /side|fries|frytk|ziemniak|potato|coleslaw|warzywa_grill/.test(path);
}

function isSoupLikeImage(lib: ImageLibraryEntry, entry?: DishImageEntry): boolean {
  if (entry && familyFromEntry(entry) === 'soups') return true;
  const blob = imageBlob(lib);
  const path = normalizeDishName(`${lib.storagePath || ''} ${entry?.storagePath || ''}`);
  return /\b(zupa|rosol|barszcz|zurek|gazpacho|bulion|chowder|bisque|krem z |pho|ramen)\b/.test(blob)
    || /soup|zupa/.test(path);
}

function isDessertLikeImage(lib: ImageLibraryEntry, entry?: DishImageEntry): boolean {
  if (entry && familyFromEntry(entry) === 'dessert') return true;
  const blob = imageBlob(lib);
  return /\b(ciasto|deser|lody|tiramisu|tarta|pancake|nalesnik|panna cotta)\b/.test(blob);
}

/**
 * Oczyszcza fallbackTags z biblioteki — usuwa fałszywe białka/roast na dodatkach
 * oraz „zupa” na deserach (znane błędy generatora tagów).
 */
export function effectiveFallbackTags(lib: ImageLibraryEntry, entry?: DishImageEntry): string[] {
  let tags = [...(lib.fallbackTags || [])];
  if (isSideLikeImage(lib, entry)) {
    tags = tags.filter((t) => {
      const n = normalizeDishName(t);
      if (WEAK_COOK_TAGS.has(n)) return false;
      if (/^(mieso|mięso|wolowina|wołowina|wieprzowina|kurczak|kaczka|indyk|bbq)$/.test(n)) return false;
      if (/burger|makaron|pasta/.test(n)) return false;
      return true;
    });
  }
  if (isDessertLikeImage(lib, entry)) {
    tags = tags.filter((t) => normalizeDishName(t) !== 'zupa');
  }
  if (isSoupLikeImage(lib, entry)) {
    // zupa rybna może mieć ryba — OK; nie dodawaj roast/meat noise
    tags = tags.filter((t) => {
      const n = normalizeDishName(t);
      return !WEAK_COOK_TAGS.has(n) || n === 'zupa';
    });
  }
  return tags;
}

/** Główne tagi białka / diety z nazwy dania (+ opcjonalne AI tags). */
export function extractDishContextTags(name: string, extraTags: string[] = []): string[] {
  const n = normalizeDishName(name);
  const tags = new Set<string>();
  const rules: { re: RegExp; tags: string[] }[] = [
    { re: /\bkaczk/, tags: ['kaczka', 'drób', 'mięso pieczone', 'ptactwo'] },
    { re: /\b(kurczak|chicken|nugget|de volaille)/, tags: ['kurczak', 'drób'] },
    { re: /\bindyk/, tags: ['indyk', 'drób'] },
    { re: /\b(wolow|beef|stek|ribeye|tatar|piecen wol)/, tags: ['wołowina', 'mięso'] },
    { re: /\bpiecen\b/, tags: ['mięso', 'pieczeń'] },
    { re: /\b(wieprz|schab|golonk|boczek|zeberk)/, tags: ['wieprzowina', 'mięso'] },
    { re: /\b(ryb|losos|dorsz|pstrag|tunczyk|fish)/, tags: ['ryba'] },
    { re: /\b(krewet|owoc.?morz)/, tags: ['owoce morza', 'ryba'] },
    { re: /\b(wege|vegan|tofu|falafel)/, tags: ['wege'] },
    { re: /\b(zupa|rosol|barszcz|zurek|gazpacho|ramen|pho|krem z |bulion)/, tags: ['zupa'] },
    { re: /\bpomidor|tomato/, tags: ['pomidor', 'czerwone'] },
    { re: /\bburger/, tags: ['burger'] },
    { re: /\bpizza/, tags: ['pizza'] },
    { re: /\b(makaron|pasta|spaghetti)/, tags: ['makaron'] },
    { re: /\bsalatk|salad/, tags: ['sałatka'] },
    { re: /\b(pierog|uszka|pielmieni|wareniki)/, tags: ['pierogi'] },
    { re: /\b(kopytk|kluski|leniwe|pampuch|kartacz|cepelin)/, tags: ['kluski'] },
    { re: /\b(kebab|doner|shawarma|gyro)/, tags: ['kebab'] },
    { re: /\b(curry|tikka|butter chicken|naan)/, tags: ['curry', 'indyjskie'] },
    { re: /\b(taco|burrito|nachos|quesadilla)/, tags: ['meksykańskie'] },
    { re: /\b(śniadanie|breakfast|jajecznica|omlet)/, tags: ['śniadanie'] },
    { re: /\bsos |sauce/, tags: ['sos'] },
    { re: /\b(deser|ciasto|lody|tiramisu)/, tags: ['deser'] },
    { re: /\b(udko|udo)\b/, tags: ['udo', 'pieczeń'] },
    // pieczeń tylko jako słaby kontekst — nie jako główne białko
    { re: /\b(pieczon|roast|grill)\b/, tags: ['pieczeń'] },
    { re: /\bchrupiac|crispy/, tags: ['chrupiące'] },
    { re: /\bjablk|apple/, tags: ['jabłko'] },
    { re: /\bpekin|peking/, tags: ['kaczka', 'azja'] },
    { re: /\bsushi|nigiri|maki/, tags: ['sushi', 'ryba'] },
    { re: /\b(frytk|fries)\b/, tags: ['frytki', 'dodatek'] },
    { re: /\b(ziemniak|potato|batat)\b/, tags: ['ziemniak', 'dodatek'] },
  ];
  for (const r of rules) {
    if (r.re.test(n)) r.tags.forEach((t) => tags.add(t));
  }
  for (const t of extraTags) {
    const nt = normalizeDishName(t);
    if (nt) tags.add(nt);
  }
  for (const t of taxonomyContextTags(name)) {
    tags.add(t);
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
  // Cross-protein: danie z konkretnym białkiem → obraz nie może mieć konkurencyjnego
  for (const p of PROTEIN_TAGS) {
    if (![...all].some((t) => t === normalizeDishName(p) || stemToken(t) === stemToken(p))) continue;
    for (const rival of CROSS_PROTEIN[p] || []) guards.add(rival);
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
  lib?: ImageLibraryEntry,
): number {
  let s = score;
  const fam = familyFromEntry(entry);
  if (wantFamily !== 'other' && fam === wantFamily) s = Math.min(100, s + 10);
  else if (wantFamily !== 'other' && fam !== 'other' && fam !== wantFamily) {
    // Mocne kary za mismatch kategorii
    if ((wantFamily === 'meat' && fam === 'soups') || (wantFamily === 'soups' && fam === 'meat')) {
      s = Math.max(0, s - 55);
    } else if ((wantFamily === 'meat' && fam === 'sides') || (wantFamily === 'sides' && fam === 'meat')) {
      s = Math.max(0, s - 50);
    } else if ((wantFamily === 'soups' && fam === 'sides') || (wantFamily === 'sides' && fam === 'soups')) {
      s = Math.max(0, s - 45);
    } else if (wantFamily === 'soups' && fam !== 'soups' && fam !== 'sauces') {
      s = Math.max(0, s - 40);
    } else if (wantFamily === 'meat' && (fam === 'dessert' || fam === 'drink')) {
      s = Math.max(0, s - 50);
    } else {
      s = Math.max(0, s - 28);
    }
  }
  // Extra: mięso/roast nie może wygrać frytkami / ziemniakami nawet przy tagach pieczeń
  if (wantFamily === 'meat' && lib && isSideLikeImage(lib, entry)) {
    s = Math.max(0, s - 60);
  }
  if (wantFamily === 'soups' && lib && !isSoupLikeImage(lib, entry) && fam !== 'soups') {
    s = Math.max(0, s - 50);
  }
  if (wantFamily === 'sides' && lib && isSoupLikeImage(lib, entry)) {
    s = Math.max(0, s - 45);
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
  if (tags.includes('frytki') || tags.includes('ziemniak')) return 'Dodatki';
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

const TAG_THRESHOLD = 1;

function mainProteinTags(tags: string[]): string[] {
  const priority = [
    'kaczka', 'kurczak', 'indyk', 'wołowina', 'wieprzowina', 'ryba', 'owoce morza',
    'wege', 'burger', 'pizza', 'makaron', 'zupa', 'sos', 'sałatka', 'sushi', 'pierogi', 'kluski',
    'kebab', 'deser', 'frytki', 'ziemniak', 'curry', 'śniadanie', 'meksykańskie',
  ];
  const norm = tags.map(normalizeDishName);
  // Nie używaj samego „pieczeń” jako głównego tagu — zbyt szeroki
  return priority.filter((p) => norm.some((t) => t === normalizeDishName(p) || stemToken(t) === stemToken(p)));
}

function tagsConflict(
  lib: ImageLibraryEntry,
  dishContextTags: string[],
  dietaryGuards: string[],
  entry?: DishImageEntry,
  queryFamily?: TaxonomyFamily,
): boolean {
  const dishNorm = dishContextTags.map(normalizeDishName);
  const forbid = new Set((lib.forbiddenTags || []).map(normalizeDishName));
  for (const t of dishNorm) {
    if (forbid.has(t)) return true;
  }
  const eff = effectiveFallbackTags(lib, entry).map(normalizeDishName);
  if (dietaryGuards.length) {
    for (const g of dietaryGuards) {
      const ng = normalizeDishName(g);
      if (eff.some((t) => t === ng || stemToken(t) === stemToken(ng))) return true;
    }
  }
  // Zupa vs solid: danie zupa nie bierze obrazu bez tagu zupa / ścieżki soup
  if (dishNorm.includes('zupa') && !isSoupLikeImage(lib, entry) && !eff.includes('zupa')) {
    return true;
  }
  // Mięso/pieczeń nie bierze frytek / ziemniaków
  const wantMeat = dishNorm.some((t) =>
    ['kaczka', 'kurczak', 'indyk', 'wołowina', 'wieprzowina', 'mięso', 'mieso', 'pieczeń'].includes(t)
    || stemToken(t) === 'wolowina' || stemToken(t) === 'wieprzowina',
  );
  const wantSoup = dishNorm.includes('zupa');
  if (wantMeat && !wantSoup && isSideLikeImage(lib, entry)) {
    // wyjątek: danie to sam dodatek
    if (!dishNorm.includes('frytki') && !dishNorm.includes('ziemniak') && !dishNorm.includes('dodatek')) {
      return true;
    }
  }
  // Taksonomia: pizza≠focaccia, pierogi≠kluski, stek≠burger…
  if (queryFamily && queryFamily !== 'other') {
    const blob = `${lib.primaryName} ${lib.slug} ${(lib.aliases || []).join(' ')} ${entry?.storagePath || ''} ${entry?.labelPl || ''}`;
    if (imageFamilyConflictsQuery(queryFamily, blob)) return true;
  }
  return false;
}

function imageHasTag(lib: ImageLibraryEntry, tag: string, entry?: DishImageEntry): boolean {
  const want = normalizeDishName(tag);
  const stem = stemToken(want);
  if (WEAK_COOK_TAGS.has(want) && !['zupa'].includes(want)) {
    // słabe tagi: tylko jeśli primaryName też je sugeruje mocno
    const blob = normalizeDishName(`${lib.primaryName} ${lib.slug}`);
    return blob.includes(want) || blob.split(' ').some((w) => stemToken(w) === stem);
  }
  for (const t of effectiveFallbackTags(lib, entry)) {
    const nt = normalizeDishName(t);
    if (nt === want || stemToken(nt) === stem || nt.includes(want) || want.includes(nt)) return true;
  }
  const blob = normalizeDishName(`${lib.primaryName} ${lib.slug} ${(lib.aliases || []).join(' ')}`);
  return blob.includes(want) || blob.split(' ').some((w) => stemToken(w) === stem);
}

/**
 * Waterfall match. Zwraca undefined tylko gdy brak katalogu —
 * UI powinno użyć categoryPlaceholderSlug jako ostateczność.
 *
 * Kolejność (z nazwy produktow.md):
 *  1) exact name / alias
 *  2) synonimy (expandDishQuery)
 *  3) near-exact token overlap
 *  4) fallbackTags + forbiddenTags
 *  5) category placeholder (caller)
 */
export function findDishImageMatch(
  name: string,
  catalog: DishImageEntry[],
  opts?: { extraTags?: string[]; menuCategory?: string; excludeSlugs?: Set<string> | string[] },
): DishMatchResult | undefined {
  const q = normalizeDishName(name);
  if (!q || !catalog.length) return undefined;
  const queryVariants = expandDishQuery(name);
  const qTokens = significantTokens(q);
  const wantFamily = detectDishFamily(name);
  const taxFamily = detectTaxonomyFamily(name);
  const contextTags = extractDishContextTags(name, opts?.extraTags || []);
  const guards = dishDietaryGuards(name, contextTags);
  const catalogBySlug = new Map(catalog.map((e) => [e.slug, e]));
  const library = getImageLibraryCached();
  const excluded =
    opts?.excludeSlugs == null
      ? null
      : opts.excludeSlugs instanceof Set
        ? opts.excludeSlugs
        : new Set(opts.excludeSlugs);
  const allowed = (slug: string) => !excluded || !excluded.has(slug);

  const conflicts = (lib: ImageLibraryEntry | undefined, entry: DishImageEntry) =>
    !!(lib && tagsConflict(lib, contextTags, guards, entry, taxFamily));

  // Exact label equality on original OR synonym variants → 100
  for (const entry of catalog) {
    if (!allowed(entry.slug) || isPackagingPath(entry.storagePath)) continue;
    const lib = getLibraryEntryBySlug(entry.slug);
    if (conflicts(lib, entry)) continue;
    const labels = [entry.labelPl, ...entry.aliases, lib?.primaryName, ...(lib?.aliases || [])]
      .filter(Boolean)
      .map((x) => normalizeDishName(String(x)));
    if (labels.some((l) => queryVariants.includes(l))) {
      return { slug: entry.slug, score: 100, entry, tier: 'exact' };
    }
  }

  // ── Step 1b: Near-exact / strong token overlap (po wszystkich wariantach) ─
  const exactRanked: DishMatchResult[] = [];
  for (const entry of catalog) {
    if (!allowed(entry.slug) || isPackagingPath(entry.storagePath)) continue;
    const lib = getLibraryEntryBySlug(entry.slug);
    if (conflicts(lib, entry)) continue;
    let score = 0;
    for (const variant of queryVariants) {
      const vTokens = significantTokens(variant);
      score = Math.max(score, bestCandidateScore(variant, vTokens.length ? vTokens : qTokens, entry, lib));
    }
    score = applyFamilyAdjustments(name, score, entry, wantFamily, lib);
    // Kara za konflikt taksonomii (np. pizza vs focaccia w score borderline)
    if (taxFamily !== 'other') {
      const blob = `${entry.labelPl} ${entry.slug} ${entry.aliases.join(' ')} ${entry.storagePath}`;
      if (imageFamilyConflictsQuery(taxFamily, blob)) {
        score = Math.max(0, score - 70);
      }
    }
    if (score >= 82) {
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
      const entry = catalogBySlug.get(lib.slug);
      if (!entry) continue;
      if (conflicts(lib, entry)) continue;
      let hitCount = 0;
      for (const p of proteins) {
        if (imageHasTag(lib, p, entry)) hitCount += 1;
      }
      if (hitCount < TAG_THRESHOLD) continue;
      // Wymagaj ≥1 mocnego białka gdy danie ma białko — nie wygrywaj samym „pieczeń”
      const strongHits = proteins.filter((p) =>
        !WEAK_COOK_TAGS.has(normalizeDishName(p)) && imageHasTag(lib, p, entry),
      ).length;
      if (proteins.some((p) => PROTEIN_TAGS.includes(p as typeof PROTEIN_TAGS[number])) && strongHits < 1) {
        continue;
      }
      let score = 55 + hitCount * 12 + strongHits * 6;
      score = applyFamilyAdjustments(name, score, entry, wantFamily, lib);
      const secondary = contextTags.filter((t) => !proteins.includes(t) && !WEAK_COOK_TAGS.has(normalizeDishName(t)));
      for (const t of secondary) {
        if (imageHasTag(lib, t, entry)) score = Math.min(84, score + 4);
      }
      // Bonus za zgodność synonimu w primaryName
      const imgNorm = normalizeDishName(`${lib.primaryName} ${(lib.aliases || []).join(' ')}`);
      if (queryVariants.some((v) => v.length >= 4 && imgNorm.includes(v))) {
        score = Math.min(84, score + 8);
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
  const tax = detectTaxonomyFamily(name);
  const pick = (...slugs: string[]) => {
    for (const s of slugs) {
      if (catalog.some((e) => e.slug === s)) return s;
    }
    return undefined;
  };
  // Najpierw placeholdery z taksonomii (kebab, sushi, pierogi, indyjskie…)
  const taxHit = pick(...taxonomyPlaceholderSlugs(tax));
  if (taxHit) return taxHit;

  if (isRedTomatoFamily(name)) {
    if (fam === 'sauces') {
      return pick('sos_bolognese', 'sos_buffalo', 'zupa_pomidorowa', 'gazpacho');
    }
    return pick('zupa_pomidorowa', 'gazpacho', 'sos_bolognese', 'sos_buffalo');
  }
  const tags = extractDishContextTags(name);
  if (tags.includes('kaczka')) {
    return pick('pieczona_kaczka', 'kaczka_porcja', 'udo_kaczki', 'kaczka_pekinska', 'kaczka_chrupiaca');
  }
  if (tags.includes('kurczak') || (tags.includes('drób') && !tags.includes('kaczka'))) {
    return pick(
      'kotlet_de_volaille',
      'palki_bbq',
      'butter_chicken',
      'kurczak_kung_pao',
      'pieczona_kaczka',
    );
  }
  if (tags.includes('wołowina')) {
    return pick('stek_ribeye', 'beef_tartare', 'burger_bbq_board');
  }
  if (tags.includes('wieprzowina')) {
    return pick('kotlet_schabowy', 'schab_ze_sliwka', 'golonka_pieczona', 'crispy_pork_belly');
  }
  if (tags.includes('ryba') || tags.includes('sushi')) {
    return pick('dorsz_pieczony', 'losos_maslo_ziolowe', 'dorsz_fish_and_chips', 'fish_and_chips', 'tuna_tataki', 'california_roll');
  }
  switch (fam) {
    case 'sauces':
      return pick('sos_smietankowo_ziolowy', 'sos_curry')
        ?? catalog.find((e) => /sauce|sos/.test(e.storagePath) && !/opakowan|packaging|pudelko|miska_zupa_papier/.test(e.storagePath))?.slug;
    case 'soups':
      return pick('rosol', 'zupa_ogorkowa_pl', 'zupa_pomidorowa', 'rosol_tradycyjny');
    case 'burgers':
      return pick('classic_cheeseburger');
    case 'pasta':
      return pick('spaghetti_carbonara');
    case 'pizza':
      return pick('pizza_margherita');
    case 'salad':
      return pick('garden_salad');
    case 'meat':
      return pick('kotlet_schabowy', 'stek_ribeye', 'kotlet_de_volaille', 'golonka_pieczona')
        ?? catalog.find((e) => /steak|kotlet|grill|mieso|roast|dinner|kebab/.test(e.storagePath) && !/soup|side|fries/.test(e.storagePath))?.slug;
    case 'sides':
      return pick('warzywa_grillowane', 'french_fries', 'coleslaw', 'mlode_ziemniaki');
    case 'drink': {
      const n = normalizeDishName(name);
      if (/\blemoniad/.test(n)) {
        return pick('lemoniada_cytrynowa', 'lemoniada_dzbanek')
          ?? catalog.find((e) => /lemoniad|lemonade/.test(e.storagePath + e.slug))?.slug;
      }
      if (/\b(sok|wyciskan|juice)\b/.test(n)) {
        return pick('sok_pomaranczowy_miazsz', 'sok_pomaranczowy_karafka', 'sok_jablkowy_szklanka')
          ?? catalog.find((e) => /sok|juice/.test(e.storagePath + e.slug) && !/kawa|coffee|latte/.test(e.storagePath))?.slug;
      }
      if (/\b(koktajl|cocktail)\b/.test(n)) {
        return pick('mojito', 'aperol_spritz', 'milkshake_truskawkowy')
          ?? catalog.find((e) => /cocktail|koktajl|milkshake|smoothie/.test(e.storagePath + e.slug) && !/kawa|coffee|latte|pierog|pyz|pasta|pizza/.test(e.storagePath + e.slug))?.slug;
      }
      if (/\bsmoothie\b/.test(n)) {
        return pick('smoothie_owoce_lesne', 'smoothie_mango_banan', 'milkshake_truskawkowy')
          ?? catalog.find((e) => /smoothie|milkshake/.test(e.storagePath + e.slug))?.slug;
      }
      if (/\b(kawa|espresso|latte|cappuccino|americano)\b/.test(n)) {
        return pick('espresso', 'latte_klasyczne')
          ?? catalog.find((e) => /coffee|kawa|espresso|latte/.test(e.storagePath))?.slug;
      }
      // Ogólny napój — nie domyślaj kawy (lemoniada/sok częściej w menu)
      return pick('lemoniada_cytrynowa', 'sok_pomaranczowy_miazsz')
        ?? catalog.find((e) => /lemoniad|lemonade|juice|smoothie|sok/.test(e.storagePath + e.slug))?.slug;
    }
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
  const fam = detectDishFamily(name);
  const tax = detectTaxonomyFamily(name);
  const tags = extractDishContextTags(name, opts?.extraTags || []);
  const guards = dishDietaryGuards(name, tags);
  const phCandidates = [
    ...taxonomyPlaceholderSlugs(tax),
    categoryPlaceholderSlug(name, catalog),
  ].filter(Boolean) as string[];
  // Rodzinne fallbacki — bez mieszania mięsa z frytkami / zupą / pierogów z kluskami
  if (tags.includes('kaczka')) {
    phCandidates.push('pieczona_kaczka', 'kaczka_porcja', 'udo_kaczki', 'kaczka_pekinska');
  } else if (tax === 'pierogi' || tags.includes('pierogi')) {
    phCandidates.push('pierogi_ruskie', 'pierogi_z_miesem', 'pierogi_kapusta_grzyby');
  } else if (tax === 'kluski' || tags.includes('kluski')) {
    phCandidates.push('kopytka', 'kluski_slaskie', 'kluski_leniwe');
  } else if (fam === 'soups') {
    phCandidates.push('rosol', 'zupa_pomidorowa', 'gazpacho');
  } else if (fam === 'meat' || tax === 'kebab' || tax === 'steak' || tax === 'bbq') {
    phCandidates.push('kotlet_schabowy', 'stek_ribeye', 'kotlet_de_volaille');
  } else if (fam === 'sides') {
    phCandidates.push('french_fries', 'warzywa_grillowane', 'mlode_ziemniaki');
  } else if (tax === 'sushi') {
    phCandidates.push('california_roll', 'sake_nigiri', 'futomaki_losos');
  } else {
    phCandidates.push('garden_salad');
  }
  for (const phSlug of phCandidates) {
    if (excluded?.has(phSlug)) continue;
    const entry = catalog.find((e) => e.slug === phSlug);
    if (!entry || isPackagingPath(entry.storagePath)) continue;
    const lib = getLibraryEntryBySlug(phSlug);
    if (lib && tagsConflict(lib, tags, guards, entry, tax)) continue;
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

/** Wspólna rodzina składników do smoke testów. */
export function ingredientFamilyKey(name: string): string {
  const tags = extractDishContextTags(name);
  const fam = detectDishFamily(name);
  if (tags.includes('kaczka')) return 'duck';
  if (tags.includes('kurczak') || tags.includes('drób')) return 'chicken';
  if (tags.includes('wołowina')) return 'beef';
  if (tags.includes('wieprzowina')) return 'pork';
  if (tags.includes('ryba') || tags.includes('sushi') || tags.includes('owoce morza')) return 'fish';
  if (tags.includes('wege')) return 'veg';
  if (tags.includes('zupa') || fam === 'soups') return 'soup';
  if (tags.includes('burger') || fam === 'burgers') return 'burger';
  if (tags.includes('pizza') || fam === 'pizza') return 'pizza';
  if (tags.includes('makaron') || fam === 'pasta') return 'pasta';
  if (tags.includes('sałatka') || fam === 'salad') return 'salad';
  if (tags.includes('deser') || fam === 'dessert') return 'dessert';
  if (tags.includes('frytki') || tags.includes('ziemniak') || fam === 'sides') return 'sides';
  if (fam === 'meat') return 'meat';
  if (fam === 'sauces') return 'sauce';
  if (fam === 'drink') return 'drink';
  return 'other';
}

export function familiesCompatible(a: string, b: string): boolean {
  if (a === 'other' || b === 'other') return true;
  if (a === b) return true;
  const meatish = new Set(['meat', 'beef', 'pork', 'chicken', 'duck']);
  if (meatish.has(a) && meatish.has(b)) {
    // cross-protein w obrębie meatish — tylko chicken↔duck (drób) OK
    if ((a === 'chicken' || a === 'duck') && (b === 'chicken' || b === 'duck')) return true;
    if (a === 'meat' || b === 'meat') return true;
    return false;
  }
  if ((a === 'soup' && b === 'sauce') || (a === 'sauce' && b === 'soup')) return true;
  return false;
}
