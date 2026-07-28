/**
 * Ścisłe dopasowanie nazwy dania → slug z DISH_IMAGE_CATALOG.
 * Unika luźnych `includes` (np. „sos” → hummus / dip).
 */
import type { DishImageEntry } from '@/lib/dishImagesCatalog';

const STOP = new Set([
  'a',
  'i',
  'z',
  'ze',
  'w',
  'na',
  'do',
  'od',
  'po',
  'dla',
  'the',
  'of',
  'and',
  'with',
  'de',
  'la',
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

export function normalizeDishName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function significantTokens(normalized: string): string[] {
  return normalized
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

export function detectDishFamily(name: string): DishFamily {
  const n = normalizeDishName(name);
  // Sosy / zupy przed mięsem — „sos czosnkowy”, „krem z kurczaka”
  if (/\b(sos|sauce|aioli|gravy|bbq|demi glace|bearnaise|holendersk|bernensk|fondue|satay|bolognese|carbonara)\b/.test(n) || n.startsWith('sos ')) {
    return 'sauces';
  }
  if (/\b(zupa|krem|rosol|barszcz|zurek|flaki|chowder|bisque|gazpacho|bulion|chlodnik|krupnik|kapusniak|grochowk|pho|ramen|miso|tom yum|tom kha)\b/.test(n)) {
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
  // Mięsa / dania obiadowe (filet, pierś, schab…) — NIE zupy; confiture/glaze = cooked meat
  if (
    /\b(filet|piers|kurczak|schab|kotlet|stek|zeberk|wolow|wieprz|indyk|kaczka|de volaille|poledwic|antrykot|karkowk|udziec|skrzyde|nugget|confitur|glazur|boczek)\b/.test(n)
  ) {
    return 'meat';
  }
  return 'other';
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
  if (/steak|meat|mieso|grill|bbq|kotlet|schab|kurczak|beef|pork|ribs|roast/.test(path) && !/soup|zupa/.test(path)) return 'meat';
  return detectDishFamily(entry.labelPl);
}

/** Tokeny generyczne — sam „kurczak” nie wystarczy do silnego matcha. */
const WEAK_ALONE = new Set([
  'kurczak', 'wolow', 'wieprz', 'indyk', 'mieso', 'ryba', 'ser', 'sos', 'zupa', 'krem',
]);

/** Dice / token overlap 0–100. */
function tokenOverlapScore(qTokens: string[], cTokens: string[]): number {
  if (!qTokens.length || !cTokens.length) return 0;
  const cSet = new Set(cTokens);
  let hit = 0;
  for (const t of qTokens) {
    if (cSet.has(t)) {
      hit += 1;
      continue;
    }
    // dłuższe tokeny: prawie-exact (bez krótkich podciągów typu „sos”)
    if (t.length >= 5 && [...cSet].some((ct) => ct.length >= 5 && (ct.includes(t) || t.includes(ct)))) {
      hit += 0.85;
    }
  }
  const coverQ = hit / qTokens.length;
  const coverC = hit / cTokens.length;
  // Wymagaj mocnego pokrycia zapytań; lekkie pokrycie kandydata nie wystarczy
  let score = Math.round(100 * (0.7 * coverQ + 0.3 * Math.min(coverC, 1)));
  // Pojedynczy wspólny token (np. tylko „kurczak”) — cap, żeby zupa ≠ filet
  if (hit < 1.5 && qTokens.length >= 2) {
    score = Math.min(score, 52);
  }
  return score;
}

function bestCandidateScore(q: string, qTokens: string[], entry: DishImageEntry): number {
  const candidates = [entry.labelPl, ...entry.aliases, entry.slug.replace(/_/g, ' ')].map(normalizeDishName);
  let best = 0;
  for (const c of candidates) {
    if (!c) continue;
    if (q === c) return 100;
    const cTokens = significantTokens(c);
    // Pełne pokrycie znaczących tokenów zapytania w kandydacie
    if (qTokens.length >= 2 && qTokens.every((t) => cTokens.includes(t) || c.includes(t))) {
      best = Math.max(best, 92);
      continue;
    }
    if (qTokens.length === 1 && cTokens.includes(qTokens[0]) && cTokens.length <= 3) {
      const alone = qTokens[0];
      best = Math.max(best, WEAK_ALONE.has(alone) ? 70 : 90);
      continue;
    }
    const overlap = tokenOverlapScore(qTokens, cTokens);
    best = Math.max(best, overlap);
  }
  return best;
}

export type DishMatchResult = {
  slug: string;
  score: number;
  entry: DishImageEntry;
};

const STRONG_THRESHOLD = 85;

/**
 * Znajdź slug grafiki dania. Zwraca undefined gdy brak mocnego trafienia
 * (wtedy UI powinno użyć placeholdera kategorii, nie losowego jedzenia).
 */
export function findDishImageMatch(
  name: string,
  catalog: DishImageEntry[],
): DishMatchResult | undefined {
  const q = normalizeDishName(name);
  if (!q || !catalog.length) return undefined;
  const qTokens = significantTokens(q);
  const wantFamily = detectDishFamily(name);

  // 1) Exact label / alias
  for (const entry of catalog) {
    const labels = [entry.labelPl, ...entry.aliases].map(normalizeDishName);
    if (labels.includes(q)) {
      return { slug: entry.slug, score: 100, entry };
    }
  }

  // 2) Token / fuzzy ≥ threshold, z bonusem za rodzinę kategorii
  const ranked: DishMatchResult[] = [];
  for (const entry of catalog) {
    let score = bestCandidateScore(q, qTokens, entry);
    if (score <= 0) continue;
    const fam = familyFromEntry(entry);
    if (wantFamily !== 'other' && fam === wantFamily) score = Math.min(100, score + 8);
    else if (wantFamily !== 'other' && fam !== 'other' && fam !== wantFamily) {
      // Mięso ↔ zupa: twarda kara (filet kurczaka ≠ rosół)
      if ((wantFamily === 'meat' && fam === 'soups') || (wantFamily === 'soups' && fam === 'meat')) {
        score = Math.max(0, score - 45);
      } else {
        score = Math.max(0, score - 25);
      }
    }
    if (score >= STRONG_THRESHOLD) {
      ranked.push({ slug: entry.slug, score, entry });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked[0];
}

/** Compat: tylko slug (jak stary findSlugForName). */
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
  switch (fam) {
    case 'sauces':
      return pick('sos_smietankowo_ziolowy', 'sos_curry') ?? catalog.find((e) => /sauce|sos/.test(e.storagePath))?.slug;
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
      return pick('kotlet_schabowy', 'stek_ribeye', 'de_volaille') ?? catalog.find((e) => /steak|kotlet|grill|mieso|roast/.test(e.storagePath))?.slug;
    case 'sides':
      return pick('warzywa_grillowane', 'french_fries', 'coleslaw');
    case 'drink':
      return pick('espresso', 'lemoniada_cytrynowa') ?? catalog.find((e) => /coffee|tea|lemonade|juice/.test(e.storagePath))?.slug;
    default:
      return undefined;
  }
}
