/**
 * Heurystyka kategorii magazynowej z nazwy produktu (bez LLM).
 * Używa tych samych tokenów/stemów co fuzzyProductMatch (bataty → batat).
 */
import { productTokens } from '@/lib/fuzzyProductMatch';
import { normCategoryName } from '@/lib/warehouseCategories';

const CAT_KEYWORDS: Array<{ category: string; words: string[] }> = [
  {
    category: 'Warzywa i owoce',
    words: [
      'pomidor', 'cebula', 'czosnek', 'salat', 'ogorek', 'baklazan', 'jabl', 'banan',
      'cytryn', 'marchew', 'ziemniak', 'papryk', 'brokul', 'kalafior', 'burak', 'kapust',
      'szpinak', 'awokado', 'grzyb', 'pieczark', 'owoc', 'warzyw', 'por', 'seler', 'pietruszk',
      'koperek', 'bazyl', 'natk', 'rzodkiew', 'cukini', 'dyni', 'gruszk', 'truskawk', 'malin',
      'borowk', 'jagod', 'winogron', 'arbuz', 'melon', 'ananas', 'mango', 'kiwi', 'batat',
      'bob', 'fasol', 'groch', 'soczewic', 'groszek', 'kalarep', 'bruksel', 'porzeczk',
    ],
  },
  {
    category: 'Nabiał',
    words: [
      'mleko', 'ser', 'smietan', 'jogurt', 'maslo', 'twarog', 'mozarella', 'mozzarella',
      'parmezan', 'jajk', 'jajec', 'kefir', 'maslank', 'ricotta', 'feta', 'goud', 'cheddar',
    ],
  },
  {
    category: 'Mięso i wędliny',
    words: [
      'kurczak', 'wolow', 'wieprz', 'indyk', 'schab', 'karkow', 'wedlin', 'boczek', 'kielbas',
      'szynk', 'filet', 'udziec', 'mieso', 'kaczka', 'mielon', 'parowk', 'kabanos', 'salami',
    ],
  },
  {
    category: 'Ryby i owoce morza',
    words: [
      'ryba', 'ryby', 'losos', 'dorsz', 'krewet', 'tuna', 'tunczyk', 'sledz', 'makrel',
      'kalmar', 'mintaj', 'pstrag',
    ],
  },
  {
    category: 'Pieczywo',
    words: ['chleb', 'bulka', 'bagiet', 'ciabatta', 'tortilla', 'wrap', 'pieczyw', 'croissant', 'pita'],
  },
  {
    category: 'Oleje i tłuszcze',
    words: ['oliwa', 'oliw', 'olive', 'olej', 'smalec', 'frytur', 'ghee'],
  },
  {
    category: 'Przyprawy',
    words: ['przypraw', 'pieprz', 'curry', 'oregano', 'tymianek', 'kminek', 'cynamon', 'kurkum', 'chili'],
  },
  {
    category: 'Suchy magazyn',
    words: ['maka', 'ryz', 'makaron', 'cukier', 'sol', 'ocet', 'konserw', 'kasza', 'drozdze'],
  },
  {
    category: 'Napoje',
    words: ['woda', 'sok', 'napoj', 'cola', 'lemoniad', 'herbata', 'kawa'],
  },
  {
    category: 'Alkohole',
    words: ['wino', 'piwo', 'wodka', 'whisky', 'rum', 'gin', 'likier', 'szampan'],
  },
  {
    category: 'Mrożonki',
    words: ['mrozon', 'mrozonka', 'frozen'],
  },
];

function tokenHit(word: string, tokens: string[]): boolean {
  const w = (word || '').trim().toLowerCase();
  if (!w || !tokens.length) return false;
  for (const t of tokens) {
    if (t === w) return true;
    if (w.length >= 3 && t.startsWith(w)) return true;
    if (w.length >= 4 && w.startsWith(t) && t.length >= 3) return true;
  }
  return false;
}

/** Zwraca nazwę kategorii do mapowania na inventory_categories użytkownika. */
export function guessWarehouseCategoryName(productName: string): string {
  const tokens = productTokens(productName);
  if (!tokens.length) return 'Inne';
  let best: string | null = null;
  let bestScore = 0;
  for (const { category, words } of CAT_KEYWORDS) {
    const hits = words.filter((w) => tokenHit(w, tokens));
    if (!hits.length) continue;
    const score = hits.length * 10 + Math.max(...hits.map((h) => h.length));
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best || 'Inne';
}

/** Dopasuj kanoniczną nazwę do istniejących kategorii konta (np. „Warzywa” ↔ „Warzywa i owoce”). */
export function mapGuessToUserCategory(
  guessed: string,
  userCategories: Array<{ id: string; name: string }>,
): { id: string; name: string } | null {
  if (!userCategories.length) return null;
  const g = normCategoryName(guessed);
  for (const c of userCategories) {
    if (normCategoryName(c.name) === g) return c;
  }
  for (const c of userCategories) {
    const n = normCategoryName(c.name);
    if (g && n && (g.includes(n) || n.includes(g))) return c;
  }
  if (g.includes('warzyw') || g.includes('owoc')) {
    const hit = userCategories.find((c) => {
      const n = normCategoryName(c.name);
      return n.includes('warzyw') || n.includes('owoc');
    });
    if (hit) return hit;
  }
  const inne = userCategories.find((c) => normCategoryName(c.name) === 'inne');
  return inne ?? null;
}
