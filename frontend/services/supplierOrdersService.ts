/**
 * supplierOrdersService — IO Supabase zamówień do dostawców (koszyki/drafty).
 * Zachowanie 1:1 z ekranem (dekalog §II/§V).
 */
import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/** Zapis koszyka: podmiana pozycji + aktualizacja notatek. Rzuca przy błędzie insertu. */
export async function saveOrderItems(orderId: string, rows: Row[], notes: string | null): Promise<void> {
  await supabase.from('supplier_order_items').delete().eq('order_id', orderId);
  if (rows.length) {
    const { error } = await supabase.from('supplier_order_items').insert(rows);
    if (error) throw error;
  }
  await supabase.from('supplier_orders').update({ notes }).eq('id', orderId);
}

/** Globalny koszyk: pozycje ofert + zapisane drafty zamówień. */
export async function fetchGlobalBasket(): Promise<{ offerItems: Row[]; drafts: Row[] }> {
  const [{ data: offerData }, { data: drafts }] = await Promise.all([
    supabase
      .from('supplier_offer_items')
      .select('id, supplier_id, raw_product_name, price_net, unit, suppliers(name, icon_color)')
      .order('raw_product_name'),
    supabase
      .from('supplier_orders')
      .select('id, supplier_id, notes, status, suppliers(name, email), supplier_order_items(id, raw_product_name, quantity_ordered, unit, price_net)')
      .eq('status', 'draft')
      .order('created_at', { ascending: false }),
  ]);
  return { offerItems: offerData ?? [], drafts: drafts ?? [] };
}

/** Oznacz zamówienie jako wysłane (best-effort). */
export async function markDraftSent(orderId: string): Promise<void> {
  await supabase.from('supplier_orders').update({ status: 'sent' }).eq('id', orderId);
}

/** Usuń wiele draftów (pozycje + zamówienia). */
export async function deleteDrafts(draftIds: string[]): Promise<void> {
  if (!draftIds.length) return;
  await supabase.from('supplier_order_items').delete().in('order_id', draftIds);
  await supabase.from('supplier_orders').delete().in('id', draftIds);
}

/** Usuń pojedynczy draft (pozycje + zamówienie). */
export async function deleteOneDraft(orderId: string): Promise<void> {
  await supabase.from('supplier_order_items').delete().eq('order_id', orderId);
  await supabase.from('supplier_orders').delete().eq('id', orderId);
}
