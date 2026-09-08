/**
 * Billing client — gastro-free: brak Checkout/portal z aplikacji (Play).
 * confirm-session zostaje dla deep-linków po płatności z ukrytej WWW.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TopupKey } from '@/lib/subscriptionCatalog';
import { requireTenantAccountKey } from '@/lib/tenantScope';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim();
const PENDING_SESSION_KEY = 'stripe_pending_checkout_session';

export type CheckoutKind = 'subscription' | 'topup';

const DISABLED_MSG =
  'Zakupy w aplikacji są wyłączone. Kredyty AI zdobywasz oglądając reklamę.';

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Account-Key': requireTenantAccountKey(),
    ...extra,
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

export async function createCheckoutAndOpen(_opts: {
  kind: CheckoutKind;
  tier_level?: 1 | 2;
  package?: TopupKey;
}): Promise<{ ok: boolean; url?: string; session_id?: string; upgraded?: boolean; message: string }> {
  return { ok: false, message: DISABLED_MSG };
}

/** Backend pyta Stripe, czy sesja jest opłacona — i dopiero wtedy dolicza kredyty. */
export async function confirmPendingCheckout(sessionIdFromUrl?: string | null): Promise<{
  ok: boolean;
  paid?: boolean;
  message: string;
}> {
  if (!BACKEND_URL) return { ok: false, message: 'Brak backendu' };
  let sessionId = (sessionIdFromUrl || '').trim();
  if (sessionId.startsWith('cs_')) {
    try {
      await AsyncStorage.setItem(PENDING_SESSION_KEY, sessionId);
    } catch { /* ignore */ }
  } else {
    try {
      sessionId = (await AsyncStorage.getItem(PENDING_SESSION_KEY)) || '';
    } catch {
      return { ok: false, message: 'Brak zapisanej sesji płatności.' };
    }
  }
  if (!sessionId) {
    return { ok: false, message: 'Brak oczekującej płatności do potwierdzenia.' };
  }
  const res = await fetch(`${BACKEND_URL}/api/billing/confirm-session`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ session_id: sessionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.paid || (data.ok && data.billing?.paid)) {
    try { await AsyncStorage.removeItem(PENDING_SESSION_KEY); } catch { /* ignore */ }
    return {
      ok: true,
      paid: true,
      message: data.message || 'Płatność potwierdzona — portfel zaktualizowany.',
    };
  }
  return {
    ok: false,
    paid: false,
    message: data.message || data.detail || 'Płatność jeszcze nie potwierdzona w Stripe.',
  };
}

export async function openBillingPortal(): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: DISABLED_MSG };
}

export async function fetchBillingStatus(): Promise<{
  stripe_configured: boolean;
  webhook_secret_set: boolean;
  mock_billing: boolean;
  stripe_key_mode: 'live' | 'test' | 'missing';
  public_api_url_ok: boolean;
}> {
  if (!BACKEND_URL) {
    return {
      stripe_configured: false,
      webhook_secret_set: false,
      mock_billing: false,
      stripe_key_mode: 'missing',
      public_api_url_ok: false,
    };
  }
  try {
    const res = await fetch(`${BACKEND_URL}/api/billing/status`, {
      headers: await authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    return {
      stripe_configured: !!data.stripe_configured,
      webhook_secret_set: !!data.webhook_secret_set,
      mock_billing: !!data.mock_billing,
      stripe_key_mode: data.stripe_key_mode || 'missing',
      public_api_url_ok: !!data.public_api_url_ok,
    };
  } catch {
    return {
      stripe_configured: false,
      webhook_secret_set: false,
      mock_billing: false,
      stripe_key_mode: 'missing',
      public_api_url_ok: false,
    };
  }
}
