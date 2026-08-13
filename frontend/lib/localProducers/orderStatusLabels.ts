/**
 * Polskie etykiety statusów zamówień LP (lista Dostawy + szczegóły).
 */

export function paymentStatusLabelPl(status?: string | null): string {
  const s = String(status || '').toLowerCase();
  switch (s) {
    case 'paid':
      return 'Opłacono';
    case 'pending':
    case 'awaiting_payment':
    case 'pending_payment':
      return 'Oczekuje na płatność';
    case 'failed':
      return 'Nieudana';
    case 'refunded':
      return 'Zwrócono';
    case 'cancelled':
    case 'canceled':
      return 'Anulowano';
    default:
      return s ? s : '—';
  }
}

export function shipmentStatusLabelPl(status?: string | null): string {
  const s = String(status || '').toLowerCase();
  switch (s) {
    case 'draft':
      return 'Szkic';
    case 'confirmed':
      return 'Potwierdzone';
    case 'preparing':
      return 'Przygotowywane';
    case 'awaiting_courier':
      return 'Kurier zamówiony';
    case 'shipped':
      return 'W drodze';
    case 'delivered':
      return 'Doręczone';
    case 'cancelled':
    case 'canceled':
      return 'Anulowano';
    default:
      return s ? s : '—';
  }
}

export function deliverySummaryLabelPl(order: {
  payment_status?: string | null;
  shipment_status?: string | null;
}): string {
  const pay = String(order.payment_status || '').toLowerCase();
  if (pay !== 'paid') return paymentStatusLabelPl(pay);
  const ship = String(order.shipment_status || '').toLowerCase();
  if (ship === 'delivered') return 'Doręczone';
  if (ship === 'shipped') return 'Kurier w drodze';
  if (ship === 'awaiting_courier') return 'Kurier zamówiony po paczkę';
  if (ship === 'preparing') return 'Przygotowywane u przetwórcy';
  if (ship === 'confirmed') return 'Opłacono · Potwierdzone';
  return 'Opłacono';
}
