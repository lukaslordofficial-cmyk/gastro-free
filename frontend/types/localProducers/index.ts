/**
 * Typy modułu „Lokalni Przetwórcy” — zgodne z migracją
 * `supabase_migrations/ADD_LOCAL_PRODUCERS_MARKETPLACE.sql`.
 */

export type ProducerPaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export type ProducerShipmentStatus =
  | 'draft'
  | 'confirmed'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type LocalProducer = {
  id: string;
  auth_user_id: string | null;
  company_name: string;
  owner_name: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
  voivodeship: string | null;
  county: string | null;
  city: string | null;
  address: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  logo_url: string | null;
  banner_url: string | null;
  verified: boolean;
  active: boolean;
  min_order_value: number;
  pickup_available: boolean;
  courier_available: boolean;
  created_at: string;
  updated_at: string;
};

export type ProducerCategory = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  created_at: string;
};

export type ProducerProduct = {
  id: string;
  producer_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  price: number;
  unit: string;
  stock: number;
  image_url: string | null;
  weight_g: number | null;
  available: boolean;
  created_at: string;
  updated_at: string;
};

export type ProducerProductGalleryItem = {
  id: string;
  product_id: string;
  image_url: string;
  sort_order: number;
  created_at: string;
};

export type ProducerOrder = {
  id: string;
  producer_id: string;
  restaurant_id: string;
  restaurant_account_key: string;
  total_price: number;
  shipping_cost: number;
  platform_fee: number;
  payment_status: ProducerPaymentStatus;
  shipment_status: ProducerShipmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProducerOrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  created_at: string;
};

export type ProducerReview = {
  id: string;
  producer_id: string;
  restaurant_id: string;
  restaurant_account_key: string;
  quality: number;
  delivery: number;
  communication: number;
  comment: string | null;
  created_at: string;
};

export type ProducerDocument = {
  id: string;
  producer_id: string;
  document_type: string;
  file_url: string;
  verified: boolean;
  uploaded_at: string;
};

export type ProducerNotification = {
  id: string;
  producer_id: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
};

/** @deprecated alias — używaj LocalProducer */
export type LocalProducerStatus = 'draft' | 'active' | 'archived';

export type LocalProducerListFilters = {
  query?: string;
  voivodeship?: string;
  city?: string;
  categorySlug?: string;
};

export type LocalProducerProduct = ProducerProduct;

export type CreateLocalProducerInput = {
  company_name: string;
  owner_name?: string | null;
  email?: string | null;
  phone?: string | null;
  description?: string | null;
  voivodeship?: string | null;
  county?: string | null;
  city?: string | null;
  address?: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  min_order_value?: number;
  pickup_available?: boolean;
  courier_available?: boolean;
};

export type UpdateLocalProducerInput = Partial<CreateLocalProducerInput> & {
  logo_url?: string | null;
  banner_url?: string | null;
  verified?: boolean;
  active?: boolean;
};

export const LOCAL_PRODUCERS_MODULE = {
  id: 'localProducers',
  routeSegment: 'lokalni-przetworcy',
  tabLabel: 'Lokalni Przetwórcy',
  parentTab: 'dostawcy',
  title: 'Lokalni Przetwórcy',
  subtitle: 'Producenci lokalni — niezależnie od dostawców restauracyjnych',
} as const;

export const LOCAL_PRODUCERS_STORAGE_BUCKETS = {
  logos: 'producer-logos',
  banners: 'producer-banners',
  products: 'producer-products',
  documents: 'producer-documents',
} as const;
