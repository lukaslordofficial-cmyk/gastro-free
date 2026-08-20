import { namesMatch, normalizeIngredientName } from '@/lib/fuzzyProductMatch';
import { mapInvDbRow, normIngredientName } from '@/lib/menuScreenHelpers';
import { normalizeMenuUnit, normalizeRecipeQuantity, parseOptionalPieceWeightG } from '@/lib/recipeUnits';
import {
  fetchActiveInventoryRows,
  insertZeroStockInventoryItem,
} from '@/services/menuService';
import type { IngredientDraft, InventoryItem } from '@/types/menu';

/** normName → inventory_items.id — tworzy brakujące produkty ze stanem 0. */
export async function ensureWarehouseLinks(opts: {
  accountKey: string;
  validIngredients: IngredientDraft[];
  inventory: InventoryItem[];
  categoryMap: Record<string, string>;
  onInventoryAdd: (item: InventoryItem) => void;
}): Promise<Map<string, string>> {
  const { accountKey, validIngredients, inventory, categoryMap, onInventoryAdd } = opts;
  const linkMap = new Map<string, string>();
  if (!accountKey || accountKey === 'default') return linkMap;

  const dbInv = await fetchActiveInventoryRows(accountKey);
  const working: InventoryItem[] = dbInv.map(mapInvDbRow);
  for (const local of inventory) {
    if (!working.some((w) => w.id === local.id)) working.push(local);
  }

  const findLocal = (displayName: string, key: string) =>
    working.find(
      (i) =>
        normIngredientName(i.product_name) === key ||
        namesMatch(i.product_name, displayName, 86),
    );

  for (const ing of validIngredients) {
    const name = normalizeIngredientName(ing.name.trim());
    const key = normIngredientName(name);
    if (!key || linkMap.has(key)) continue;
    const existing = findLocal(name, key);
    if (existing) {
      linkMap.set(key, existing.id);
      continue;
    }
    const mapped = await insertZeroStockInventoryItem({
      name,
      categoryId: categoryMap['Inne'] ?? categoryMap['Przyprawy'] ?? null,
      unit: normalizeMenuUnit(ing.unit),
      accountKey,
    });
    if (!mapped) {
      const raced = (await fetchActiveInventoryRows(accountKey)).map(mapInvDbRow);
      const hit = raced.find(
        (i) =>
          normIngredientName(i.product_name) === key ||
          namesMatch(i.product_name, name, 86),
      );
      if (hit) {
        working.push(hit);
        linkMap.set(key, hit.id);
      }
      continue;
    }
    working.push(mapped);
    linkMap.set(key, mapped.id);
    onInventoryAdd(mapped);
  }
  return linkMap;
}

export function buildIngredientRows(
  menuItemId: string,
  validIngredients: IngredientDraft[],
  linkMap: Map<string, string>,
): Record<string, unknown>[] {
  return validIngredients.map((ing, idx) => {
    const iname = normalizeIngredientName(ing.name.trim());
    const row: Record<string, unknown> = {
      menu_item_id: menuItemId,
      ingredient_name: iname,
      quantity: normalizeRecipeQuantity(parseFloat((ing.quantity || '').replace(',', '.')) || 0),
      unit: normalizeMenuUnit(ing.unit),
      sort_order: idx + 1,
    };
    const pw = parseOptionalPieceWeightG(ing.pieceWeightG);
    if ((ing.unit === 'szt' || ing.unit === 'sztuka') && pw != null) {
      row.piece_weight_g = pw;
    }
    const wid = linkMap.get(normIngredientName(iname));
    if (wid) row.warehouse_product_id = wid;
    return row;
  });
}
