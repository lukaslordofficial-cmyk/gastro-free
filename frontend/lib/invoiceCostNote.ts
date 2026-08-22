/**
 * Parsowanie notatki kosztu zmiennego z faktury (GM_INVOICE_LINES:…).
 */
export type InvoiceCostLine = {
  name: string;
  qty: number;
  unit: string;
  price_netto: number;
};

export type InvoiceCostPayload = {
  v: number;
  kind: 'invoice_lines';
  supplier_id?: string;
  supplier_name?: string;
  total?: number;
  lines: InvoiceCostLine[];
};

/** Buduje notatkę kosztu zmiennego ze szczegółami pozycji (klik → podgląd). */
export function buildInvoiceCostNote(input: {
  supplier_id?: string;
  supplier_name?: string;
  total?: number;
  lines: InvoiceCostLine[];
}): string {
  const payload: InvoiceCostPayload = {
    v: 1,
    kind: 'invoice_lines',
    supplier_id: input.supplier_id,
    supplier_name: input.supplier_name,
    total: input.total,
    lines: input.lines.filter((l) => l.name),
  };
  return `GM_INVOICE_LINES:${JSON.stringify(payload)}`;
}

export function parseInvoiceCostNote(note: string | null | undefined): InvoiceCostPayload | null {
  const raw = (note || '').trim();
  if (!raw) return null;
  const marker = 'GM_INVOICE_LINES:';
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  const jsonPart = raw.slice(idx + marker.length).trim();
  try {
    const data = JSON.parse(jsonPart);
    if (!data || data.kind !== 'invoice_lines' || !Array.isArray(data.lines)) return null;
    return {
      v: Number(data.v) || 1,
      kind: 'invoice_lines',
      supplier_id: data.supplier_id,
      supplier_name: data.supplier_name,
      total: data.total != null ? Number(data.total) : undefined,
      lines: data.lines
        .map((l: any) => ({
          name: String(l?.name || '').trim(),
          qty: Number(l?.qty) || 0,
          unit: String(l?.unit || 'szt'),
          price_netto: Number(l?.price_netto) || 0,
        }))
        .filter((l: InvoiceCostLine) => l.name),
    };
  } catch {
    return null;
  }
}

export function formatInvoiceLineLabel(line: InvoiceCostLine): string {
  const qty = Number.isFinite(line.qty) ? line.qty : 0;
  const price = Number.isFinite(line.price_netto) ? line.price_netto : 0;
  const lineTotal = qty * price;
  return `${line.name} · ${qty} ${line.unit} · ${lineTotal.toFixed(2)} zł`;
}

/** Krótki podgląd notatki bez surowego JSON GM_INVOICE_LINES. */
export function humanizeInvoiceNotePreview(note: string | null | undefined): string | null {
  const raw = (note || '').trim();
  if (!raw) return null;
  const invoice = parseInvoiceCostNote(raw);
  if (invoice) {
    const n = invoice.lines.length;
    const supplier = invoice.supplier_name ? ` · ${invoice.supplier_name}` : '';
    return `Faktura${supplier} · ${n} poz. · dotknij → podgląd`;
  }
  const marker = 'GM_INVOICE_LINES:';
  const idx = raw.indexOf(marker);
  if (idx >= 0) {
    const head = raw.slice(0, idx).trim();
    return head || 'Faktura · szczegóły w notatce';
  }
  return raw;
}
