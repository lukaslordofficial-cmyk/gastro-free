/**
 * supplierOrdersService — koszyki + panel Zamówienia (sent / received).
 */
import { DeviceEventEmitter } from 'react-native';
import { supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export type SupplierOrderFull = {
  id: string;
  supplier_id: string;
  status: string;
  notes: string | null;
  created_at: string;
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

export async function saveOrderItems(orderId: string, rows: Row[], notes: string | null): Promise<void> {
  await supabase.from('supplier_order_items').delete().eq('order_id', orderId);
  if (rows.length) {
    const { error } = await supabase.from('supplier_order_items').insert(rows);
    if (error) throw error;
  }
  await supabase.from('supplier_orders').update({ notes }).eq('id', orderId);
}

export async function fetchGlobalBasket(): Promise<{ offerItems: Row[]; drafts: Row[] }> {
  const [{ data: offerData }, { data: drafts }] = await Promise.all([
    supabase
      .from('supplier_offer_items')
      .select('id, supplier_id, raw_product_name, price_net, unit, suppliers(name, icon_color)')
      .order('raw_product_name'),
    supabase
      .from('supplier_orders')
      .select(
        'id, supplier_id, notes, status, suppliers(name, email), supplier_order_items(id, raw_product_name, quantity_ordered, unit, price_net)',
      )
      .eq('status', 'draft')
      .order('created_at', { ascending: false }),
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

/** Draft → sent (Przygotowywane) + wyczyść pozostałe drafty tego dostawcy z koszyka. */
export async function markDraftSent(orderId: string): Promise<void> {
  const { data: row } = await supabase
    .from('supplier_orders')
    .select('id, supplier_id')
    .eq('id', orderId)
    .maybeSingle();
  const { error } = await supabase.from('supplier_orders').update({ status: 'sent' }).eq('id', orderId);
  if (error) throw error;
  const sid = (row as { supplier_id?: string } | null)?.supplier_id;
  if (sid) {
    await supabase
      .from('supplier_orders')
      .update({ status: 'sent' })
      .eq('supplier_id', sid)
      .eq('status', 'draft');
  }
  emitBasketChanged();
}

export async function deleteDrafts(draftIds: string[]): Promise<void> {
  if (!draftIds.length) return;
  await supabase.from('supplier_order_items').delete().in('order_id', draftIds);
  await supabase.from('supplier_orders').delete().in('id', draftIds);
  emitBasketChanged();
}

export async function deleteOneDraft(orderId: string): Promise<void> {
  await supabase.from('supplier_order_items').delete().eq('order_id', orderId);
  await supabase.from('supplier_orders').delete().eq('id', orderId);
  emitBasketChanged();
}

/**
 * Po „Złóż zamówienie” / przejściu do maila: podnieś drafty do sent
 * albo utwórz nowe zamówienie sent z pozycjami (Łowca Okazji).
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
  const { data: drafts } = await supabase
    .from('supplier_orders')
    .select('id')
    .eq('supplier_id', params.supplierId)
    .eq('status', 'draft');
  const draftIds = (drafts || []).map((r: { id: string }) => r.id);
  if (draftIds.length) {
    await supabase.from('supplier_orders').update({ status: 'sent' }).in('id', draftIds);
    emitBasketChanged();
    return draftIds[0];
  }
  const { data: order, error } = await supabase
    .from('supplier_orders')
    .insert({
      supplier_id: params.supplierId,
      status: 'sent',
      notes: params.notes ?? null,
    })
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

export async function fetchOrdersByStatuses(
  statuses: Array<'sent' | 'confirmed' | 'received'>,
): Promise<SupplierOrderFull[]> {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select(ORDER_SELECT)
    .in('status', statuses)
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
  const ak = getAccountKey();
  let q = supabase.from('inventory_items').select('id, name').limit(5000);
  if (ak && ak !== 'default') q = q.eq('account_key', ak);
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

/** Dopisz ilości do magazynu (fuzzy nazwa); nieznane → Inne + raport przypisań. */
export async function applyOrderItemsToInventory(
  items: SupplierOrderFull['supplier_order_items'],
): Promise<ApplyInventoryResult> {
  let updated = 0;
  let created = 0;
  const assignments: InventoryAssignment[] = [];
  const ak = getAccountKey();
  const categories = ak && ak !== 'default' ? await loadCategories(ak) : [];
  const catNameById = new Map(categories.map((c) => [c.id, c.name]));
  const inneCat =
    categories.find((c) => (c.name || '').trim().toLowerCase() === 'inne') ?? null;

  let invQuery = supabase
    .from('inventory_items')
    .select('id, name, quantity, category_id, unit')
    .limit(5000);
  if (ak && ak !== 'default') invQuery = invQuery.eq('account_key', ak);
  const { data: allInv } = await invQuery;
  const inventory = (allInv ?? []) as Array<{
    id: string;
    name: string;
    quantity: number;
    category_id: string | null;
    unit?: string | null;
  }>;

  const resolveCategoryLabel = (categoryId: string | null | undefined, fallback: string) => {
    if (categoryId && catNameById.has(categoryId)) return catNameById.get(categoryId)!;
    return fallback;
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
      let upd = supabase
        .from('inventory_items')
        .update({ quantity: before + qty })
        .eq('id', invId);
      if (ak && ak !== 'default') upd = upd.eq('account_key', ak);
      const { data: updatedRow, error } = await upd.select('id, quantity').maybeSingle();
      if (error) {
        throw new Error(
          `Nie udało się zwiększyć stanu „${matched.name}”: ${error.message}`,
        );
      }
      if (!updatedRow) {
        const { error: e2 } = await supabase
          .from('inventory_items')
          .update({ quantity: before + qty })
          .eq('id', invId);
        if (e2) {
          throw new Error(
            `Nie udało się zwiększyć stanu „${matched.name}”: ${e2.message}`,
          );
        }
      }
      updated += 1;
      matched.quantity = before + qty;
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

    // Brak dopasowania → nowa pozycja; niepewna jednostka / brak kategorii → Inne
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
      account_key: ak,
      category_id: cat?.id ?? null,
    };
    const { data: inserted, error } = await supabase
      .from('inventory_items')
      .insert(payload as never)
      .select('id, name, quantity, category_id')
      .maybeSingle();
    if (error) {
      throw new Error(`Nie udało się dodać „${storeName}” do magazynu: ${error.message}`);
    }
    if (inserted) {
      created += 1;
      inventory.push({
        ...(inserted as { id: string; name: string; quantity: number; category_id: string | null }),
        unit,
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
        await supabase.from('invoices').insert({
          supplier_id: order.supplier_id,
          supplier_name: supplierName,
          total_cost: total,
          note: shipping > 0
            ? `Zamówienie ręczne — zrealizowane (+ dostawa ${shipping} zł)`
            : 'Zamówienie ręczne — zrealizowane',
        } as never);
      } catch {
        /* tabela/migracja opcjonalna */
      }
    }
  }
  const { error } = await supabase
    .from('supplier_orders')
    .update({ status: 'received' })
    .eq('id', order.id);
  if (error) throw error;
  return { assignments };
}
