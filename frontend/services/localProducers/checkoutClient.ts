/**
 * Stripe Checkout + InPost dla zamówień Lokalnych Przetwórców.
 * Bez nowych paczek — Linking.openURL (jak billing subskrypcji).
 */
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getAccountKey } from '@/lib/accountKey';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');
const PENDING_LP_SESSION_KEY = 'lp_stripe_pending_checkout_session';
const PENDING_LP_ORDER_KEY = 'lp_stripe_pending_order_id';

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Account-Key': getAccountKey(),
  };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  return headers;
}

export async function openProducerOrderCheckout(orderId: string): Promise<{
  ok: boolean;
  url?: string;
  session_id?: string;
  message: string;
}> {
  if (!BACKEND_URL) {
    return { ok: false, message: 'Brak EXPO_PUBLIC_BACKEND_URL — ustaw adres backendu.' };
  }
  const res = await fetch(`${BACKEND_URL}/api/local-producers/checkout`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      order_id: orderId,
      idempotency_key: `lp_${orderId}_${Date.now()}`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      message: typeof data.detail === 'string'
        ? data.detail
        : data.message || `Błąd płatności (${res.status})`,
    };
  }
  const url = data.url as string | undefined;
  const sessionId = data.id as string | undefined;
  if (!url) return { ok: false, message: 'Stripe nie zwrócił URL Checkout.' };

  try {
    if (sessionId) await AsyncStorage.setItem(PENDING_LP_SESSION_KEY, sessionId);
    await AsyncStorage.setItem(PENDING_LP_ORDER_KEY, orderId);
  } catch {
    /* ignore */
  }

  const can = await Linking.canOpenURL(url);
  if (!can && Platform.OS !== 'web') {
    return { ok: false, message: 'Nie można otworzyć Stripe Checkout.' };
  }
  await Linking.openURL(url);
  return {
    ok: true,
    url,
    session_id: sessionId,
    message: 'Otwarto płatność (BLIK / karta). Po powrocie potwierdź płatność w apce.',
  };
}

export async function confirmProducerOrderPayment(sessionId?: string): Promise<{
  ok: boolean;
  paid?: boolean;
  message: string;
  shipment?: unknown;
}> {
  if (!BACKEND_URL) return { ok: false, message: 'Brak backendu' };
  let sid = sessionId || null;
  if (!sid) {
    try {
      sid = await AsyncStorage.getItem(PENDING_LP_SESSION_KEY);
    } catch {
      sid = null;
    }
  }
  if (!sid) return { ok: false, message: 'Brak zapisanej sesji płatności LP.' };

  const res = await fetch(`${BACKEND_URL}/api/local-producers/confirm-payment`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ session_id: sid }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      message: typeof data.detail === 'string' ? data.detail : `Błąd potwierdzenia (${res.status})`,
    };
  }
  if (data.paid) {
    try {
      await AsyncStorage.multiRemove([PENDING_LP_SESSION_KEY, PENDING_LP_ORDER_KEY]);
    } catch {
      /* ignore */
    }
  }
  return {
    ok: !!data.ok,
    paid: !!data.paid,
    message: data.paid
      ? 'Płatność potwierdzona. Kurier InPost uruchomiony (lub stub, jeśli brak tokenu).'
      : data.reason || 'Sesja jeszcze nieopłacona.',
    shipment: data.shipment,
  };
}

export async function getLpCommerceStatus(): Promise<{
  stripe_configured?: boolean;
  inpost_configured?: boolean;
}> {
  if (!BACKEND_URL) return {};
  try {
    const res = await fetch(`${BACKEND_URL}/api/local-producers/commerce-status`, {
      headers: await authHeaders(),
    });
    return await res.json();
  } catch {
    return {};
  }
}
