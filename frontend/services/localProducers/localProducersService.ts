/**
 * IO modułu „Lokalni Przetwórcy”.
 * Używa tego samego klienta Supabase co reszta aplikacji,
 * ale NIE korzysta z tabel/serwisów dostawców restauracyjnych.
 *
 * ETAP 1: warstwa przygotowana; zapytania do tabel LP wrócą w kolejnych etapach.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type {
  CreateLocalProducerInput,
  LocalProducer,
  LocalProducerListFilters,
  LocalProducerProduct,
  UpdateLocalProducerInput,
} from '@/types/localProducers';

/** Docelowe nazwy tabel (Supabase) — osobne od `suppliers` / `supplier_*`. */
export const LOCAL_PRODUCERS_TABLES = {
  producers: 'local_producers',
  products: 'local_producer_products',
} as const;

export function isLocalProducersBackendReady(): boolean {
  return isSupabaseConfigured;
}

/**
 * Lista producentów lokalnych.
 * ETAP 1: zwraca pustą listę (tabele / RLS w kolejnym etapie).
 */
export async function listLocalProducers(
  _filters?: LocalProducerListFilters,
): Promise<LocalProducer[]> {
  if (!isSupabaseConfigured) return [];
  // Placeholder — nie dotykamy tabel suppliers.
  void supabase;
  return [];
}

export async function getLocalProducer(_id: string): Promise<LocalProducer | null> {
  if (!isSupabaseConfigured) return null;
  return null;
}

export async function createLocalProducer(
  _input: CreateLocalProducerInput,
): Promise<LocalProducer | null> {
  if (!isSupabaseConfigured) return null;
  return null;
}

export async function updateLocalProducer(
  _id: string,
  _input: UpdateLocalProducerInput,
): Promise<LocalProducer | null> {
  if (!isSupabaseConfigured) return null;
  return null;
}

export async function listLocalProducerProducts(
  _producerId: string,
): Promise<LocalProducerProduct[]> {
  if (!isSupabaseConfigured) return [];
  return [];
}
