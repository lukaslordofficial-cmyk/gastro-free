/**
 * Hook produktów + koszyk lokalny dla jednego producenta.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as localProducersService from '@/services/localProducers';
import type {
  CreateProducerOrderInput,
  LocalProducer,
  ProducerCartLine,
  ProducerCategory,
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
  const [categories, setCategories] = useState<ProducerCategory[]>([]);
  const [cart, setCart] = useState<ProducerCartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!producerId) return;
    setLoading(true);
    setError(null);
    try {
      const [p, prods, cats] = await Promise.all([
        localProducersService.getLocalProducer(producerId),
        localProducersService.listLocalProducerProducts(producerId),
        localProducersService.listProducerCategories().catch(() => []),
      ]);
      setProducer(p);
      setProducts(prods);
      setCategories(cats);
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

  const stockCap = useCallback((product: ProducerProduct) => {
    const n = Number(product.stock);
    if (!Number.isFinite(n) || n < 0) return 0;
    // Stan magazynowy LP jest w jednostce produktu (szt/kg/l) — qty koszyka to ta sama jednostka.
    return Math.floor(n);
  }, []);

  const addToCart = useCallback((product: ProducerProduct, qty = 1) => {
    const max = stockCap(product);
    if (max <= 0) return;
    setCart((prev) => {
      const i = prev.findIndex((l) => l.product.id === product.id);
      if (i >= 0) {
        const next = [...prev];
        const desired = next[i].quantity + qty;
        next[i] = { ...next[i], quantity: Math.min(desired, max), product };
        return next;
      }
      return [...prev, { product, quantity: Math.min(Math.max(1, qty), max) }];
    });
  }, [stockCap]);

  const setQty = useCallback((productId: string, quantity: number) => {
    setCart((prev) => {
      if (quantity <= 0) return prev.filter((l) => l.product.id !== productId);
      return prev.map((l) => {
        if (l.product.id !== productId) return l;
        const max = stockCap(l.product);
        return { ...l, quantity: Math.min(quantity, Math.max(0, max)) };
      }).filter((l) => l.quantity > 0);
    });
  }, [stockCap]);

  const clearCart = useCallback(() => setCart([]), []);

  const placeOrder = useCallback(
    async (delivery: ProducerDeliveryAddress, courier?: CreateProducerOrderInput['courier']): Promise<ProducerOrder> => {
      if (!producerId || !cart.length) {
        throw new Error('Dodaj produkty do koszyka.');
      }
      setOrdering(true);
      try {
        const order = await localProducersService.createProducerOrder({
          producerId,
          delivery,
          courier: courier || null,
          items: cart.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            unitPrice: Number(l.product.price),
            unit: l.product.unit,
            weight_g: l.product.weight_g,
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
    categories,
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
