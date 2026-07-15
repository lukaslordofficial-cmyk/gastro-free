/**
 * Polish currency formatting: 17.2 → "17,20 zł", 17 → "17,00 zł"
 * Always two decimals, comma separator.
 */
export function formatPln(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0,00 zł';
  return `${n.toFixed(2).replace('.', ',')} zł`;
}

/** Same as formatPln but without the "zł" suffix (e.g. for input fields / raw stats). */
export function formatPlnNumber(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

/** Parses a user-typed price like "17,20" or "17.20" → 17.2 (returns 0 if invalid). */
export function parsePln(input: string): number {
  const cleaned = (input ?? '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
