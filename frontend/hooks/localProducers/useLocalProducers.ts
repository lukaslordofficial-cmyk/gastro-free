/**
 * Hook listy „Lokalni Przetwórcy” + Realtime (produkty / producenci / opinie).
 */
import { useCallback, useEffect, useState } from 'react';
import * as localProducersService from '@/services/localProducers';
import type { LocalProducer, LocalProducerListFilters } from '@/types/localProducers';

export function useLocalProducers(filters?: LocalProducerListFilters) {
  const [items, setItems] = useState<LocalProducer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const query = filters?.query;
  const voivodeship = filters?.voivodeship;
  const city = filters?.city;

  const load = useCallback(
    async (opts?: { soft?: boolean }) => {
      if (opts?.soft) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const rows = await localProducersService.listLocalProducers({
          query,
          voivodeship,
          city,
        });
        setItems(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Nie udało się załadować lokalnych przetwórców');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [query, voivodeship, city],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return localProducersService.subscribeLocalProducersMarketplace(() => {
      void load({ soft: true });
    });
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
