/**
 * Hook listy „Lokalni Przetwórcy” — niezależny od suppliersService.
 */
import { useCallback, useEffect, useState } from 'react';
import * as localProducersService from '@/services/localProducers';
import type { LocalProducer, LocalProducerListFilters } from '@/types/localProducers';

export function useLocalProducers(filters?: LocalProducerListFilters) {
  const [items, setItems] = useState<LocalProducer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (opts?: { soft?: boolean }) => {
      if (opts?.soft) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const rows = await localProducersService.listLocalProducers(filters);
        setItems(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Nie udało się załadować lokalnych przetwórców');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return {
    items,
    loading,
    error,
    refreshing,
    refresh: () => load({ soft: true }),
    reload: () => load(),
    backendReady: localProducersService.isLocalProducersBackendReady(),
  };
}
