/**
 * IO modułu „Lokalni Przetwórcy”.
 * Tabele: local_producers, producer_* (nie suppliers).
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type {
  CreateLocalProducerInput,
  LocalProducer,
  LocalProducerListFilters,
  ProducerCategory,
  ProducerProduct,
  ProducerReview,
  UpdateLocalProducerInput,
} from '@/types/localProducers';

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

/** Lista aktywnych + zweryfikowanych producentów (widok restauratora). */
export async function listLocalProducers(
  filters?: LocalProducerListFilters,
): Promise<LocalProducer[]> {
  if (!isSupabaseConfigured) return [];

  let q = supabase
    .from(LOCAL_PRODUCERS_TABLES.producers)
    .select('*')
    .eq('active', true)
    .eq('verified', true)
    .order('company_name', { ascending: true });

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
    if (__DEV__) console.warn('[localProducers] list:', error.message);
    throw new Error(error.message);
  }
  return asRows<LocalProducer>(data);
}

export async function getLocalProducer(id: string): Promise<LocalProducer | null> {
  if (!isSupabaseConfigured || !id) return null;
  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.producers)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (__DEV__) console.warn('[localProducers] get:', error.message);
    throw new Error(error.message);
  }
  return (data as LocalProducer | null) ?? null;
}

export async function listProducerCategories(): Promise<ProducerCategory[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.categories)
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) {
    if (__DEV__) console.warn('[localProducers] categories:', error.message);
    throw new Error(error.message);
  }
  return asRows<ProducerCategory>(data);
}

export async function listLocalProducerProducts(
  producerId: string,
): Promise<ProducerProduct[]> {
  if (!isSupabaseConfigured || !producerId) return [];
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
  return asRows<ProducerProduct>(data);
}

export async function listProducerReviews(producerId: string): Promise<ProducerReview[]> {
  if (!isSupabaseConfigured || !producerId) return [];
  const { data, error } = await supabase
    .from(LOCAL_PRODUCERS_TABLES.reviews)
    .select('*')
    .eq('producer_id', producerId)
    .order('created_at', { ascending: false });
  if (error) {
    if (__DEV__) console.warn('[localProducers] reviews:', error.message);
    throw new Error(error.message);
  }
  return asRows<ProducerReview>(data);
}

/**
 * Tworzenie profilu producenta (konto rolnika / panel WWW).
 * Wymaga sesji auth; auth_user_id = bieżący użytkownik.
 */
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

/**
 * Subskrypcja Realtime — odświeża listę gdy zmienia się producent lub produkt.
 * Zwraca funkcję unsubscribe.
 */
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
