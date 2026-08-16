/**
 * Typy marketplace B2B „Lokalni Przetwórcy”
 * (schemat WWW: ETAP 2 → billing → admin).
 */

export type ProducerVerificationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'blocked'
  | 'archived';

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

/** Wartości zgodne z CHECK producer_orders_order_status (WWW + apka). */
export type ProducerOrderStatus =
  | 'pending'
  | 'pending_payment'
  | 'awaiting_payment'
  | 'new'
  | 'confirmed'
  | 'paid'
  | 'processing'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'canceled'
  | 'refunded';

/** Dni wysyłki — jsonb z profilu WWW (np. ["pon","wt","sr"]). */
export type ProducerShippingDays = string[] | Record<string, boolean> | null;

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
  farm_photo_url?: string | null;
  verified: boolean;
  verification_status: ProducerVerificationStatus | string | null;
  active: boolean;
  archived_at: string | null;
  verified_at?: string | null;
  min_order_value: number;
  pickup_available: boolean;
  courier_available: boolean;
  shipping_days?: ProducerShippingDays;
  next_ship_note?: string | null;
  free_delivery_from?: number | null;
  /** Stripe Connect Express (acct_...) — wymagane do widoczności marketplace. */
  stripe_connect_id?: string | null;
  stripe_account_id?: string | null;
  payouts_enabled?: boolean | null;
  stripe_onboarding_complete?: boolean | null;
  created_at: string;
  updated_at: string;
};

/** Producent na liście z wyliczonym dystansem (km). */
export type LocalProducerWithDistance = LocalProducer & {
  distanceKm: number | null;
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
  delivery_cost?: number;
  platform_fee: number;
  producer_amount?: number;
  payment_status: ProducerPaymentStatus | string;
  shipment_status: ProducerShipmentStatus | string;
  order_status?: ProducerOrderStatus | string | null;
  notes: string | null;
  delivery_tracking?: string | null;
  broker_package_id?: string | null;
  pickup_date?: string | null;
  pickup_min_time?: string | null;
  pickup_max_time?: string | null;
  courier_name?: string | null;
  parcel_weight_kg?: number | null;
  shipping_error?: string | null;
  tracking_state?: string | null;
  label_storage_path?: string | null;
  /** URL faktury/rachunku wgranego przez dystrybutora (panel WWW). */
  invoice_url?: string | null;
  settlement_invoice_url?: string | null;
  invoice_file_url?: string | null;
  created_at: string;
  updated_at?: string;
};

export type ProducerOrderWithProducer = ProducerOrder & {
  local_producers?: {
    company_name?: string | null;
    city?: string | null;
  } | null;
};

/** Buckety zakładki Dostawy (sync z producer_orders / panel dystrybutora). */
export type DeliveryBucket = 'pending' | 'in_transit' | 'delivered';

export function deliveryBucketForOrder(order: {
  shipment_status?: string | null;
  order_status?: string | null;
  payment_status?: string | null;
}): DeliveryBucket {
  const ship = String(order.shipment_status || '').toLowerCase();
  const ost = String(order.order_status || '').toLowerCase();
  const track = String((order as { tracking_state?: string }).tracking_state || '').toLowerCase();
  if (ship === 'delivered' || ost === 'delivered' || track === 'delivered') return 'delivered';
  if (
    ship === 'shipped' ||
    ost === 'shipped' ||
    ['collected', 'transit', 'delivery'].includes(track)
  ) {
    return 'in_transit';
  }
  return 'pending';
}

export type ProducerOrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  created_at: string;
};

export type ProducerCartLine = {
  product: ProducerProduct;
  quantity: number;
};

export type ProducerDeliveryAddress = {
  name: string;
  phone: string;
  street: string;
  building_number: string;
  city: string;
  post_code: string;
  email?: string | null;
  /** NIP firmy restauracji (opcjonalnie, do faktury). */
  nip?: string | null;
  /** REGON firmy restauracji (opcjonalnie). */
  regon?: string | null;
};

export type CreateProducerOrderInput = {
  producerId: string;
  items: {
    productId: string;
    quantity: number;
    unitPrice: number;
    unit?: string | null;
    weight_g?: number | null;
  }[];
  /** Adres dostawy do restauracji (kurier). */
  delivery: ProducerDeliveryAddress;
  notes?: string | null;
  courier?: {
    serviceId: number | string;
    service: string;
    name: string;
    priceGross: number;
    widthCm?: number;
    heightCm?: number;
    depthCm?: number;
    weightKg?: number;
  } | null;
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

export type LocalProducerListFilters = {
  query?: string;
  voivodeship?: string;
  city?: string;
  /** Sortuj po dystansie gdy dostępna lokalizacja restauracji */
  restaurantLat?: number | null;
  restaurantLng?: number | null;
  maxDistanceKm?: number | null;
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
  verification_status?: ProducerVerificationStatus;
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

/** Opłata serwisu platformy (5% od wartości produktów). */
export const PLATFORM_FEE_RATE = 0.05;
/** Fallback gdy brak wagi produktów (nie używaj do checkoutu). */
export const COURIER_DELIVERY_STUB_PLN = 15.99;
