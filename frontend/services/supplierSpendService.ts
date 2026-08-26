/**
 * Sumy wydatków i lista faktur / dostaw per dostawca (koszty zmienne + invoices).
 * Zawsze scoped do account_key bieżącego tenanta — bez zapytań globalnych.
 */
import { supabase } from '@/lib/supabase';
import { requireTenantAccountKey } from '@/lib/tenantScope';
import {
  parseInvoiceCostNote,
  supplierIdFromCostNote,
  formatInvoiceLineLabel,
} from '@/lib/invoiceCostNote';

export type SupplierInvoiceEntry = {
  id: string;
  source: 'cost' | 'invoice';
  title: string;
  amount_pln: number;
  created_at: string;
  lines: string[];
  notePreview: string | null;
};

/** Agregacja „Zamówiono” z kosztów materiałów (AI + ręczne dostawy). */
export async function fetchSupplierOrderTotals(ak?: string): Promise<Record<string, number>> {
  const orderTotals: Record<string, number> = {};
  const accountKey = (ak && ak !== 'default' ? ak : null) || requireTenantAccountKey();

  const { data: costs } = await supabase
    .from('variable_cost_entries')
    .select('amount_pln, note')
    .eq('account_key', accountKey)
    .eq('type', 'materials');

  for (const c of costs ?? []) {
    const sid = supplierIdFromCostNote((c as { note?: string }).note);
    if (!sid) continue;
    const amt = Number((c as { amount_pln?: number }).amount_pln ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    orderTotals[sid] = (orderTotals[sid] ?? 0) + amt;
  }

  // Faktury z tabeli invoices (gdy brak odpowiadającego kosztu — unikamy podwójnego zliczenia AI)
  try {
    const { data: invs } = await supabase
      .from('invoices')
      .select('supplier_id, total_cost')
      .eq('account_key', accountKey)
      .not('supplier_id', 'is', null)
      .limit(5000);
    for (const inv of invs ?? []) {
      const sid = String((inv as { supplier_id?: string }).supplier_id || '')
        .trim()
        .toLowerCase();
      if (!sid) continue;
      if (orderTotals[sid] != null && orderTotals[sid] > 0) continue;
      const amt = Number((inv as { total_cost?: number }).total_cost ?? 0);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      orderTotals[sid] = (orderTotals[sid] ?? 0) + amt;
    }
  } catch {
    /* tabela invoices może nie istnieć / brak kolumny account_key do migracji */
  }

  return orderTotals;
}

/** Chronologiczna lista faktur / dostaw dla jednego dostawcy + suma. */
export async function fetchSupplierInvoices(supplierId: string): Promise<{
  entries: SupplierInvoiceEntry[];
  totalSpent: number;
}> {
  const sid = supplierId.trim().toLowerCase();
  const entries: SupplierInvoiceEntry[] = [];
  if (!sid) return { entries, totalSpent: 0 };

  const ak = requireTenantAccountKey();
  let q = supabase
    .from('variable_cost_entries')
    .select('id, name, amount_pln, note, created_at')
    .eq('type', 'materials')
    .eq('account_key', ak)
    .order('created_at', { ascending: false })
    .limit(500);
  const { data: costs } = await q;
  for (const c of costs ?? []) {
    const row = c as {
      id: string;
      name?: string;
      amount_pln?: number;
      note?: string | null;
      created_at?: string;
    };
    if (supplierIdFromCostNote(row.note) !== sid) continue;
    const inv = parseInvoiceCostNote(row.note);
    entries.push({
      id: `cost:${row.id}`,
      source: 'cost',
      title: (row.name || 'Zakup').trim(),
      amount_pln: Number(row.amount_pln) || 0,
      created_at: row.created_at || new Date().toISOString(),
      lines: (inv?.lines || []).map(formatInvoiceLineLabel),
      notePreview: inv ? `${inv.lines.length} poz.` : null,
    });
  }

  const costIds = new Set(entries.map((e) => e.id));
  try {
    const { data: invs } = await supabase
      .from('invoices')
      .select('id, supplier_id, supplier_name, total_cost, note, created_at')
      .eq('account_key', ak)
      .eq('supplier_id', supplierId)
      .order('created_at', { ascending: false })
      .limit(200);
    for (const inv of invs ?? []) {
      const row = inv as {
        id: string;
        total_cost?: number;
        note?: string | null;
        created_at?: string;
        supplier_name?: string | null;
      };
      const amt = Number(row.total_cost) || 0;
      const dup = entries.some((e) => {
        if (Math.abs(e.amount_pln - amt) > 0.02) return false;
        const a = Date.parse(e.created_at);
        const b = Date.parse(row.created_at || '');
        return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 86_400_000;
      });
      if (dup) continue;
      const id = `invoice:${row.id}`;
      if (costIds.has(id)) continue;
      entries.push({
        id,
        source: 'invoice',
        title: `Faktura — ${(row.supplier_name || '').trim() || 'dostawca'}`,
        amount_pln: amt,
        created_at: row.created_at || new Date().toISOString(),
        lines: [],
        notePreview: (row.note || '').trim() || null,
      });
    }
  } catch {
    /* invoices optional */
  }

  entries.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const totalSpent = entries.reduce((s, e) => s + (Number(e.amount_pln) || 0), 0);
  return { entries, totalSpent: Math.round(totalSpent * 100) / 100 };
}

/** Usuń wgraną fakturę / dostawę (koszt zmienny + powiązany wiersz invoices). */
export async function deleteSupplierInvoiceEntry(
  entry: SupplierInvoiceEntry,
  opts?: { supplierId?: string },
): Promise<void> {
  const id = String(entry.id || '');
  const amt = Number(entry.amount_pln) || 0;
  const createdMs = Date.parse(entry.created_at);
  const supplierId = (opts?.supplierId || '').trim().toLowerCase();
  const ak = requireTenantAccountKey();

  const sameBallpark = (iso?: string | null) => {
    const b = Date.parse(iso || '');
    if (!Number.isFinite(createdMs) || !Number.isFinite(b)) return true;
    return Math.abs(createdMs - b) < 86_400_000;
  };

  if (id.startsWith('cost:')) {
    const rawId = id.slice('cost:'.length);
    const { error } = await supabase
      .from('variable_cost_entries')
      .delete()
      .eq('id', rawId)
      .eq('account_key', ak);
    if (error) throw error;
    try {
      let iq = supabase
        .from('invoices')
        .select('id, total_cost, created_at, supplier_id')
        .eq('account_key', ak)
        .limit(300);
      if (supplierId) iq = iq.eq('supplier_id', supplierId);
      const { data: invs } = await iq;
      for (const inv of invs ?? []) {
        const row = inv as {
          id: string;
          total_cost?: number;
          created_at?: string;
          supplier_id?: string;
        };
        if (Math.abs(Number(row.total_cost) - amt) > 0.02) continue;
        if (!sameBallpark(row.created_at)) continue;
        await supabase.from('invoices').delete().eq('id', row.id).eq('account_key', ak);
      }
    } catch {
      /* invoices optional */
    }
    return;
  }

  if (id.startsWith('invoice:')) {
    const rawId = id.slice('invoice:'.length);
    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', rawId)
      .eq('account_key', ak);
    if (error) throw error;
    const { data: costs } = await supabase
      .from('variable_cost_entries')
      .select('id, amount_pln, note, created_at')
      .eq('account_key', ak)
      .eq('type', 'materials')
      .order('created_at', { ascending: false })
      .limit(300);
    for (const c of costs ?? []) {
      const row = c as {
        id: string;
        amount_pln?: number;
        note?: string | null;
        created_at?: string;
      };
      if (Math.abs(Number(row.amount_pln) - amt) > 0.02) continue;
      if (!sameBallpark(row.created_at)) continue;
      if (supplierId) {
        const costSid = supplierIdFromCostNote(row.note);
        if (costSid && costSid !== supplierId) continue;
      }
      await supabase
        .from('variable_cost_entries')
        .delete()
        .eq('id', row.id)
        .eq('account_key', ak);
    }
    return;
  }

  throw new Error('Nieznany typ wpisu faktury.');
}
