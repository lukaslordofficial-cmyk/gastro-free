/**
 * settingsService — IO Supabase ekranu Ustawienia / mapowanie POS (dekalog §II).
 *
 * DLACZEGO: `ustawienia.tsx` wołał supabase bezpośrednio. Tu zostaje zachowanie 1:1
 * + filtr `account_key` na menu/magazynie gdy tenant jest znany (defense-in-depth).
 */
import { supabase } from '@/lib/supabase';
import type {
  InventoryItemForRecipe,
  MenuItemForMapping,
} from '@/components/MenuRecipeRow';

export type PosSettingsRow = {
  id?: string;
  api_key: string;
  is_connected: boolean;
};

export type SettingsBundle = {
  pos: (PosSettingsRow & { id: string }) | null;
  menuItems: MenuItemForMapping[];
  inventoryItems: InventoryItemForRecipe[];
};

function isRealKey(ak: string | null | undefined): ak is string {
  return !!ak && ak !== 'default';
}

type RecipeIngRaw = {
  id?: string;
  ingredient_name?: string;
  quantity?: number | string;
  unit?: string;
  sort_order?: number | string;
  warehouse_product_id?: string | null;
};

function mapMenuWithRecipes(rows: unknown[]): MenuItemForMapping[] {
  return (rows ?? []).map((raw) => {
    const m = raw as {
      id: string;
      name: string;
      category: string | null;
      price_pln: number | null;
      pos_id: string | null;
      is_available?: boolean | null;
      recipe_ingredients?: RecipeIngRaw | RecipeIngRaw[] | null;
    };
    const ings = Array.isArray(m.recipe_ingredients)
      ? m.recipe_ingredients
      : m.recipe_ingredients
        ? [m.recipe_ingredients]
        : [];
    const sorted = [...ings].sort(
      (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0),
    );
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      price_pln: m.price_pln,
      pos_id: m.pos_id,
      is_available: m.is_available !== false,
      recipeIngredients: sorted.map((r) => ({
        id: String(r.id ?? ''),
        ingredient_name: r.ingredient_name ?? '',
        quantity: Number(r.quantity) || 0,
        unit: r.unit || 'g',
        warehouse_product_id: r.warehouse_product_id ?? null,
        warehouse_product_name: null,
      })),
    };
  });
}

function mapMenuPlain(rows: unknown[]): MenuItemForMapping[] {
  return (rows ?? []).map((raw) => {
    const m = raw as {
      id: string;
      name: string;
      category: string | null;
      price_pln: number | null;
      pos_id: string | null;
      is_available?: boolean | null;
    };
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      price_pln: m.price_pln,
      pos_id: m.pos_id,
      is_available: m.is_available !== false,
      recipeIngredients: [],
    };
  });
}

function mapInventory(rows: unknown[]): InventoryItemForRecipe[] {
  return (rows ?? []).map((raw) => {
    const i = raw as {
      id: string;
      name: string;
      unit: string;
      quantity: number | string;
      min_quantity: number | string;
      inventory_categories?: { name?: string | null } | null;
    };
    return {
      id: i.id,
      name: i.name,
      unit: i.unit,
      quantity: Number(i.quantity) || 0,
      min_quantity: Number(i.min_quantity) || 0,
      category_name: i.inventory_categories?.name ?? null,
    };
  });
}

/** Pełny odczyt ustawień: POS + menu (z recepturami) + magazyn. */
export async function fetchSettingsBundle(accountKey?: string | null): Promise<SettingsBundle> {
  if (!isRealKey(accountKey)) {
    return { pos: null, menuItems: [], inventoryItems: [] };
  }
  try {
    let menuQ = supabase
      .from('menu_items')
      .select(
        'id, name, category, price_pln, pos_id, is_available, recipe_ingredients(id, ingredient_name, quantity, unit, sort_order)',
      )
      .eq('is_active', true)
      .order('category')
      .order('name');
    let invQ = supabase
      .from('inventory_items')
      .select('id, name, unit, quantity, min_quantity, inventory_categories(name)')
      .order('name');
    if (isRealKey(accountKey)) {
      menuQ = menuQ.eq('account_key', accountKey);
      invQ = invQ.eq('account_key', accountKey);
    }

    let posQ = supabase.from('pos_settings').select('*').limit(1);
    if (isRealKey(accountKey)) posQ = posQ.eq('account_key', accountKey);
    else posQ = posQ.eq('account_key', '__none__');

    const [posRes, menuRes, invRes] = await Promise.all([
      posQ.maybeSingle(),
      menuQ,
      invQ,
    ]);

    let pos: (PosSettingsRow & { id: string }) | null = null;
    if (posRes.data?.id) {
      pos = {
        id: String(posRes.data.id),
        api_key: posRes.data.api_key ?? '',
        is_connected: posRes.data.is_connected ?? false,
      };
    }

    let menuItems: MenuItemForMapping[] = [];
    if (menuRes.error) {
      let plainQ = supabase
        .from('menu_items')
        .select('id, name, category, price_pln, pos_id, is_available')
        .eq('is_active', true)
        .order('category')
        .order('name');
      if (isRealKey(accountKey)) plainQ = plainQ.eq('account_key', accountKey);
      const plain = await plainQ;
      if (plain.error) throw plain.error;
      menuItems = mapMenuPlain(plain.data ?? []);
    } else {
      menuItems = mapMenuWithRecipes(menuRes.data ?? []);
    }

    return {
      pos,
      menuItems,
      inventoryItems: invRes.error ? [] : mapInventory(invRes.data ?? []),
    };
  } catch (e) {
    if (__DEV__) console.warn('[settingsService] fetchSettingsBundle', e);
    throw e instanceof Error ? e : new Error('Błąd ładowania ustawień');
  }
}

export type PosSettingsPayload = {
  webhook_url: string;
  api_key: string;
  is_connected: boolean;
};

/** Update lub insert wiersza pos_settings. Zwraca błąd do UI. */
export async function savePosSettings(
  payload: PosSettingsPayload,
  existingId?: string | null,
  accountKey?: string | null,
): Promise<{ error: { message: string } | null }> {
  try {
    const ak = isRealKey(accountKey) ? accountKey : null;
    if (!ak) {
      return { error: { message: 'Zaloguj się, żeby zapisać ustawienia POS tej restauracji.' } };
    }
    const row = { ...payload, account_key: ak };
    if (existingId) {
      const { error } = await supabase
        .from('pos_settings')
        .update(row)
        .eq('id', existingId)
        .eq('account_key', ak);
      return { error: error ? { message: error.message } : null };
    }
    const { error } = await supabase.from('pos_settings').insert(row);
    return { error: error ? { message: error.message } : null };
  } catch (e) {
    if (__DEV__) console.warn('[settingsService] savePosSettings', e);
    return {
      error: { message: e instanceof Error ? e.message : 'Nie udało się zapisać POS.' },
    };
  }
}

/** Lekka lista menu po zmianie mapowania POS (bez receptur). */
export async function fetchActiveMenuPosList(
  accountKey?: string | null,
): Promise<MenuItemForMapping[]> {
  try {
    let q = supabase
      .from('menu_items')
      .select('id, name, category, price_pln, pos_id')
      .eq('is_active', true)
      .order('category')
      .order('name');
    if (isRealKey(accountKey)) q = q.eq('account_key', accountKey);
    const { data, error } = await q;
    if (error) {
      if (__DEV__) console.warn('[settingsService] fetchActiveMenuPosList', error.message);
      return [];
    }
    return mapMenuPlain(data ?? []);
  } catch (e) {
    if (__DEV__) console.warn('[settingsService] fetchActiveMenuPosList', e);
    return [];
  }
}
