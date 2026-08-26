import type { CategoryRow, MagListRow, MockInventoryItem } from './types';
import { FALLBACK_COLOR } from './constants';
import { getStatus } from './helpers';

export type MagCategorySection = {
  cat: CategoryRow;
  items: MockInventoryItem[];
};

export type BuildMagRowsInput = {
  inventory: MockInventoryItem[];
  search: string;
  uniqueCategories: CategoryRow[];
  dbCategoriesLength: number;
  expandedCategories: Set<string>;
};

/** Pure list-row builder for Magazyn FlashList (search + category sections). */
export function buildMagRows({
  inventory,
  search,
  uniqueCategories,
  dbCategoriesLength,
  expandedCategories,
}: BuildMagRowsInput): MagListRow[] {
  const qLower = search.trim().toLowerCase();
  const searching = search.trim().length > 0;

  const searchResults: MockInventoryItem[] = !qLower
    ? []
    : inventory
        .filter(
          (item) =>
            item.product_name.toLowerCase().includes(qLower) ||
            item.category.toLowerCase().includes(qLower),
        )
        .sort((a, b) => {
          const ORDER = { critical: 0, warning: 1, ok: 2 } as const;
          return ORDER[getStatus(a)] - ORDER[getStatus(b)];
        });

  const categoryProductCounts: Record<string, number> = {};
  inventory.forEach((item) => {
    const key = item.category_id
      ? (uniqueCategories.find((c) => c.id === item.category_id)?.name ?? item.category)
      : item.category;
    categoryProductCounts[key] = (categoryProductCounts[key] ?? 0) + 1;
  });

  const categorySections: MagCategorySection[] = [...uniqueCategories]
    .sort((a, b) => (categoryProductCounts[b.name] ?? 0) - (categoryProductCounts[a.name] ?? 0))
    .map((c) => ({
      cat: c,
      items: inventory.filter((item) =>
        item.category_id ? item.category_id === c.id : item.category === c.name,
      ),
    }));

  const uncategorizedItems = inventory.filter((item) => {
    if (item.category_id) {
      return !uniqueCategories.some((c) => c.id === item.category_id);
    }
    return !uniqueCategories.some((c) => c.name === item.category);
  });

  if (searching) {
    const q = search.trim();
    if (searchResults.length === 0) return [{ type: 'search_empty', q }];
    return [
      { type: 'search_meta', count: searchResults.length, q },
      ...searchResults.map((item): MagListRow => ({ type: 'search_item', item })),
    ];
  }

  const rows: MagListRow[] = [{ type: 'cat_toolbar' }];
  if (dbCategoriesLength === 0) {
    rows.push({ type: 'mag_empty' });
  } else {
    for (const section of categorySections) {
      const criticalCount = section.items.filter((i) => getStatus(i) === 'critical').length;
      const warningCount = section.items.filter((i) => getStatus(i) === 'warning').length;
      rows.push({
        type: 'cat_header',
        cat: section.cat,
        itemCount: section.items.length,
        criticalCount,
        warningCount,
      });
      if (expandedCategories.has(section.cat.name)) {
        if (section.items.length === 0) {
          rows.push({ type: 'cat_empty', catId: section.cat.id });
        } else {
          const sorted = section.items.slice().sort((a, b) => {
            const ORDER = { critical: 0, warning: 1, ok: 2 } as const;
            return ORDER[getStatus(a)] - ORDER[getStatus(b)];
          });
          for (const inv of sorted) {
            rows.push({
              type: 'cat_item',
              item: inv,
              catColor: section.cat.color || FALLBACK_COLOR,
            });
          }
        }
      }
    }
  }
  if (uncategorizedItems.length > 0) {
    rows.push({ type: 'uncat_header', itemCount: uncategorizedItems.length });
    if (expandedCategories.has('__uncategorized__')) {
      for (const inv of uncategorizedItems) {
        rows.push({ type: 'uncat_item', item: inv });
      }
    }
  }
  return rows;
}
