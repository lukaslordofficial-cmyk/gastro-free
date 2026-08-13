/**
 * Waga zamówienia LP + cena kuriera InPost (te same progi co backend lp_courier_price.py).
 */

export type CourierQuoteItem = {
  quantity: number;
  unit?: string | null;
  weight_g?: number | null;
};

export function lineWeightKg(item: CourierQuoteItem): number {
  const qty = Number(item.quantity) || 0;
  if (qty <= 0) return 0;
  const u = String(item.unit || 'szt').trim().toLowerCase();
  if (['kg', 'kilogram', 'kilogramy', 'kilograma'].includes(u)) return qty;
  if (['g', 'gram', 'gramy', 'grama'].includes(u)) return qty / 1000;
  const wg = Number(item.weight_g) || 0;
  if (wg > 0) return qty * (wg / 1000);
  if (['l', 'ltr', 'litr', 'litry', 'litra'].includes(u)) return qty;
  if (u === 'ml') return qty / 1000;
  return qty * 0.5;
}

export function estimateOrderWeightKg(items: CourierQuoteItem[]): number {
  const total = items.reduce((s, it) => s + lineWeightKg(it), 0);
  return Math.round(Math.max(total, 0) * 1000) / 1000;
}

const BANDS: { maxKg: number; pln: number }[] = [
  { maxKg: 1, pln: 12.99 },
  { maxKg: 5, pln: 15.99 },
  { maxKg: 10, pln: 18.99 },
  { maxKg: 15, pln: 22.99 },
  { maxKg: 20, pln: 26.99 },
  { maxKg: 25, pln: 32.99 },
  { maxKg: 30, pln: 38.99 },
];

export function courierPriceForWeightKg(weightKg: number): number {
  const kg = Math.max(Number(weightKg) || 0, 0.1);
  const maxParcel = 25;
  if (kg > maxParcel + 0.049) {
    let remaining = kg;
    let sum = 0;
    while (remaining > 0.049) {
      const chunk = Math.min(remaining, maxParcel);
      sum += courierPriceForSingleParcelKg(chunk);
      remaining = Math.round((remaining - chunk) * 1000) / 1000;
    }
    return Math.round(sum * 100) / 100;
  }
  return courierPriceForSingleParcelKg(kg);
}

function courierPriceForSingleParcelKg(weightKg: number): number {
  const kg = Math.max(Number(weightKg) || 0, 0.1);
  for (const b of BANDS) {
    if (kg <= b.maxKg + 1e-9) return b.pln;
  }
  return Math.round((38.99 + 8 * ((kg - 30) / 5)) * 100) / 100;
}

export function quoteCourier(items: CourierQuoteItem[]): {
  weightKg: number;
  pricePln: number;
} {
  const weightKg = estimateOrderWeightKg(items);
  return { weightKg, pricePln: courierPriceForWeightKg(weightKg) };
}
