/**
 * Typy modułu „Lokalni Przetwórcy”.
 * Warstwa niezależna od `Supplier` / `suppliersService`.
 */

export type LocalProducerStatus = 'draft' | 'active' | 'archived';

/** Producent lokalny (osobna encja względem dostawcy restauracyjnego). */
export type LocalProducer = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  region: string | null;
  city: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: LocalProducerStatus;
  tags: string[];
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalProducerProduct = {
  id: string;
  producer_id: string;
  name: string;
  unit: string | null;
  price_net: number | null;
  category: string | null;
  is_available: boolean;
  created_at: string;
  updated_at: string;
};

export type LocalProducerListFilters = {
  query?: string;
  region?: string;
  status?: LocalProducerStatus;
};

export type CreateLocalProducerInput = {
  name: string;
  description?: string | null;
  region?: string | null;
  city?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  tags?: string[];
};

export type UpdateLocalProducerInput = Partial<CreateLocalProducerInput> & {
  status?: LocalProducerStatus;
  cover_image_url?: string | null;
};

/** Metadane modułu (nawigacja / feature flag). */
export const LOCAL_PRODUCERS_MODULE = {
  id: 'localProducers',
  routeSegment: 'lokalni-przetworcy',
  tabLabel: 'Lokalni Przetwórcy',
  parentTab: 'dostawcy',
  title: 'Lokalni Przetwórcy',
  subtitle: 'Producenci lokalni — niezależnie od dostawców restauracyjnych',
} as const;
