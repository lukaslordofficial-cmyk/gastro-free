/**
 * Hook listy marketplace + GPS sort + Realtime.
 */
import { useCallback, useEffect, useState } from 'react';
import * as localProducersService from '@/services/localProducers';
import type { LocalProducerListFilters, LocalProducerWithDistance } from '@/types/localProducers';
import { useRestaurantLocation } from './useRestaurantLocation';

export function useLocalProducers(filters?: Omit<LocalProducerListFilters, 'restaurantLat' | 'restaurantLng'>) {
  const { coords, loading: locLoading, permissionDenied, refresh: refreshLocation } =
    useRestaurantLocation();
  const [items, setItems] = useState<LocalProducerWithDistance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const query = filters?.query;
  const voivodeship = filters?.voivodeship;
  const city = filters?.city;
  const maxDistanceKm = filters?.maxDistanceKm;

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
          maxDistanceKm,
          restaurantLat: coords?.latitude ?? null,
          restaurantLng: coords?.longitude ?? null,
        });
        setItems(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Nie udało się załadować lokalnych przetwórców');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [query, voivodeship, city, maxDistanceKm, coords?.latitude, coords?.longitude],
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
    loading: loading || locLoading,
    error,
    refreshing,
    refresh: () => load({ soft: true }),
    reload: () => load(),
    backendReady: localProducersService.isLocalProducersBackendReady(),
    coords,
    permissionDenied,
    refreshLocation,
  };
}
