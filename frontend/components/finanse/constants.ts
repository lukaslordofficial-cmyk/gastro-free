/** Aktualny miesiąc YYYY-MM (liczony przy wywołaniu — nie przy starcie bundla). */
export function currentYearMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Poprzedni miesiąc względem YYYY-MM. */
export function previousYearMonth(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec((ym || '').trim());
  if (!m) return null;
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/** Etykieta PL: „sierpień 2026”. */
export function yearMonthLabelPl(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec((ym || '').trim());
  if (!m) return ym;
  const months = [
    'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
    'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
  ];
  const idx = Number(m[2]) - 1;
  return `${months[idx] || m[2]} ${m[1]}`;
}

/**
 * Compat: dawniej stała z czasu ładowania modułu.
 * Preferuj currentYearMonth() w nowym kodzie.
 */
export const CURRENT_MONTH = currentYearMonth();

export const BASE_FIXED_TYPES = [
  { key: 'rent' as const, label: 'Czynsz lokalu' },
  { key: 'media' as const, label: 'Media' },
  { key: 'payroll' as const, label: 'Wynagrodzenia' },
];

export const BASE_VAR_TYPES = [
  { key: 'materials' as const, label: 'Surowce' },
  { key: 'waste' as const, label: 'Straty' },
];
