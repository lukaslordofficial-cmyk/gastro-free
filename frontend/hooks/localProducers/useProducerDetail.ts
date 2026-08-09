/**
 * Hook produktów + koszyk lokalny dla jednego producenta.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as localProducersService from '@/services/localProducers';
import type {
  LocalProducer,
  ProducerCartLine,
  ProducerDeliveryAddress,
  ProducerOrder,
  ProducerProduct,
} from '@/types/localProducers';
import { haversineKm } from '@/lib/localProducers/haversine';
import { useRestaurantLocation } from './useRestaurantLocation';

export function useProducerDetail(producerId: string | undefined) {
  const { coords } = useRestaurantLocation();
  const [producer, setProducer] = useState<LocalProducer | null>(null);
  const [products, setProducts] = useState<ProducerProduct[]>([]);
  const [cart, setCart] = useState<ProducerCartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!producerId) return;
    setLoading(true);
    setError(null);
    try {
      const [p, prods] = await Promise.all([
        localProducersService.getLocalProducer(producerId),
        localProducersService.listLocalProducerProducts(producerId),
      ]);
      setProducer(p);
      setProducts(prods);
      if (!p) setError('Producent niedostępny (niezatwierdzony lub nieaktywny).');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd ładowania producenta');
    } finally {
      setLoading(false);
    }
  }, [producerId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!producerId) return;
    return localProducersService.subscribeLocalProducersMarketplace(() => {
      void load();
    });
  }, [producerId, load]);

  const distanceKm = useMemo(() => {
    if (
      !coords
      || producer?.latitude == null
      || producer?.longitude == null
    ) {
      return null;
    }
    return haversineKm(
      coords.latitude,
      coords.longitude,
      Number(producer.latitude),
      Number(producer.longitude),
    );
  }, [coords, producer?.latitude, producer?.longitude]);

  const cartTotal = useMemo(
    () => cart.reduce((s, l) => s + Number(l.product.price) * l.quantity, 0),
    [cart],
  );

  const addToCart = useCallback((product: ProducerProduct, qty = 1) => {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.product.id === product.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + qty };
        return next;
      }
      return [...prev, { product, quantity: qty }];
    });
  }, []);

  const setQty = useCallback((productId: string, quantity: number) => {
    setCart((prev) => {
      if (quantity <= 0) return prev.filter((l) => l.product.id !== productId);
      return prev.map((l) =>
        (l.product.id === productId ? { ...l, quantity } : l),
      );
    });
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const placeOrder = useCallback(
    async (delivery: ProducerDeliveryAddress): Promise<ProducerOrder> => {
      if (!producerId || !cart.length) {
        throw new Error('Dodaj produkty do koszyka.');
      }
      setOrdering(true);
      try {
        const order = await localProducersService.createProducerOrder({
          producerId,
          delivery,
          items: cart.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            unitPrice: Number(l.product.price),
          })),
        });
        clearCart();
        return order;
      } finally {
        setOrdering(false);
      }
    },
    [producerId, cart, clearCart],
  );

  return {
    producer,
    products,
    cart,
    cartTotal,
    cartCount: cart.reduce((s, l) => s + l.quantity, 0),
    distanceKm,
    loading,
    ordering,
    error,
    reload: load,
    addToCart,
    setQty,
    clearCart,
    placeOrder,
  };
}
