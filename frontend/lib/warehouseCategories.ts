/**
 * Domyślne puste kategorie magazynowe — seed per account_key (signup / pierwszy Magazyn).
 * Muszą być zsynchronizowane z backend `WAREHOUSE_CATEGORIES` w server.py.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type WarehouseCategorySeed = {
  name: string;
  color: string;
  sort_order: number;
};

/** ~15 ogólnych kategorii gastronomicznych (puste foldery pod AI / skan faktur). */
export const DEFAULT_WAREHOUSE_CATEGORIES: WarehouseCategorySeed[] = [
  { name: 'Mięso i wędliny', color: '#DC2626', sort_order: 10 },
  { name: 'Ryby i owoce morza', color: '#0284C7', sort_order: 20 },
  { name: 'Nabiał', color: '#F59E0B', sort_order: 30 },
  { name: 'Warzywa i owoce', color: '#16A34A', sort_order: 40 },
  { name: 'Pieczywo', color: '#78716C', sort_order: 50 },
  { name: 'Suchy magazyn', color: '#B45309', sort_order: 60 },
  { name: 'Oleje i tłuszcze', color: '#CA8A04', sort_order: 70 },
  { name: 'Przyprawy', color: '#D97706', sort_order: 80 },
  { name: 'Mrożonki', color: '#0EA5E9', sort_order: 90 },
  { name: 'Napoje', color: '#0891B2', sort_order: 100 },
  { name: 'Alkohole', color: '#7C3AED', sort_order: 110 },
  { name: 'Wywary i sosy', color: '#EA580C', sort_order: 120 },
  { name: 'Półprodukty', color: '#A855F7', sort_order: 125 },
  { name: 'Chemia i czystość', color: '#6366F1', sort_order: 130 },
  { name: 'Opakowania', color: '#64748B', sort_order: 140 },
  { name: 'Inne', color: '#94A3B8', sort_order: 150 },
];

export const DOC_WAREHOUSE_CATEGORIES = DEFAULT_WAREHOUSE_CATEGORIES.map((c) => c.name);

export function normCategoryName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Upsert brakujących kategorii systemowych dla danego account_key.
 * Nie usuwa ani nie nadpisuje kategorii utworzonych przez użytkownika.
 * Insert po jednej — unikamy race / unique violation przy już istniejących duplikatach.
 */
export async function ensureDefaultWarehouseCategories(
  supabase: SupabaseClient,
  accountKey: string,
): Promise<{ created: number; error?: string }> {
  const ak = (accountKey || '').trim();
  if (!ak || ak === 'default') {
    return { created: 0, error: 'invalid_account_key' };
  }

  const { data: existing, error: loadErr } = await supabase
    .from('inventory_categories')
    .select('id, name')
    .eq('account_key', ak)
    .limit(500);

  if (loadErr) {
    return { created: 0, error: loadErr.message };
  }

  const have = new Set((existing || []).map((r: { name?: string }) => normCategoryName(r.name || '')));
  const missing = DEFAULT_WAREHOUSE_CATEGORIES.filter((c) => !have.has(normCategoryName(c.name)));
  if (!missing.length) return { created: 0 };

  let created = 0;
  for (const c of missing) {
    const { error: insErr } = await supabase.from('inventory_categories').insert({
      name: c.name,
      color: c.color,
      icon_name: 'package',
      sort_order: c.sort_order,
      account_key: ak,
    });
    if (insErr) {
      // Unique / race — kategoria już jest; nie przerywaj całego seedu.
      if (/duplicate|unique|23505/i.test(insErr.message ?? '')) continue;
      return { created, error: insErr.message };
    }
    created += 1;
    have.add(normCategoryName(c.name));
  }
  return { created };
}

type CatRow = { id: string; name: string; color?: string; sort_order?: number | null };

/**
 * Soft-dedupe: ta sama nazwa (norm) na koncie → jeden keeper.
 * Produkty z duplikatów dostają category_id keepera; puste duplikaty usuwane.
 * Nie rusza kategorii o unikalnych nazwach.
 */
export async function dedupeWarehouseCategories(
  supabase: SupabaseClient,
  accountKey: string,
): Promise<{ merged: number; error?: string }> {
  const ak = (accountKey || '').trim();
  if (!ak || ak === 'default') return { merged: 0 };

  const { data: cats, error: catErr } = await supabase
    .from('inventory_categories')
    .select('id, name, color, sort_order')
    .eq('account_key', ak)
    .limit(500);
  if (catErr) return { merged: 0, error: catErr.message };
  if (!cats?.length) return { merged: 0 };

  const { data: items } = await supabase
    .from('inventory_items')
    .select('id, category_id')
    .eq('account_key', ak)
    .limit(5000);

  const countByCat = new Map<string, number>();
  for (const it of items || []) {
    const cid = (it as { category_id?: string | null }).category_id;
    if (!cid) continue;
    countByCat.set(cid, (countByCat.get(cid) ?? 0) + 1);
  }

  const groups = new Map<string, CatRow[]>();
  for (const c of cats as CatRow[]) {
    const key = normCategoryName(c.name || '');
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  let merged = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const ca = countByCat.get(a.id) ?? 0;
      const cb = countByCat.get(b.id) ?? 0;
      if (cb !== ca) return cb - ca;
      return String(a.id).localeCompare(String(b.id));
    });
    const keeper = group[0];
    for (const dup of group.slice(1)) {
      const { error: moveErr } = await supabase
        .from('inventory_items')
        .update({ category_id: keeper.id })
        .eq('category_id', dup.id)
        .eq('account_key', ak);
      if (moveErr) return { merged, error: moveErr.message };

      const { error: delErr } = await supabase
        .from('inventory_categories')
        .delete()
        .eq('id', dup.id)
        .eq('account_key', ak);
      if (delErr) return { merged, error: delErr.message };
      merged += 1;
    }
  }
  return { merged };
}
