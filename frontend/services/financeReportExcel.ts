/**
 * Eksport Excel (.xls SpreadsheetML) dla raportów Finanse.
 */
import { shareExcelSheets, type ExcelSheet } from '@/services/excelExport';
import {
  fetchComprehensiveReport,
  fetchFinanceForRange,
  fetchOrdersForRange,
  buildLocalComprehensiveFallback,
  type FinancePdfRange,
  type FinancePdfReportKind,
} from '@/services/financeReportPdf';
import { parseInvoiceCostNote } from '@/lib/invoiceCostNote';

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

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function generateAndShareFinanceExcel(
  kind: FinancePdfReportKind,
  range: FinancePdfRange,
): Promise<void> {
  if (!range.from || !range.to) throw new Error('Wybierz zakres dat.');
  if (range.from > range.to) throw new Error('Data „od” nie może być późniejsza niż „do”.');

  if (kind === 'pnl') {
    const { revenue, fixed, variable } = await fetchFinanceForRange(range.from, range.to);
    const sumRev = round2(revenue.reduce((s, r) => s + Number(r.amount_pln || 0), 0));
    const sumFix = round2(fixed.reduce((s, r) => s + Number(r.amount_pln || 0), 0));
    const sumVar = round2(variable.reduce((s, r) => s + Number(r.amount_pln || 0), 0));
    const sheets: ExcelSheet[] = [
      {
        name: 'Podsumowanie',
        headers: ['Metryka', 'Kwota PLN'],
        rows: [
          ['Przychody', sumRev],
          ['Koszty stałe', sumFix],
          ['Koszty zmienne', sumVar],
          ['Zysk netto', round2(sumRev - sumFix - sumVar)],
          ['Zakres od', range.from],
          ['Zakres do', range.to],
        ],
      },
      {
        name: 'Przychody',
        headers: ['Data', 'Opis', 'Kwota PLN', 'Miesiąc'],
        rows: revenue.map((r) => [
          r.created_at?.slice(0, 10) || '',
          r.description || 'Przychód',
          round2(Number(r.amount_pln)),
          r.year_month,
        ]),
      },
      {
        name: 'Koszty stale',
        headers: ['Miesiąc', 'Typ', 'Nazwa', 'Kwota PLN'],
        rows: fixed.map((r) => [
          r.year_month,
          typeLabelFixed(r.type),
          r.name || '',
          round2(Number(r.amount_pln)),
        ]),
      },
      {
        name: 'Koszty zmienne',
        headers: ['Data', 'Typ', 'Nazwa', 'Kwota PLN', 'Notatka'],
        rows: variable.map((r) => [
          r.created_at?.slice(0, 10) || '',
          typeLabelVariable(r.type),
          r.name || '',
          round2(Number(r.amount_pln)),
          (r.note || '').slice(0, 200),
        ]),
      },
    ];
    await shareExcelSheets(`gastro-raport-zyski_${range.from}_${range.to}.xls`, sheets);
    return;
  }

  if (kind === 'purchases') {
    const [{ variable }, orders] = await Promise.all([
      fetchFinanceForRange(range.from, range.to),
      fetchOrdersForRange(range.from, range.to),
    ]);
    const materials = variable.filter((v) => v.type === 'materials');
    const purchaseRows: Array<Array<string | number>> = [];
    for (const r of materials) {
      const inv = parseInvoiceCostNote(r.note);
      if (inv?.lines?.length) {
        for (const l of inv.lines) {
          purchaseRows.push([
            r.created_at?.slice(0, 10) || '',
            inv.supplier_name || r.name || 'Zakup',
            l.name,
            l.qty,
            l.unit,
            round2(l.qty * l.price_netto),
          ]);
        }
      } else {
        purchaseRows.push([
          r.created_at?.slice(0, 10) || '',
          r.name || 'Zakup',
          '',
          '',
          '',
          round2(Number(r.amount_pln)),
        ]);
      }
    }
    const orderRows: Array<Array<string | number>> = [];
    for (const o of orders) {
      const supplier = o.suppliers?.name || 'Dostawca';
      for (const it of o.supplier_order_items || []) {
        orderRows.push([
          o.created_at.slice(0, 10),
          supplier,
          statusLabel(o.status),
          it.raw_product_name || '',
          Number(it.quantity_ordered) || 0,
          it.unit || '',
          round2((Number(it.quantity_ordered) || 0) * (Number(it.price_net) || 0)),
        ]);
      }
      if (!(o.supplier_order_items || []).length) {
        orderRows.push([o.created_at.slice(0, 10), supplier, statusLabel(o.status), '', 0, '', 0]);
      }
    }
    const sheets: ExcelSheet[] = [
      {
        name: 'Zakupy faktury',
        headers: ['Data', 'Dostawca/nazwa', 'Produkt', 'Ilość', 'Jednostka', 'Wartość PLN'],
        rows: purchaseRows,
      },
      {
        name: 'Zamowienia dostawcow',
        headers: ['Data', 'Dostawca', 'Status', 'Produkt', 'Ilość', 'Jednostka', 'Wartość netto PLN'],
        rows: orderRows,
      },
    ];
    await shareExcelSheets(`gastro-raport-zakupy_${range.from}_${range.to}.xls`, sheets);
    return;
  }

  // comprehensive
  const [finance, orders] = await Promise.all([
    fetchFinanceForRange(range.from, range.to),
    fetchOrdersForRange(range.from, range.to),
  ]);
  let comp: Awaited<ReturnType<typeof fetchComprehensiveReport>>;
  try {
    comp = await fetchComprehensiveReport(range, 10);
  } catch {
    comp = buildLocalComprehensiveFallback(
      range,
      finance.revenue,
      finance.fixed,
      finance.variable,
    );
  }
  const pnl = comp.pnl || {};
  const sheets: ExcelSheet[] = [
    {
      name: 'Podsumowanie P&L',
      headers: ['Metryka', 'Wartość'],
      rows: [
        ['Okres od', range.from],
        ['Okres do', range.to],
        ['Przychody PLN', round2(Number(pnl.total_revenue || 0))],
        ['Koszty stałe (pro-rata) PLN', round2(Number(pnl.fixed_costs_allocated || 0))],
        [
          'Koszty zmienne brutto PLN',
          round2(Number(pnl.variable_costs_gross ?? pnl.variable_costs_allocated ?? 0)),
        ],
        ['Straty PLN', round2(Number(pnl.total_waste_cost || 0))],
        ['Zysk netto PLN', round2(Number(pnl.net_profit || 0))],
        ['Źródło przychodu', pnl.revenue_source || ''],
        ['Liczba dni', pnl.days_count ?? ''],
      ],
    },
    {
      name: 'Top dania',
      headers: ['#', 'Danie', 'Kategoria', 'Ilość', 'Przychód PLN'],
      rows: (comp.top_dishes || []).map((r, i) => [
        i + 1,
        r.name || '',
        r.category || '',
        Number(r.qty_sold || 0),
        round2(Number(r.revenue_pln || 0)),
      ]),
    },
    {
      name: 'Najslabsze dania',
      headers: ['#', 'Danie', 'Kategoria', 'Ilość', 'Przychód PLN'],
      rows: (comp.worst_dishes || []).map((r, i) => [
        i + 1,
        r.name || '',
        r.category || '',
        Number(r.qty_sold || 0),
        round2(Number(r.revenue_pln || 0)),
      ]),
    },
    {
      name: 'Zuzycie magazynu',
      headers: ['#', 'Produkt', 'Kategoria', 'Zużycie', 'Jednostka', 'Stan'],
      rows: (comp.inventory_usage_top || []).map((r, i) => [
        i + 1,
        r.inventory_name || r.ingredient_name || '',
        r.category || '',
        Number(r.qty_used || 0),
        r.unit || '',
        Number(r.current_stock || 0),
      ]),
    },
    {
      name: 'Straty',
      headers: ['#', 'Pozycja', 'Ilość', 'Jednostka', 'Koszt PLN', 'Koszt jedn.'],
      rows: (comp.waste?.items || []).map((r, i) => [
        i + 1,
        r.name || '',
        Number(r.qty || 0),
        r.unit || '',
        round2(Number(r.cost_pln || 0)),
        round2(Number(r.unit_cost || 0)),
      ]),
    },
    {
      name: 'Dni najlepsze',
      headers: ['#', 'Data', 'Przychód PLN', 'Koszty PLN', 'Straty PLN', 'Zysk PLN'],
      rows: (comp.best_days || []).map((r, i) => [
        i + 1,
        r.date || '',
        round2(Number(r.revenue_pln || 0)),
        round2(Number(r.costs_pln || 0)),
        round2(Number(r.waste_pln || 0)),
        round2(Number(r.net_pln || 0)),
      ]),
    },
    {
      name: 'Dni najslabsze',
      headers: ['#', 'Data', 'Przychód PLN', 'Koszty PLN', 'Straty PLN', 'Zysk PLN'],
      rows: (comp.worst_days || []).map((r, i) => [
        i + 1,
        r.date || '',
        round2(Number(r.revenue_pln || 0)),
        round2(Number(r.costs_pln || 0)),
        round2(Number(r.waste_pln || 0)),
        round2(Number(r.net_pln || 0)),
      ]),
    },
    {
      name: 'Dni wszystkie',
      headers: ['Data', 'Przychód PLN', 'Koszty PLN', 'Straty PLN', 'Zysk PLN'],
      rows: (comp.daily_profits || []).map((r) => [
        r.date || '',
        round2(Number(r.revenue_pln || 0)),
        round2(Number(r.costs_pln || 0)),
        round2(Number(r.waste_pln || 0)),
        round2(Number(r.net_pln || 0)),
      ]),
    },
    {
      name: 'Przychody ewidencja',
      headers: ['Data', 'Opis', 'Kwota PLN'],
      rows: finance.revenue.map((r) => [
        r.created_at?.slice(0, 10) || '',
        r.description || 'Przychód',
        round2(Number(r.amount_pln)),
      ]),
    },
    {
      name: 'Koszty stale',
      headers: ['Miesiąc', 'Typ', 'Nazwa', 'Kwota PLN'],
      rows: finance.fixed.map((r) => [
        r.year_month,
        typeLabelFixed(r.type),
        r.name || '',
        round2(Number(r.amount_pln)),
      ]),
    },
    {
      name: 'Koszty zmienne',
      headers: ['Data', 'Typ', 'Nazwa', 'Kwota PLN'],
      rows: finance.variable.map((r) => [
        r.created_at?.slice(0, 10) || '',
        typeLabelVariable(r.type),
        r.name || '',
        round2(Number(r.amount_pln)),
      ]),
    },
    {
      name: 'Zamowienia',
      headers: ['Data', 'Dostawca', 'Status', 'Produkt', 'Ilość', 'Jednostka', 'Wartość PLN'],
      rows: orders.flatMap((o) => {
        const supplier = o.suppliers?.name || 'Dostawca';
        const items = o.supplier_order_items || [];
        if (!items.length) {
          return [[o.created_at.slice(0, 10), supplier, statusLabel(o.status), '', 0, '', 0]];
        }
        return items.map((it) => [
          o.created_at.slice(0, 10),
          supplier,
          statusLabel(o.status),
          it.raw_product_name || '',
          Number(it.quantity_ordered) || 0,
          it.unit || '',
          round2((Number(it.quantity_ordered) || 0) * (Number(it.price_net) || 0)),
        ]);
      }),
    },
  ];
  await shareExcelSheets(`gastro-raport-zbiorczy_${range.from}_${range.to}.xls`, sheets);
}
