/**
 * Wspólna normalizacja nazw żywności (PL) do matchingu ikon / miniaturek.
 * Musi mapować ąłęśćńóźżŁ — inaczej „łosoś” → „osos” i trafia w butelki.
 */
export function normalizeFoodName(raw: string): string {
  if (!raw) return '';
  return String(raw)
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

/** Przymiotniki / dopiski, które nie powinny „przechwycić” innego produktu. */
export const FOOD_MODIFIER_TOKENS = new Set([
  'surowy', 'surowa', 'surowe', 'raw',
  'plat', 'platy', 'plaster', 'plastry', 'filet', 'filety', 'stek', 'steki',
  'swiezy', 'swieza', 'swieze', 'swiezo', 'fresh',
  'wyciskany', 'wyciskana', 'wyciskane', 'wyciskanych',
  'sezonowy', 'sezonowa', 'sezonowe', 'sezonowych',
  'domowy', 'domowa', 'domowe',
  'premium', 'bio', 'eko', 'light',
  'mrozony', 'mrozona', 'mrozone',
  'wedzony', 'wedzona', 'wedzone',
  'grillowany', 'grillowana', 'grillowane',
  'pieczony', 'pieczona', 'pieczone',
  'gotowany', 'gotowana', 'gotowane',
  'duzy', 'duza', 'male', 'maly', 'mala',
]);

/** Lekki stem PL: soki→sok, koktajle→koktajl (bez agresywnego stemmera). */
export function lightFoodStem(token: string): string {
  const t = token || '';
  if (t.length < 4) return t;
  if (t.endsWith('ami') || t.endsWith('ach')) return t.slice(0, -3);
  if (t.endsWith('ow') || t.endsWith('om') || t.endsWith('em')) return t.slice(0, -2);
  if (t.endsWith('ie') || t.endsWith('ye')) return t.slice(0, -2);
  if (/[aeiy]$/.test(t) && t.length >= 4) return t.slice(0, -1);
  return t;
}

/**
 * Pierwszy „rdzeń” nazwy (np. łosoś z „łosoś płat surowy”).
 */
export function foodHeadToken(normalizedQuery: string): string | null {
  const toks = normalizedQuery
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !FOOD_MODIFIER_TOKENS.has(t));
  const raw = toks[0] || null;
  return raw ? lightFoodStem(raw) : null;
}

/**
 * Czy dwa stemmy to ten sam rdzeń (nie: rice→ric ⊂ ricotta, sos ⊂ espresso).
 * Wymaga sensownej długości i proporcji — unikamy krótkich fałszywych prefixów.
 */
export function stemsCompatiblyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 4) return false;
  if (!longer.startsWith(shorter) && !longer.includes(shorter)) return false;
  // Prefix: dopuszczaj tylko małą różnicę długości (ryby↔ryba), nie ric⊂ricotta
  if (longer.startsWith(shorter)) {
    return longer.length - shorter.length <= 2;
  }
  // Substring w środku tylko dla dłuższych rdzeni (np. „łosoś” w „filet łosoś”)
  return shorter.length >= 6;
}

/**
 * Czy kandydat jest zakotwiczony w głównym słowie zapytania (łosoś⊂łosoś płat).
 */
export function candidateAnchoredToQuery(
  normalizedQuery: string,
  candidateLabels: string[],
): boolean {
  const head = foodHeadToken(normalizedQuery);
  if (!head || head.length < 4) return false;
  const qToks = new Set(
    normalizedQuery.split(/\s+/).filter(Boolean).map((t) => lightFoodStem(t)),
  );
  for (const label of candidateLabels) {
    const n = normalizeFoodName(label);
    if (!n) continue;
    if (n === normalizedQuery) return true;
    // Cała etykieta w zapytaniu — unikaj krótkich aliasów („ryz”, „ser”, „sos”)
    if (n.length >= 5 && normalizedQuery.includes(n)) return true;
    const lToks = n
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !FOOD_MODIFIER_TOKENS.has(t))
      .map((t) => lightFoodStem(t));
    if (lToks.length === 1 && stemsCompatiblyMatch(lToks[0], head)) return true;
    if (
      lToks.length >= 1 &&
      lToks.every((t) => [...qToks].some((qt) => stemsCompatiblyMatch(t, qt)))
    ) {
      if (lToks.some((t) => stemsCompatiblyMatch(t, head))) return true;
    }
  }
  return false;
}
