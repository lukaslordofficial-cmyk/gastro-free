/**
 * financeService — całe IO Supabase dla modułu Finanse/Dashboard (dekalog §II/§III).
 *
 * DLACZEGO: ekran `app/(tabs)/index.tsx` nie wykonuje już żadnych zapytań do bazy.
 * Tu żyją odczyty (miesiąc + historia + snapshot magazynu) oraz mutacje
 * (insert/update/delete) z fallbackiem `account_key` (zgodność z bazą sprzed
 * migracji FIX_FINANCE_TENANT_RLS.sql). Zachowanie 1:1 z poprzednią wersją.
 */
import { supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import type { FixedCost, RevenueEntry, VariableCostEntry } from '@/lib/types';

export type FinanceTable = 'revenue_entries' | 'fixed_costs' | 'variable_cost_entries';

type HistRow = { year_month: string | null; amount_pln: number };
type InventorySnapshotRow = {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  optimal_quantity?: number | null;
  is_combo_polprodukt?: boolean | null;
  unit: string;
};

export type FinanceRows = {
  revenue: RevenueEntry[];
  fixed: FixedCost[];
  variableMonth: VariableCostEntry[];
  revenueHist: HistRow[];
  variableHist: HistRow[];
  revenueAll: RevenueEntry[];
  fixedAll: FixedCost[];
  variableAll: VariableCostEntry[];
  /** null gdy zapytanie o magazyn zwróciło błąd — UI zachowuje poprzedni snapshot. */
  inventory: InventorySnapshotRow[] | null;
};

/** true dla prawdziwego tenanta (nie współdzielony „default"). */
function isRealKey(ak: string): boolean {
  return !!ak && ak !== 'default';
}

/**
 * Insert z fallbackiem: najpierw z `account_key`, a gdy kolumna nie istnieje
 * (baza sprzed migracji) — ponów bez niej. Rzuca przy realnym błędzie (§V).
 */
async function insertWithAccountKeyFallback(
  table: FinanceTable,
  payload: Record<string, unknown>,
): Promise<void> {
  const ak = getAccountKey();
  let { error } = await supabase.from(table).insert({ ...payload, account_key: ak } as never);
  if (error && /account_key/i.test(error.message ?? '')) {
    ({ error } = await supabase.from(table).insert(payload as never));
  }
  if (error) throw error;
}

export function insertRevenue(payload: { year_month: string; description: string | null; amount_pln: number }): Promise<void> {
  return insertWithAccountKeyFallback('revenue_entries', payload);
}

export function insertFixedCost(payload: { year_month: string; type: string; name: string; amount_pln: number }): Promise<void> {
  return insertWithAccountKeyFallback('fixed_costs', payload);
}

export function insertVariableCost(payload: { year_month: string; type: string; name: string; amount_pln: number }): Promise<void> {
  return insertWithAccountKeyFallback('variable_cost_entries', payload);
}

/** Update pozycji, scope na account_key gdy dostępny. Rzuca przy błędzie. */
export async function updateCost(
  table: FinanceTable,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const ak = getAccountKey();
  let q = supabase.from(table).update(payload).eq('id', id);
  if (isRealKey(ak)) q = q.eq('account_key', ak);
  const { error } = await q;
  if (error) throw error;
}

/** Zapis notatki. */
export function updateNote(table: FinanceTable, id: string, note: string | null): Promise<void> {
  return updateCost(table, id, { note });
}

/** Usunięcie pozycji, scope na account_key gdy dostępny. Rzuca przy błędzie. */
export async function deleteCost(table: FinanceTable, id: string): Promise<void> {
  const ak = getAccountKey();
  let q = supabase.from(table).delete().eq('id', id);
  if (isRealKey(ak)) q = q.eq('account_key', ak);
  const { error } = await q;
  if (error) throw error;
}

/**
 * Odczyt kompletu danych finansowych + snapshot magazynu dla danego tenanta.
 * Zawiera fallback dla bazy bez kolumny `account_key`. Rzuca gdy krytyczne
 * zapytania (miesiąc: przychody/koszty stałe/zmienne) zwrócą błąd (§V).
 */
export async function fetchFinanceRows(accountKey: string, currentMonth: string): Promise<FinanceRows> {
  const ak = accountKey;
  const scoped = <T,>(q: T & { eq: (col: string, val: string) => T }, col = 'account_key'): T =>
    isRealKey(ak) ? q.eq(col, ak) : q;

  let revRes = await scoped(supabase.from('revenue_entries').select('*')).eq('year_month', currentMonth).order('created_at');
  let fixedRes = await scoped(supabase.from('fixed_costs').select('*')).eq('year_month', currentMonth).order('type');
  let varRes = await scoped(supabase.from('variable_cost_entries').select('*')).eq('year_month', currentMonth).order('created_at');
  let revHistRes = await scoped(supabase.from('revenue_entries').select('year_month, amount_pln')).order('year_month').limit(2000);
  let varHistRes = await scoped(supabase.from('variable_cost_entries').select('year_month, amount_pln')).order('year_month').limit(2000);
  // Soft-delete (is_active=false) MUSI być odfiltrowany — inaczej Finanse pokazuje
  // „250 wymaga uzupełnienia” po wyczyszczeniu magazynu. Kolumny opcjonalne
  // (optimal / is_combo) zdejmujemy stopniowo, nie wyrzucając filtra is_active.
  const invSelects = [
    'id, name, quantity, min_quantity, optimal_quantity, unit, is_combo_polprodukt',
    'id, name, quantity, min_quantity, optimal_quantity, unit',
    'id, name, quantity, min_quantity, unit',
  ];
  let inventoryData: InventorySnapshotRow[] | null = null;
  let skipActive = false;
  for (const sel of invSelects) {
    let q = supabase.from('inventory_items').select(sel).eq('account_key', ak);
    if (!skipActive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (!error) {
      inventoryData = (data ?? []) as unknown as InventorySnapshotRow[];
      break;
    }
    if (/is_active/i.test(error.message ?? '')) {
      skipActive = true;
      const retry = await supabase.from('inventory_items').select(sel).eq('account_key', ak);
      if (!retry.error) {
        inventoryData = (retry.data ?? []) as unknown as InventorySnapshotRow[];
        break;
      }
      if (/optimal_quantity|is_combo/i.test(retry.error.message ?? '')) continue;
      inventoryData = null;
      break;
    }
    if (/optimal_quantity|is_combo/i.test(error.message ?? '')) continue;
    inventoryData = null;
    break;
  }
  let revAllRes = await scoped(supabase.from('revenue_entries').select('*')).order('created_at', { ascending: false }).limit(1500);
  let fixedAllRes = await scoped(supabase.from('fixed_costs').select('*')).order('created_at', { ascending: false }).limit(1000);
  let varAllRes = await scoped(supabase.from('variable_cost_entries').select('*')).order('created_at', { ascending: false }).limit(1500);

  // Fallback gdy brak kolumny account_key (przed migracją FIX_FINANCE_TENANT_RLS.sql).
  const missingAk = [revRes, fixedRes, varRes].some(
    (r) => r.error && /account_key/i.test(r.error.message ?? ''),
  );
  if (missingAk) {
    [revRes, fixedRes, varRes, revHistRes, varHistRes, revAllRes, fixedAllRes, varAllRes] = await Promise.all([
      supabase.from('revenue_entries').select('*').eq('year_month', currentMonth).order('created_at'),
      supabase.from('fixed_costs').select('*').eq('year_month', currentMonth).order('type'),
      supabase.from('variable_cost_entries').select('*').eq('year_month', currentMonth).order('created_at'),
      supabase.from('revenue_entries').select('year_month, amount_pln').order('year_month').limit(2000),
      supabase.from('variable_cost_entries').select('year_month, amount_pln').order('year_month').limit(2000),
      supabase.from('revenue_entries').select('*').order('created_at', { ascending: false }).limit(1500),
      supabase.from('fixed_costs').select('*').order('created_at', { ascending: false }).limit(1000),
      supabase.from('variable_cost_entries').select('*').order('created_at', { ascending: false }).limit(1500),
    ]);
  }
  if (revRes.error) throw revRes.error;
  if (fixedRes.error) throw fixedRes.error;
  if (varRes.error) throw varRes.error;

  return {
    revenue: (revRes.data ?? []) as RevenueEntry[],
    fixed: (fixedRes.data ?? []) as FixedCost[],
    variableMonth: (varRes.data ?? []) as VariableCostEntry[],
    revenueHist: (revHistRes.data ?? []) as HistRow[],
    variableHist: (varHistRes.data ?? []) as HistRow[],
    revenueAll: (revAllRes.data ?? []) as RevenueEntry[],
    fixedAll: (fixedAllRes.data ?? []) as FixedCost[],
    variableAll: (varAllRes.data ?? []) as VariableCostEntry[],
    inventory: inventoryData == null ? null : (inventoryData as InventorySnapshotRow[]),
  };
}
