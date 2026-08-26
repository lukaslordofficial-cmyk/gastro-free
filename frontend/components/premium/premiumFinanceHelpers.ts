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
