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
  { name: 'Chemia i czystość', color: '#6366F1', sort_order: 130 },
  { name: 'Opakowania', color: '#64748B', sort_order: 140 },
  { name: 'Inne', color: '#94A3B8', sort_order: 150 },
];

export const DOC_WAREHOUSE_CATEGORIES = DEFAULT_WAREHOUSE_CATEGORIES.map((c) => c.name);

function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Upsert brakujących kategorii systemowych dla danego account_key.
 * Nie usuwa ani nie nadpisuje kategorii utworzonych przez użytkownika.
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
    .limit(200);

  if (loadErr) {
    return { created: 0, error: loadErr.message };
  }

  const have = new Set((existing || []).map((r: { name?: string }) => normName(r.name || '')));
  const missing = DEFAULT_WAREHOUSE_CATEGORIES.filter((c) => !have.has(normName(c.name)));
  if (!missing.length) return { created: 0 };

  const rows = missing.map((c) => ({
    name: c.name,
    color: c.color,
    icon_name: 'package',
    sort_order: c.sort_order,
    account_key: ak,
  }));

  const { error: insErr } = await supabase.from('inventory_categories').insert(rows);
  if (insErr) {
    return { created: 0, error: insErr.message };
  }
  return { created: rows.length };
}
