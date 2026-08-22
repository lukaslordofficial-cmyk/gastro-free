/**
 * Jednostki magazynowe przy odbiorze dostaw / fuzzy match.
 * „Pęczek”, „wiązka” itd. = sztuka.
 */

const PIECE_ALIASES = new Set([
  'szt',
  'szt.',
  'sztuka',
  'sztuki',
  'sztuk',
  'pcs',
  'pc',
  'opak',
  'op',
  'op.',
  'opakowanie',
  'peczek',
  'peczki',
  'peczka',
  'pęczek',
  'pęczki',
  'pęczka',
  'wiazka',
  'wiązka',
  'wiazki',
  'wiązki',
  'bunch',
  'bunches',
  'pack',
  'packs',
]);

/** Szum opakowań / jednostek w nazwie produktu (koperek pęczek → koperek). */
const NAME_UNIT_NOISE = new Set([
  'peczek',
  'peczki',
  'peczka',
  'wiazka',
  'wiazki',
  'bunch',
  'bunches',
  'szt',
  'sztuka',
  'sztuki',
  'opak',
  'opakowanie',
  'paczka',
  'paczek',
  'luz',
  'luzem',
  'kg',
  'g',
  'gr',
  'l',
  'ml',
  'litr',
  'litry',
]);

function stripAccents(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Normalizacja jednostki do zapisu w magazynie. Nieznane → null (caller → Inne / szt). */
export function normalizeWarehouseUnit(raw: string | null | undefined): string | null {
  const x = stripAccents((raw || '').trim()).replace(/\.$/, '');
  if (!x) return 'szt';
  if (PIECE_ALIASES.has(x)) return 'szt';
  if (['g', 'gr', 'gram', 'gramy', 'gramow'].includes(x)) return 'g';
  if (['kg', 'kilogram', 'kilogramy', 'kilogramow'].includes(x)) return 'kg';
  if (['ml', 'mililitr', 'mililitry'].includes(x)) return 'ml';
  if (['l', 'ltr', 'litr', 'litry', 'litrow'].includes(x)) return 'L';
  // nierozpoznana jednostka
  return null;
}

/** Nazwa do fuzzy match — bez „pęczek”, „kg” itd. */
export function stripUnitNoiseFromProductName(raw: string): string {
  const parts = (raw || '')
    .trim()
    .split(/[\s,/|]+/)
    .filter(Boolean);
  const kept = parts.filter((p) => {
    const n = stripAccents(p).replace(/\.$/, '');
    if (!n) return false;
    if (NAME_UNIT_NOISE.has(n)) return false;
    if (/^\d+([.,]\d+)?(kg|g|ml|l|szt)?$/i.test(n)) return false;
    return true;
  });
  return kept.join(' ').trim() || (raw || '').trim();
}
