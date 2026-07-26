/** Normalizacja jednostek z inspiracji/receptur do przycisków w Menu. */
const MENU_UNITS = ['g', 'ml', 'szt', 'kg', 'L'] as const;
export type MenuUnit = (typeof MENU_UNITS)[number];

export function normalizeMenuUnit(raw: string | null | undefined): MenuUnit {
  const x = (raw || '').trim().toLowerCase().replace(/\.$/, '');
  if (!x) return 'g';
  if (['g', 'gr', 'gram', 'gramy', 'gramow', 'gramów'].includes(x)) return 'g';
  if (['kg', 'kilogram', 'kilogramy', 'kilogramow', 'kilogramów'].includes(x)) return 'kg';
  if (['ml', 'mililitr', 'mililitry', 'mililitrow', 'mililitrów'].includes(x)) return 'ml';
  if (['l', 'ltr', 'litr', 'litry', 'litrow', 'litrów'].includes(x)) return 'L';
  if (['szt', 'sztuka', 'sztuki', 'sztuk', 'pcs', 'pc'].includes(x)) return 'szt';
  if (x === 'opak' || x === 'op') return 'szt';
  const hit = MENU_UNITS.find((u) => u.toLowerCase() === x);
  return hit ?? 'g';
}

/**
 * Ilości w recepturze: zawsze całkowite liczby całkowite ≥ 1.
 * Ułamki typu 0.25 g pieprzu/soli → minimum 1 (idealnie 1–2 na porcję).
 */
export function normalizeRecipeQuantity(qty: number | string | null | undefined): number {
  const n = typeof qty === 'string' ? parseFloat(qty.replace(',', '.')) : Number(qty);
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (n < 1) return 1;
  return Math.max(1, Math.round(n));
}

/** Bezpieczny odczyt opcjonalnej wagi sztuki (unika crasha `.trim()` na undefined). */
export function parseOptionalPieceWeightG(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const pw = parseFloat(s.replace(',', '.'));
  return Number.isFinite(pw) && pw > 0 ? pw : null;
}
