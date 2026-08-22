/**
 * Smoke: supplierIdFromCostNote + prefiks supplier:uuid w notatce.
 */
import assert from 'node:assert/strict';

function parseInvoiceCostNote(note) {
  const raw = (note || '').trim();
  const marker = 'GM_INVOICE_LINES:';
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  try {
    const data = JSON.parse(raw.slice(idx + marker.length).trim());
    if (!data || data.kind !== 'invoice_lines') return null;
    return data;
  } catch {
    return null;
  }
}

function supplierIdFromCostNote(note) {
  const raw = (note || '').trim();
  if (!raw) return null;
  const m = /supplier:([0-9a-fA-F-]{36})/.exec(raw);
  if (m?.[1]) return m[1].toLowerCase();
  const inv = parseInvoiceCostNote(raw);
  const sid = (inv?.supplier_id || '').trim();
  return sid ? sid.toLowerCase() : null;
}

function buildNote(supplierId) {
  const payload = {
    v: 1,
    kind: 'invoice_lines',
    supplier_id: supplierId,
    lines: [{ name: 'Bataty', qty: 1, unit: 'kg', price_netto: 10 }],
  };
  return `Dostawa · supplier:${supplierId}\nGM_INVOICE_LINES:${JSON.stringify(payload)}`;
}

const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
assert.equal(supplierIdFromCostNote(buildNote(SID)), SID);
assert.equal(
  supplierIdFromCostNote(`GM_INVOICE_LINES:${JSON.stringify({ kind: 'invoice_lines', supplier_id: SID, lines: [] })}`),
  SID,
);
assert.equal(supplierIdFromCostNote('Skan faktury · supplier:' + SID), SID);
assert.equal(supplierIdFromCostNote('bez dostawcy'), null);
console.log('smoke_supplier_spend_note: ok');
