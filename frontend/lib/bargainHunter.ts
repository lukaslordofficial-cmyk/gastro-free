/** Pure helpers for Łowca Okazji — mirrors backend/bargain_hunter.py */

export const UNIT_FACTOR: Record<string, number> = {
  kg: 1,
  kilogram: 1,
  g: 0.001,
  gram: 0.001,
  ml: 0.001,
  mililitr: 0.001,
  l: 1,
  litr: 1,
  litry: 1,
  szt: 1,
  sztuka: 1,
  sztuk: 1,
  opak: 1,
  opakowanie: 1,
  porcja: 1,
  porcje: 1,
};

export interface OfferItem {
  product_name: string;
  quantity: number;
  unit: string;
  unit_price_base: number;
  matched_name: string;
  line_total: number;
  base_dim: string;
  is_local_producer?: boolean;
  catalog_product_id?: string;
}

export interface SupplierGroup {
  supplier_id: string | null;
  supplier_name: string;
  supplier_email: string | null;
  items: OfferItem[];
  subtotal_pln: number;
  min_order_value?: number;
  meets_minimum_order?: boolean;
  shipping_pln?: number;
  total_pln?: number;
  /** Marketplace B2B — Lokalni Przetwórcy (nie suppliers) */
  is_local_producer?: boolean;
  local_producer_city?: string | null;
  local_producer_voivodeship?: string | null;
  lead_time_days?: number;
}

export interface OptionAllOne {
  type: string;
  supplier_id: string;
  supplier_name: string;
  supplier_email: string | null;
  items: OfferItem[];
  subtotal_pln: number;
  total_pln: number;
  min_order_value?: number;
  meets_minimum_order?: boolean;
  missing: string[];
}

export interface OptionOptimized {
  type: string;
  suppliers: SupplierGroup[];
  total_pln: number;
  missing: string[];
}

export interface BestOption {
  type: string;
  supplier_id?: string;
  supplier_name?: string;
  supplier_email?: string | null;
  items?: OfferItem[];
  suppliers?: SupplierGroup[];
  subtotal_pln: number;
  total_pln: number;
  min_order_value?: number;
  meets_minimum_order?: boolean;
  missing?: string[];
}

export interface TiedSupplier {
  supplier_id: string;
  supplier_name: string;
  supplier_email: string | null;
  total_pln: number;
  subtotal_pln: number;
  min_order_value: number;
  meets_minimum_order: boolean;
  matched_name?: string;
  unit_price_base?: number;
}

export interface PricingQuote {
  supplier_id: string;
  supplier_name?: string;
  supplier_email?: string | null;
  unit_price_base: number;
  matched_name?: string;
  min_order_value?: number;
}

export interface PricingMatrixItem {
  product_key: string;
  product_name: string;
  quantity: number;
  unit: string;
  base_dim: string;
  base_quantity?: number;
  quotes: PricingQuote[];
}

export interface BasketScenario {
  id: 'split_max' | 'monolith' | 'smart_hybrid' | string;
  label: string;
  description: string;
  suppliers: SupplierGroup[];
  products_pln: number;
  shipping_pln: number;
  total_pln: number;
  supplier_count: number;
  meets_all_minimums: boolean;
  missing: string[];
  viable: boolean;
  smart_tip?: string;
  logistics_hints?: {
    supplier_name?: string;
    gap_to_minimum_pln?: number;
    gap_to_free_shipping_pln?: number;
    blocked_by_minimum?: boolean;
  }[];
}

export interface OptimizeResult {
  currency?: string;
  is_optimized: boolean;
  /** v2: true gdy warto pokazać kilka scenariuszy (różnica ≥ 5%) */
  is_multivariable?: boolean;
  optimizer_version?: number;
  items_requested: {
    product_name: string;
    quantity: number;
    unit: string;
    found: boolean;
    supplier_id?: string | null;
    supplier_name?: string | null;
    matched_name?: string | null;
    offers?: Array<{
      supplier_id?: string;
      supplier_name?: string;
      line_total?: number;
      matched_name?: string;
    }>;
  }[];
  /** Zakres z critical-by-category — rozpiska w Łowcy (nie w panelu Jarvisa). */
  scope_categories?: string[];
  scope_products?: {
    name?: string;
    category?: string;
    quantity?: number;
    unit?: string;
    source?: string;
  }[];
  scope_summary?: string;
  not_found_products?: string[];
  not_found_count?: number;
  best_option: BestOption | null;
  tied_suppliers: TiedSupplier[];
  variant_monolith: OptionAllOne | null;
  variant_split: OptionOptimized;
  savings_pln: number;
  savings_amount?: number;
  cheaper_variant: 'monolith' | 'split' | 'hybrid' | null;
  pricing_matrix: PricingMatrixItem[];
  assistant_speech: string;
  analysis_summary?: string;
  recommended_reason?: string;
  credits_deducted?: number;
  credits_remaining?: number | null;
  /** Notatki PL gdy opakowanie ≠ dokładne zapotrzebowanie */
  pack_adjustment_notes?: string[];
  /** Math/AI suggestions from Deal Hunter Phase 2+ */
  suggestions?: {
    type: string;
    product_name?: string;
    supplier_id?: string;
    message: string;
    evidence?: Record<string, unknown>;
    action?: string;
  }[];
  smart_tip?: string;
  decision_log?: { product?: string; reason_code?: string; tco_note?: string }[];
  kitchen_priorities?: Record<string, { score?: number; class_a?: boolean; reasons?: string[] }>;
  /** Legacy keys */
  option_all_one: OptionAllOne | null;
  option_optimized: OptionOptimized;
  /** v2 scenarios */
  scenarios?: BasketScenario[];
  scenario_split_max?: BasketScenario;
  scenario_monolith?: BasketScenario;
  scenario_smart_hybrid?: BasketScenario;
  recommended_scenario_id?: string | null;
}

const PRICE_TOLERANCE = 0.01;

export function unitFactor(unit: string): number {
  const key = (unit || '').trim().toLowerCase().replace(/\.$/, '');
  return UNIT_FACTOR[key] ?? 1;
}

export function recalcLineTotal(unitPriceBase: number, qty: number, unit: string): number {
  const baseQty = qty * unitFactor(unit);
  return Math.round(unitPriceBase * baseQty * 100) / 100;
}

function meetsMinimum(subtotal: number, minVal: number): boolean {
  if (!minVal || minVal <= 0) return true;
  return subtotal >= minVal;
}

function itemLineEntry(
  pi: { product_name: string; quantity: number; unit: string; base_dim: string },
  b: {
    unit_price_base: number;
    matched_name: string;
    line_total: number;
  },
): OfferItem {
  return {
    product_name: pi.product_name,
    quantity: pi.quantity,
    unit: pi.unit,
    base_dim: pi.base_dim,
    unit_price_base: b.unit_price_base,
    matched_name: b.matched_name,
    line_total: b.line_total,
  };
}

type PerItem = {
  product_name: string;
  quantity: number;
  unit: string;
  base_dim: string;
  base_quantity: number;
  best_by_supplier: Record<
    string,
    {
      supplier_id: string;
      supplier_name: string;
      supplier_email: string | null;
      matched_name: string;
      unit_price_base: number;
      line_total: number;
    }
  >;
};

type SuppliersMeta = Record<
  string,
  { name?: string; email?: string | null; min_order_value?: number }
>;

function minOrder(meta: SuppliersMeta, sid: string): number {
  return Number(meta[sid]?.min_order_value ?? 0);
}

function computeMonolith(items: PerItem[], meta: SuppliersMeta): OptionAllOne | null {
  const allIds = new Set<string>();
  items.forEach((pi) => Object.keys(pi.best_by_supplier).forEach((id) => allIds.add(id)));

  let best: {
    supplier_id: string;
    supplier_name: string;
    supplier_email: string | null;
    covered_count: number;
    subtotal_pln: number;
    min_order_value: number;
  } | null = null;

  for (const sid of allIds) {
    const covered = items.filter((pi) => pi.best_by_supplier[sid]);
    const total = Math.round(
      covered.reduce((s, pi) => s + pi.best_by_supplier[sid].line_total, 0) * 100,
    ) / 100;
    const m = meta[sid] ?? {};
    const cand = {
      supplier_id: sid,
      supplier_name: (m.name || '').trim() || 'Dostawca',
      supplier_email: m.email ?? null,
      covered_count: covered.length,
      subtotal_pln: total,
      min_order_value: minOrder(meta, sid),
    };
    if (
      !best ||
      cand.covered_count > best.covered_count ||
      (cand.covered_count === best.covered_count && cand.subtotal_pln < best.subtotal_pln)
    ) {
      best = cand;
    }
  }

  if (!best) return null;

  const sid = best.supplier_id;
  const lineItems: OfferItem[] = [];
  const missing: string[] = [];
  items.forEach((pi) => {
    const b = pi.best_by_supplier[sid];
    if (!b) {
      missing.push(pi.product_name);
      return;
    }
    lineItems.push(itemLineEntry(pi, b));
  });

  return {
    type: 'all_one_supplier',
    supplier_id: sid,
    supplier_name: best.supplier_name,
    supplier_email: best.supplier_email,
    items: lineItems,
    subtotal_pln: best.subtotal_pln,
    total_pln: best.subtotal_pln,
    min_order_value: best.min_order_value,
    meets_minimum_order: meetsMinimum(best.subtotal_pln, best.min_order_value),
    missing,
  };
}

function computeSplit(items: PerItem[], meta: SuppliersMeta): OptionOptimized {
  const groups: Record<string, SupplierGroup> = {};
  const missing: string[] = [];

  items.forEach((pi) => {
    const bbs = pi.best_by_supplier;
    const keys = Object.keys(bbs);
    if (!keys.length) {
      missing.push(pi.product_name);
      return;
    }
    const [sid, b] = keys.reduce<[string, (typeof bbs)[string]]>((best, k) => {
      if (!best || bbs[k].line_total < best[1].line_total) return [k, bbs[k]];
      return best;
    }, ['', bbs[keys[0]]]);

    if (!groups[sid]) {
      groups[sid] = {
        supplier_id: sid,
        supplier_name: b.supplier_name,
        supplier_email: b.supplier_email,
        items: [],
        subtotal_pln: 0,
        min_order_value: minOrder(meta, sid),
      };
    }
    groups[sid].items.push(itemLineEntry(pi, b));
    groups[sid].subtotal_pln =
      Math.round((groups[sid].subtotal_pln + b.line_total) * 100) / 100;
  });

  Object.values(groups).forEach((g) => {
    g.meets_minimum_order = meetsMinimum(g.subtotal_pln, g.min_order_value ?? 0);
  });

  const suppliers = Object.values(groups);
  const total = Math.round(suppliers.reduce((s, g) => s + g.subtotal_pln, 0) * 100) / 100;
  return { type: 'optimized', suppliers, total_pln: total, missing };
}

function findTiedSuppliers(
  item: PerItem,
  targetTotal: number,
  meta: SuppliersMeta,
): TiedSupplier[] {
  const bbs = item.best_by_supplier;
  const target = Math.round(targetTotal * 100) / 100;
  let refMin: number | null = null;
  const tied: TiedSupplier[] = [];

  Object.entries(bbs).forEach(([sid, b]) => {
    const total = Math.round(b.line_total * 100) / 100;
    if (Math.abs(total - target) > PRICE_TOLERANCE) return;
    const minVal = minOrder(meta, sid);
    if (refMin === null) refMin = minVal;
    if (Math.abs(minVal - refMin) > PRICE_TOLERANCE) return;
    tied.push({
      supplier_id: sid,
        supplier_name: (b.supplier_name || meta[sid]?.name || '').trim() || 'Dostawca',
      supplier_email: b.supplier_email ?? meta[sid]?.email ?? null,
      total_pln: total,
      subtotal_pln: total,
      min_order_value: minVal,
      meets_minimum_order: meetsMinimum(total, minVal),
      matched_name: b.matched_name,
      unit_price_base: b.unit_price_base,
    });
  });

  return tied.sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
}

function effectiveTotal(option: OptionAllOne | null): number | null {
  if (!option || (option.missing && option.missing.length)) return null;
  return Math.round(option.total_pln * 100) / 100;
}

function splitTotal(split: OptionOptimized): number | null {
  if (split.missing?.length || !split.suppliers?.length) return null;
  return Math.round(split.total_pln * 100) / 100;
}

function monolithToBest(m: OptionAllOne): BestOption {
  return {
    type: 'single',
    supplier_id: m.supplier_id,
    supplier_name: m.supplier_name,
    supplier_email: m.supplier_email,
    items: m.items,
    subtotal_pln: m.subtotal_pln,
    total_pln: m.total_pln,
    min_order_value: m.min_order_value,
    meets_minimum_order: m.meets_minimum_order,
    missing: m.missing,
  };
}

function splitToBest(split: OptionOptimized): BestOption {
  if (split.suppliers.length === 1) {
    const g = split.suppliers[0];
    return {
      type: 'single',
      supplier_id: g.supplier_id ?? undefined,
      supplier_name: g.supplier_name,
      supplier_email: g.supplier_email,
      items: g.items,
      subtotal_pln: g.subtotal_pln,
      total_pln: g.subtotal_pln,
      min_order_value: g.min_order_value,
      meets_minimum_order: g.meets_minimum_order,
      missing: split.missing,
    };
  }
  return {
    type: 'split_single_view',
    suppliers: split.suppliers,
    subtotal_pln: split.total_pln,
    total_pln: split.total_pln,
    missing: split.missing,
  };
}

export function matrixToPerItem(
  matrix: PricingMatrixItem[],
  quantities: Record<string, number>,
): PerItem[] {
  return matrix.map((row) => {
    const qty = quantities[row.product_key] ?? row.quantity;
    const baseQty = qty * unitFactor(row.unit);
    const best_by_supplier: PerItem['best_by_supplier'] = {};
    row.quotes.forEach((q) => {
      const lt = recalcLineTotal(q.unit_price_base, qty, row.unit);
      best_by_supplier[q.supplier_id] = {
        supplier_id: q.supplier_id,
        supplier_name: (q.supplier_name || '').trim() || 'Dostawca',
        supplier_email: q.supplier_email ?? null,
        matched_name: q.matched_name ?? row.product_name,
        unit_price_base: q.unit_price_base,
        line_total: lt,
      };
    });
    return {
      product_name: row.product_name,
      quantity: qty,
      unit: row.unit,
      base_dim: row.base_dim,
      base_quantity: baseQty,
      best_by_supplier,
    };
  });
}

export function buildFromPerItem(
  items: PerItem[],
  meta: SuppliersMeta,
  base: Pick<
    OptimizeResult,
    'currency' | 'items_requested' | 'pricing_matrix' | 'assistant_speech'
  >,
): OptimizeResult {
  const monolith = computeMonolith(items, meta);
  const split = computeSplit(items, meta);
  const totalA = effectiveTotal(monolith);
  const totalB = splitTotal(split);
  const uniqueCount = items.length;
  const sameTotal =
    totalA !== null && totalB !== null && Math.abs(totalA - totalB) <= PRICE_TOLERANCE;
  const isOptimized =
    uniqueCount > 1 && totalA !== null && totalB !== null && !sameTotal;

  let bestOption: BestOption | null = null;
  let tied: TiedSupplier[] = [];
  let savings = 0;
  let cheaper: 'monolith' | 'split' | null = null;

  if (!isOptimized) {
    if (totalA !== null && (totalB === null || totalA <= totalB)) {
      if (monolith && !monolith.missing?.length) bestOption = monolithToBest(monolith);
    }
    if (!bestOption && totalB !== null && split && !split.missing?.length) {
      bestOption = splitToBest(split);
    }
    if (!bestOption && monolith) bestOption = monolithToBest(monolith);
    if (!bestOption && split.suppliers.length) bestOption = splitToBest(split);

    if (uniqueCount === 1 && items.length && bestOption) {
      const target = bestOption.total_pln ?? bestOption.subtotal_pln;
      tied = findTiedSuppliers(items[0], target, meta);
    }
  } else {
    savings =
      (totalA ?? 0) > (totalB ?? 0)
        ? Math.round(((totalA ?? 0) - (totalB ?? 0)) * 100) / 100
        : Math.round(((totalB ?? 0) - (totalA ?? 0)) * 100) / 100;
    cheaper = (totalB ?? 0) < (totalA ?? 0) ? 'split' : 'monolith';
  }

  return {
    ...base,
    is_optimized: isOptimized,
    best_option: bestOption,
    tied_suppliers: tied,
    variant_monolith: monolith,
    variant_split: split,
    savings_pln: savings,
    cheaper_variant: cheaper,
    option_all_one: monolith,
    option_optimized: split,
  };
}

export function suppliersMetaFromMatrix(matrix: PricingMatrixItem[]): SuppliersMeta {
  const meta: SuppliersMeta = {};
  matrix.forEach((row) => {
    row.quotes.forEach((q) => {
      if (!meta[q.supplier_id]) {
        meta[q.supplier_id] = {
          name: q.supplier_name,
          email: q.supplier_email,
          min_order_value: q.min_order_value ?? 0,
        };
      }
    });
  });
  return meta;
}

function patchGroupQuantities(
  g: SupplierGroup,
  quantities: Record<string, number>,
): SupplierGroup {
  const items = g.items.map((it) => {
    const qty = quantities[it.product_name] ?? it.quantity;
    return {
      ...it,
      quantity: qty,
      line_total: recalcLineTotal(it.unit_price_base, qty, it.unit),
    };
  });
  const subtotal = Math.round(items.reduce((s, it) => s + it.line_total, 0) * 100) / 100;
  const minVal = g.min_order_value ?? 0;
  return {
    ...g,
    items,
    subtotal_pln: subtotal,
    meets_minimum_order: !minVal || minVal <= 0 || subtotal >= minVal,
    total_pln: Math.round((subtotal + (g.shipping_pln ?? 0)) * 100) / 100,
  };
}

function patchScenarioQuantities(
  sc: BasketScenario | null | undefined,
  quantities: Record<string, number>,
): BasketScenario | null | undefined {
  if (!sc) return sc;
  const suppliers = (sc.suppliers || []).map((g) => patchGroupQuantities(g, quantities));
  const products_pln = Math.round(
    suppliers.reduce((s, g) => s + g.subtotal_pln, 0) * 100,
  ) / 100;
  return {
    ...sc,
    suppliers,
    products_pln,
    total_pln: Math.round((products_pln + (sc.shipping_pln || 0)) * 100) / 100,
    supplier_count: suppliers.filter((g) => g.items.length > 0).length,
  };
}

/**
 * Przelicz ilości w wyniku compare.
 * Dla v2 (scenariusze / wielu dostawców) NIE przebudowuj koszyków od zera —
 * inaczej giną grupy dostawców i UI pokazuje tylko jeden koszyk (lub żaden).
 */
export function recalcFromMatrix(
  base: OptimizeResult,
  quantities: Record<string, number>,
): OptimizeResult {
  if (!base.pricing_matrix?.length) return base;

  const itemsRequested = base.items_requested.map((ir) => {
    const qty = quantities[ir.product_name] ?? ir.quantity;
    const row = base.pricing_matrix.find((m) => m.product_key === ir.product_name);
    return {
      ...ir,
      quantity: qty,
      found: Boolean(row?.quotes?.length),
    };
  });

  const pricing_matrix = base.pricing_matrix.map((row) => ({
    ...row,
    quantity: quantities[row.product_key] ?? row.quantity,
  }));

  const keepV2 =
    Boolean(base.is_multivariable)
    || base.optimizer_version === 2
    || Boolean(base.scenarios?.length)
    || Boolean(base.scenario_split_max)
    || Boolean(base.scenario_monolith);

  if (keepV2) {
    const scenarios = (base.scenarios ?? [])
      .map((sc) => patchScenarioQuantities(sc, quantities))
      .filter((sc): sc is BasketScenario => !!sc);
    const scenario_split_max = patchScenarioQuantities(base.scenario_split_max, quantities) ?? undefined;
    const scenario_monolith = patchScenarioQuantities(base.scenario_monolith, quantities) ?? undefined;
    const scenario_smart_hybrid = patchScenarioQuantities(base.scenario_smart_hybrid, quantities) ?? undefined;

    const variant_split_suppliers = (
      base.variant_split?.suppliers
      ?? base.option_optimized?.suppliers
      ?? []
    ).map((g) => patchGroupQuantities(g, quantities));
    const variant_split: OptionOptimized = {
      type: base.variant_split?.type ?? 'optimized',
      suppliers: variant_split_suppliers,
      total_pln: Math.round(
        variant_split_suppliers.reduce((s, g) => s + g.subtotal_pln, 0) * 100,
      ) / 100,
      missing: base.variant_split?.missing ?? base.option_optimized?.missing ?? [],
    };

    let variant_monolith = base.variant_monolith ?? base.option_all_one ?? null;
    if (variant_monolith) {
      const items = variant_monolith.items.map((it) => {
        const qty = quantities[it.product_name] ?? it.quantity;
        return {
          ...it,
          quantity: qty,
          line_total: recalcLineTotal(it.unit_price_base, qty, it.unit),
        };
      });
      const subtotal = Math.round(items.reduce((s, it) => s + it.line_total, 0) * 100) / 100;
      variant_monolith = {
        ...variant_monolith,
        items,
        subtotal_pln: subtotal,
        total_pln: subtotal,
        meets_minimum_order: meetsMinimum(subtotal, variant_monolith.min_order_value ?? 0),
      };
    }

    let best_option = base.best_option;
    if (best_option?.suppliers?.length) {
      best_option = {
        ...best_option,
        suppliers: best_option.suppliers.map((g) => patchGroupQuantities(g, quantities)),
      };
      const sum = Math.round(
        (best_option.suppliers ?? []).reduce((s, g) => s + g.subtotal_pln, 0) * 100,
      ) / 100;
      best_option = { ...best_option, subtotal_pln: sum, total_pln: sum };
    } else if (best_option?.items?.length) {
      const items = best_option.items.map((it) => {
        const qty = quantities[it.product_name] ?? it.quantity;
        return {
          ...it,
          quantity: qty,
          line_total: recalcLineTotal(it.unit_price_base, qty, it.unit),
        };
      });
      const subtotal = Math.round(items.reduce((s, it) => s + it.line_total, 0) * 100) / 100;
      best_option = {
        ...best_option,
        items,
        subtotal_pln: subtotal,
        total_pln: subtotal,
        meets_minimum_order: meetsMinimum(subtotal, best_option.min_order_value ?? 0),
      };
    }

    return {
      ...base,
      items_requested: itemsRequested,
      pricing_matrix,
      scenarios,
      scenario_split_max,
      scenario_monolith,
      scenario_smart_hybrid,
      variant_split,
      option_optimized: variant_split,
      variant_monolith,
      option_all_one: variant_monolith,
      best_option,
    };
  }

  const meta = suppliersMetaFromMatrix(pricing_matrix);
  const items = matrixToPerItem(pricing_matrix, quantities);
  return buildFromPerItem(items, meta, {
    currency: base.currency,
    items_requested: itemsRequested,
    pricing_matrix,
    assistant_speech: base.assistant_speech,
  });
}

export function initQuantities(result: OptimizeResult): Record<string, number> {
  const q: Record<string, number> = {};
  result.pricing_matrix?.forEach((row) => {
    q[row.product_key] = row.quantity;
  });
  if (!result.pricing_matrix?.length) {
    result.items_requested.forEach((ir) => {
      q[ir.product_name] = ir.quantity;
    });
  }
  return q;
}

export type SelectedVariant = 'all_one' | 'optimized' | 'single' | 'tied' | 'split_max' | 'monolith' | 'smart_hybrid';

export function toSupplierGroups(
  result: OptimizeResult,
  selected: SelectedVariant,
  tiedSupplierId?: string | null,
): SupplierGroup[] {
  // v2: wybór po id scenariusza — zwróć WSZYSTKIE koszyki dostawców ze scenariusza
  if (selected === 'split_max' || selected === 'monolith' || selected === 'smart_hybrid') {
    const sc =
      (result.scenarios ?? []).find((s) => s.id === selected)
      ?? (selected === 'split_max' ? result.scenario_split_max : null)
      ?? (selected === 'monolith' ? result.scenario_monolith : null)
      ?? (selected === 'smart_hybrid' ? result.scenario_smart_hybrid : null);
    if (sc?.suppliers?.length) {
      return sc.suppliers.filter((g) => (g.items?.length ?? 0) > 0);
    }
    // Awaryjnie: nie gub rozbicia na dostawców gdy kafle scenariuszy zniknęły z payloadu
    if (selected === 'split_max' || selected === 'smart_hybrid') {
      const splitGroups = result.variant_split?.suppliers ?? result.option_optimized?.suppliers ?? [];
      if (splitGroups.length) return splitGroups.filter((g) => (g.items?.length ?? 0) > 0);
      if (result.best_option?.suppliers?.length) {
        return result.best_option.suppliers.filter((g) => (g.items?.length ?? 0) > 0);
      }
    }
    if (selected === 'monolith' && result.variant_monolith) {
      const o = result.variant_monolith;
      return o.items?.length
        ? [{
            supplier_id: o.supplier_id,
            supplier_name: o.supplier_name,
            supplier_email: o.supplier_email,
            items: o.items,
            subtotal_pln: o.total_pln,
            min_order_value: o.min_order_value,
            meets_minimum_order: o.meets_minimum_order,
          }]
        : [];
    }
  }

  if (!result.is_optimized && !result.is_multivariable) {
    const tied = result.tied_suppliers ?? [];
    if (tied.length > 1 && tiedSupplierId) {
      const t = tied.find((x) => x.supplier_id === tiedSupplierId);
      if (t && result.best_option?.items) {
        return [
          {
            supplier_id: t.supplier_id,
            supplier_name: t.supplier_name,
            supplier_email: t.supplier_email,
            items: result.best_option.items,
            subtotal_pln: t.subtotal_pln,
          },
        ];
      }
    }
    const best = result.best_option;
    if (!best) return [];
    // Rozbicie na wielu dostawców — zawsze wszystkie grupy
    if (best.suppliers && best.suppliers.length > 0) {
      return best.suppliers.filter((g) => (g.items?.length ?? 0) > 0);
    }
    if (best.type === 'single' && best.supplier_id && best.items) {
      return [
        {
          supplier_id: best.supplier_id,
          supplier_name: best.supplier_name ?? '',
          supplier_email: best.supplier_email ?? null,
          items: best.items,
          subtotal_pln: best.subtotal_pln,
        },
      ];
    }
    return [];
  }

  if (selected === 'all_one' && result.variant_monolith) {
    const o = result.variant_monolith;
    return [
      {
        supplier_id: o.supplier_id,
        supplier_name: o.supplier_name,
        supplier_email: o.supplier_email,
        items: o.items,
        subtotal_pln: o.total_pln,
        min_order_value: o.min_order_value,
        meets_minimum_order: o.meets_minimum_order,
      },
    ];
  }
  if (selected === 'optimized') {
    return (result.variant_split?.suppliers ?? []).filter((g) => (g.items?.length ?? 0) > 0);
  }
  // Ostatnia deska: pokaż rozbicie z best_option / variant_split zamiast pustego koszyka
  if (result.best_option?.suppliers?.length) {
    return result.best_option.suppliers.filter((g) => (g.items?.length ?? 0) > 0);
  }
  return (result.variant_split?.suppliers ?? []).filter((g) => (g.items?.length ?? 0) > 0);
}

/** Normalize API payload that may predate is_optimized field */
export function normalizeOptimizeResult(data: Partial<OptimizeResult> & Record<string, unknown>): OptimizeResult {
  const packNotes = Array.isArray(data.pack_adjustment_notes)
    ? (data.pack_adjustment_notes as string[]).filter((n) => !!String(n || '').trim())
    : undefined;
  const scopeFields = {
    ...(Array.isArray(data.scope_categories) ? { scope_categories: data.scope_categories as string[] } : {}),
    ...(Array.isArray(data.scope_products) ? { scope_products: data.scope_products as OptimizeResult['scope_products'] } : {}),
    ...(data.scope_summary ? { scope_summary: String(data.scope_summary) } : {}),
    ...(Array.isArray(data.not_found_products)
      ? { not_found_products: data.not_found_products as string[] }
      : {}),
    ...(data.not_found_count != null ? { not_found_count: Number(data.not_found_count) } : {}),
  };
  if (typeof data.is_optimized === 'boolean' && data.pricing_matrix) {
    const out = { ...(data as OptimizeResult), ...scopeFields };
    if (packNotes?.length && !out.pack_adjustment_notes?.length) {
      out.pack_adjustment_notes = packNotes;
    }
    return out;
  }
  const split = (data.option_optimized ?? { type: 'optimized', suppliers: [], total_pln: 0, missing: [] }) as OptionOptimized;
  const mono = (data.option_all_one ?? null) as OptionAllOne | null;
  const itemsReq = (data.items_requested ?? []) as OptimizeResult['items_requested'];
  const matrix = (data.pricing_matrix ?? []) as PricingMatrixItem[];
  const stub: OptimizeResult = {
    currency: (data.currency as string) ?? 'PLN',
    is_optimized: false,
    items_requested: itemsReq,
    best_option: null,
    tied_suppliers: [],
    variant_monolith: mono,
    variant_split: split,
    savings_pln: Number(data.savings_pln ?? 0),
    cheaper_variant: null,
    pricing_matrix: matrix,
    assistant_speech: String(data.assistant_speech ?? ''),
    option_all_one: mono,
    option_optimized: split,
    ...(packNotes?.length ? { pack_adjustment_notes: packNotes } : {}),
    ...scopeFields,
  };
  if (matrix.length) {
    const meta = suppliersMetaFromMatrix(matrix);
    const items = matrixToPerItem(matrix, initQuantities(stub));
    const built = buildFromPerItem(items, meta, {
      currency: stub.currency,
      items_requested: itemsReq,
      pricing_matrix: matrix,
      assistant_speech: stub.assistant_speech,
    });
    if (packNotes?.length) built.pack_adjustment_notes = packNotes;
    return { ...built, ...scopeFields };
  }
  const unique = itemsReq.length;
  const totalA = mono && !mono.missing?.length ? mono.total_pln : null;
  const totalB = split && !split.missing?.length && split.suppliers?.length ? split.total_pln : null;
  const same = totalA !== null && totalB !== null && Math.abs(totalA - totalB) <= PRICE_TOLERANCE;
  stub.is_optimized = unique > 1 && totalA !== null && totalB !== null && !same;
  stub.savings_pln = stub.is_optimized ? Math.abs((totalA ?? 0) - (totalB ?? 0)) : 0;
  return stub;
}
