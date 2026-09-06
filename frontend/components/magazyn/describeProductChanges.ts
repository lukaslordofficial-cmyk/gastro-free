import type { MockInventoryItem } from './types';
import { formatQty } from './helpers';

/** Opisuje różnice przed/po zapisie produktu (progi, bufor, stan…). */
export function describeProductChanges(
  before: MockInventoryItem | null | undefined,
  after: MockInventoryItem,
): string[] {
  if (!before) {
    return [`Dodano „${after.product_name}” do magazynu.`];
  }
  const lines: string[] = [];
  const u = after.unit;

  if (before.product_name !== after.product_name) {
    lines.push(`Nazwa: „${before.product_name}” → „${after.product_name}”`);
  }
  if (Number(before.critical_threshold) !== Number(after.critical_threshold)) {
    lines.push(
      `Próg krytyczny: ${formatQty(before.critical_threshold, u)} → ${formatQty(after.critical_threshold, u)}`,
    );
  }
  const bOpt = Number(before.optimal_threshold) || 0;
  const aOpt = Number(after.optimal_threshold) || 0;
  if (bOpt !== aOpt) {
    lines.push(
      `Próg optymalny: ${bOpt > 0 ? formatQty(bOpt, u) : 'brak'} → ${aOpt > 0 ? formatQty(aOpt, u) : 'brak'}`,
    );
  }
  const bBuf = Number(before.safety_buffer_percent ?? 20);
  const aBuf = Number(after.safety_buffer_percent ?? 20);
  if (bBuf !== aBuf) {
    lines.push(`Bufor bezpieczeństwa: ${bBuf}% → ${aBuf}%`);
  }
  if (Number(before.current_qty) !== Number(after.current_qty)) {
    lines.push(
      `Stan: ${formatQty(before.current_qty, before.unit)} → ${formatQty(after.current_qty, u)}`,
    );
  }
  if (before.unit !== after.unit) {
    lines.push(`Jednostka: ${before.unit} → ${after.unit}`);
  }
  if ((before.category || '') !== (after.category || '')) {
    lines.push(`Kategoria: ${before.category || '—'} → ${after.category || '—'}`);
  }
  if (!lines.length) {
    lines.push('Zapisano bez zmian wartości progów / stanu.');
  }
  return lines;
}
