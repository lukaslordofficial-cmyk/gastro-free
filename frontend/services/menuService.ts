/**
 * menuService — całe IO Supabase modułu Menu (dekalog §II/§V).
 *
 * DLACZEGO: ekran `menu.tsx` trzymał bezpośrednie zapytania do menu_items /
 * recipe_ingredients / inventory_*. Warstwa UI ma tylko orkiestrację stanu;
 * tu zostaje zachowanie 1:1 (te same kolumny, fallbacki schematu, limity).
 */
import { supabase } from '@/lib/supabase';
import { mapDbToDish, mapInvDbRow } from '@/lib/menuScreenHelpers';
import type { Dish, InventoryItem, KitchenUtensil, RecipeIngredient } from '@/types/menu';

const INV_SELECT =
  'id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)';
const INV_SELECT_NO_SUPPLIER =
  'id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name)';

export type MenuListRowDb = {
  id: string;
  name: string;
  category: string;
  price_pln: number;
  pos_id: string;
};

export type RecipeIngredientRow = {
  ingredient_name: string;
  quantity: number | string;
  unit: string;
  sort_order?: number | null;
  piece_weight_g?: number | string | null;
};

export type RecipeIngredientInsert = Record<string, unknown>;

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message?: string }).message ?? '');
  }
  return e instanceof Error ? e.message : '';
}

/** Lista dań bez receptur (szybki pierwszy paint). */
export async function fetchMenuItemList(accountKey: string): Promise<Dish[]> {
  try {
    const listRes = await supabase
      .from('menu_items')
      .select('id, name, category, price_pln, pos_id')
      .eq('account_key', accountKey)
      .eq('is_active', true)
      .order('category')
      .order('name')
      .limit(1000);
    if (listRes.error) throw listRes.error;

    const byId = new Map<string, Dish>();
    for (const row of listRes.data ?? []) {
      const id = String((row as { id?: string }).id || '');
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        name: String((row as { name?: string }).name || ''),
        category: String((row as { category?: string }).category || ''),
        price_pln: Number((row as { price_pln?: number }).price_pln) || 0,
        pos_id: String((row as { pos_id?: string }).pos_id || ''),
        recipe: [],
      });
    }
    return Array.from(byId.values());
  } catch (e) {
    if (__DEV__) console.warn('[menuService] fetchMenuItemList', e);
    throw e instanceof Error ? e : new Error(errMsg(e) || 'Nie udało się wczytać menu.');
  }
}

/**
 * Receptury w tle — fallback gdy kolumna piece_weight_g nie istnieje w cache schematu.
 * Zwraca mapę menu_item_id → składniki.
 */
export async function fetchMenuRecipesMap(
  accountKey: string,
): Promise<Map<string, RecipeIngredient[]>> {
  const recipeById = new Map<string, RecipeIngredient[]>();
  try {
    let recipesRes = await supabase
      .from('menu_items')
      .select('id, recipe_ingredients(id, ingredient_name, quantity, unit, sort_order, piece_weight_g)')
      .eq('account_key', accountKey)
      .eq('is_active', true)
      .limit(1000);
    if (recipesRes.error && /piece_weight_g/i.test(recipesRes.error.message ?? '')) {
      recipesRes = await supabase
        .from('menu_items')
        .select('id, recipe_ingredients(id, ingredient_name, quantity, unit, sort_order)')
        .eq('account_key', accountKey)
        .eq('is_active', true)
        .limit(1000);
    }
    if (recipesRes.error || !recipesRes.data) return recipeById;
    for (const row of recipesRes.data) {
      const mapped = mapDbToDish(row);
      recipeById.set(mapped.id, mapped.recipe);
    }
    return recipeById;
  } catch (e) {
    if (__DEV__) console.warn('[menuService] fetchMenuRecipesMap', e);
    return recipeById;
  }
}

export type MenuAuxiliaryData = {
  utensils: KitchenUtensil[];
  inventory: InventoryItem[];
  categoryMap: Record<string, string>;
};

/** Narzędzia kuchenne + magazyn + mapa kategorii (tło po liście dań). */
export async function fetchMenuAuxiliary(accountKey: string): Promise<MenuAuxiliaryData> {
  const empty: MenuAuxiliaryData = { utensils: [], inventory: [], categoryMap: {} };
  try {
    const [utensilsRes, invRes, catsRes] = await Promise.all([
      supabase
        .from('kitchen_utensils')
        .select('id, name, utensil_type, capacity_value, capacity_unit')
        .eq('account_key', accountKey)
        .order('name'),
      supabase
        .from('inventory_items')
        .select(INV_SELECT)
        .eq('account_key', accountKey)
        .eq('is_active', true)
        .order('name')
        .then(async (res) => {
          if (res.error && /is_active/.test(res.error.message ?? '')) {
            return supabase
              .from('inventory_items')
              .select(INV_SELECT)
              .eq('account_key', accountKey)
              .order('name');
          }
          return res;
        }),
      supabase
        .from('inventory_categories')
        .select('id, name')
        .eq('account_key', accountKey)
        .order('sort_order'),
    ]);

    let utensils: KitchenUtensil[] = [];
    if (utensilsRes.error) {
      if (!/account_key|schema cache|column/i.test(utensilsRes.error.message ?? '')) {
        if (__DEV__) console.warn('[menuService] utensils', utensilsRes.error.message);
      }
    } else {
      utensils = (utensilsRes.data ?? []) as KitchenUtensil[];
    }

    let inventory: InventoryItem[] = [];
    if (!invRes.error) {
      const invMapped = (invRes.data ?? []).map(mapInvDbRow);
      const invById = new Map<string, InventoryItem>();
      for (const i of invMapped) {
        if (!invById.has(i.id)) invById.set(i.id, i);
      }
      inventory = Array.from(invById.values());
    }

    const categoryMap: Record<string, string> = {};
    if (!catsRes.error) {
      (catsRes.data ?? []).forEach((c: { id?: string; name?: string }) => {
        if (c.name && c.id) categoryMap[c.name] = c.id;
      });
    }

    return { utensils, inventory, categoryMap };
  } catch (e) {
    if (__DEV__) console.warn('[menuService] fetchMenuAuxiliary', e);
    return empty;
  }
}

/** Składniki receptury do edytora (sync z Ustawień POS). */
export async function fetchRecipeIngredientRows(
  menuItemId: string,
): Promise<RecipeIngredientRow[]> {
  try {
    const { data, error } = await supabase
      .from('recipe_ingredients')
      .select('ingredient_name, quantity, unit, sort_order, piece_weight_g')
      .eq('menu_item_id', menuItemId)
      .order('sort_order');
    if (error) {
      if (__DEV__) console.warn('[menuService] fetchRecipeIngredientRows', error.message);
      return [];
    }
    return (data ?? []) as RecipeIngredientRow[];
  } catch (e) {
    if (__DEV__) console.warn('[menuService] fetchRecipeIngredientRows', e);
    return [];
  }
}

/**
 * Usuwa danie + recepturę. Zwraca ID produktów magazynu podpiętych tylko pod to danie
 * (UI decyduje o auto-czyszczeniu pustych pozycji).
 */
export async function deleteMenuDish(
  dishId: string,
  accountKey?: string,
): Promise<{ linkedWarehouseIds: string[] }> {
  try {
    const { data: linkedRows } = await supabase
      .from('recipe_ingredients')
      .select('warehouse_product_id')
      .eq('menu_item_id', dishId);
    const linkedWarehouseIds = [
      ...new Set(
        ((linkedRows ?? []) as Array<{ warehouse_product_id?: string | null }>)
          .map((r) => r.warehouse_product_id)
          .filter((id): id is string => !!id),
      ),
    ];

    await supabase.from('recipe_ingredients').delete().eq('menu_item_id', dishId);
    let delQ = supabase.from('menu_items').delete().eq('id', dishId);
    // Defense-in-depth obok RLS — nie kasuj cudzego dania po samym UUID.
    if (accountKey && accountKey !== 'default') {
      delQ = delQ.eq('account_key', accountKey);
    }
    const { error: delError } = await delQ;
    if (delError) throw delError;
    return { linkedWarehouseIds };
  } catch (e) {
    if (__DEV__) console.warn('[menuService] deleteMenuDish', e);
    throw e instanceof Error ? e : new Error(errMsg(e) || 'Nie udało się usunąć dania.');
  }
}

/**
 * Usuwa produkt magazynu gdy stan = 0 i nie jest używany w żadnej innej recepturze.
 * Zwraca true gdy faktycznie usunięto.
 */
export async function deleteOrphanZeroStockWarehouseProduct(
  warehouseProductId: string,
): Promise<boolean> {
  try {
    const { data: inv } = await supabase
      .from('inventory_items')
      .select('id, quantity')
      .eq('id', warehouseProductId)
      .maybeSingle();
    if (!inv || Number(inv.quantity) > 0) return false;

    const { count } = await supabase
      .from('recipe_ingredients')
      .select('id', { count: 'exact', head: true })
      .eq('warehouse_product_id', warehouseProductId);
    if ((count ?? 0) > 0) return false;

    await supabase.from('inventory_items').delete().eq('id', warehouseProductId);
    return true;
  } catch (e) {
    if (__DEV__) console.warn('[menuService] deleteOrphanZeroStockWarehouseProduct', e);
    return false;
  }
}

/** Świeży snapshot aktywnych pozycji magazynu (linkowanie receptur). */
export async function fetchActiveInventoryRows(accountKey: string): Promise<unknown[]> {
  try {
    const withActive = await supabase
      .from('inventory_items')
      .select(INV_SELECT_NO_SUPPLIER)
      .eq('account_key', accountKey)
      .eq('is_active', true)
      .limit(3000);
    if (!withActive.error) return withActive.data ?? [];
    if (/is_active/i.test(withActive.error.message ?? '')) {
      const fallback = await supabase
        .from('inventory_items')
        .select(INV_SELECT_NO_SUPPLIER)
        .eq('account_key', accountKey)
        .limit(3000);
      return fallback.error ? [] : (fallback.data ?? []);
    }
    return [];
  } catch (e) {
    if (__DEV__) console.warn('[menuService] fetchActiveInventoryRows', e);
    return [];
  }
}

export type InsertZeroStockItemInput = {
  name: string;
  categoryId: string | null;
  unit: string;
  accountKey: string;
};

/** Tworzy produkt ze stanem 0 pod recepturę; przy race zwraca null (caller dociąga listę). */
export async function insertZeroStockInventoryItem(
  input: InsertZeroStockItemInput,
): Promise<InventoryItem | null> {
  try {
    const insertPayload: Record<string, unknown> = {
      name: input.name,
      category_id: input.categoryId,
      quantity: 0,
      unit: input.unit,
      min_quantity: 1,
      is_combo_polprodukt: false,
      unit_cost: 0,
      account_key: input.accountKey,
    };
    const { data: newRow, error } = await supabase
      .from('inventory_items')
      .insert(insertPayload as never)
      .select(INV_SELECT_NO_SUPPLIER)
      .single();
    if (error || !newRow?.id) return null;
    return mapInvDbRow(newRow);
  } catch (e) {
    if (__DEV__) console.warn('[menuService] insertZeroStockInventoryItem', e);
    return null;
  }
}

export async function updateMenuItem(
  id: string,
  fields: { name: string; category: string; price_pln: number },
  accountKey?: string,
): Promise<void> {
  let q = supabase
    .from('menu_items')
    .update({ name: fields.name, category: fields.category, price_pln: fields.price_pln })
    .eq('id', id);
  if (accountKey && accountKey !== 'default') {
    q = q.eq('account_key', accountKey);
  }
  const { error } = await q;
  if (error) throw error;
}

/**
 * Insert składników z fallbackiem gdy schema cache nie zna piece_weight_g / warehouse_product_id.
 */
export async function replaceRecipeIngredients(
  menuItemId: string,
  rows: RecipeIngredientInsert[],
): Promise<void> {
  await supabase.from('recipe_ingredients').delete().eq('menu_item_id', menuItemId);
  if (rows.length === 0) return;

  const { error: ingError } = await supabase.from('recipe_ingredients').insert(rows as never);
  if (!ingError) return;

  if (/piece_weight_g|warehouse_product_id|schema cache/i.test(ingError.message ?? '')) {
    const fallback = rows.map(({ piece_weight_g: _pw, warehouse_product_id: _w, ...rest }) => rest);
    const { error: e2 } = await supabase.from('recipe_ingredients').insert(fallback as never);
    if (e2) throw e2;
    return;
  }
  throw ingError;
}

export type InsertMenuItemInput = {
  name: string;
  category: string;
  price_pln: number;
  pos_id: string;
  accountKey: string;
};

export async function insertMenuItem(input: InsertMenuItemInput): Promise<{ id: string }> {
  const { data: newItem, error: itemError } = await supabase
    .from('menu_items')
    .insert({
      name: input.name,
      category: input.category,
      price_pln: input.price_pln,
      pos_id: input.pos_id,
      is_active: true,
      account_key: input.accountKey,
    })
    .select('id')
    .single();

  if (itemError) {
    const msg = itemError.message || '';
    if (/row-level security|RLS/i.test(msg)) {
      throw new Error(
        'Brak uprawnień do zapisu menu. Wyloguj się i zaloguj ponownie. Jeśli problem wraca — skontaktuj się z supportem.',
      );
    }
    throw itemError;
  }
  return { id: newItem.id as string };
}

/** Opcjonalnie: insert receptury przy nowym daniu (bez delete). */
export async function insertRecipeIngredients(rows: RecipeIngredientInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error: ingError } = await supabase.from('recipe_ingredients').insert(rows as never);
  if (!ingError) return;
  if (/piece_weight_g|warehouse_product_id|schema cache/i.test(ingError.message ?? '')) {
    const fallback = rows.map(({ piece_weight_g: _pw, warehouse_product_id: _w, ...rest }) => rest);
    const { error: e2 } = await supabase.from('recipe_ingredients').insert(fallback as never);
    if (e2) throw e2;
    return;
  }
  throw ingError;
}

export type QuickAddInventoryInput = {
  name: string;
  categoryId: string | null;
  quantity: number;
  unit: string;
  minQuantity: number;
  portionSize: number | null;
  isCombo: boolean;
  accountKey: string;
};

/**
 * Quick-add z formularza składnika: update istniejącego (suma qty) albo insert.
 * `existingId` = lokalny hit; gdy null — szuka w DB po account_key.
 */
export async function upsertQuickAddInventoryItem(
  input: QuickAddInventoryInput,
  existing: InventoryItem | null,
): Promise<InventoryItem> {
  const ak = input.accountKey;

  if (existing) {
    const nextQty = (Number(existing.current_qty) || 0) + (Number(input.quantity) || 0);
    const { data: updated, error: updErr } = await supabase
      .from('inventory_items')
      .update({
        quantity: nextQty,
        min_quantity: input.minQuantity,
        unit: input.unit,
        portion_size: input.portionSize,
        is_combo_polprodukt: input.isCombo,
      })
      .eq('id', existing.id)
      .eq('account_key', ak)
      .select(INV_SELECT)
      .single();
    if (updErr) throw updErr;
    return mapInvDbRow(updated);
  }

  const { data: newRow, error: insertError } = await supabase
    .from('inventory_items')
    .insert({
      name: input.name,
      category_id: input.categoryId,
      quantity: input.quantity,
      unit: input.unit,
      min_quantity: input.minQuantity,
      portion_size: input.portionSize,
      is_combo_polprodukt: input.isCombo,
      unit_cost: 0,
      account_key: ak,
    } as never)
    .select(INV_SELECT)
    .single();

  if (insertError) {
    const msg = insertError.message || '';
    if (/row-level security|RLS/i.test(msg)) {
      throw new Error(
        'Brak uprawnień do zapisu magazynu. Wyloguj się i zaloguj ponownie. Jeśli problem wraca — skontaktuj się z supportem.',
      );
    }
    throw insertError;
  }
  return mapInvDbRow(newRow);
}

/** Szuka aktywnych pozycji magazynu (dedup quick-add gdy brak lokalnego hitu). */
export async function fetchActiveInventoryItems(accountKey: string): Promise<InventoryItem[]> {
  try {
    const { data: dbHit, error } = await supabase
      .from('inventory_items')
      .select(INV_SELECT)
      .eq('account_key', accountKey)
      .eq('is_active', true)
      .limit(3000);
    if (error) {
      if (__DEV__) console.warn('[menuService] fetchActiveInventoryItems', error.message);
      return [];
    }
    return (dbHit ?? []).map(mapInvDbRow);
  } catch (e) {
    if (__DEV__) console.warn('[menuService] fetchActiveInventoryItems', e);
    return [];
  }
}
