/** Tytuł przelewu dla „Opłać zamówienie” (dane z ustawień restauracji). */

export function formatPlManualPayDate(d: Date = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function buildManualOrderTitle(opts: {
  restaurantName?: string | null;
  deliveryAddress?: string | null;
  date?: Date;
}): string {
  const name = (opts.restaurantName || '').trim() || '—';
  const addr = (opts.deliveryAddress || '').trim() || '—';
  const dateStr = formatPlManualPayDate(opts.date ?? new Date());
  return `Zamówienie dla restauracji ${name} na adres ${addr} ${dateStr}`;
}
