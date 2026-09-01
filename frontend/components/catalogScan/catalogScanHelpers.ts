/**
 * Helpery API / meta skanera dokumentów — bez UI.
 */
import type { SupplierScanMeta } from './catalogScanTypes';

export const CATALOG_SCAN_BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '')
  .trim()
  .replace(/\/$/, '');

/** Client abort — Railway/proxy often dies ~100s; fail with clear message sooner. */
export const PROCESS_TIMEOUT_MS = 720_000; // do ~12 min — katalogi 30–40 stron (batch Vision)

export const PROCESSING_MESSAGES = [
  'Agent AI analizuje wgrany dokument…',
  'Czytam kolejne strony PDF (katalogi mogą mieć ich wiele)…',
  'Rozpoznaję typ dokumentu i pozycje…',
  'Segreguję produkty do właściwych zakładek…',
  'Szukam danych dostawcy (NIP, telefon, dostawa)…',
  'Duży plik = więcej tokenów OpenAI (rozliczenie 1:1 z usage)…',
  'Po zakończeniu zapiszę dane i Cię powiadomię.',
];

export const SAVING_MESSAGES = [
  'Zapisywanie produktów…',
  'Aktualizuję profil dostawcy…',
  'Aktualizuję stany magazynowe…',
  'Odświeżam listy w Magazynie…',
];

export function normalizeSupplierMeta(raw: any): SupplierScanMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: SupplierScanMeta = {};
  const strKeys = ['nip', 'phone', 'email', 'contact_person', 'address', 'bank_account', 'payment_terms'] as const;
  for (const k of strKeys) {
    const v = raw[k];
    if (v != null && String(v).trim()) out[k] = String(v).trim();
  }
  const numKeys = [
    'shipping_cost',
    'min_order_value',
    'free_shipping_threshold',
    'lead_time_days',
  ] as const;
  for (const k of numKeys) {
    const v = raw[k];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

export function supplierMetaHasContent(m: SupplierScanMeta | null | undefined): boolean {
  return !!m && Object.keys(m).length > 0;
}

export function friendlyCatalogScanApiError(status: number, detail: string): string {
  const raw = `${detail || ''}`.toLowerCase();
  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    raw.includes('application failed to respond') ||
    raw.includes('failed to respond') ||
    raw.includes('timeout') ||
    raw.includes('timed out') ||
    raw.includes('aborted')
  ) {
    return (
      'Serwer AI nie zdążył odpowiedzieć (timeout). '
      + 'Przy bardzo dużym PDF spróbuj ponownie albo podziel katalog na części '
      + '(limit ok. 40 stron na jeden skan).'
    );
  }
  if (!CATALOG_SCAN_BACKEND_URL) return 'Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).';
  if (typeof detail === 'string' && detail.trim() && !raw.startsWith('<!')) {
    return detail.trim();
  }
  return `Błąd serwera (${status || '?'}). Spróbuj ponownie.`;
}

export async function parseCatalogScanErrorDetail(res: Response): Promise<string> {
  const txt = await res.text();
  try {
    const j = JSON.parse(txt);
    const d = j?.detail ?? j?.message ?? j?.error ?? txt;
    return typeof d === 'string' ? d : JSON.stringify(d);
  } catch {
    return txt || `HTTP ${res.status}`;
  }
}
