/**
 * menuRecipeService — IO mapowania receptur / POS w Ustawieniach (MenuRecipeRow).
 * Zachowanie 1:1 z poprzednimi zapytaniami w komponencie (fallbacki schematu).
 */
import { supabase } from '@/lib/supabase';
import type { RecipeIngredientRow } from '@/components/MenuRecipeRow';

function errMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message?: string }).message ?? '');
  }
  return e instanceof Error ? e.message : '';
}

type RawIng = {
  id?: string;
  ingredient_name?: string;
  quantity?: number | string;
  unit?: string;
  sort_order?: number | string;
  piece_weight_g?: number | string | null;
  warehouse_product_id?: string | null;
};

function mapRawRows(data: RawIng[]): RecipeIngredientRow[] {
  const sorted = [...data].sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0),
  );
  return sorted.map((r) => ({
    id: String(r.id ?? ''),
    ingredient_name: r.ingredient_name ?? '',
    quantity: Number(r.quantity) || 0,
    unit: r.unit || 'g',
    piece_weight_g: r.piece_weight_g != null ? Number(r.piece_weight_g) : null,
    warehouse_product_id: r.warehouse_product_id ?? null,
    warehouse_product_name: null,
  }));
}

/** Odczyt składników dania z fallbackami kolumn schematu. */
export async function fetchRecipeRowsForMenuItem(
  menuItemId: string,
): Promise<RecipeIngredientRow[]> {
  try {
    let data: RawIng[] | null = null;

    const nestedFull = await supabase
      .from('menu_items')
      .select(
        'id, recipe_ingredients(id, ingredient_name, quantity, unit, sort_order, piece_weight_g, warehouse_product_id)',
      )
      .eq('id', menuItemId)
      .maybeSingle();

    let nested = nestedFull;
    if (nestedFull.error) {
      nested = await supabase
        .from('menu_items')
        .select('id, recipe_ingredients(id, ingredient_name, quantity, unit, piece_weight_g)')
        .eq('id', menuItemId)
        .maybeSingle();
      if (nested.error) {
        nested = await supabase
          .from('menu_items')
          .select('id, recipe_ingredients(id, ingredient_name, quantity, unit)')
          .eq('id', menuItemId)
          .maybeSingle();
      }
    }

    if (!nested.error && nested.data) {
      const raw = (nested.data as { recipe_ingredients?: RawIng | RawIng[] | null })
        .recipe_ingredients;
      data = Array.isArray(raw) ? raw : raw ? [raw] : [];
    } else {
      const fallback = await supabase
        .from('recipe_ingredients')
        .select('id, ingredient_name, quantity, unit, piece_weight_g')
        .eq('menu_item_id', menuItemId);
      if (fallback.error && /piece_weight_g/i.test(fallback.error.message ?? '')) {
        const fb2 = await supabase
          .from('recipe_ingredients')
          .select('id, ingredient_name, quantity, unit')
          .eq('menu_item_id', menuItemId);
        data = (fb2.data as RawIng[] | null) ?? [];
      } else {
        data = (fallback.data as RawIng[] | null) ?? [];
      }
    }

    const rows = mapRawRows(data ?? []);
    const whIds = rows.map((r) => r.warehouse_product_id).filter(Boolean) as string[];
    if (whIds.length > 0) {
      const { data: inv } = await supabase
        .from('inventory_items')
        .select('id, name')
        .in('id', whIds);
      const byId = new Map((inv ?? []).map((i: { id: string; name: string }) => [i.id, i.name]));
      for (const row of rows) {
        if (row.warehouse_product_id) {
          row.warehouse_product_name = byId.get(row.warehouse_product_id) ?? null;
        }
      }
    }
    return rows;
  } catch (e) {
    if (__DEV__) console.warn('[menuRecipeService] fetchRecipeRowsForMenuItem', e);
    return [];
  }
}

export async function persistWarehouseProductLink(
  ingredientId: string,
  warehouseProductId: string | null,
): Promise<{ error: { message: string } | null; schemaMissing?: boolean }> {
  try {
    const { error } = await supabase
      .from('recipe_ingredients')
      .update({ warehouse_product_id: warehouseProductId })
      .eq('id', ingredientId);
    if (!error) return { error: null };
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('warehouse_product_id') || msg.includes('schema cache')) {
      return { error: { message: error.message }, schemaMissing: true };
    }
    return { error: { message: error.message } };
  } catch (e) {
    return { error: { message: errMessage(e) || 'Błąd mapowania składnika.' } };
  }
}

export async function setMenuItemAvailable(
  menuItemId: string,
  isAvailable: boolean,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase
    .from('menu_items')
    .update({ is_available: isAvailable })
    .eq('id', menuItemId);
  return { error: error ? { message: error.message } : null };
}

export async function saveMenuItemPosId(
  menuItemId: string,
  posId: string | null,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase
    .from('menu_items')
    .update({ pos_id: posId })
    .eq('id', menuItemId);
  return { error: error ? { message: error.message } : null };
}

export async function deleteRecipeIngredientIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('recipe_ingredients').delete().in('id', ids);
  if (error) throw error;
}

export async function updateRecipeIngredientRow(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ error: { message: string } | null; schemaFallback?: boolean }> {
  const { error } = await supabase.from('recipe_ingredients').update(payload).eq('id', id);
  if (!error) return { error: null };
  if (/piece_weight_g|warehouse_product_id|schema cache/i.test(error.message ?? '')) {
    const { piece_weight_g: _pw, warehouse_product_id: _w, ...rest } = payload;
    const { error: e2 } = await supabase.from('recipe_ingredients').update(rest).eq('id', id);
    if (e2) return { error: { message: e2.message } };
    return { error: null, schemaFallback: true };
  }
  return { error: { message: error.message } };
}

export async function insertRecipeIngredientRow(
  payload: Record<string, unknown>,
): Promise<{ id: string | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('recipe_ingredients')
    .insert(payload as never)
    .select('id')
    .single();
  if (!error && data?.id) return { id: String(data.id), error: null };
  if (error && /piece_weight_g|warehouse_product_id|schema cache/i.test(error.message ?? '')) {
    const { piece_weight_g: _pw, warehouse_product_id: _w, ...rest } = payload;
    const { data: d2, error: e2 } = await supabase
      .from('recipe_ingredients')
      .insert(rest as never)
      .select('id')
      .single();
    if (e2) return { id: null, error: { message: e2.message } };
    return { id: d2?.id ? String(d2.id) : null, error: null };
  }
  return { id: null, error: error ? { message: error.message } : { message: 'Insert failed' } };
}

export async function replaceMenuItemRecipe(
  menuItemId: string,
  rows: Array<{
    ingredient_name: string;
    quantity: number;
    unit: string;
    sort_order: number;
  }>,
): Promise<void> {
  await supabase.from('recipe_ingredients').delete().eq('menu_item_id', menuItemId);
  if (!rows.length) return;
  const { error } = await supabase.from('recipe_ingredients').insert(
    rows.map((r) => ({ ...r, menu_item_id: menuItemId })) as never,
  );
  if (error) throw new Error(error.message);
}
