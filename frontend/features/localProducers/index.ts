/**
 * Feature barrel — „Lokalni Przetwórcy”.
 * Punkt wejścia warstwy niezależnej od dostawców restauracyjnych.
 */
export { LOCAL_PRODUCERS_MODULE, LOCAL_PRODUCERS_STORAGE_BUCKETS } from '@/types/localProducers';
export type {
  LocalProducer,
  ProducerProduct,
  ProducerCategory,
  ProducerReview,
  ProducerOrder,
  LocalProducerProduct,
  LocalProducerListFilters,
  CreateLocalProducerInput,
  UpdateLocalProducerInput,
} from '@/types/localProducers';
export * from '@/services/localProducers';
export * from '@/hooks/localProducers';
export { LocalProducersScreen } from '@/screens/localProducers';
export { DostawcySubTabs, LocalProducersEmptyState } from '@/components/localProducers';
