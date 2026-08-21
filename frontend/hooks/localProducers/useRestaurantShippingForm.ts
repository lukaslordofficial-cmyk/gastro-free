/**
 * Adres paczki restauracji — wczytanie z Supabase i pola formularza.
 * Uzupełnia puste pola z „Dane lokalu” (restaurant_profile).
 */
import { useCallback, useEffect, useState } from 'react';
import * as localProducersService from '@/services/localProducers';
import type { ProducerDeliveryAddress } from '@/types/localProducers';
import { fetchRestaurantProfile } from '@/services/restaurantProfileService';

function digitsOnly(v: string): string {
  return String(v || '').replace(/\D/g, '');
}

/** Prosty rozbiór „ul. X 12, 00-001 Miasto” / „ul. X, kod, miasto”. */
function parseDeliveryAddress(raw: string): {
  street: string;
  building: string;
  post: string;
  city: string;
} {
  const s = (raw || '').trim();
  if (!s) return { street: '', building: '', post: '', city: '' };
  const postMatch = s.match(/\b(\d{2}-\d{3})\b/);
  const post = postMatch?.[1] || '';
  const rest = post ? s.replace(post, ',').replace(/,\s*,/g, ',') : s;
  const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
  let street = '';
  let building = '';
  let city = '';
  if (parts.length >= 2) {
    const streetPart = parts[0];
    city = parts[parts.length - 1].replace(post, '').trim() || parts[parts.length - 1];
    const bm = streetPart.match(/^(.*?)[\s]+(\d+[A-Za-z/-]*)$/);
    if (bm) {
      street = bm[1].trim();
      building = bm[2].trim();
    } else {
      street = streetPart;
    }
  } else {
    street = s;
  }
  return { street, building, post, city };
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
      // Fallback: Dane lokalu z Ustawień
      try {
        const rp = await fetchRestaurantProfile();
        const parsed = parseDeliveryAddress(rp.delivery_address || '');
        setShipName((v) => v || (rp.company_name || '').trim());
        setShipPhone((v) => v || (rp.contact_phone || '').trim());
        setShipStreet((v) => v || parsed.street);
        setShipBuilding((v) => v || parsed.building);
        setShipCity((v) => v || parsed.city);
        setShipPost((v) => v || parsed.post);
        setShipNip((v) => v || (rp.nip || '').trim());
        setShipRegon((v) => v || (rp.regon || '').trim());
      } catch {
        /* brak profilu — OK */
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
