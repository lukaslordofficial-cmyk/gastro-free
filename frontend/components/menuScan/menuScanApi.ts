/**
 * Wywołania API i komunikaty błędów skanera menu (.agentrules §I / §II).
 */

import type { Suggestion, WeightUnit } from './menuScanTypes';

export const MENU_SCAN_BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '')
  .trim()
  .replace(/\/$/, '');

/** Chunk size for /api/menu/suggest-recipe — keeps each Railway request under proxy timeout. */
const SUGGEST_CHUNK = 4;

export function friendlyMenuScanApiError(status: number, detail: string): string {
  const raw = `${detail || ''}`.toLowerCase();
  const looksLikeCredits =
    raw.includes('kredyt') ||
    raw.includes('credit') ||
    raw.includes('saldo') ||
    raw.includes('kosztowa') ||
    (raw.includes('koszt') && (raw.includes('ai') || raw.includes('skan') || raw.includes('portfel')));
  if (status === 403 && looksLikeCredits) {
    return (
      'Backend odmówił operacji AI (kredyty / portfel). '
      + 'Zapis potraw bez sugestii AI nadal działa — wybierz „Nie, zapisz jak jest”. '
      + 'Jeśli w Subskrypcji widać saldo > 0, odśwież aplikację (Metro reload) i spróbuj ponownie.'
    );
  }
  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    raw.includes('application failed to respond') ||
    raw.includes('failed to respond') ||
    raw.includes('timeout') ||
    raw.includes('timed out')
  ) {
    return (
      'Serwer AI nie zdążył odpowiedzieć (timeout / 502). '
      + 'Spróbuj ponownie za chwilę albo zapisz bez sugestii AI („Nie”).'
    );
  }
  if (!MENU_SCAN_BACKEND_URL) {
    return 'Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).';
  }
  if (typeof detail === 'string' && detail.trim() && !raw.startsWith('<!')) {
    return detail.trim();
  }
  return `Błąd serwera (${status || '?'}). Spróbuj ponownie.`;
}

export async function parseMenuScanErrorDetail(res: Response): Promise<string> {
  const txt = await res.text();
  try {
    const j = JSON.parse(txt);
    const d = j?.detail ?? j?.message ?? j?.error ?? txt;
    return typeof d === 'string' ? d : JSON.stringify(d);
  } catch {
    return txt || `HTTP ${res.status}`;
  }
}

type AskDish = {
  name: string;
  category: string;
  ingredients: { name: string; quantity: number | null; unit: string }[];
  portion_weight_value: number | null;
  portion_weight_unit: WeightUnit | null;
};

/** Fetch suggestions in chunks to avoid Railway proxy 502 on large menus. */
export async function fetchMenuSuggestionsChunked(
  askDishes: AskDish[],
): Promise<Record<string, Suggestion>> {
  if (!MENU_SCAN_BACKEND_URL) {
    throw new Error('Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
  }
  const { apiJsonHeaders } = await import('@/lib/apiHeaders');
  const headers = await apiJsonHeaders();
  const byName: Record<string, Suggestion> = {};
  for (let i = 0; i < askDishes.length; i += SUGGEST_CHUNK) {
    const chunk = askDishes.slice(i, i + SUGGEST_CHUNK);
    const res = await fetch(`${MENU_SCAN_BACKEND_URL}/api/menu/suggest-recipe`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ dishes: chunk }),
    });
    if (!res.ok) {
      const detail = await parseMenuScanErrorDetail(res);
      throw new Error(friendlyMenuScanApiError(res.status, detail));
    }
    const sug = await res.json();
    for (const s of sug.dishes ?? []) {
      byName[(s.name ?? '').trim().toLowerCase()] = s;
    }
  }
  return byName;
}
