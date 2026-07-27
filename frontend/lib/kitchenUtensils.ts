/**
 * Katalog naczyń kuchennych — seed + CRUD helpers (per account_key).
 * Pojemności to punkt startowy — użytkownik edytuje do swojego sprzętu.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type KitchenUtensilSeed = {
  name: string;
  utensil_type: string;
  capacity_value: number;
  capacity_unit: 'l' | 'ml';
  notes?: string;
};

/** Standardowy start (zupy / sosy / smażenie) — nie dogma. */
export const DEFAULT_KITCHEN_UTENSILS: KitchenUtensilSeed[] = [
  { name: 'Garnek 1 l', utensil_type: 'garnek', capacity_value: 1, capacity_unit: 'l', notes: 'Sos / mała partia' },
  { name: 'Garnek 2 l', utensil_type: 'garnek', capacity_value: 2, capacity_unit: 'l' },
  { name: 'Garnek 3 l', utensil_type: 'garnek', capacity_value: 3, capacity_unit: 'l' },
  { name: 'Garnek 5 l', utensil_type: 'garnek', capacity_value: 5, capacity_unit: 'l', notes: 'Zupy 8–15 porcji' },
  { name: 'Garnek 8 l', utensil_type: 'garnek', capacity_value: 8, capacity_unit: 'l' },
  { name: 'Garnek 10 l', utensil_type: 'garnek', capacity_value: 10, capacity_unit: 'l', notes: 'Większe partie zup' },
  { name: 'Garnek 15 l', utensil_type: 'garnek', capacity_value: 15, capacity_unit: 'l' },
  { name: 'Garnek 20 l', utensil_type: 'garnek', capacity_value: 20, capacity_unit: 'l', notes: 'Duża produkcja' },
  { name: 'Patelnia 24 cm', utensil_type: 'patelnia', capacity_value: 1.5, capacity_unit: 'l', notes: 'Smażenie małych partii' },
  { name: 'Patelnia 28 cm', utensil_type: 'patelnia', capacity_value: 2.5, capacity_unit: 'l' },
  { name: 'Patelnia 32 cm', utensil_type: 'patelnia', capacity_value: 3.5, capacity_unit: 'l' },
  { name: 'Pojemnik GN 1/1 100 mm', utensil_type: 'pojemnik', capacity_value: 13, capacity_unit: 'l', notes: 'Przybliżona pojemność robocza' },
  { name: 'Pojemnik GN 1/2 100 mm', utensil_type: 'pojemnik', capacity_value: 6, capacity_unit: 'l' },
];

export type KitchenUtensilRow = {
  id: string;
  name: string;
  utensil_type: string;
  capacity_value: number | null;
  capacity_unit: string | null;
  notes: string | null;
  account_key?: string | null;
  created_at?: string;
};

function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export async function ensureDefaultKitchenUtensils(
  supabase: SupabaseClient,
  accountKey: string,
): Promise<{ created: number; error?: string }> {
  const ak = (accountKey || '').trim();
  if (!ak || ak === 'default') {
    return { created: 0, error: 'invalid_account_key' };
  }

  const { data: existing, error: loadErr } = await supabase
    .from('kitchen_utensils')
    .select('id, name')
    .eq('account_key', ak)
    .limit(200);

  if (loadErr) {
    // Kolumna account_key może jeszcze nie istnieć — nie blokuj Magazynu.
    return { created: 0, error: loadErr.message };
  }

  const have = new Set((existing || []).map((r: { name?: string }) => normName(r.name || '')));
  const missing = DEFAULT_KITCHEN_UTENSILS.filter((u) => !have.has(normName(u.name)));
  if (!missing.length) return { created: 0 };

  let created = 0;
  for (const u of missing) {
    const { error: insErr } = await supabase.from('kitchen_utensils').insert({
      name: u.name,
      utensil_type: u.utensil_type,
      capacity_value: u.capacity_value,
      capacity_unit: u.capacity_unit,
      notes: u.notes ?? null,
      account_key: ak,
    });
    if (!insErr) created += 1;
  }
  return { created };
}

export async function fetchKitchenUtensils(
  supabase: SupabaseClient,
  accountKey: string,
): Promise<{ rows: KitchenUtensilRow[]; error?: string }> {
  const ak = (accountKey || '').trim();
  if (!ak || ak === 'default') return { rows: [] };

  const { data, error } = await supabase
    .from('kitchen_utensils')
    .select('id, name, utensil_type, capacity_value, capacity_unit, notes, account_key, created_at')
    .eq('account_key', ak)
    .order('utensil_type')
    .order('capacity_value')
    .limit(200);

  if (error) return { rows: [], error: error.message };
  return { rows: (data as KitchenUtensilRow[]) ?? [] };
}

/** Pojemność w litrach (do doboru garnka). */
export function utensilCapacityLiters(u: {
  capacity_value: number | null;
  capacity_unit: string | null;
}): number | null {
  if (u.capacity_value == null || !Number.isFinite(Number(u.capacity_value))) return null;
  const v = Number(u.capacity_value);
  const unit = String(u.capacity_unit || 'l').toLowerCase();
  if (unit === 'ml') return v / 1000;
  return v;
}
