/**
 * Adres paczki restauracji — wczytanie z Supabase i pola formularza.
 */
import { useCallback, useEffect, useState } from 'react';
import * as localProducersService from '@/services/localProducers';
import type { ProducerDeliveryAddress } from '@/types/localProducers';

function digitsOnly(v: string): string {
  return String(v || '').replace(/\D/g, '');
}

export function useRestaurantShippingForm() {
  const [shipName, setShipName] = useState('');
  const [shipPhone, setShipPhone] = useState('');
  const [shipStreet, setShipStreet] = useState('');
  const [shipBuilding, setShipBuilding] = useState('');
  const [shipCity, setShipCity] = useState('');
  const [shipPost, setShipPost] = useState('');
  const [shipNip, setShipNip] = useState('');
  const [shipRegon, setShipRegon] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const hydrate = useCallback(async () => {
    try {
      const saved = await localProducersService.getRestaurantShippingProfile();
      if (saved) {
        setShipName((v) => v || saved.name);
        setShipPhone((v) => v || saved.phone);
        setShipStreet((v) => v || saved.street);
        setShipBuilding((v) => v || saved.building_number);
        setShipCity((v) => v || saved.city);
        setShipPost((v) => v || saved.post_code);
        setShipNip((v) => v || String(saved.nip || '').trim());
        setShipRegon((v) => v || String(saved.regon || '').trim());
      }
    } catch (e) {
      if (__DEV__) console.warn('[shipping form]', e);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const toDelivery = useCallback((): ProducerDeliveryAddress => ({
    name: shipName.trim(),
    phone: shipPhone.trim(),
    street: shipStreet.trim(),
    building_number: shipBuilding.trim() || '1',
    city: shipCity.trim(),
    post_code: shipPost.trim(),
    nip: digitsOnly(shipNip) || null,
    regon: digitsOnly(shipRegon) || null,
  }), [shipName, shipPhone, shipStreet, shipBuilding, shipCity, shipPost, shipNip, shipRegon]);

  const missingMessage = useCallback((): string | null => {
    const d = toDelivery();
    if (!d.name) return 'Podaj nazwę restauracji — na nią jedzie paczka.';
    if (!d.phone || !d.street || !d.city || !d.post_code) {
      return 'Uzupełnij telefon, ulicę, miasto i kod pocztowy — kurier musi wiedzieć, dokąd jechać.';
    }
    if (d.nip && d.nip.length !== 10) {
      return 'NIP powinien mieć 10 cyfr (albo zostaw pole puste).';
    }
    if (d.regon && d.regon.length !== 9 && d.regon.length !== 14) {
      return 'REGON powinien mieć 9 lub 14 cyfr (albo zostaw pole puste).';
    }
    return null;
  }, [toDelivery]);

  return {
    shipName,
    setShipName,
    shipPhone,
    setShipPhone,
    shipStreet,
    setShipStreet,
    shipBuilding,
    setShipBuilding,
    shipCity,
    setShipCity,
    shipPost,
    setShipPost,
    shipNip,
    setShipNip,
    shipRegon,
    setShipRegon,
    hydrated,
    hydrate,
    toDelivery,
    missingMessage,
  };
}
