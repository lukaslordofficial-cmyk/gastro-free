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

export function insertFixedCost(payload: {
  year_month: string;
  type: string;
  name: string;
  amount_pln: number;
  note?: string | null;
}): Promise<void> {
  return insertWithAccountKeyFallback('fixed_costs', payload);
}

/**
 * Kopiuje koszty stałe z poprzedniego miesiąca do targetYm (nowe ID).
 * Zwraca wstawione wiersze. No-op gdy target już ma pozycje albo źródło jest puste.
 */
export async function copyFixedCostsFromPreviousMonth(
  accountKey: string,
  targetYm: string,
  sourceYm: string,
): Promise<FixedCost[]> {
  if (!isRealKey(accountKey)) {
    throw new Error('Brak aktywnego konta (account_key). Zaloguj się ponownie.');
  }
  if (!/^\d{4}-\d{2}$/.test(targetYm) || !/^\d{4}-\d{2}$/.test(sourceYm)) {
    return [];
  }

  const { data: existing, error: exErr } = await supabase
    .from('fixed_costs')
    .select('id')
    .eq('account_key', accountKey)
    .eq('year_month', targetYm)
    .limit(1);
  if (exErr) throw exErr;
  if ((existing ?? []).length > 0) return [];

  const { data: source, error: srcErr } = await supabase
    .from('fixed_costs')
    .select('type, name, amount_pln, note')
    .eq('account_key', accountKey)
    .eq('year_month', sourceYm)
    .order('type');
  if (srcErr) throw srcErr;
  const rows = (source ?? []) as Array<{
    type: string;
    name: string;
    amount_pln: number;
    note?: string | null;
  }>;
  if (!rows.length) return [];

  const payload = rows.map((r) => ({
    account_key: accountKey,
    year_month: targetYm,
    type: r.type || 'other',
    name: r.name || 'Koszt stały',
    amount_pln: Number(r.amount_pln) || 0,
    note: r.note ?? null,
  }));

  const { data: inserted, error: insErr } = await supabase
    .from('fixed_costs')
    .insert(payload as never)
    .select('*');
  if (insErr) throw insErr;
  return (inserted ?? []) as FixedCost[];
}

export function insertVariableCost(payload: {
  year_month: string;
  type: string;
  name: string;
  amount_pln: number;
  note?: string | null;
}): Promise<void> {
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
  if (!isRealKey(ak)) {
    throw new Error(
      'Brak aktywnego konta (account_key). Zaloguj się ponownie i spróbuj jeszcze raz.',
    );
  }
  const scoped = <T,>(q: T & { eq: (col: string, val: string) => T }, col = 'account_key'): T =>
    q.eq(col, ak);

  const invSelects = [
    'id, name, quantity, min_quantity, optimal_quantity, unit, is_combo_polprodukt',
    'id, name, quantity, min_quantity, optimal_quantity, unit',
    'id, name, quantity, min_quantity, unit',
  ];

  const loadInventory = async (): Promise<InventorySnapshotRow[] | null> => {
    let skipActive = false;
    for (const sel of invSelects) {
      let q = supabase.from('inventory_items').select(sel).eq('account_key', ak);
      if (!skipActive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (!error) return (data ?? []) as unknown as InventorySnapshotRow[];
      if (/is_active/i.test(error.message ?? '')) {
        skipActive = true;
        const retry = await supabase.from('inventory_items').select(sel).eq('account_key', ak);
        if (!retry.error) return (retry.data ?? []) as unknown as InventorySnapshotRow[];
        if (/optimal_quantity|is_combo/i.test(retry.error.message ?? '')) continue;
        return null;
      }
      if (/optimal_quantity|is_combo/i.test(error.message ?? '')) continue;
      return null;
    }
    return null;
  };

  let [
    revRes,
    fixedRes,
    varRes,
    revHistRes,
    varHistRes,
    revAllRes,
    fixedAllRes,
    varAllRes,
    inventoryData,
  ] = await Promise.all([
    scoped(supabase.from('revenue_entries').select('*')).eq('year_month', currentMonth).order('created_at'),
    scoped(supabase.from('fixed_costs').select('*')).eq('year_month', currentMonth).order('type'),
    scoped(supabase.from('variable_cost_entries').select('*')).eq('year_month', currentMonth).order('created_at'),
    scoped(supabase.from('revenue_entries').select('year_month, amount_pln')).order('year_month').limit(2000),
    scoped(supabase.from('variable_cost_entries').select('year_month, amount_pln')).order('year_month').limit(2000),
    scoped(supabase.from('revenue_entries').select('*')).order('created_at', { ascending: false }).limit(1500),
    scoped(supabase.from('fixed_costs').select('*')).order('created_at', { ascending: false }).limit(1000),
    scoped(supabase.from('variable_cost_entries').select('*')).order('created_at', { ascending: false }).limit(1500),
    loadInventory(),
  ]);

  const missingAk = [revRes, fixedRes, varRes].some(
    (r) => r.error && /account_key/i.test(r.error.message ?? ''),
  );
  if (missingAk) {
    // NIGDY nie odczytuj wszystkich wierszy bez account_key — to wyciek między tenantami.
    throw new Error(
      'Brak izolacji account_key w tabelach finansowych. Uruchom migrację FIX_FINANCE_TENANT_RLS.sql.',
    );
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
    inventory: inventoryData,
  };
}
