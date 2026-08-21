/**
 * supplierOrdersService — koszyki + panel Zamówienia (sent / received).
 */
import { supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import { insertVariableCost } from '@/services/financeService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export type SupplierOrderFull = {
  id: string;
  supplier_id: string;
  status: string;
  notes: string | null;
  created_at: string;
  suppliers: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    bank_account?: string | null;
    nip?: string | null;
  } | null;
  supplier_order_items: {
    id: string;
    raw_product_name: string;
    quantity_ordered: number;
    unit: string;
    price_net: number | null;
    warehouse_product_id: string | null;
  }[];
};

const ORDER_SELECT =
  'id, supplier_id, notes, status, created_at, ' +
  'suppliers(name, email, phone, address, bank_account, nip), ' +
  'supplier_order_items(id, raw_product_name, quantity_ordered, unit, price_net, warehouse_product_id)';

export async function saveOrderItems(orderId: string, rows: Row[], notes: string | null): Promise<void> {
  await supabase.from('supplier_order_items').delete().eq('order_id', orderId);
  if (rows.length) {
    const { error } = await supabase.from('supplier_order_items').insert(rows);
    if (error) throw error;
  }
  await supabase.from('supplier_orders').update({ notes }).eq('id', orderId);
}

export async function fetchGlobalBasket(): Promise<{ offerItems: Row[]; drafts: Row[] }> {
  const [{ data: offerData }, { data: drafts }] = await Promise.all([
    supabase
      .from('supplier_offer_items')
      .select('id, supplier_id, raw_product_name, price_net, unit, suppliers(name, icon_color)')
      .order('raw_product_name'),
    supabase
      .from('supplier_orders')
      .select(
        'id, supplier_id, notes, status, suppliers(name, email), supplier_order_items(id, raw_product_name, quantity_ordered, unit, price_net)',
      )
      .eq('status', 'draft')
      .order('created_at', { ascending: false }),
  ]);
  return { offerItems: offerData ?? [], drafts: drafts ?? [] };
}

export async function markDraftSent(orderId: string): Promise<void> {
  const { error } = await supabase.from('supplier_orders').update({ status: 'sent' }).eq('id', orderId);
  if (error) throw error;
}

export async function deleteDrafts(draftIds: string[]): Promise<void> {
  if (!draftIds.length) return;
  await supabase.from('supplier_order_items').delete().in('order_id', draftIds);
  await supabase.from('supplier_orders').delete().in('id', draftIds);
}

export async function deleteOneDraft(orderId: string): Promise<void> {
  await supabase.from('supplier_order_items').delete().eq('order_id', orderId);
  await supabase.from('supplier_orders').delete().eq('id', orderId);
}

/**
 * Po „Złóż zamówienie” / przejściu do maila: podnieś drafty do sent
 * albo utwórz nowe zamówienie sent z pozycjami (Łowca Okazji).
 */
export async function ensureSentOrderForSupplier(params: {
  supplierId: string;
  notes?: string | null;
  items: Array<{
    raw_product_name: string;
    price_net: number | null;
    unit: string;
    quantity_ordered: number;
    warehouse_product_id?: string | null;
  }>;
}): Promise<string> {
  const { data: drafts } = await supabase
    .from('supplier_orders')
    .select('id')
    .eq('supplier_id', params.supplierId)
    .eq('status', 'draft');
  const draftIds = (drafts || []).map((r: { id: string }) => r.id);
  if (draftIds.length) {
    await supabase.from('supplier_orders').update({ status: 'sent' }).in('id', draftIds);
    return draftIds[0];
  }
  const { data: order, error } = await supabase
    .from('supplier_orders')
    .insert({
      supplier_id: params.supplierId,
      status: 'sent',
      notes: params.notes ?? null,
    })
    .select('id')
    .single();
  if (error || !order) throw error ?? new Error('Nie utworzono zamówienia');
  if (params.items.length) {
    const rows = params.items.map((it) => ({
      order_id: order.id,
      raw_product_name: it.raw_product_name,
      price_net: it.price_net,
      unit: it.unit,
      quantity_ordered: it.quantity_ordered,
      warehouse_product_id: it.warehouse_product_id ?? null,
    }));
    const { error: itemsErr } = await supabase.from('supplier_order_items').insert(rows);
    if (itemsErr) throw itemsErr;
  }
  return order.id as string;
}

export async function fetchOrdersByStatuses(
  statuses: Array<'sent' | 'confirmed' | 'received'>,
): Promise<SupplierOrderFull[]> {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select(ORDER_SELECT)
    .in('status', statuses)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SupplierOrderFull[];
}

function yearMonthNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function orderLineTotal(items: SupplierOrderFull['supplier_order_items']): number {
  return items.reduce((s, it) => {
    const p = it.price_net != null ? Number(it.price_net) : 0;
    const q = Number(it.quantity_ordered) || 0;
    return s + p * q;
  }, 0);
}

/** Dopisz ilości do magazynu (po warehouse_product_id lub nazwie); utwórz brakujące. */
export async function applyOrderItemsToInventory(
  items: SupplierOrderFull['supplier_order_items'],
): Promise<{ updated: number; created: number }> {
  let updated = 0;
  let created = 0;
  const ak = getAccountKey();
  for (const it of items) {
    const qty = Number(it.quantity_ordered) || 0;
    if (qty <= 0) continue;
    const name = (it.raw_product_name || '').trim();
    if (!name) continue;
    const unit = (it.unit || 'szt').trim() || 'szt';

    let invId = (it.warehouse_product_id || '').trim() || null;
    if (!invId) {
      let q = supabase
        .from('inventory_items')
        .select('id, quantity')
        .ilike('name', name)
        .limit(1);
      if (ak && ak !== 'default') q = q.eq('account_key', ak);
      const { data } = await q.maybeSingle();
      if (data?.id) invId = data.id;
    }

    if (invId) {
      const { data: row } = await supabase
        .from('inventory_items')
        .select('id, quantity')
        .eq('id', invId)
        .maybeSingle();
      if (row?.id) {
        const before = Number(row.quantity) || 0;
        const { error } = await supabase
          .from('inventory_items')
          .update({ quantity: before + qty })
          .eq('id', row.id);
        if (!error) updated += 1;
        continue;
      }
    }

    const payload: Record<string, unknown> = {
      name,
      quantity: qty,
      unit,
      min_quantity: 0,
      unit_cost: it.price_net != null ? Number(it.price_net) : 0,
      portion_size: null,
      is_combo_polprodukt: false,
      is_critical: false,
      account_key: ak,
    };
    const { error } = await supabase.from('inventory_items').insert(payload as never);
    if (!error) created += 1;
  }
  return { updated, created };
}

export async function receiveSupplierOrder(
  order: SupplierOrderFull,
  opts: { applyInventory: boolean; applyVariableCost: boolean },
): Promise<void> {
  if (opts.applyInventory) {
    await applyOrderItemsToInventory(order.supplier_order_items || []);
  }
  if (opts.applyVariableCost) {
    const total = orderLineTotal(order.supplier_order_items || []);
    if (total > 0) {
      const supplierName = order.suppliers?.name || 'Dostawca';
      await insertVariableCost({
        year_month: yearMonthNow(),
        type: 'materials',
        name: `Dostawa — ${supplierName}`,
        amount_pln: Math.round(total * 100) / 100,
      });
    }
  }
  const { error } = await supabase
    .from('supplier_orders')
    .update({ status: 'received' })
    .eq('id', order.id);
  if (error) throw error;
}
