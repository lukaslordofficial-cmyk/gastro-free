/**
 * Próg minimalnego zamówienia u dostawcy — wspólna walidacja
 * (OrderModal, koszyk, e-mail, Łowca, magazyn).
 */
import { supabase } from '@/lib/supabase';
import { formatPlnNumber } from '@/lib/format';

export type MinOrderCheck = {
  ok: boolean;
  minValue: number;
  subtotal: number;
  gap: number;
  supplierName?: string;
};

export function evaluateMinOrder(
  subtotalPln: number,
  minOrderValue: number,
  supplierName?: string,
): MinOrderCheck {
  const subtotal = Math.round((Number(subtotalPln) || 0) * 100) / 100;
  const minValue = Math.round((Number(minOrderValue) || 0) * 100) / 100;
  if (minValue <= 0 || subtotal + 0.0001 >= minValue) {
    return { ok: true, minValue, subtotal, gap: 0, supplierName };
  }
  const gap = Math.round((minValue - subtotal) * 100) / 100;
  return { ok: false, minValue, subtotal, gap, supplierName };
}

export function minOrderAlertCopy(check: MinOrderCheck): { title: string; message: string } {
  const who = check.supplierName ? ` u „${check.supplierName}”` : '';
  return {
    title: 'Minimalne zamówienie',
    message:
      `Ten dostawca ma próg minimalnego zamówienia${who}: ${formatPlnNumber(check.minValue)} zł.\n\n`
      + `Brakuje ${formatPlnNumber(check.gap)} zł, aby go spełnić.\n\n`
      + `Dodaj produkty i zamów ponownie.`,
  };
}

/** Pobierz min_order_value z DB (0 gdy brak kolumny / wiersza). */
export async function fetchSupplierMinOrderValue(supplierId: string): Promise<{
  minValue: number;
  name?: string;
}> {
  const sid = (supplierId || '').trim();
  if (!sid) return { minValue: 0 };
  const full = await supabase
    .from('suppliers')
    .select('id, name, min_order_value')
    .eq('id', sid)
    .maybeSingle();
  if (full.error && /min_order_value/.test(full.error.message ?? '')) {
    const base = await supabase.from('suppliers').select('id, name').eq('id', sid).maybeSingle();
    return { minValue: 0, name: (base.data as { name?: string } | null)?.name };
  }
  const row = full.data as { name?: string; min_order_value?: number | null } | null;
  return {
    minValue: Number(row?.min_order_value ?? 0) || 0,
    name: row?.name,
  };
}

export async function checkSupplierMinOrder(opts: {
  supplierId: string;
  subtotalPln: number;
  /** Gdy już znamy wartość z karty dostawcy — bez dodatkowego fetch. */
  minOrderValue?: number | null;
  supplierName?: string;
}): Promise<MinOrderCheck> {
  let minValue = Number(opts.minOrderValue ?? NaN);
  let name = opts.supplierName;
  if (!Number.isFinite(minValue)) {
    const fetched = await fetchSupplierMinOrderValue(opts.supplierId);
    minValue = fetched.minValue;
    name = name || fetched.name;
  }
  return evaluateMinOrder(opts.subtotalPln, minValue, name);
}
