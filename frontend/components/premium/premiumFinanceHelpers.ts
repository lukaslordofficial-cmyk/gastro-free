export const WEEKDAYS_PL = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];

export function formatPLN(n: number): string {
  return Math.round(n).toLocaleString('pl-PL', { maximumFractionDigits: 0 }) + ' PLN';
}

export const MONTH_SHORT: Record<string, string> = {
  '01': 'Sty', '02': 'Lut', '03': 'Mar', '04': 'Kwi',
  '05': 'Maj', '06': 'Cze', '07': 'Lip', '08': 'Sie',
  '09': 'Wrz', '10': 'Paź', '11': 'Lis', '12': 'Gru',
};

export function compactAxisAmount(n: number): string {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 100000) return `${sign}${Math.round(abs / 1000)}k`;
  if (abs >= 10000) return `${sign}${Math.round(abs / 1000)}k`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}${Math.round(abs)}`;
}

/** Liczba dni w miesiącu YYYY-MM (miesiąc z napisu = 1–12). */
export function daysInYearMonth(ym: string): number {
  const [yy, mm] = ym.split('-').map(Number);
  if (!yy || !mm || mm < 1 || mm > 12) return 30;
  // day 0 of next calendar month = last day of `mm`
  return new Date(yy, mm, 0).getDate();
}

/**
 * Klucz dnia YYYY-MM-DD dla wpisu finansowego.
 * Preferuje prefiks ISO created_at; gdy brak — lokalna data z Date.
 */
export function financeEntryDayKey(
  createdAt: string | null | undefined,
  yearMonth?: string | null,
): string | null {
  const iso = String(createdAt || '').trim();
  const head = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) {
    if (yearMonth && !head.startsWith(yearMonth)) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime()) && yearMonth) {
        return `${yearMonth}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
    return head;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (yearMonth && /^\d{4}-\d{2}$/.test(yearMonth)) {
    return `${yearMonth}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
