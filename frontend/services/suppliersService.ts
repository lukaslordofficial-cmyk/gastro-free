/**
 * suppliersService — IO Supabase modułu Dostawcy: dostawcy, katalog, oferty AI,
 * edge function `process-offer` (dekalog §II/§V). Zachowanie 1:1 z ekranem.
 */
import { supabase } from '@/lib/supabase';
import { matchesAnyMenuIngredient } from '@/lib/fuzzyProductMatch';
import type { SupplierOffer, SupplierOfferItem } from '@/lib/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const ICON_COLORS = ['#2563EB', '#DC2626', '#16A34A', '#D97706', '#7C3AED', '#0891B2', '#475569'];
const randomIconColor = () => ICON_COLORS[Math.floor(Math.random() * ICON_COLORS.length)];

const EXTRA = 'min_order_value, shipping_cost, free_shipping_threshold, lead_time_days';
const CAT = 'supplier_catalog(id, name, variant, volume_label, unit_count, price_pln, liters_total, sort_order';
const SEL_VISIBLE = `id, name, nip, category, contact_person, phone, email, notes, icon_color, ${EXTRA}, ${CAT}, is_visible)`;
const SEL_BASE = `id, name, nip, category, contact_person, phone, email, notes, icon_color, ${EXTRA}, ${CAT})`;
const SEL_NO_LEAD = `id, name, nip, category, contact_person, phone, email, notes, icon_color, min_order_value, shipping_cost, free_shipping_threshold, ${CAT})`;
const SEL_LEGACY = `id, name, nip, category, contact_person, phone, email, notes, icon_color, min_order_value, ${CAT})`;

export type SuppliersData = {
  rows: Row[];
  menuIngredients: string[];
  totalAnalyses: number;
  orderTotals: Record<string, number>;
};

/** Fetch dostawców z 4-poziomowym fallbackiem schematu + reveal katalogu + sumy zamówień. */
export async function fetchSuppliersData(ak: string): Promise<SuppliersData> {
  const [suppliersRes, countRes, recipeRes] = await Promise.all([
    supabase.from('suppliers').select(SEL_VISIBLE).eq('account_key', ak).order('name'),
    supabase.from('supplier_offers').select('*', { count: 'exact', head: true }).eq('account_key', ak).eq('status', 'done'),
    supabase.from('recipe_ingredients').select('ingredient_name').limit(5000),
  ]);

  let data = suppliersRes.data;
  if (suppliersRes.error) {
    const msg = suppliersRes.error.message ?? '';
    if (/lead_time_days/.test(msg)) {
      const retry = await supabase.from('suppliers').select(SEL_NO_LEAD).eq('account_key', ak).order('name');
      if (retry.error) {
        if (/shipping_cost|free_shipping_threshold/.test(retry.error.message ?? '')) {
          const legacy = await supabase.from('suppliers').select(SEL_LEGACY).eq('account_key', ak).order('name');
          if (legacy.error) throw legacy.error;
          data = legacy.data;
        } else throw retry.error;
      } else data = retry.data;
    } else if (/shipping_cost|free_shipping_threshold/.test(msg)) {
      const retry = await supabase.from('suppliers').select(SEL_LEGACY).eq('account_key', ak).order('name');
      if (retry.error) throw retry.error;
      data = retry.data;
    } else if (/is_visible/.test(msg)) {
      const retry = await supabase.from('suppliers').select(SEL_BASE).eq('account_key', ak).order('name');
      if (retry.error) throw retry.error;
      data = retry.data;
    } else throw suppliersRes.error;
  }

  const menuIngredients = [
    ...new Set((recipeRes.data ?? []).map((r: Row) => (r.ingredient_name || '').trim()).filter(Boolean)),
  ] as string[];

  // Opcjonalnie: podnieś is_visible w DB dla fuzzy-match (bez blokowania UI).
  const toReveal: string[] = [];
  for (const s of data ?? []) {
    for (const c of (s as Row).supplier_catalog ?? []) {
      if (c.is_visible === false && matchesAnyMenuIngredient(c.name, menuIngredients, 72)) toReveal.push(c.id);
    }
  }
  if (toReveal.length > 0) {
    void supabase.from('supplier_catalog').update({ is_visible: true }).in('id', toReveal);
  }

  const { data: costs } = await supabase
    .from('variable_cost_entries')
    .select('amount_pln, note')
    .eq('account_key', ak)
    .eq('type', 'materials');
  const orderTotals: Record<string, number> = {};
  (costs ?? []).forEach((c: Row) => {
    const m = /supplier:([0-9a-fA-F-]{36})/.exec(c.note ?? '');
    if (m) orderTotals[m[1]] = (orderTotals[m[1]] ?? 0) + Number(c.amount_pln ?? 0);
  });

  return { rows: data ?? [], menuIngredients, totalAnalyses: countRes.count ?? 0, orderTotals };
}

/** Zapis dostawcy (insert/update) z fallbackiem lead_time/shipping. Zwraca listę częściowych zapisów. */
export async function saveSupplier(input: {
  payload: Record<string, unknown>;
  editingId: string | null;
  ak: string;
}): Promise<{ partials: Array<'lead' | 'shipping'> }> {
  const { payload, editingId, ak } = input;
  const partials: Array<'lead' | 'shipping'> = [];
  const run = async (body: Record<string, unknown>) =>
    editingId
      ? (await supabase.from('suppliers').update(body).eq('id', editingId).eq('account_key', ak)).error
      : (await supabase.from('suppliers').insert({ ...body, icon_color: randomIconColor() })).error;

  let err = await run(payload);
  if (err && /lead_time_days/.test(err.message ?? '')) {
    const noLead = { ...payload }; delete noLead.lead_time_days;
    err = await run(noLead);
    if (!err) partials.push('lead');
  }
  if (err && /shipping_cost|free_shipping_threshold/.test(err.message ?? '')) {
    const legacy = { ...payload }; delete legacy.shipping_cost; delete legacy.free_shipping_threshold; delete legacy.lead_time_days;
    err = await run(legacy);
    if (!err) partials.push('shipping');
  }
  if (err) throw err;
  return { partials };
}

/** Usunięcie dostawcy. Rzuca przy błędzie. */
export async function deleteSupplier(id: string): Promise<void> {
  const { error } = await supabase.from('suppliers').delete().eq('id', id);
  if (error) throw error;
}

/** Insert produktu do katalogu z fallbackiem bez kg_total. Zwraca surowy błąd. */
export async function insertCatalogProduct(
  basePayload: Record<string, unknown>,
  kgTotal: number,
): Promise<{ error: { message: string } | null }> {
  let { error } = await supabase.from('supplier_catalog').insert({ ...basePayload, kg_total: kgTotal });
  if (error && /kg_total/i.test(error.message ?? '')) {
    ({ error } = await supabase.from('supplier_catalog').insert(basePayload));
  }
  return { error: error ? { message: error.message } : null };
}

/** Usunięcie pozycji katalogu. Zwraca surowy błąd. */
export async function deleteCatalogProduct(id: string): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from('supplier_catalog').delete().eq('id', id);
  return { error: error ? { message: error.message } : null };
}

/** Katalog dostawcy do okna zamówienia. */
export async function fetchSupplierCatalog(supplierId: string): Promise<Row[]> {
  const { data } = await supabase
    .from('supplier_catalog')
    .select('id, name, price_pln, unit')
    .eq('supplier_id', supplierId)
    .order('name')
    .limit(400);
  return data ?? [];
}

/** Ostatnia oferta + pozycje dla karty dostawcy. */
export async function fetchSupplierOfferData(
  supplierId: string,
): Promise<{ offer: SupplierOffer | null; items: SupplierOfferItem[] }> {
  const [{ data: offerData }, { data: itemData }] = await Promise.all([
    supabase.from('supplier_offers').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('supplier_offer_items').select('*').eq('supplier_id', supplierId).order('raw_product_name'),
  ]);
  return { offer: (offerData as SupplierOffer) ?? null, items: (itemData ?? []) as SupplierOfferItem[] };
}

/** Poll pojedynczej oferty (status). */
export async function fetchOfferById(offerId: string): Promise<Row | null> {
  const { data } = await supabase.from('supplier_offers').select('*').eq('id', offerId).maybeSingle();
  return data ?? null;
}

/** Pozycje oferty (po zakończeniu przetwarzania). */
export async function fetchOfferItems(supplierId: string): Promise<SupplierOfferItem[]> {
  const { data } = await supabase.from('supplier_offer_items').select('*').eq('supplier_id', supplierId).order('raw_product_name');
  return (data ?? []) as SupplierOfferItem[];
}

/** Skrócona lista magazynu (kontekst dla process-offer). */
export async function fetchInventoryBrief(): Promise<Row[]> {
  const { data } = await supabase.from('inventory_items').select('id, name, unit').order('name');
  return data ?? [];
}

/** Wywołanie edge function process-offer (analiza faktury AI). */
export async function invokeProcessOffer(body: Record<string, unknown>): Promise<{ data: Row; error: Row }> {
  const { data, error } = await supabase.functions.invoke('process-offer', { body });
  return { data, error };
}
