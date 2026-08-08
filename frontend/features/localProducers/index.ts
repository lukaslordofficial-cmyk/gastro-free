/**
 * Feature barrel — „Lokalni Przetwórcy”.
 * Punkt wejścia warstwy niezależnej od dostawców restauracyjnych.
 */
export {
  LOCAL_PRODUCERS_MODULE,
  LOCAL_PRODUCERS_STORAGE_BUCKETS,
  PLATFORM_FEE_RATE,
  COURIER_DELIVERY_STUB_PLN,
} from '@/types/localProducers';
export type {
  LocalProducer,
  LocalProducerWithDistance,
  ProducerProduct,
  ProducerCategory,
  ProducerReview,
  ProducerOrder,
  ProducerVerificationStatus,
  LocalProducerProduct,
  LocalProducerListFilters,
  CreateLocalProducerInput,
  UpdateLocalProducerInput,
  CreateProducerOrderInput,
} from '@/types/localProducers';
export * from '@/services/localProducers';
export * from '@/hooks/localProducers';
export { LocalProducersScreen, ProducerDetailScreen } from '@/screens/localProducers';
export { DostawcySubTabs, LocalProducersEmptyState } from '@/components/localProducers';
export { haversineKm, formatDistanceKm } from '@/lib/localProducers/haversine';
export { isMarketplaceVisibleProducer } from '@/lib/localProducers/formatProducer';