/**
 * Lekki fuzzy-matcher nazw produktów (menu ↔ magazyn ↔ oferty dostawców).
 * Bez ML — normalizacja PL, synonimy kulinarne, stem-ish, Jaccard + Levenshtein.
 */

const STOP = new Set([
  'a', 'i', 'z', 'ze', 'w', 'we', 'na', 'do', 'od', 'po', 'pod', 'nad', 'przy',
  'bez', 'dla', 'oraz', 'lub', 'albo', 'the', 'of', 'and', 'with', 'de', 'la',
  'swiezy', 'swieze', 'swieza', 'fresh', 'bio', 'eko', 'premium', 'classic',
  'extra', 'light', 'opak', 'opakowanie', 'virgin', 'organic', 'selection',
  // Formy opakowania / porcji — „ser kozi” ↔ „ser kozi rolka”
  'rolka', 'rolki', 'rolke', 'kostka', 'kostki', 'blok', 'bloki', 'plastry',
  'plaster', 'krazek', 'krazki', 'kreg', 'kregi', 'tacka', 'tacki', 'luz',
  'luzem', 'porcja', 'porcje', 'opakowanie', 'paczk', 'paczka', 'szt', 'sztuka',
]);

/** Synonimy kulinarne → kanoniczny token (po normalizacji). */
const SYNONYM: Record<string, string> = {
  filet: 'piers',
  filety: 'piers',
  filetem: 'piers',
  filetu: 'piers',
  piersi: 'piers',
  piersiami: 'piers',
  piers: 'piers',
  kurczaka: 'kurczak',
  kurczakiem: 'kurczak',
  kurczaki: 'kurczak',
  kurczakowi: 'kurczak',
  drobiowy: 'kurczak',
  drobiowa: 'kurczak',
  drobiowe: 'kurczak',
  indyka: 'indyk',
  indykiem: 'indyk',
  wolowego: 'wolow',
  wolowa: 'wolow',
  wolowy: 'wolow',
  wolowe: 'wolow',
  wolowina: 'wolow',
  wolowiny: 'wolow',
  wieprzowego: 'wieprz',
  wieprzowa: 'wieprz',
  wieprzowy: 'wieprz',
  wieprzowina: 'wieprz',
  oliwek: 'oliw',
  oliwa: 'oliw',
  oliwy: 'oliw',
  oliwie: 'oliw',
  olive: 'oliw',
  olives: 'oliw',
  cukru: 'cukier',
  cukrem: 'cukier',
  soli: 'sol',
  sola: 'sol',
  pieprzu: 'pieprz',
  czosnku: 'czosnek',
  czosnkiem: 'czosnek',
  cebuli: 'cebula',
  cebula: 'cebula',
  pomidorow: 'pomidor',
  pomidory: 'pomidor',
  pomidora: 'pomidor',
  ziemniakow: 'ziemniak',
  ziemniaki: 'ziemniak',
  majonezu: 'majonez',
  musztardy: 'musztarda',
  smietany: 'smietana',
  smietana: 'smietana',
  mleka: 'mleko',
  masla: 'maslo',
  maslem: 'maslo',
  sera: 'ser',
  serem: 'ser',
  sery: 'ser',
  cheese: 'ser',
  kozi: 'kozi',
  koziego: 'kozi',
  kozia: 'kozi',
  kozie: 'kozi',
  feta: 'feta',
  mozzarella: 'mozzarella',
  mozarella: 'mozzarella',
  cheddar: 'cheddar',
  gouda: 'gouda',
  parmezan: 'parmezan',
  parmigiano: 'parmezan',
  ricotta: 'ricotta',
  jajka: 'jajko',
  jajek: 'jajko',
  jaja: 'jajko',
  zoltko: 'jajko',
  zoltka: 'jajko',
  bialko: 'jajko',
  bialka: 'jajko',
  yolk: 'jajko',
  marchewki: 'marchew',
  marchewek: 'marchew',
  marchewka: 'marchew',
  marchewke: 'marchew',
  marchew: 'marchew',
  bataty: 'batat',
  batatow: 'batat',
  batata: 'batat',
  batatem: 'batat',
  batat: 'batat',
  bob: 'bob',
  bobu: 'bob',
  bobem: 'bob',
  bobow: 'bob',
  fasolki: 'fasol',
  fasolka: 'fasol',
  fasoli: 'fasol',
  fasola: 'fasol',
  ogorki: 'ogorek',
  ogorkow: 'ogorek',
  papryki: 'papryka',
  papryk: 'papryka',
  cukinie: 'cukinia',
  cukinii: 'cukinia',
  baklazany: 'baklazan',
  pieczarki: 'pieczarka',
  pieczarek: 'pieczarka',
  grzyby: 'grzyb',
  grzybow: 'grzyb',
  borowiki: 'borowik',
  borowikow: 'borowik',
  boczniaki: 'boczniak',
  boczniakow: 'boczniak',
  cebule: 'cebula',
  czosnki: 'czosnek',
  cytryny: 'cytryna',
  limonki: 'limonka',
  jabłka: 'jablko',
  jablka: 'jablko',
  jablek: 'jablko',
  banany: 'banan',
  bananow: 'banan',
  truskawki: 'truskawka',
  truskawek: 'truskawka',
  maliny: 'malina',
  malin: 'malina',
  orzechy: 'orzech',
  orzechow: 'orzech',
  migdaly: 'migdal',
  migdalow: 'migdal',
  rodzynki: 'rodzynka',
  rodzynkow: 'rodzynka',
  oliwki: 'oliwka',
  kapary: 'kapar',
  kaparow: 'kapar',
  bazylie: 'bazylia',
  pietruszki: 'pietruszka',
  koperki: 'koperek',
  szczypiorki: 'szczypiorek',
  ryze: 'ryz',
  makarony: 'makaron',
  bulki: 'bulka',
  bulek: 'bulka',
  chleby: 'chleb',
  chlebow: 'chleb',
  kielbasy: 'kielbasa',
  kielbas: 'kielbasa',
  szynki: 'szynka',
  szynek: 'szynka',
  boczki: 'boczek',
  steki: 'stek',
  kotlety: 'kotlet',
  kotletow: 'kotlet',
  krewetki: 'krewetka',
  krewetek: 'krewetka',
  muszle: 'muszla',
};

const NORM_CACHE = new Map<string, string>();
const TOKENS_CACHE = new Map<string, string[]>();
const CACHE_MAX = 4000;

function cacheSet<T>(map: Map<string, T>, key: string, value: T): T {
  if (map.size >= CACHE_MAX) {
    let i = 0;
    const drop = Math.floor(CACHE_MAX / 3);
    for (const k of map.keys()) {
      map.delete(k);
      if (++i >= drop) break;
    }
  }
  map.set(key, value);
  return value;
}

export function normalizePolish(raw: string): string {
  const hit = NORM_CACHE.get(raw);
  if (hit !== undefined) return hit;
  const s = (raw || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|l|ml|cl|szt|op|opak)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cacheSet(NORM_CACHE, raw, s);
}

function lightStem(token: string): string {
  if (SYNONYM[token]) return SYNONYM[token];
  const suffixes = ['ami', 'ach', 'owi', 'iem', 'ami', 'ow', 'om', 'em', 'ie'];
  for (const suf of suffixes) {
    if (token.length > suf.length + 3 && token.endsWith(suf)) {
      const stem = token.slice(0, -suf.length);
      return SYNONYM[stem] ?? stem;
    }
  }
  // końcówki 1-literowe: bataty→batat, pomidory→pomidor (len≥5)
  if (token.length >= 5 && /[ayiue]$/.test(token)) {
    const stem = token.slice(0, -1);
    if (stem.length >= 4) return SYNONYM[stem] ?? stem;
  }
  return token;
}

/** Znaczące tokeny kanoniczne (posortowane, unikalne). */
export function productTokens(raw: string): string[] {
  const key = raw || '';
  const cached = TOKENS_CACHE.get(key);
  if (cached) return cached;
  const norm = normalizePolish(key);
  const tokens = norm
    .split(' ')
    .filter((t) => t.length >= 2 && !STOP.has(t))
    .map(lightStem)
    .filter((t) => t.length >= 2 && !STOP.has(t));
  const uniq = [...new Set(tokens)].sort();
  return cacheSet(TOKENS_CACHE, key, uniq);
}

/** Znormalizowany klucz do porównań (tokeny posortowane). */
export function productMatchKey(raw: string): string {
  return productTokens(raw).join(' ');
}

/**
 * Kanoniczna nazwa składnika do zapisu / dedupe (pomidory → pomidor, jajka → jajko).
 * Stem-ish + synonimy PL; wielowyrazowe zachowuje czytelny zapis z kanonicznymi tokenami.
 */
const SINGULAR_DISPLAY: Record<string, string> = {
  pomidor: 'pomidor',
  jajko: 'jajko',
  ziemniak: 'ziemniak',
  marchew: 'marchew',
  batat: 'batat',
  bob: 'bób',
  fasol: 'fasola',
  ogorek: 'ogórek',
  papryka: 'papryka',
  cukinia: 'cukinia',
  baklazan: 'bakłażan',
  pieczarka: 'pieczarka',
  grzyb: 'grzyb',
  borowik: 'borowik',
  boczniak: 'boczniak',
  cebula: 'cebula',
  czosnek: 'czosnek',
  cytryna: 'cytryna',
  limonka: 'limonka',
  jablko: 'jabłko',
  banan: 'banan',
  truskawka: 'truskawka',
  malina: 'malina',
  orzech: 'orzech',
  migdal: 'migdał',
  oliwka: 'oliwka',
  kapar: 'kapar',
  bazylia: 'bazylia',
  pietruszka: 'pietruszka',
  koperek: 'koperek',
  szczypiorek: 'szczypiorek',
  ryz: 'ryż',
  makaron: 'makaron',
  bulka: 'bułka',
  chleb: 'chleb',
  kielbasa: 'kiełbasa',
  szynka: 'szynka',
  boczek: 'boczek',
  filet: 'filet',
  piers: 'pierś',
  stek: 'stek',
  kotlet: 'kotlet',
  krewetka: 'krewetka',
  kurczak: 'kurczak',
  indyk: 'indyk',
  maslo: 'masło',
  mleko: 'mleko',
  smietana: 'śmietana',
  ser: 'ser',
  cukier: 'cukier',
  sol: 'sól',
  pieprz: 'pieprz',
  majonez: 'majonez',
  musztarda: 'musztarda',
  oliw: 'oliwa',
};

export function normalizeIngredientName(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;
  const tokens = productTokens(trimmed);
  if (!tokens.length) return trimmed;
  if (tokens.length === 1) {
    return SINGULAR_DISPLAY[tokens[0]] ?? trimmed;
  }
  // Wielowyrazowe: singularizuj TYLKO ostatni wyraz oryginału.
  // Nie wolno brać ostatniego z posortowanych tokenów — „ser biały” → tokeny
  // [bialy, ser] kończą się na „ser” i błędnie zamieniały „biały” → „ser ser”.
  const parts = trimmed.split(/\s+/);
  const lastRaw = parts[parts.length - 1] || '';
  if (!/y$|i$|e$|ów$|ow$/i.test(lastRaw)) return trimmed;
  const lastTok = productTokens(lastRaw)[0];
  const lastDisp = lastTok ? SINGULAR_DISPLAY[lastTok] : undefined;
  if (!lastDisp) return trimmed;
  parts[parts.length - 1] = lastDisp;
  return parts.join(' ');
}

/** Klucz dedupe magazyn ↔ receptura (pomidor === pomidory). */
export function ingredientDedupeKey(raw: string): string {
  return productMatchKey(normalizeIngredientName(raw)) || productMatchKey(raw);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
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

function tokenJaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const bSet = new Set(b);
  let inter = 0;
  for (const t of a) if (bSet.has(t)) inter += 1;
  const union = a.length + b.length - inter;
  return union > 0 ? inter / union : 0;
}

function softTokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let hit = 0;
  for (const t of a) {
    if (b.includes(t)) {
      hit += 1;
      continue;
    }
    if (t.length >= 4 && b.some((bt) => bt.length >= 4 && (bt.includes(t) || t.includes(bt) || levenshtein(t, bt) <= 1))) {
      hit += 0.85;
    }
  }
  return hit / a.length;
}

/**
 * Wynik 0–100. ≥72 ≈ pewne dopasowanie kulinarne (filet z piersi kurczaka ↔ pierś z kurczaka).
 */
export function scoreProductNames(a: string, b: string): number {
  const ka = productMatchKey(a);
  const kb = productMatchKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 100;

  const ta = productTokens(a);
  const tb = productTokens(b);
  const jaccard = tokenJaccard(ta, tb);
  const coverA = softTokenOverlap(ta, tb);
  const coverB = softTokenOverlap(tb, ta);
  const cover = 0.55 * coverA + 0.45 * coverB;

  const maxLen = Math.max(ka.length, kb.length);
  const levSim = maxLen > 0 ? 1 - levenshtein(ka, kb) / maxLen : 0;

  // Wymagaj sensownego pokrycia tokenów — sam Levenshtein na długich stringach nie wystarczy
  let score = 100 * (0.5 * cover + 0.35 * jaccard + 0.15 * levSim);

  // Bonus: wszystkie tokeny krótszej nazwy pokryte
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  if (shorter.length >= 2 && shorter.every((t) => longer.includes(t) || longer.some((l) => l.includes(t) || t.includes(l)))) {
    score = Math.max(score, 88);
  }
  if (shorter.length === 1 && longer.includes(shorter[0]) && longer.length <= 3) {
    score = Math.max(score, 82);
  }
  // Prefiks / odmiana: marchew ⊂ marchewka, bob ⊂ bobu (gdy synonim nie złapał)
  if (shorter.length === 1 && longer.length === 1) {
    const a = shorter[0];
    const b = longer[0];
    if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) {
      score = Math.max(score, 90);
    }
  }
  // „ser kozi” ⊂ „ser kozi rolka” (po odfiltrowaniu form opakowania w STOP)
  if (shorter.length >= 2 && shorter.every((t) => longer.includes(t)) && longer.length - shorter.length <= 2) {
    score = Math.max(score, 92);
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}

/** Lista kandydatów z wynikami — do UI (near-hits) i lokalnego wyszukiwania katalogu. */
export function rankProductMatches<T>(
  query: string,
  candidates: readonly T[],
  getName: (c: T) => string,
  opts?: { threshold?: number; limit?: number },
): Array<{ item: T; score: number }> {
  const threshold = opts?.threshold ?? 55;
  const limit = opts?.limit ?? 40;
  const ranked: Array<{ item: T; score: number }> = [];
  for (const c of candidates) {
    const score = scoreProductNames(query, getName(c));
    if (score < threshold) continue;
    ranked.push({ item: c, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

export function namesMatch(a: string, b: string, threshold = 72): boolean {
  return scoreProductNames(a, b) >= threshold;
}

export function bestProductMatch<T>(
  query: string,
  candidates: readonly T[],
  getName: (c: T) => string,
  threshold = 72,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const c of candidates) {
    const score = scoreProductNames(query, getName(c));
    if (score < threshold) continue;
    if (!best || score > best.score) best = { item: c, score };
  }
  return best;
}

/** Czy nazwa produktu występuje na liście składników menu (fuzzy). */
export function matchesAnyMenuIngredient(
  productName: string,
  ingredientNames: readonly string[],
  threshold = 72,
): boolean {
  if (!productName || !ingredientNames.length) return false;
  return ingredientNames.some((ing) => namesMatch(productName, ing, threshold));
}
