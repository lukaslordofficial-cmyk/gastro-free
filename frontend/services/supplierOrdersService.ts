/**
 * supplierOrdersService — koszyki + panel Zamówienia (sent / received).
 */
import { DeviceEventEmitter } from 'react-native';
import { supabase } from '@/lib/supabase';
import { requireTenantAccountKey, withAccountKey } from '@/lib/tenantScope';
import { insertVariableCost } from '@/services/financeService';
import { namesMatch, productMatchKey, bestProductMatch } from '@/lib/fuzzyProductMatch';
import {
  guessWarehouseCategoryName,
  mapGuessToUserCategory,
} from '@/lib/guessWarehouseCategory';
import { ensureDefaultWarehouseCategories } from '@/lib/warehouseCategories';
import { buildInvoiceCostNote } from '@/lib/invoiceCostNote';
import {
  normalizeWarehouseUnit,
  stripUnitNoiseFromProductName,
} from '@/lib/warehouseUnits';

/** Odśwież koszyk globalny po przejściu draft → przygotowywane. */
export const SUPPLIER_BASKET_CHANGED = 'gm/supplier-basket-changed';

/** Magazyn: po przyjęciu dostawy odśwież listę (qty / nowe pozycje). */
export const INVENTORY_CHANGED = 'gm/inventory-changed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export type SupplierOrderFull = {
  id: string;
  supplier_id: string;
  status: string;
  notes: string | null;
  created_at: string;
  received_at?: string | null;
  inventory_applied?: boolean | null;
  variable_cost_applied?: boolean | null;
  suppliers: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    bank_account?: string | null;
    nip?: string | null;
  } | null;
  supplier_order_items: {
    id: string;
    raw_product_name: string;
    quantity_ordered: number;
    unit: string;
    price_net: number | null;
    warehouse_product_id: string | null;
  }[];
};

const ORDER_SELECT =
  'id, supplier_id, notes, status, created_at, ' +
  'suppliers(name, email, phone, address, bank_account, nip), ' +
  'supplier_order_items(id, raw_product_name, quantity_ordered, unit, price_net, warehouse_product_id)';

const ORDER_SELECT_WITH_FLAGS =
  'id, supplier_id, notes, status, created_at, received_at, inventory_applied, variable_cost_applied, ' +
  'suppliers(name, email, phone, address, bank_account, nip), ' +
  'supplier_order_items(id, raw_product_name, quantity_ordered, unit, price_net, warehouse_product_id)';

export async function saveOrderItems(orderId: string, rows: Row[], notes: string | null): Promise<void> {
  const ak = requireTenantAccountKey();
  await supabase.from('supplier_order_items').delete().eq('order_id', orderId);
  if (rows.length) {
    const { error } = await supabase.from('supplier_order_items').insert(rows);
    if (error) throw error;
  }
  await supabase.from('supplier_orders').update({ notes }).eq('id', orderId).eq('account_key', ak);
}

export async function fetchGlobalBasket(): Promise<{ offerItems: Row[]; drafts: Row[] }> {
  let accountKey: string;
  try {
    accountKey = requireTenantAccountKey();
  } catch {
    return { offerItems: [], drafts: [] };
  }
  const draftsQuery = supabase
    .from('supplier_orders')
    .select(
      'id, supplier_id, notes, status, suppliers(name, email), supplier_order_items(id, raw_product_name, quantity_ordered, unit, price_net)',
    )
    .eq('status', 'draft')
    .eq('account_key', accountKey)
    .order('created_at', { ascending: false });
  const [{ data: offerData }, { data: drafts }] = await Promise.all([
    supabase
      .from('supplier_offer_items')
      .select('id, supplier_id, raw_product_name, price_net, unit, suppliers(name, icon_color)')
      .order('raw_product_name'),
    draftsQuery,
  ]);
  return { offerItems: offerData ?? [], drafts: drafts ?? [] };
}

function emitBasketChanged(): void {
  try {
    DeviceEventEmitter.emit(SUPPLIER_BASKET_CHANGED);
  } catch {
    /* ignore */
  }
}

/** Draft → sent (Przygotowywane). Tylko ten konkretny szkic — nie kasuj innych koszyków
 * tego samego dostawcy (użytkownik mógł zapisać kilka niezależnych draftów). */
export async function markDraftSent(orderId: string): Promise<void> {
  const ak = requireTenantAccountKey();
  const { error } = await supabase.from('supplier_orders').update({ status: 'sent' }).eq('id', orderId).eq('account_key', ak);
  if (error) throw error;
  emitBasketChanged();
}

export async function deleteDrafts(draftIds: string[]): Promise<void> {
  if (!draftIds.length) return;
  const ak = requireTenantAccountKey();
  await supabase.from('supplier_order_items').delete().in('order_id', draftIds);
  await supabase.from('supplier_orders').delete().in('id', draftIds).eq('account_key', ak);
  emitBasketChanged();
}

export async function deleteOneDraft(orderId: string): Promise<void> {
  const ak = requireTenantAccountKey();
  await supabase.from('supplier_order_items').delete().eq('order_id', orderId);
  await supabase.from('supplier_orders').delete().eq('id', orderId).eq('account_key', ak);
  emitBasketChanged();
}

/**
 * Utwórz zamówienie „przygotowywane” (sent) z pozycjami z koszyka.
 * Zawsze zapisuje podane items (nie promuj pustych draftów).
 */
export async function ensureSentOrderForSupplier(params: {
  supplierId: string;
  notes?: string | null;
  items: Array<{
    raw_product_name: string;
    price_net: number | null;
    unit: string;
    quantity_ordered: number;
    warehouse_product_id?: string | null;
  }>;
}): Promise<string> {
  const { data: order, error } = await supabase
    .from('supplier_orders')
    .insert(withAccountKey({
      supplier_id: params.supplierId,
      status: 'sent',
      notes: params.notes ?? null,
    }))
    .select('id')
    .single();
  if (error || !order) throw error ?? new Error('Nie utworzono zamówienia');
  if (params.items.length) {
    const rows = params.items.map((it) => ({
      order_id: order.id,
      raw_product_name: it.raw_product_name,
      price_net: it.price_net,
      unit: it.unit,
      quantity_ordered: it.quantity_ordered,
      warehouse_product_id: it.warehouse_product_id ?? null,
    }));
    const { error: itemsErr } = await supabase.from('supplier_order_items').insert(rows);
    if (itemsErr) throw itemsErr;
  }
  emitBasketChanged();
  return order.id as string;
}

/** Usuń zamówienie z Przygotowywanych (sent/confirmed). */
export async function deletePreparingOrder(orderId: string): Promise<void> {
  const ak = requireTenantAccountKey();
  await supabase.from('supplier_order_items').delete().eq('order_id', orderId);
  const { error } = await supabase
    .from('supplier_orders')
    .delete()
    .eq('id', orderId)
    .eq('account_key', ak)
    .in('status', ['sent', 'confirmed']);
  if (error) throw error;
  emitBasketChanged();
}

function productNamesOverlap(
  a: string[],
  b: string[],
): number {
  if (!a.length || !b.length) return 0;
  const keysB = new Set(b.map((n) => productMatchKey(n)).filter(Boolean));
  let hit = 0;
  for (const n of a) {
    const k = productMatchKey(n);
    if (k && keysB.has(k)) hit += 1;
    else if (b.some((x) => namesMatch(n, x, 55))) hit += 1;
  }
  return hit / Math.max(a.length, 1);
}

/** Zamówienia już odebrane z magazynem — do ostrzeżenia przy skanie faktury. */
export async function findReceivedOrdersForInvoice(params: {
  supplierId?: string | null;
  supplierName?: string | null;
  productNames: string[];
}): Promise<SupplierOrderFull[]> {
  const ak = requireTenantAccountKey();
  let q = supabase
    .from('supplier_orders')
    .select(ORDER_SELECT_WITH_FLAGS)
    .eq('status', 'received')
    .eq('account_key', ak)
    .order('created_at', { ascending: false })
    .limit(30);
  if (params.supplierId) {
    q = q.eq('supplier_id', params.supplierId);
  }
  let { data, error } = await q;
  if (error) {
    const fallback = await supabase
      .from('supplier_orders')
      .select(ORDER_SELECT)
      .eq('status', 'received')
      .eq('account_key', ak)
      .order('created_at', { ascending: false })
      .limit(30);
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  const rows = (data ?? []) as SupplierOrderFull[];
  const withInv = rows.filter((o) => o.inventory_applied !== false);
  return filterOrdersBySupplierOrProducts(withInv.length ? withInv : rows, params);
}

function filterOrdersBySupplierOrProducts(
  rows: SupplierOrderFull[],
  params: {
    supplierId?: string | null;
    supplierName?: string | null;
    productNames: string[];
  },
): SupplierOrderFull[] {
  const sn = (params.supplierName || '').trim().toLowerCase();
  return rows.filter((o) => {
    if (params.supplierId && o.supplier_id === params.supplierId) {
      const names = (o.supplier_order_items || []).map((it) => it.raw_product_name);
      return productNamesOverlap(params.productNames, names) >= 0.35 || !params.productNames.length;
    }
    if (sn && (o.suppliers?.name || '').trim().toLowerCase() === sn) {
      const names = (o.supplier_order_items || []).map((it) => it.raw_product_name);
      return productNamesOverlap(params.productNames, names) >= 0.35;
    }
    return false;
  });
}

/** Po skanie faktury: przygotowywane → zrealizowane (bez ponownego magazynu). */
export async function markPreparingReceivedFromInvoice(params: {
  supplierId?: string | null;
  supplierName?: string | null;
}): Promise<number> {
  const ak = requireTenantAccountKey();
  let q = supabase
    .from('supplier_orders')
    .select('id, supplier_id, suppliers(name)')
    .in('status', ['sent', 'confirmed'])
    .eq('account_key', ak)
    .limit(50);
  if (params.supplierId) q = q.eq('supplier_id', params.supplierId);
  const { data } = await q;
  let rows = (data ?? []) as Array<{
    id: string;
    supplier_id: string;
    suppliers: { name?: string } | null;
  }>;
  if (!params.supplierId && params.supplierName) {
    const sn = params.supplierName.trim().toLowerCase();
    rows = rows.filter((r) => (r.suppliers?.name || '').trim().toLowerCase() === sn);
  }
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const patch: Record<string, unknown> = {
    status: 'received',
    received_at: new Date().toISOString(),
    inventory_applied: true,
    variable_cost_applied: true,
  };
  const { error } = await supabase
    .from('supplier_orders')
    .update(patch)
    .in('id', ids)
    .eq('account_key', ak);
  if (error) {
    // bez nowych kolumn
    await supabase
      .from('supplier_orders')
      .update({ status: 'received' })
      .in('id', ids)
      .eq('account_key', ak);
  }
  emitBasketChanged();
  return ids.length;
}

export async function fetchOrdersByStatuses(
  statuses: Array<'sent' | 'confirmed' | 'received'>,
): Promise<SupplierOrderFull[]> {
  const ak = requireTenantAccountKey();
  const { data, error } = await supabase
    .from('supplier_orders')
    .select(ORDER_SELECT)
    .in('status', statuses)
    .eq('account_key', ak)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SupplierOrderFull[];
}

function yearMonthNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function orderLineTotal(items: SupplierOrderFull['supplier_order_items']): number {
  return items.reduce((s, it) => {
    const p = it.price_net != null ? Number(it.price_net) : 0;
    const q = Number(it.quantity_ordered) || 0;
    return s + p * q;
  }, 0);
}

/** Koszt dostawy: gdy shipping_cost > 0 i (brak progu gratis albo koszyk poniżej progu). */
export function computeSupplierShipping(
  productsTotal: number,
  shippingCost: number,
  freeShippingThreshold: number,
): number {
  const ship = Number(shippingCost) || 0;
  if (ship <= 0) return 0;
  const freeFrom = Number(freeShippingThreshold) || 0;
  if (freeFrom > 0 && productsTotal >= freeFrom) return 0;
  return Math.round(ship * 100) / 100;
}

async function fetchSupplierShippingMeta(supplierId: string): Promise<{
  shipping_cost: number;
  free_shipping_threshold: number;
}> {
  const { data } = await supabase
    .from('suppliers')
    .select('shipping_cost, free_shipping_threshold')
    .eq('id', supplierId)
    .maybeSingle();
  return {
    shipping_cost: Number((data as { shipping_cost?: number } | null)?.shipping_cost) || 0,
    free_shipping_threshold:
      Number((data as { free_shipping_threshold?: number } | null)?.free_shipping_threshold) || 0,
  };
}

async function loadCategories(ak: string): Promise<Array<{ id: string; name: string }>> {
  await ensureDefaultWarehouseCategories(supabase, ak);
  const { data } = await supabase
    .from('inventory_categories')
    .select('id, name')
    .eq('account_key', ak)
    .limit(200);
  return (data ?? []) as Array<{ id: string; name: string }>;
}

/** Znajdź id pozycji magazynu po nazwie (koper ↔ koperek). */
export async function resolveWarehouseProductId(
  productName: string,
): Promise<string | null> {
  const name = stripUnitNoiseFromProductName(productName || '');
  if (!name) return null;
  const ak = requireTenantAccountKey();
  let q = supabase.from('inventory_items').select('id, name').eq('account_key', ak).limit(5000);
  const { data } = await q;
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  if (!rows.length) return null;
  const key = productMatchKey(name);
  const exact = key ? rows.find((r) => productMatchKey(r.name) === key) : undefined;
  if (exact) return exact.id;
  const fuzzy = bestProductMatch(name, rows, (r) => r.name, 58);
  return fuzzy?.item.id ?? null;
}

export type InventoryAssignment = {
  sourceName: string;
  inventoryName: string;
  categoryName: string;
  action: 'updated' | 'created';
  qty: number;
  unit: string;
};

export type ApplyInventoryResult = {
  updated: number;
  created: number;
  assignments: InventoryAssignment[];
};

/** Dopisz ilości do magazynu (fuzzy nazwa); tylko aktywne pozycje; nieznane → Inne. */
export async function applyOrderItemsToInventory(
  items: SupplierOrderFull['supplier_order_items'],
): Promise<ApplyInventoryResult> {
  let updated = 0;
  let created = 0;
  const assignments: InventoryAssignment[] = [];
  const ak = requireTenantAccountKey();
  const categories = await loadCategories(ak);
  const catNameById = new Map(categories.map((c) => [c.id, c.name]));
  const inneCat =
    categories.find((c) => (c.name || '').trim().toLowerCase() === 'inne') ?? null;

  // Tylko aktywne — soft-delete (is_active=false) z DEDUP nie może „połykać” dostaw.
  let invQuery = supabase
    .from('inventory_items')
    .select('id, name, quantity, category_id, unit, is_active')
    .eq('account_key', ak)
    .limit(5000);
  let { data: allInv, error: invErr } = await invQuery.eq('is_active', true);
  if (invErr && /is_active/.test(invErr.message ?? '')) {
    const retry = await supabase
      .from('inventory_items')
      .select('id, name, quantity, category_id, unit')
      .eq('account_key', ak)
      .limit(5000);
    allInv = retry.data;
    invErr = retry.error;
  }
  if (invErr) {
    throw new Error(`Nie udało się wczytać magazynu: ${invErr.message}`);
  }
  const inventory = (allInv ?? []) as Array<{
    id: string;
    name: string;
    quantity: number;
    category_id: string | null;
    unit?: string | null;
    is_active?: boolean | null;
  }>;

  const resolveCategoryLabel = (categoryId: string | null | undefined, fallback: string) => {
    if (categoryId && catNameById.has(categoryId)) return catNameById.get(categoryId)!;
    return fallback;
  };

  const bumpQuantity = async (
    invId: string,
    displayName: string,
    before: number,
    qty: number,
  ): Promise<number> => {
    const nextQty = before + qty;
    const patch: Record<string, unknown> = {
      quantity: nextQty,
      is_active: true,
    };
    let upd = supabase.from('inventory_items').update(patch).eq('id', invId);
    if (ak && ak !== 'default') upd = upd.eq('account_key', ak);
    let { data: updatedRow, error } = await upd.select('id, quantity, is_active').maybeSingle();
    if (error && /is_active/.test(error.message ?? '')) {
      const soft = { quantity: nextQty };
      let u2 = supabase.from('inventory_items').update(soft).eq('id', invId);
      if (ak && ak !== 'default') u2 = u2.eq('account_key', ak);
      const r2 = await u2.select('id, quantity').maybeSingle();
      updatedRow = r2.data as { id: string; quantity: number; is_active?: boolean } | null;
      error = r2.error;
    }
    if (error) {
      throw new Error(`Nie udało się zwiększyć stanu „${displayName}”: ${error.message}`);
    }
    if (!updatedRow) {
      const r3 = await supabase
        .from('inventory_items')
        .update(patch)
        .eq('id', invId)
        .select('id, quantity')
        .maybeSingle();
      if (r3.error) {
        throw new Error(`Nie udało się zwiększyć stanu „${displayName}”: ${r3.error.message}`);
      }
      if (!r3.data) {
        throw new Error(
          `Nie zapisano stanu „${displayName}” (brak uprawnień lub pozycja nieaktywna).`,
        );
      }
      return Number(r3.data.quantity) || nextQty;
    }
    const saved = Number(updatedRow.quantity);
    if (!Number.isFinite(saved) || Math.abs(saved - nextQty) > 0.0001) {
      throw new Error(
        `Stan „${displayName}” nie został zapisany (oczekiwano ${nextQty}, jest ${saved}).`,
      );
    }
    return saved;
  };

  for (const it of items) {
    const qty = Number(it.quantity_ordered) || 0;
    if (qty <= 0) continue;
    const rawName = (it.raw_product_name || '').trim();
    if (!rawName) continue;
    const matchName = stripUnitNoiseFromProductName(rawName);
    const unitNorm = normalizeWarehouseUnit(it.unit);
    const unit = unitNorm || 'szt';
    const unsureUnit = unitNorm == null && !!(it.unit || '').trim();

    let invId = (it.warehouse_product_id || '').trim() || null;
    let matched = invId ? inventory.find((r) => r.id === invId) : undefined;
    // martwy / nieaktywny ID z zamówienia → fuzzy po nazwie wśród aktywnych
    if (invId && !matched) invId = null;

    if (!matched) {
      const key = productMatchKey(matchName);
      matched =
        (key
          ? inventory.find((r) => productMatchKey(r.name) === key)
          : undefined) ||
        bestProductMatch(matchName, inventory, (r) => r.name, 55)?.item ||
        inventory.find((r) => namesMatch(matchName, r.name, 55));
      if (!matched && key) {
        const sameKey = inventory.filter((r) => productMatchKey(r.name) === key);
        if (sameKey.length) {
          matched = sameKey.reduce((a, b) =>
            (a.name || '').length <= (b.name || '').length ? a : b,
          );
        }
      }
      if (!matched && matchName !== rawName) {
        matched =
          bestProductMatch(rawName, inventory, (r) => r.name, 55)?.item ||
          inventory.find((r) => namesMatch(rawName, r.name, 55));
      }
      if (matched) invId = matched.id;
    }

    if (matched && invId) {
      const before = Number(matched.quantity) || 0;
      const savedQty = await bumpQuantity(invId, matched.name, before, qty);
      updated += 1;
      matched.quantity = savedQty;
      assignments.push({
        sourceName: rawName,
        inventoryName: matched.name,
        categoryName: resolveCategoryLabel(matched.category_id, 'Magazyn'),
        action: 'updated',
        qty,
        unit,
      });
      continue;
    }

    const guessed = unsureUnit ? 'Inne' : guessWarehouseCategoryName(matchName || rawName);
    let cat = mapGuessToUserCategory(guessed, categories);
    if (!cat || guessed === 'Inne' || unsureUnit) {
      cat = inneCat ?? cat;
    }
    const storeName = matchName || rawName;
    const payload: Record<string, unknown> = {
      name: storeName,
      quantity: qty,
      unit,
      min_quantity: 0,
      unit_cost: it.price_net != null ? Number(it.price_net) : 0,
      portion_size: null,
      is_combo_polprodukt: false,
      is_critical: false,
      is_active: true,
      account_key: ak,
      category_id: cat?.id ?? null,
    };
    let { data: inserted, error } = await supabase
      .from('inventory_items')
      .insert(payload as never)
      .select('id, name, quantity, category_id')
      .maybeSingle();
    if (error && /is_active/.test(error.message ?? '')) {
      const { is_active: _ia, ...withoutActive } = payload;
      const r2 = await supabase
        .from('inventory_items')
        .insert(withoutActive as never)
        .select('id, name, quantity, category_id')
        .maybeSingle();
      inserted = r2.data;
      error = r2.error;
    }
    if (error) {
      throw new Error(`Nie udało się dodać „${storeName}” do magazynu: ${error.message}`);
    }
    if (!inserted?.id) {
      throw new Error(`Nie zapisano nowej pozycji „${storeName}” w magazynie.`);
    }
    created += 1;
    inventory.push({
      ...(inserted as { id: string; name: string; quantity: number; category_id: string | null }),
      unit,
      is_active: true,
    });
    assignments.push({
      sourceName: rawName,
      inventoryName: (inserted as { name: string }).name,
      categoryName: resolveCategoryLabel(
        (inserted as { category_id?: string | null }).category_id,
        cat?.name || 'Inne',
      ),
      action: 'created',
      qty,
      unit,
    });
  }
  return { updated, created, assignments };
}

export async function receiveSupplierOrder(
  order: SupplierOrderFull,
  opts: { applyInventory: boolean; applyVariableCost: boolean },
): Promise<{ assignments: InventoryAssignment[] }> {
  let assignments: InventoryAssignment[] = [];
  if (opts.applyInventory) {
    const res = await applyOrderItemsToInventory(order.supplier_order_items || []);
    assignments = res.assignments;
  }
  if (opts.applyVariableCost) {
    const items = order.supplier_order_items || [];
    const productsTotal = orderLineTotal(items);
    const shipMeta = await fetchSupplierShippingMeta(order.supplier_id);
    const shipping = computeSupplierShipping(
      productsTotal,
      shipMeta.shipping_cost,
      shipMeta.free_shipping_threshold,
    );
    const total = Math.round((productsTotal + shipping) * 100) / 100;
    if (total > 0) {
      const supplierName = order.suppliers?.name || 'Dostawca';
      const lines = items.map((it) => ({
        name: (it.raw_product_name || '').trim(),
        qty: Number(it.quantity_ordered) || 0,
        unit: (it.unit || 'szt').trim() || 'szt',
        price_netto: it.price_net != null ? Number(it.price_net) : 0,
      }));
      if (shipping > 0) {
        lines.push({
          name: 'Koszt dostawy',
          qty: 1,
          unit: 'szt',
          price_netto: shipping,
        });
      }
      const note = buildInvoiceCostNote({
        supplier_id: order.supplier_id,
        supplier_name: supplierName,
        total,
        lines,
      });
      await insertVariableCost({
        year_month: yearMonthNow(),
        type: 'materials',
        name: `Dostawa — ${supplierName}`,
        amount_pln: total,
        note,
      });
      try {
        await supabase.from('invoices').insert(withAccountKey({
          supplier_id: order.supplier_id,
          supplier_name: supplierName,
          total_cost: total,
          note: shipping > 0
            ? `Zamówienie ręczne — zrealizowane (+ dostawa ${shipping} zł)`
            : 'Zamówienie ręczne — zrealizowane',
        }) as never);
      } catch {
        /* tabela/migracja opcjonalna */
      }
    }
  }
  const patch: Record<string, unknown> = {
    status: 'received',
    received_at: new Date().toISOString(),
    inventory_applied: !!opts.applyInventory,
    variable_cost_applied: !!opts.applyVariableCost,
  };
  let { error } = await supabase
    .from('supplier_orders')
    .update(patch)
    .eq('id', order.id)
    .eq('account_key', requireTenantAccountKey());
  if (error && /received_at|inventory_applied|variable_cost_applied/.test(error.message ?? '')) {
    const r2 = await supabase
      .from('supplier_orders')
      .update({ status: 'received' })
      .eq('id', order.id)
      .eq('account_key', requireTenantAccountKey());
    error = r2.error;
  }
  if (error) throw error;
  if (opts.applyInventory) {
    DeviceEventEmitter.emit(INVENTORY_CHANGED);
  }
  return { assignments };
}
