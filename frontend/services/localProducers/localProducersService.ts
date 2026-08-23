/**
 * IO marketplace „Lokalni Przetwórcy”.
 * HARD RULE: tylko approved + verified + active + not archived.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { haversineKm } from '@/lib/localProducers/haversine';
import { isMarketplaceVisibleProducer } from '@/lib/localProducers/formatProducer';
import type {
  CreateLocalProducerInput,
  CreateProducerOrderInput,
  LocalProducer,
  LocalProducerListFilters,
  LocalProducerWithDistance,
  ProducerCategory,
  ProducerOrder,
  ProducerProduct,
  ProducerReview,
  ProducerDeliveryAddress,
  UpdateLocalProducerInput,
} from '@/types/localProducers';
import {
  PLATFORM_FEE_RATE,
} from '@/types/localProducers';
import { quoteCourier } from '@/lib/localProducers/courierQuote';

export const LOCAL_PRODUCERS_TABLES = {
  producers: 'local_producers',
  categories: 'producer_categories',
  products: 'producer_products',
  gallery: 'producer_product_gallery',
  orders: 'producer_orders',
  orderItems: 'producer_order_items',
  reviews: 'producer_reviews',
  documents: 'producer_documents',
  notifications: 'producer_notifications',
} as const;

export function isLocalProducersBackendReady(): boolean {
  return isSupabaseConfigured;
}

function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function parseLpShipNote(notes: string | null | undefined): ProducerDeliveryAddress | null {
  const raw = String(notes || '');
  const marker = 'lp_ship:';
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  const after = raw.slice(idx + marker.length).trim();
  const jsonPart = after.split(/\s\|\s*lp_/)[0]?.trim();
  if (!jsonPart) return null;
  try {
    const obj = JSON.parse(jsonPart) as Record<string, unknown>;
    const name = String(obj.name || '').trim();
    const phone = String(obj.phone || '').trim();
    const street = String(obj.street || '').trim();
    const city = String(obj.city || '').trim();
    const post_code = String(obj.post_code || '').trim();
    if (!phone && !street && !city) return null;
    return {
      name,
      phone,
      street,
      building_number: String(obj.building_number || '').trim(),
      city,
      post_code,
      email: obj.email ? String(obj.email) : null,
      nip: obj.nip ? String(obj.nip).replace(/\D/g, '') : null,
      regon: obj.regon ? String(obj.regon).replace(/\D/g, '') : null,
    };
  } catch {
    return null;
  }
}

function shippingFromProfileRow(row: Record<string, unknown> | null): ProducerDeliveryAddress | null {
  if (!row) return null;
  const name = String(row.restaurant_name || '').trim();
  const phone = String(row.shipping_phone || '').trim();
  const street = String(row.shipping_street || '').trim();
  const city = String(row.shipping_city || '').trim();
  const post_code = String(row.shipping_post_code || '').trim();
  if (!name && !phone && !street && !city && !post_code) return null;
  return {
    name,
    phone,
    street,
    building_number: String(row.shipping_building || '').trim(),
    city,
    post_code,
    nip: row.shipping_nip ? String(row.shipping_nip).replace(/\D/g, '') : null,
    regon: row.shipping_regon ? String(row.shipping_regon).replace(/\D/g, '') : null,
  };
}

/** Zapisany adres paczki restauracji (profil, ewentualnie ostatnie zamówienie). */
export async function getRestaurantShippingProfile(): Promise<ProducerDeliveryAddress | null> {
  if (!isSupabaseConfigured) return null;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;

  const full = await supabase
    .from('profiles')
    .select('restaurant_name, shipping_phone, shipping_street, shipping_building, shipping_city, shipping_post_code, shipping_nip, shipping_regon')
    .eq('id', uid)
    .maybeSingle();

  if (full.error && /shipping_nip|shipping_regon|column|schema cache/i.test(full.error.message || '')) {
    const legacy = await supabase
      .from('profiles')
      .select('restaurant_name, shipping_phone, shipping_street, shipping_building, shipping_city, shipping_post_code')
      .eq('id', uid)
      .maybeSingle();
    if (!legacy.error) {
      Object.assign(full, legacy);
    }
  }

  if (!full.error) {
    const fromProfile = shippingFromProfileRow(full.data as Record<string, unknown> | null);
    if (fromProfile && fromProfile.street && fromProfile.city && fromProfile.post_code && fromProfile.phone) {
      return fromProfile;
    }
    if (fromProfile?.name && !fromProfile.street) {
      // Mamy nazwę restauracji — dociągniemy adres z ostatniego zamówienia, jeśli jest.
    } else if (fromProfile && fromProfile.street) {
      return fromProfile;
    }
  } else if (!/shipping_|column|schema cache/i.test(full.error.message || '')) {
    if (__DEV__) console.warn('[localProducers] shipping profile:', full.error.message);
  }

  const { data: last } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.orders)
    .select('notes')
    .eq('restaurant_id', uid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromOrder = parseLpShipNote((last as { notes?: string } | null)?.notes);
  if (fromOrder) {
    const nameFallback = shippingFromProfileRow(
      full.error ? null : (full.data as Record<string, unknown> | null),
    )?.name;
    return {
      ...fromOrder,
      name: fromOrder.name || nameFallback || '',
    };
  }

  if (!full.error) {
    return shippingFromProfileRow(full.data as Record<string, unknown> | null);
  }

  const nameOnly = await supabase
    .from('profiles')
    .select('restaurant_name')
    .eq('id', uid)
    .maybeSingle();
  const n = String((nameOnly.data as { restaurant_name?: string } | null)?.restaurant_name || '').trim();
  return n ? { name: n, phone: '', street: '', building_number: '', city: '', post_code: '' } : null;
}

export async function saveRestaurantShippingProfile(
  delivery: ProducerDeliveryAddress,
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;

  const payload: Record<string, unknown> = {
    restaurant_name: delivery.name.trim() || null,
    shipping_phone: delivery.phone.trim() || null,
    shipping_street: delivery.street.trim() || null,
    shipping_building: (delivery.building_number || '').trim() || null,
    shipping_city: delivery.city.trim() || null,
    shipping_post_code: delivery.post_code.trim() || null,
    shipping_nip: (delivery.nip || '').replace(/\D/g, '') || null,
    shipping_regon: (delivery.regon || '').replace(/\D/g, '') || null,
  };

  const { error } = await supabase.from('profiles').update(payload).eq('id', uid);
  if (error && /shipping_nip|shipping_regon|column|schema cache/i.test(error.message || '')) {
    const withoutTax = { ...payload };
    delete withoutTax.shipping_nip;
    delete withoutTax.shipping_regon;
    const retry = await supabase.from('profiles').update(withoutTax).eq('id', uid);
    if (retry.error && /shipping_|column|schema cache/i.test(retry.error.message || '')) {
      await supabase
        .from('profiles')
        .update({ restaurant_name: delivery.name.trim() || null })
        .eq('id', uid);
      return;
    }
    return;
  }
  if (error && /shipping_|column|schema cache/i.test(error.message || '')) {
    await supabase
      .from('profiles')
      .update({ restaurant_name: delivery.name.trim() || null })
      .eq('id', uid);
    return;
  }
  if (error && __DEV__) {
    console.warn('[localProducers] save shipping:', error.message);
  }
}

/** Filtr PostgREST — HARD RULE + Stripe Connect Express. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyMarketplaceProducerFilter(q: any) {
  return q
    .eq('active', true)
    .eq('verified', true)
    .eq('verification_status', 'approved')
    .is('archived_at', null)
    .not('stripe_connect_id', 'is', null)
    .neq('stripe_connect_id', '');
}

function withDistance(
  rows: LocalProducer[],
  lat?: number | null,
  lng?: number | null,
  maxKm?: number | null,
): LocalProducerWithDistance[] {
  const hasOrigin = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
  let out: LocalProducerWithDistance[] = rows.map((p) => {
    let distanceKm: number | null = null;
    if (
      hasOrigin
      && p.latitude != null
      && p.longitude != null
      && Number.isFinite(Number(p.latitude))
      && Number.isFinite(Number(p.longitude))
    ) {
      distanceKm = haversineKm(lat!, lng!, Number(p.latitude), Number(p.longitude));
    }
    return { ...p, distanceKm };
  });

  if (maxKm != null && Number.isFinite(maxKm)) {
    out = out.filter((p) => p.distanceKm == null || p.distanceKm <= maxKm);
  }

  if (hasOrigin) {
    out.sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) {
        return a.company_name.localeCompare(b.company_name, 'pl');
      }
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }

  return out;
}

/**
 * Lista producentów widocznych dla restauracji (HARD RULE + Haversine sort).
 */
export async function listLocalProducers(
  filters?: LocalProducerListFilters,
): Promise<LocalProducerWithDistance[]> {
  if (!isSupabaseConfigured) return [];

  let q = applyMarketplaceProducerFilter(
    supabase.from(LOCAL_PRODUCERS_TABLES.producers).select('*'),
  ).order('company_name', { ascending: true });

  if (filters?.voivodeship) {
    q = q.ilike('voivodeship', filters.voivodeship);
  }
  if (filters?.city) {
    q = q.ilike('city', `%${filters.city}%`);
  }
  if (filters?.query?.trim()) {
    const term = `%${filters.query.trim()}%`;
    q = q.or(
      `company_name.ilike.${term},city.ilike.${term},description.ilike.${term},voivodeship.ilike.${term}`,
    );
  }

  const { data, error } = await q;
  if (error) {
    // Fallback gdy kolumna verification_status / archived_at / stripe_connect_id jeszcze nie istnieje
    if (/verification_status|archived_at|stripe_connect_id/i.test(error.message)) {
      const fallback = await supabase
        .from(LOCAL_PRODUCERS_TABLES.producers)
        .select('*')
        .eq('active', true)
        .eq('verified', true)
        .order('company_name', { ascending: true });
      if (fallback.error) throw new Error(fallback.error.message);
      const rows = asRows<LocalProducer>(fallback.data).filter(isMarketplaceVisibleProducer);
      return withDistance(rows, filters?.restaurantLat, filters?.restaurantLng, filters?.maxDistanceKm);
    }
    if (__DEV__) console.warn('[localProducers] list:', error.message);
    throw new Error(error.message);
  }

  const rows = asRows<LocalProducer>(data).filter(isMarketplaceVisibleProducer);
  return withDistance(rows, filters?.restaurantLat, filters?.restaurantLng, filters?.maxDistanceKm);
}

/** Profil producenta — tylko jeśli spełnia HARD RULE. */
export async function getLocalProducer(id: string): Promise<LocalProducer | null> {
  if (!isSupabaseConfigured || !id) return null;

  let q = applyMarketplaceProducerFilter(
    supabase.from(LOCAL_PRODUCERS_TABLES.producers).select('*').eq('id', id),
  );

  const { data, error } = await q.maybeSingle();
  if (error) {
    if (/verification_status|archived_at|stripe_connect_id/i.test(error.message)) {
      const fallback = await supabase
        .from(LOCAL_PRODUCERS_TABLES.producers)
        .select('*')
        .eq('id', id)
        .eq('active', true)
        .eq('verified', true)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      const row = fallback.data as LocalProducer | null;
      return row && isMarketplaceVisibleProducer(row) ? row : null;
    }
    if (__DEV__) console.warn('[localProducers] get:', error.message);
    throw new Error(error.message);
  }

  const row = data as LocalProducer | null;
  return row && isMarketplaceVisibleProducer(row) ? row : null;
}

export async function listProducerCategories(): Promise<ProducerCategory[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.categories)
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return asRows<ProducerCategory>(data);
}

/** Produkty producenta — tylko available; producent musi być marketplace-visible. */
export async function listLocalProducerProducts(
  producerId: string,
): Promise<ProducerProduct[]> {
  if (!isSupabaseConfigured || !producerId) return [];

  const producer = await getLocalProducer(producerId);
  if (!producer) return [];

  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.products)
    .select('*')
    .eq('producer_id', producerId)
    .eq('available', true)
    .order('title', { ascending: true });

  if (error) {
    if (__DEV__) console.warn('[localProducers] products:', error.message);
    throw new Error(error.message);
  }
  return asRows<ProducerProduct>(data).filter((p) => p.available === true);
}

export async function listProducerReviews(producerId: string): Promise<ProducerReview[]> {
  if (!isSupabaseConfigured || !producerId) return [];
  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.reviews)
    .select('*')
    .eq('producer_id', producerId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return asRows<ProducerReview>(data);
}

/**
 * Utwórz zamówienie pending z kurierem (produkty + InPost + 5% platformy).
 * Płatność i split: Stripe Checkout na backendzie.
 */
export async function createProducerOrder(
  input: CreateProducerOrderInput,
): Promise<ProducerOrder> {
  if (!isSupabaseConfigured) throw new Error('Supabase nie jest skonfigurowany.');
  if (!input.items.length) throw new Error('Koszyk jest pusty.');

  const producer = await getLocalProducer(input.producerId);
  if (!producer) throw new Error('Producent niedostępny w marketplace.');

  if (!producer.courier_available) {
    throw new Error('Ten producent nie oferuje dostawy kurierskiej.');
  }
  const connectId = String(
    producer.stripe_connect_id || producer.stripe_account_id || '',
  ).trim();
  if (!connectId.startsWith('acct_')) {
    throw new Error(
      'Dystrybutor nie połączył Stripe Connect — zamówienie niedostępne.',
    );
  }

  const d = input.delivery;
  if (!d?.street?.trim() || !d?.city?.trim() || !d?.post_code?.trim() || !d?.phone?.trim()) {
    throw new Error('Podaj adres dostawy: ulica, miasto, kod pocztowy i telefon.');
  }

  // Hard limit: nie pozwól zamówić więcej niż stan magazynowy produktu.
  const productIds = [...new Set(input.items.map((i) => i.productId).filter(Boolean))];
  if (productIds.length) {
    const { data: stockRows, error: stockErr } = await supabase
      .from(LOCAL_PRODUCERS_TABLES.products)
      .select('id, title, stock, available, producer_id')
      .in('id', productIds);
    if (stockErr) throw new Error(stockErr.message);
    const byId = new Map(
      asRows<{
        id: string;
        title?: string | null;
        stock?: number | null;
        available?: boolean | null;
        producer_id?: string | null;
      }>(stockRows).map((r) => [r.id, r]),
    );
    for (const item of input.items) {
      const row = byId.get(item.productId);
      if (!row || row.producer_id !== input.producerId) {
        throw new Error('Jeden z produktów nie należy do tego dystrybutora.');
      }
      if (row.available === false) {
        throw new Error(`Produkt „${row.title || item.productId}” jest niedostępny.`);
      }
      const stock = Math.floor(Number(row.stock) || 0);
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) throw new Error('Ilość produktu musi być większa od zera.');
      if (qty > stock) {
        throw new Error(
          `Za mało na stanie: „${row.title || 'produkt'}” — dostępne ${stock}, w koszyku ${qty}.`,
        );
      }
    }
  }

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Zaloguj się jako restauracja.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_key, restaurant_name, email')
    .eq('id', uid)
    .maybeSingle();

  const accountKey =
    (profile as { account_key?: string } | null)?.account_key
    || `ak_${uid.replace(/-/g, '')}`;

  const producerAmount = input.items.reduce(
    (s, i) => s + Number(i.unitPrice) * Number(i.quantity),
    0,
  );
  if (producerAmount < Number(producer.min_order_value || 0)) {
    throw new Error(
      `Minimalne zamówienie: ${Number(producer.min_order_value).toFixed(2)} zł`,
    );
  }

  const platformFee = Math.round(producerAmount * PLATFORM_FEE_RATE * 100) / 100;
  const freeFrom = producer.free_delivery_from != null
    ? Number(producer.free_delivery_from)
    : null;
  const quote = quoteCourier(input.items.map((i) => ({
    quantity: i.quantity,
    unit: i.unit,
    weight_g: i.weight_g,
  })));
  const selectedCourier = input.courier;
  const deliveryCost =
    freeFrom != null && producerAmount >= freeFrom
      ? 0
      : (selectedCourier?.priceGross != null
        ? Math.round(Number(selectedCourier.priceGross) * 100) / 100
        : quote.pricePln);
  const totalPrice = Math.round((producerAmount + deliveryCost + platformFee) * 100) / 100;

  const shipPayload = {
    name: (d.name || (profile as { restaurant_name?: string } | null)?.restaurant_name || 'Restauracja').trim(),
    phone: d.phone.trim(),
    street: d.street.trim(),
    building_number: (d.building_number || '1').trim(),
    city: d.city.trim(),
    post_code: d.post_code.trim(),
    email: (d.email || (profile as { email?: string } | null)?.email || null),
    nip: (d.nip || '').replace(/\D/g, '') || null,
    regon: (d.regon || '').replace(/\D/g, '') || null,
  };
  void saveRestaurantShippingProfile({
    name: shipPayload.name,
    phone: shipPayload.phone,
    street: shipPayload.street,
    building_number: shipPayload.building_number,
    city: shipPayload.city,
    post_code: shipPayload.post_code,
    email: shipPayload.email,
    nip: shipPayload.nip,
    regon: shipPayload.regon,
  });
  const shipNote = `lp_ship:${JSON.stringify(shipPayload)}`;
  const courierNote = selectedCourier
    ? `lp_courier:${JSON.stringify({
      service_id: selectedCourier.serviceId,
      service: selectedCourier.service,
      name: selectedCourier.name,
      price_gross: deliveryCost,
      width: selectedCourier.widthCm,
      height: selectedCourier.heightCm,
      depth: selectedCourier.depthCm,
      weight_kg: selectedCourier.weightKg ?? quote.weightKg,
    })}`
    : '';
  const notes = [
    input.notes?.trim() || 'Zamów i zapłać · kurier',
    shipNote,
    courierNote,
  ].filter(Boolean).join(' | ');

  // order_status: 'pending' — zgodne z typowym CHECK WWW (nie 'pending_payment')
  const orderPayload: Record<string, unknown> = {
    producer_id: input.producerId,
    restaurant_id: uid,
    restaurant_account_key: accountKey,
    total_price: totalPrice,
    shipping_cost: deliveryCost,
    delivery_cost: deliveryCost,
    platform_fee: platformFee,
    producer_amount: producerAmount,
    payment_status: 'pending',
    shipment_status: 'draft',
    order_status: 'pending',
    notes,
    parcel_weight_kg: selectedCourier?.weightKg ?? quote.weightKg,
    courier_name: selectedCourier?.name || selectedCourier?.service || null,
  };

  let { data: order, error: orderErr } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.orders)
    .insert(orderPayload)
    .select('*')
    .maybeSingle();

  // Retry: brak kolumn WWW / zbyt wąski CHECK order_status
  if (
    orderErr
    && (/column|schema cache|order_status|check constraint/i.test(orderErr.message))
  ) {
    const withoutStatus = { ...orderPayload };
    delete withoutStatus.order_status;
    delete withoutStatus.delivery_cost;
    delete withoutStatus.producer_amount;
    delete withoutStatus.parcel_weight_kg;
    delete withoutStatus.courier_name;
    let retry = await supabase
      .from(LOCAL_PRODUCERS_TABLES.orders)
      .insert(withoutStatus)
      .select('*')
      .maybeSingle();
    if (retry.error && /column|schema cache|check constraint/i.test(retry.error.message)) {
      const minimal = {
        producer_id: input.producerId,
        restaurant_id: uid,
        restaurant_account_key: accountKey,
        total_price: totalPrice,
        shipping_cost: deliveryCost,
        platform_fee: platformFee,
        payment_status: 'pending',
        shipment_status: 'draft',
        notes: orderPayload.notes,
      };
      retry = await supabase
        .from(LOCAL_PRODUCERS_TABLES.orders)
        .insert(minimal)
        .select('*')
        .maybeSingle();
    }
    order = retry.data;
    orderErr = retry.error;
  }

  if (orderErr || !order) {
    throw new Error(orderErr?.message || 'Nie udało się utworzyć zamówienia.');
  }

  const orderId = String((order as ProducerOrder).id || '').trim();
  if (!orderId) {
    throw new Error(
      'Zamówienie utworzone, ale serwer nie zwrócił ID. Odśwież Dostawy i spróbuj zapłacić ponownie.',
    );
  }
  const itemsPayload = input.items.map((i) => ({
    order_id: orderId,
    product_id: i.productId,
    quantity: i.quantity,
    unit_price: i.unitPrice,
  }));

  const { error: itemsErr } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.orderItems)
    .insert(itemsPayload);

  if (itemsErr) {
    // best-effort cleanup
    await supabase.from(LOCAL_PRODUCERS_TABLES.orders).delete().eq('id', orderId);
    throw new Error(itemsErr.message);
  }

  return { ...(order as ProducerOrder), id: orderId };
}

/**
 * Zamówienia LP zalogowanej restauracji (zakładka Dostawy).
 */
export async function listMyProducerOrders(): Promise<
  import('@/types/localProducers').ProducerOrderWithProducer[]
> {
  if (!isSupabaseConfigured) return [];
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_key')
    .eq('id', uid)
    .maybeSingle();

  const accountKey =
    (profile as { account_key?: string } | null)?.account_key
    || `ak_${uid.replace(/-/g, '')}`;

  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.orders)
    .select('*, local_producers(company_name, city)')
    .eq('restaurant_account_key', accountKey)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    // Fallback bez join gdy FK/relacja niedostępna
    const retry = await supabase
      .from(LOCAL_PRODUCERS_TABLES.orders)
      .select('*')
      .eq('restaurant_account_key', accountKey)
      .order('created_at', { ascending: false })
      .limit(100);
    if (retry.error) throw new Error(retry.error.message);
    return asRows(retry.data);
  }
  return asRows(data);
}

export async function getMyProducerOrder(
  orderId: string,
): Promise<import('@/types/localProducers').ProducerOrderWithProducer | null> {
  if (!isSupabaseConfigured || !orderId) return null;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_key')
    .eq('id', uid)
    .maybeSingle();
  const accountKey =
    (profile as { account_key?: string } | null)?.account_key
    || `ak_${uid.replace(/-/g, '')}`;

  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.orders)
    .select('*, local_producers(company_name, city)')
    .eq('id', orderId)
    .eq('restaurant_account_key', accountKey)
    .maybeSingle();

  if (error || !data) {
    const retry = await supabase
      .from(LOCAL_PRODUCERS_TABLES.orders)
      .select('*')
      .eq('id', orderId)
      .eq('restaurant_account_key', accountKey)
      .maybeSingle();
    if (retry.error || !retry.data) return null;
    return retry.data as import('@/types/localProducers').ProducerOrderWithProducer;
  }
  return data as import('@/types/localProducers').ProducerOrderWithProducer;
}

export type ProducerOrderLine = {
  id: string;
  quantity: number;
  unit_price: number;
  title: string;
  unit?: string | null;
};

/** Pozycje zamówienia z nazwami produktów. */
export async function listMyProducerOrderItems(
  orderId: string,
): Promise<ProducerOrderLine[]> {
  if (!isSupabaseConfigured || !orderId) return [];
  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.orderItems)
    .select('id, quantity, unit_price, product_id, producer_products(title, unit)')
    .eq('order_id', orderId);

  if (error || !data) {
    const retry = await supabase
      .from(LOCAL_PRODUCERS_TABLES.orderItems)
      .select('id, quantity, unit_price, product_id')
      .eq('order_id', orderId);
    if (retry.error || !retry.data) return [];
    return (retry.data as { id: string; quantity: number; unit_price: number }[]).map((r) => ({
      id: r.id,
      quantity: Number(r.quantity) || 0,
      unit_price: Number(r.unit_price) || 0,
      title: 'Produkt',
      unit: null,
    }));
  }

  return (data as Array<{
    id: string;
    quantity: number;
    unit_price: number;
    producer_products?: { title?: string; unit?: string } | null;
  }>).map((r) => ({
    id: r.id,
    quantity: Number(r.quantity) || 0,
    unit_price: Number(r.unit_price) || 0,
    title: r.producer_products?.title || 'Produkt',
    unit: r.producer_products?.unit ?? null,
  }));
}

export async function createLocalProducer(
  input: CreateLocalProducerInput,
): Promise<LocalProducer | null> {
  if (!isSupabaseConfigured) return null;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Brak sesji — zaloguj się jako producent.');

  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.producers)
    .insert({
      auth_user_id: uid,
      company_name: input.company_name.trim(),
      owner_name: input.owner_name ?? null,
      email: input.email ?? auth.user?.email ?? null,
      phone: input.phone ?? null,
      description: input.description ?? null,
      voivodeship: input.voivodeship ?? null,
      county: input.county ?? null,
      city: input.city ?? null,
      address: input.address ?? null,
      postal_code: input.postal_code ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      min_order_value: input.min_order_value ?? 0,
      pickup_available: input.pickup_available ?? true,
      courier_available: input.courier_available ?? false,
      verified: false,
      verification_status: 'pending',
      active: true,
    })
    .select('*')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as LocalProducer | null) ?? null;
}

export async function updateLocalProducer(
  id: string,
  input: UpdateLocalProducerInput,
): Promise<LocalProducer | null> {
  if (!isSupabaseConfigured || !id) return null;
  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.producers)
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LocalProducer | null) ?? null;
}

export function subscribeLocalProducersMarketplace(
  onChange: () => void,
): () => void {
  if (!isSupabaseConfigured) return () => undefined;

  const channel = supabase
    .channel('local-producers-marketplace')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: LOCAL_PRODUCERS_TABLES.producers },
      () => onChange(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: LOCAL_PRODUCERS_TABLES.products },
      () => onChange(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: LOCAL_PRODUCERS_TABLES.reviews },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
