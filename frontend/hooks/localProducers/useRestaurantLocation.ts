/**
 * Lokalizacja restauracji (GPS) pod dystans Haversine.
 *
 * Celowo BEZ importu `expo-location` — dopóki pakietu nie ma w node_modules,
 * Metro pada z 500 na unresolved module. Po udanym `yarn install` włącz GPS
 * w tym pliku (patrz komentarz na dole / kolejny commit).
 */
import { useCallback, useEffect, useState } from 'react';

export type RestaurantCoords = {
  latitude: number;
  longitude: number;
};

export function useRestaurantLocation() {
  const [coords] = useState<RestaurantCoords | null>(null);
  const [loading, setLoading] = useState(false);
  const [error] = useState<string | null>(null);
  const [permissionDenied] = useState(false);

  const refresh = useCallback(async () => {
    // Stub: brak GPS do czasu instalacji expo-location.
    // Lista producentów / szczegóły działają; dystans pokazuje „— km”.
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    coords,
    loading,
    error,
    permissionDenied,
    refresh,
  };
}
