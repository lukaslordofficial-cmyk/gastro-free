/**
 * Generowanie czytelnych raportów PDF z zakładki Finanse
 * (koszty/przychody/zyski oraz dostawy/zakupy) dla wybranego zakresu dat.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import { parseInvoiceCostNote } from '@/lib/invoiceCostNote';
import type { FixedCost, RevenueEntry, VariableCostEntry } from '@/lib/types';

export type FinancePdfReportKind = 'pnl' | 'purchases';

export type FinancePdfRange = {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
};

type OrderRow = {
  id: string;
  status: string;
  notes: string | null;
  created_at: string;
  suppliers?: { name?: string | null } | null;
  supplier_order_items?: Array<{
    raw_product_name: string;
    quantity_ordered: number;
    unit: string;
    price_net: number | null;
  }> | null;
};

function isRealKey(ak: string): boolean {
  return !!ak && ak !== 'default';
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPLN(n: number): string {
  const v = Number(n) || 0;
  return (
    v.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'
  );
}

function formatPlDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function dayStartIso(ymd: string): string {
  return `${ymd}T00:00:00.000`;
}

function dayEndIso(ymd: string): string {
  return `${ymd}T23:59:59.999`;
}

/** Miesiące YYYY-MM pokrywające zakres dat (włącznie). */
export function yearMonthsInRange(from: string, to: string): string[] {
  const fm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const tm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!fm || !tm) return [];
  let y = Number(fm[1]);
  let mo = Number(fm[2]);
  const ey = Number(tm[1]);
  const em = Number(tm[2]);
  const out: string[] = [];
  while (y < ey || (y === ey && mo <= em)) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`);
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
    if (out.length > 36) break;
  }
  return out;
}

function inCreatedRange(createdAt: string | null | undefined, from: string, to: string): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= new Date(dayStartIso(from)).getTime() && t <= new Date(dayEndIso(to)).getTime();
}

function typeLabelFixed(t: string): string {
  switch (t) {
    case 'rent':
      return 'Czynsz';
    case 'media':
      return 'Media';
    case 'payroll':
      return 'Wynagrodzenia';
    default:
      return 'Inne';
  }
}

function typeLabelVariable(t: string): string {
  switch (t) {
    case 'materials':
      return 'Zakupy / materiały';
    case 'waste':
      return 'Straty';
    default:
      return 'Inne';
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case 'draft':
      return 'Szkic';
    case 'sent':
      return 'Wysłane';
    case 'confirmed':
      return 'Potwierdzone';
    case 'received':
      return 'Odebrane';
    default:
      return s;
  }
}

async function fetchFinanceForRange(from: string, to: string): Promise<{
  revenue: RevenueEntry[];
  fixed: FixedCost[];
  variable: VariableCostEntry[];
}> {
  const ak = getAccountKey();
  const months = yearMonthsInRange(from, to);
  if (!months.length) return { revenue: [], fixed: [], variable: [] };

  const scoped = <T,>(q: T & { eq: (col: string, val: string) => T }): T =>
    isRealKey(ak) ? q.eq('account_key', ak) : q;

  let revQ = scoped(supabase.from('revenue_entries').select('*')).in('year_month', months).order('created_at');
  let fixQ = scoped(supabase.from('fixed_costs').select('*')).in('year_month', months).order('year_month');
  let varQ = scoped(
    supabase.from('variable_cost_entries').select('*'),
  )
    .in('year_month', months)
    .order('created_at');

  let [revRes, fixRes, varRes] = await Promise.all([revQ, fixQ, varQ]);

  if (
    (revRes.error && /account_key/i.test(revRes.error.message ?? '')) ||
    (fixRes.error && /account_key/i.test(fixRes.error.message ?? '')) ||
    (varRes.error && /account_key/i.test(varRes.error.message ?? ''))
  ) {
    [revRes, fixRes, varRes] = await Promise.all([
      supabase.from('revenue_entries').select('*').in('year_month', months).order('created_at'),
      supabase.from('fixed_costs').select('*').in('year_month', months).order('year_month'),
      supabase.from('variable_cost_entries').select('*').in('year_month', months).order('created_at'),
    ]);
  }

  if (revRes.error) throw revRes.error;
  if (fixRes.error) throw fixRes.error;
  if (varRes.error) throw varRes.error;

  const revenue = ((revRes.data ?? []) as RevenueEntry[]).filter((r) =>
    inCreatedRange(r.created_at, from, to),
  );
  const variable = ((varRes.data ?? []) as VariableCostEntry[]).filter((r) =>
    inCreatedRange(r.created_at, from, to),
  );
  // Koszty stałe są miesięczne — bierzemy pełne miesiące z zakresu.
  const fixed = (fixRes.data ?? []) as FixedCost[];

  return { revenue, fixed, variable };
}

async function fetchOrdersForRange(from: string, to: string): Promise<OrderRow[]> {
  const ak = getAccountKey();
  let q = supabase
    .from('supplier_orders')
    .select(
      'id, status, notes, created_at, suppliers(name), supplier_order_items(raw_product_name, quantity_ordered, unit, price_net)',
    )
    .gte('created_at', dayStartIso(from))
    .lte('created_at', dayEndIso(to))
    .neq('status', 'draft')
    .order('created_at', { ascending: true });

  if (isRealKey(ak)) q = q.eq('account_key', ak);

  let { data, error } = await q;
  if (error && /account_key/i.test(error.message ?? '')) {
    ({ data, error } = await supabase
      .from('supplier_orders')
      .select(
        'id, status, notes, created_at, suppliers(name), supplier_order_items(raw_product_name, quantity_ordered, unit, price_net)',
      )
      .gte('created_at', dayStartIso(from))
      .lte('created_at', dayEndIso(to))
      .neq('status', 'draft')
      .order('created_at', { ascending: true }));
  }
  if (error) throw error;
  return (data ?? []) as OrderRow[];
}

function htmlShell(title: string, range: FinancePdfRange, body: string): string {
  const generated = new Date().toLocaleString('pl-PL');
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #122018;
      font-size: 11px;
      line-height: 1.45;
      padding: 28px 32px;
      margin: 0;
    }
    h1 { font-size: 20px; margin: 0 0 4px; color: #0A120E; }
    h2 {
      font-size: 13px;
      margin: 22px 0 8px;
      padding-bottom: 4px;
      border-bottom: 1.5px solid #1DB954;
      color: #0A120E;
    }
    .meta { color: #5a6b62; margin-bottom: 18px; }
    .kpi {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 12px 0 18px;
    }
    .kpi-card {
      flex: 1 1 120px;
      border: 1px solid #d7e3dc;
      border-radius: 8px;
      padding: 10px 12px;
      background: #f6faf7;
    }
    .kpi-card .label { color: #5a6b62; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi-card .value { font-size: 15px; font-weight: 700; margin-top: 2px; }
    .kpi-card.profit .value { color: #0f7a3a; }
    .kpi-card.loss .value { color: #b42318; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e4ece7; vertical-align: top; }
    th { background: #eef6f1; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #3d5248; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .muted { color: #6b7c74; font-size: 10px; }
    .empty { color: #6b7c74; font-style: italic; margin: 8px 0; }
    .footer { margin-top: 28px; color: #8a9a92; font-size: 9px; border-top: 1px solid #e4ece7; padding-top: 8px; }
    .order-block { margin-bottom: 14px; page-break-inside: avoid; }
    .order-head { font-weight: 700; margin-bottom: 4px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    Zakres: <strong>${formatPlDate(range.from)}</strong> – <strong>${formatPlDate(range.to)}</strong><br/>
    Wygenerowano: ${escapeHtml(generated)} · Gastro Manager
  </div>
  ${body}
  <div class="footer">Raport wygenerowany w aplikacji Gastro Manager. Kwoty w PLN.</div>
</body>
</html>`;
}

function rowsTable(
  headers: string[],
  rows: string[][],
  emptyText: string,
): string {
  if (!rows.length) return `<p class="empty">${escapeHtml(emptyText)}</p>`;
  const head = headers
    .map((h, i) => `<th class="${i === headers.length - 1 ? 'num' : ''}">${escapeHtml(h)}</th>`)
    .join('');
  const body = rows
    .map((r) => {
      const cells = r
        .map((c, i) => `<td class="${i === r.length - 1 ? 'num' : ''}">${c}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildPnlHtml(
  range: FinancePdfRange,
  revenue: RevenueEntry[],
  fixed: FixedCost[],
  variable: VariableCostEntry[],
): string {
  const sumRev = revenue.reduce((s, r) => s + Number(r.amount_pln || 0), 0);
  const sumFix = fixed.reduce((s, r) => s + Number(r.amount_pln || 0), 0);
  const sumVar = variable.reduce((s, r) => s + Number(r.amount_pln || 0), 0);
  const profit = sumRev - sumFix - sumVar;
  const profitClass = profit >= 0 ? 'profit' : 'loss';

  const revRows = revenue.map((r) => [
    escapeHtml(formatPlDate(r.created_at?.slice(0, 10) || r.year_month)),
    escapeHtml(r.description || 'Przychód'),
    escapeHtml(formatPLN(Number(r.amount_pln))),
  ]);
  const fixRows = fixed.map((r) => [
    escapeHtml(r.year_month),
    escapeHtml(typeLabelFixed(r.type)),
    escapeHtml(r.name || '—'),
    escapeHtml(formatPLN(Number(r.amount_pln))),
  ]);
  const varRows = variable.map((r) => [
    escapeHtml(formatPlDate(r.created_at?.slice(0, 10) || r.year_month)),
    escapeHtml(typeLabelVariable(r.type)),
    escapeHtml(r.name || '—'),
    escapeHtml(formatPLN(Number(r.amount_pln))),
  ]);

  const body = `
    <div class="kpi">
      <div class="kpi-card"><div class="label">Przychody</div><div class="value">${escapeHtml(formatPLN(sumRev))}</div></div>
      <div class="kpi-card"><div class="label">Koszty stałe</div><div class="value">${escapeHtml(formatPLN(sumFix))}</div></div>
      <div class="kpi-card"><div class="label">Koszty zmienne</div><div class="value">${escapeHtml(formatPLN(sumVar))}</div></div>
      <div class="kpi-card ${profitClass}"><div class="label">Zysk netto</div><div class="value">${escapeHtml(formatPLN(profit))}</div></div>
    </div>
    <p class="muted">Koszty stałe obejmują pełne miesiące z wybranego zakresu (są ewidencjonowane miesięcznie). Przychody i koszty zmienne — według daty wpisu.</p>
    <h2>Przychody (${revenue.length})</h2>
    ${rowsTable(['Data', 'Opis', 'Kwota'], revRows, 'Brak przychodów w wybranym okresie.')}
    <h2>Koszty stałe (${fixed.length})</h2>
    ${rowsTable(['Miesiąc', 'Typ', 'Nazwa', 'Kwota'], fixRows, 'Brak kosztów stałych w wybranym okresie.')}
    <h2>Koszty zmienne (${variable.length})</h2>
    ${rowsTable(['Data', 'Typ', 'Nazwa', 'Kwota'], varRows, 'Brak kosztów zmiennych w wybranym okresie.')}
  `;
  return htmlShell('Raport: koszty, przychody i zyski', range, body);
}

function buildPurchasesHtml(
  range: FinancePdfRange,
  materials: VariableCostEntry[],
  orders: OrderRow[],
): string {
  const matSum = materials.reduce((s, r) => s + Number(r.amount_pln || 0), 0);
  let orderSum = 0;
  for (const o of orders) {
    for (const it of o.supplier_order_items || []) {
      orderSum += (Number(it.quantity_ordered) || 0) * (Number(it.price_net) || 0);
    }
  }

  const purchaseBlocks = materials
    .map((r) => {
      const inv = parseInvoiceCostNote(r.note);
      const date = formatPlDate(r.created_at?.slice(0, 10) || r.year_month);
      const supplier = inv?.supplier_name ? ` · ${inv.supplier_name}` : '';
      let linesHtml = '';
      if (inv?.lines?.length) {
        const rows = inv.lines.map((l) => [
          escapeHtml(l.name),
          escapeHtml(`${l.qty} ${l.unit}`),
          escapeHtml(formatPLN(l.qty * l.price_netto)),
        ]);
        linesHtml = rowsTable(['Produkt', 'Ilość', 'Wartość'], rows, '');
      } else if (r.note && !inv) {
        linesHtml = `<p class="muted">${escapeHtml(r.note.slice(0, 240))}</p>`;
      }
      return `<div class="order-block">
        <div class="order-head">${escapeHtml(date)} — ${escapeHtml(r.name || 'Zakup')}${escapeHtml(supplier)} · ${escapeHtml(formatPLN(Number(r.amount_pln)))}</div>
        ${linesHtml}
      </div>`;
    })
    .join('');

  const orderBlocks = orders
    .map((o) => {
      const supplier = o.suppliers?.name || 'Dostawca';
      const date = formatPlDate(o.created_at.slice(0, 10));
      const items = o.supplier_order_items || [];
      const total = items.reduce(
        (s, it) => s + (Number(it.quantity_ordered) || 0) * (Number(it.price_net) || 0),
        0,
      );
      const rows = items.map((it) => [
        escapeHtml(it.raw_product_name || '—'),
        escapeHtml(`${it.quantity_ordered} ${it.unit || ''}`),
        escapeHtml(formatPLN((Number(it.quantity_ordered) || 0) * (Number(it.price_net) || 0))),
      ]);
      return `<div class="order-block">
        <div class="order-head">${escapeHtml(date)} — ${escapeHtml(supplier)} · ${escapeHtml(statusLabel(o.status))} · ${escapeHtml(formatPLN(total))}</div>
        ${rowsTable(['Produkt', 'Ilość', 'Wartość netto'], rows, 'Brak pozycji w zamówieniu.')}
        ${o.notes ? `<p class="muted">Notatka: ${escapeHtml(o.notes)}</p>` : ''}
      </div>`;
    })
    .join('');

  const body = `
    <div class="kpi">
      <div class="kpi-card"><div class="label">Zakupy (koszty mat.)</div><div class="value">${escapeHtml(formatPLN(matSum))}</div></div>
      <div class="kpi-card"><div class="label">Zamówienia do dostawców</div><div class="value">${escapeHtml(formatPLN(orderSum))}</div></div>
      <div class="kpi-card"><div class="label">Liczba faktur/zakupów</div><div class="value">${materials.length}</div></div>
      <div class="kpi-card"><div class="label">Liczba zamówień</div><div class="value">${orders.length}</div></div>
    </div>
    <h2>Zakupy i faktury (${materials.length})</h2>
    ${purchaseBlocks || '<p class="empty">Brak zakupów / faktur materiałowych w wybranym okresie.</p>'}
    <h2>Dostawy i zamówienia (${orders.length})</h2>
    ${orderBlocks || '<p class="empty">Brak zamówień do dostawców (poza szkicami) w wybranym okresie.</p>'}
  `;
  return htmlShell('Raport: dostawy i zakupy', range, body);
}

export async function generateAndShareFinancePdf(
  kind: FinancePdfReportKind,
  range: FinancePdfRange,
): Promise<void> {
  if (!range.from || !range.to) throw new Error('Wybierz zakres dat.');
  if (range.from > range.to) throw new Error('Data „od” nie może być późniejsza niż „do”.');

  let html: string;
  if (kind === 'pnl') {
    const { revenue, fixed, variable } = await fetchFinanceForRange(range.from, range.to);
    html = buildPnlHtml(range, revenue, fixed, variable);
  } else {
    const [{ variable }, orders] = await Promise.all([
      fetchFinanceForRange(range.from, range.to),
      fetchOrdersForRange(range.from, range.to),
    ]);
    const materials = variable.filter((v) => v.type === 'materials');
    html = buildPurchasesHtml(range, materials, orders);
  }

  const fileName =
    kind === 'pnl'
      ? `gastro-raport-zyski_${range.from}_${range.to}.pdf`
      : `gastro-raport-zakupy_${range.from}_${range.to}.pdf`;

  const { uri } = await Print.printToFileAsync({ html, base64: false });

  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    await Print.printAsync({ html });
    return;
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: fileName,
    UTI: 'com.adobe.pdf',
  });
}
