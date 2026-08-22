/**
 * inventoryService — całe IO Supabase modułu Magazyn (dekalog §II/§V).
 * Zachowanie 1:1 z poprzednią wersją ekranu (te same kolumny, fallbacki, seedy).
 */
import { supabase } from '@/lib/supabase';
import {
  dedupeWarehouseCategories,
  ensureDefaultWarehouseCategories,
} from '@/lib/warehouseCategories';
import { namesMatch } from '@/lib/fuzzyProductMatch';

const ITEM_COLS_FULL =
  'id, name, category_id, quantity, unit, min_quantity, optimal_quantity, portion_size, is_combo_polprodukt, safety_buffer_percent, shelf_life_days, inventory_categories(name), suppliers(name)';
const ITEM_COLS_SLIM =
  'id, name, category_id, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export type WarehouseData = {
  items: Row[];
  categories: Row[];
  wasteLogs: Row[];
};

/** Seed kategorii magazynu. fast=true -> w tle (po skanie faktury). */
export async function seedWarehouse(ak: string, fast: boolean): Promise<void> {
  if (!fast) {
    await ensureDefaultWarehouseCategories(supabase, ak);
    await dedupeWarehouseCategories(supabase, ak);
  } else {
    void ensureDefaultWarehouseCategories(supabase, ak);
  }
}

/** Odczyt produktów + kategorii + strat (ze slim-fallbackiem). Rzuca przy błędzie items/cats. */
export async function fetchWarehouseData(ak: string): Promise<WarehouseData> {
  const [itemsRes, catsRes, wasteRes] = await Promise.all([
    supabase
      .from('inventory_items')
      .select(ITEM_COLS_FULL)
      .eq('account_key', ak)
      .eq('is_active', true)
      .order('name')
      .limit(2000),
    supabase
      .from('inventory_categories')
      .select('id, name, color')
      .eq('account_key', ak)
      .order('sort_order')
      .limit(200),
    supabase
      .from('waste_logs')
      .select('id, item_name, quantity, unit, reason, created_at')
      .eq('account_key', ak)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  let itemsData = itemsRes.data;
  let itemsErr = itemsRes.error;
  // Jedna szybka ścieżka awaryjna — zachowaj filtr is_active, gdy kolumna istnieje.
  if (itemsErr && /optimal_quantity|safety_buffer_percent|shelf_life_days/.test(itemsErr.message ?? '')) {
    const slimActive = await supabase
      .from('inventory_items')
      .select(ITEM_COLS_SLIM)
      .eq('account_key', ak)
      .eq('is_active', true)
      .order('name')
      .limit(2000);
    if (!slimActive.error) {
      itemsData = slimActive.data;
      itemsErr = null;
    } else if (/is_active/.test(slimActive.error.message ?? '')) {
      const slim = await supabase
        .from('inventory_items')
        .select(ITEM_COLS_SLIM)
        .eq('account_key', ak)
        .order('name')
        .limit(2000);
      itemsData = slim.data;
      itemsErr = slim.error;
    } else {
      itemsErr = slimActive.error;
    }
  } else if (itemsErr && /is_active/.test(itemsErr.message ?? '')) {
    const slim = await supabase
      .from('inventory_items')
      .select(ITEM_COLS_SLIM)
      .eq('account_key', ak)
      .order('name')
      .limit(2000);
    itemsData = slim.data;
    itemsErr = slim.error;
  }
  if (itemsErr) throw itemsErr;
  if (catsRes.error) throw catsRes.error;
  if (wasteRes.error && !/account_key|waste_logs/.test(wasteRes.error.message ?? '')) {
    if (__DEV__) console.warn('[inventoryService] waste_logs:', wasteRes.error.message);
  }

  return {
    items: itemsData ?? [],
    categories: catsRes.data ?? [],
    wasteLogs: wasteRes.error ? [] : (wasteRes.data ?? []),
  };
}

/** Insert nowej kategorii. Zwraca zapisany wiersz + surowy błąd (mapowany w UI). */
export async function insertCategory(input: {
  name: string;
  color: string;
  sortOrder: number;
  accountKey: string;
}): Promise<{ data: Row | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('inventory_categories')
    .insert({
      name: input.name,
      color: input.color,
      icon_name: 'box',
      sort_order: input.sortOrder,
      account_key: input.accountKey,
    })
    .select('id, name, color')
    .single();
  return { data: data ?? null, error: error ? { message: error.message } : null };
}

/** Usunięcie kategorii (scope tenant). Zwraca surowy błąd. */
export async function deleteCategory(id: string, accountKey?: string): Promise<{ error: { message: string } | null }> {
  let q = supabase.from('inventory_categories').delete().eq('id', id);
  if (accountKey && accountKey !== 'default') q = q.eq('account_key', accountKey);
  const { error } = await q;
  return { error: error ? { message: error.message } : null };
}

/**
 * Usunięcie produktu z magazynu.
 * HARD DELETE (jak czysty reset przed re-skanem menu): soft-delete zostawia UNIQUE(name)
 * i blokuje ponowne utworzenie tego samego składnika przy confirm-scan.
 */
export async function softDeleteItem(id: string, accountKey?: string): Promise<void> {
  let hardQ = supabase.from('inventory_items').delete().eq('id', id);
  if (accountKey && accountKey !== 'default') hardQ = hardQ.eq('account_key', accountKey);
  const hard = await hardQ;
  if (!hard.error) return;
  // Fallback: stare bazy / FK — soft-delete gdy hard nie przejdzie.
  let softQ = supabase.from('inventory_items').update({ is_active: false }).eq('id', id);
  if (accountKey && accountKey !== 'default') softQ = softQ.eq('account_key', accountKey);
  const { error } = await softQ;
  if (error) throw hard.error ?? error;
}

/** Zapis produktu (insert/update) z fallbackiem na starsze schematy. Zwraca zapisany wiersz. */
export async function saveInventoryItem(input: {
  payload: Row;
  editingId: string | null;
  ak: string;
}): Promise<Row> {
  const { payload, editingId, ak } = input;
  const selectCols = ITEM_COLS_FULL;
  let row: Row = null;
  let saveError: Row = null;

  if (editingId) {
    const { optimal_quantity, unit_weight_volume, weight_volume_unit, safety_buffer_percent, shelf_life_days, account_key: _ak, ...core } = payload;
    let upd = await supabase.from('inventory_items').update(payload).eq('id', editingId).eq('account_key', ak).select(selectCols).single();
    if (upd.error && /optimal_quantity|shelf_life_days/.test(upd.error.message ?? '')) {
      const soft: Row = { ...core, safety_buffer_percent, unit_weight_volume, weight_volume_unit };
      if (!/shelf_life/.test(upd.error.message ?? '')) soft.shelf_life_days = shelf_life_days;
      if (!/optimal_quantity/.test(upd.error.message ?? '')) soft.optimal_quantity = optimal_quantity;
      upd = await supabase.from('inventory_items').update(soft).eq('id', editingId).eq('account_key', ak).select(ITEM_COLS_SLIM).single();
    }
    row = upd.data;
    saveError = upd.error;
  } else {
    let insertRes = await supabase.from('inventory_items').insert(payload).select(selectCols).single();
    if (insertRes.error && /optimal_quantity|safety_buffer_percent|unit_weight_volume|weight_volume_unit|shelf_life_days/.test(insertRes.error.message ?? '')) {
      const { optimal_quantity, safety_buffer_percent, unit_weight_volume, weight_volume_unit, shelf_life_days, ...fallback } = payload;
      insertRes = await supabase.from('inventory_items').insert(fallback).select(ITEM_COLS_SLIM).single();
    }
    row = insertRes.data;
    saveError = insertRes.error;
  }
  if (saveError) throw saveError;
  return row;
}

/** Zastąp składniki combo (best-effort, gdy tabela jeszcze nie zmigrowana). */
export async function replaceComboIngredients(itemId: string, rows: Row[]): Promise<void> {
  await supabase.from('inventory_combo_ingredients').delete().eq('inventory_item_id', itemId);
  if (!rows.length) return;
  const { error } = await supabase.from('inventory_combo_ingredients').insert(rows);
  if (error && !/does not exist|schema cache|relation/i.test(error.message ?? '')) {
    throw error;
  }
}

/** Odczyt składników combo produktu. */
export async function fetchComboIngredients(itemId: string): Promise<Row[]> {
  const { data } = await supabase
    .from('inventory_combo_ingredients')
    .select('id, ingredient_name, quantity, unit, warehouse_product_id, sort_order')
    .eq('inventory_item_id', itemId)
    .order('sort_order');
  return data ?? [];
}

/** Auto-odblokowanie pozycji ofert dostawcy po nazwie nowego produktu (tylko własni dostawcy). */
export async function autoUnlockOfferItems(accountKey: string, newItemId: string, newItemName: string): Promise<void> {
  try {
    let sleepingQuery = supabase
      .from('supplier_offer_items')
      .select('id, raw_product_name, supplier_id')
      .is('warehouse_product_id', null);
    if (accountKey && accountKey !== 'default') {
      const { data: mySuppliers } = await supabase.from('suppliers').select('id').eq('account_key', accountKey);
      const ids = (mySuppliers ?? []).map((s: Row) => s.id as string);
      if (ids.length === 0) return;
      sleepingQuery = sleepingQuery.in('supplier_id', ids);
    }
    const { data: sleeping } = await sleepingQuery;
    if (!sleeping || sleeping.length === 0) return;
    const toUnlock = sleeping
      .filter((item: Row) => namesMatch(newItemName, item.raw_product_name || '', 72))
      .map((item: Row) => item.id);
    if (toUnlock.length > 0) {
      await supabase.from('supplier_offer_items').update({ warehouse_product_id: newItemId }).in('id', toUnlock);
    }
  } catch {
    /* non-critical */
  }
}

export type ExpiryBatchRow = {
  id: string;
  quantity: number | string;
  expiration_date: string;
  alert_triggers?: number[] | null;
};

/** Partie dat ważności + bieżący stan produktu (scope tenant). */
export async function fetchExpiryBatches(
  inventoryItemId: string,
  accountKey?: string,
): Promise<{ batches: ExpiryBatchRow[]; stockQty: number }> {
  let batchQ = supabase
    .from('warehouse_inventory')
    .select('id, quantity, expiration_date, alert_triggers')
    .eq('inventory_item_id', inventoryItemId)
    .order('expiration_date', { ascending: true });
  let invQ = supabase.from('inventory_items').select('quantity').eq('id', inventoryItemId);
  if (accountKey && accountKey !== 'default') {
    batchQ = batchQ.eq('account_key', accountKey);
    invQ = invQ.eq('account_key', accountKey);
  }
  const [{ data }, { data: inv }] = await Promise.all([batchQ, invQ.maybeSingle()]);
  return {
    batches: (data ?? []) as ExpiryBatchRow[],
    stockQty: Number(inv?.quantity) || 0,
  };
}

export type ExpiryBatchInsert = {
  inventory_item_id: string;
  product_name: string;
  quantity: number;
  unit: string;
  expiration_date: string;
  status: string;
  alert_triggers: number[];
  source: string;
  account_key: string;
};

/** Zastąp wszystkie partie produktu (delete + insert, scope tenant). */
export async function replaceExpiryBatches(
  inventoryItemId: string,
  rows: ExpiryBatchInsert[],
  accountKey?: string,
): Promise<void> {
  let del = supabase.from('warehouse_inventory').delete().eq('inventory_item_id', inventoryItemId);
  if (accountKey && accountKey !== 'default') {
    del = del.eq('account_key', accountKey);
  }
  const { error: delErr } = await del;
  if (delErr) throw delErr;
  if (!rows.length) return;
  const { error } = await supabase.from('warehouse_inventory').insert(rows as never);
  if (error) throw error;
}
