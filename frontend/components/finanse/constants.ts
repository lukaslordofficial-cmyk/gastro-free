const _now = new Date();
/** Evaluated once at module load (same semantics as former screen-local constant). */
export const CURRENT_MONTH = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;

export const BASE_FIXED_TYPES = [
  { key: 'rent' as const, label: 'Czynsz lokalu' },
  { key: 'media' as const, label: 'Media' },
  { key: 'payroll' as const, label: 'Wynagrodzenia' },
];

export const BASE_VAR_TYPES = [
  { key: 'materials' as const, label: 'Surowce' },
  { key: 'waste' as const, label: 'Straty' },
];
