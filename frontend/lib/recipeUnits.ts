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
