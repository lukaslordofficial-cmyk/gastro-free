import type { Dish, MenuListRow } from '@/types/menu';

/** Filtr kategorii + wyszukiwania — ta sama logika co wcześniej w menu.tsx. */
export function filterMenuDishes(
  dishes: Dish[],
  search: string,
  activeCat: string,
): Dish[] {
  let list = dishes;
  if (activeCat !== 'Wszystkie') list = list.filter((d) => d.category === activeCat);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter((d) => d.name.toLowerCase().includes(q));
  }
  return list;
}

export function groupDishesByCategory(dishes: Dish[]): Record<string, Dish[]> {
  const map: Record<string, Dish[]> = {};
  dishes.forEach((d) => {
    if (!map[d.category]) map[d.category] = [];
    map[d.category].push(d);
  });
  return map;
}

/** Grupowanie → płaskie wiersze FlashList (header + dish). */
export function buildMenuRows(grouped: Record<string, Dish[]>): MenuListRow[] {
  const rows: MenuListRow[] = [];
  for (const [category, items] of Object.entries(grouped)) {
    rows.push({ type: 'header', category, count: items.length });
    for (const dish of items) rows.push({ type: 'dish', dish });
  }
  return rows;
}
