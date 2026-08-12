/**
 * creditsUsage — etykiety endpointów AI i drzewo historii zużycia kredytów.
 * Struktura: Rok → Miesiąc → Tydzień → Dzień → transakcje.
 */

export type UsageEntry = {
  id: string;
  endpoint: string;
  model: string;
  credits: number;
  cost_pln: number;
  created_at: string;
  action_label: string;
  date: string;
  time: string;
};

export type UsageDayGroup = {
  date: string;
  items: UsageEntry[];
};

export type UsageTree = Map<number, Map<number, Map<number, UsageDayGroup[]>>>;

const ENDPOINT_LABELS: Record<string, string> = {
  '/api/voice/transcribe': 'Transkrypcja mowy',
  '/api/voice/interpret': 'Interpretacja głosu',
  '/api/documents/process': 'Skan dokumentu / faktury',
  '/api/menu/scan': 'Skan karty menu',
  '/api/menu/suggest-recipe': 'Sugestia receptury AI',
  '/api/inspirations/recipe': 'Inspiracje — przepis AI',
  '/api/recipes/ocr-text': 'Skan tekstu receptury',
  '/api/menu/confirm-scan': 'Kategoryzacja składników',
  '/api/orders/compare-offers': 'Łowca Okazji',
  '/api/pos/close-day': 'Zamknięcie dnia (raport AI)',
  '/api/reports/analyze-period': 'Analiza trendów AI',
  '/api/reports/compare-periods': 'Porównanie okresów AI',
};

export function endpointLabel(endpoint: string): string {
  if (ENDPOINT_LABELS[endpoint]) return ENDPOINT_LABELS[endpoint];
  const catalog = endpoint.match(/^\/api\/suppliers\/[^/]+\/upload-catalog$/);
  if (catalog) return 'Import katalogu dostawcy';
  return endpoint.replace(/^\/api\//, '').replace(/\//g, ' · ').replace(/-/g, ' ');
}

export function weekOfMonth(d: Date): number {
  return Math.min(5, Math.floor((d.getDate() - 1) / 7) + 1);
}

export function toLocalDateParts(iso: string): { date: string; time: string; year: number; month: number; week: number } {
  const dt = new Date(iso);
  // Invalid Date → dzisiaj (unikamy NaN w drzewie Rok/Miesiąc i crasha przy odświeżeniu).
  const safe = Number.isNaN(dt.getTime()) ? new Date() : dt;
  const y = safe.getFullYear();
  const m = safe.getMonth() + 1;
  const dd = String(safe.getDate()).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const hh = String(safe.getHours()).padStart(2, '0');
  const min = String(safe.getMinutes()).padStart(2, '0');
  return {
    date: `${y}-${mm}-${dd}`,
    time: `${hh}:${min}`,
    year: y,
    month: m,
    week: weekOfMonth(safe),
  };
}

export function normalizeUsageItems(
  raw: Array<{
    id: string;
    endpoint: string;
    model: string;
    credits: number;
    cost_pln: number;
    created_at: string;
  }>,
): UsageEntry[] {
  return raw.map((r) => {
    const parts = toLocalDateParts(r.created_at);
    return {
      ...r,
      action_label: endpointLabel(r.endpoint),
      date: parts.date,
      time: parts.time,
    };
  });
}

/** Pełna kwota w UI, np. „−8 kredytów”. */
export function formatCreditsCharge(credits: number): string {
  const n = Math.max(0, Math.round(Number(credits) || 0));
  const word = n === 1 ? 'kredyt' : n >= 2 && n <= 4 ? 'kredyty' : 'kredytów';
  return `−${n} ${word}`;
}

export function buildUsageTree(items: UsageEntry[]): UsageTree {
  const tree: UsageTree = new Map();
  for (const item of items) {
    const parts = toLocalDateParts(item.created_at);
    if (!tree.has(parts.year)) tree.set(parts.year, new Map());
    const months = tree.get(parts.year)!;
    if (!months.has(parts.month)) months.set(parts.month, new Map());
    const weeks = months.get(parts.month)!;
    if (!weeks.has(parts.week)) weeks.set(parts.week, []);
    const days = weeks.get(parts.week)!;
    let dayGroup = days.find((d) => d.date === item.date);
    if (!dayGroup) {
      dayGroup = { date: item.date, items: [] };
      days.push(dayGroup);
    }
    dayGroup.items.push(item);
  }
  for (const months of tree.values()) {
    for (const weeks of months.values()) {
      for (const days of weeks.values()) {
        days.sort((a, b) => b.date.localeCompare(a.date));
        for (const day of days) {
          day.items.sort((a, b) => b.created_at.localeCompare(a.created_at));
        }
      }
    }
  }
  return tree;
}

export const MONTHS_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

export const DOW_PL = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];

export function fmtDayLabel(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()} — ${DOW_PL[d.getDay()]}`;
}
