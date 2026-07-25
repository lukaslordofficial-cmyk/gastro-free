/**
 * Krótkie tipy HACCP / przechowywania — podpowiedzi głosowe i UI.
 * Klucze = fragmenty nazwy produktu (lowercase, bez PL znaków w matchu).
 */
export type HaccpTip = {
  id: string;
  keys: string[];
  titlePl: string;
  bodyPl: string;
  tempC?: string;
  maxHours?: string;
};

export const HACCP_TIPS: HaccpTip[] = [
  {
    id: 'fifo',
    keys: ['fifo', 'kolejnosc', 'rotacja'],
    titlePl: 'Zasada FIFO',
    bodyPl:
      'First In, First Out: produkty z najkrótszą datą ważności idą na przód półki i są zużywane jako pierwsze. Etykietuj każdą partię datą otwarcia/przyjęcia.',
  },
  {
    id: 'ryby',
    keys: ['ryb', 'losos', 'dorsz', 'krewet', 'malz', 'ostry'],
    titlePl: 'Świeże ryby i owoce morza',
    bodyPl: 'Przechowuj w lodówce 0–2°C, osobna strefa od mięsa. Zużyj w ciągu 24–48 h od przyjęcia. Nie zostawiaj na rampie w upale.',
    tempC: '0–2°C',
    maxHours: '24–48 h',
  },
  {
    id: 'mieso',
    keys: ['mieso', 'wolow', 'wieprz', 'kurczak', 'indyk', 'mielon'],
    titlePl: 'Mięso świeże',
    bodyPl: 'Lodówka 0–4°C, dolna półka. Surowy kurczak osobno. Po otwarciu opakowania — zużyj w 24–48 h lub zamroź.',
    tempC: '0–4°C',
    maxHours: '24–48 h po otwarciu',
  },
  {
    id: 'nabial',
    keys: ['mleko', 'smietan', 'jogurt', 'ser ', 'twarog', 'jajk'],
    titlePl: 'Nabiał i jaja',
    bodyPl: '2–6°C, nie trzymaj w drzwiach lodówki. Po otwarciu mleka/śmietany — zużyj w 2–3 dni. Jaja w oryginalnym opakowaniu.',
    tempC: '2–6°C',
  },
  {
    id: 'salata',
    keys: ['salat', 'rukol', 'szpinak', 'mix salat', 'lodowa'],
    titlePl: 'Sałaty i zielenina',
    bodyPl: 'Przed podaniem namocz krótko w zimnej wodzie — liście stają się bardziej chrupiące. Osusz i trzymaj w pojemniku z wilgotnym ręcznikiem, 2–5°C.',
    tempC: '2–5°C',
  },
  {
    id: 'ryz',
    keys: ['ryz', 'risotto', 'basmati'],
    titlePl: 'Ryż ugotowany',
    bodyPl: 'Po ugotowaniu szybko schłodź. Do sypkości możesz przepłukać zimną wodą (np. do sałatek). W lodówce max 24 h; nie trzymaj w strefie ciepła.',
    tempC: '≤5°C po schłodzeniu',
    maxHours: '24 h',
  },
  {
    id: 'polprodukt',
    keys: ['sos', 'wywar', 'bulion', 'polprodukt', 'gulasz', 'zupa'],
    titlePl: 'Półprodukty / sosy / wywary',
    bodyPl: 'Szybko schłodź (max 2 h do ≤5°C). Etykieta: data produkcji + data ważności. Przed podaniem podgrzej do ≥75°C w środku.',
    tempC: '≤5°C przechowywanie / ≥75°C regeneracja',
  },
  {
    id: 'warzywa',
    keys: ['pomidor', 'ogorek', 'papryk', 'ziemniak', 'cebula', 'czosnek'],
    titlePl: 'Warzywa',
    bodyPl: 'Ziemniaki/cebula/czosnek — chłodne, ciemne, suche (nie lodówka). Liściaste i pokrojone — lodówka 2–5°C, oddzielnie od surowego mięsa.',
  },
];

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

export function findHaccpTips(query: string, limit = 3): HaccpTip[] {
  const q = norm(query);
  if (!q.trim()) return [HACCP_TIPS[0]];
  const hits = HACCP_TIPS.filter((t) => t.keys.some((k) => q.includes(norm(k)) || norm(k).includes(q)));
  if (hits.length) return hits.slice(0, limit);
  if (q.includes('fifo') || q.includes('przechow')) return [HACCP_TIPS[0]];
  return [HACCP_TIPS[0], ...HACCP_TIPS.slice(1, 3)].slice(0, limit);
}
