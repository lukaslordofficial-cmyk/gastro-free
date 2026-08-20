/**
 * Grupowanie dań do mapowania POS — jak lista kategorii w Menu.
 * Czysta funkcja (bez React) — łatwo testować i reużywać.
 */
export type CategorizedMenuItem = {
  id: string;
  name: string;
  category: string | null;
};

export function groupMenuItemsByCategory<T extends CategorizedMenuItem>(
  items: T[],
): Array<[string, T[]]> {
  const map = new globalThis.Map<string, T[]>();
  for (const item of items) {
    const cat = (item.category || '').trim() || 'Bez kategorii';
    const list = map.get(cat);
    if (list) list.push(item);
    else map.set(cat, [item]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'pl'));
}
