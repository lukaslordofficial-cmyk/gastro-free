/**
 * Stripe Checkout — frontend tylko otwiera sesję.
 * Kredyty/tiery dodaje backend po weryfikacji w Stripe (webhook LUB confirm-session).
 */
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { TopupKey } from '@/lib/subscriptionCatalog';
import { requireTenantAccountKey } from '@/lib/tenantScope';
import { supabase } from '@/lib/supabase';
import { secureIdempotencyKey } from '@/lib/secureId';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim();
const PENDING_SESSION_KEY = 'stripe_pending_checkout_session';

export type CheckoutKind = 'subscription' | 'topup';

function makeIdempotencyKey(prefix: string): string | undefined {
  return secureIdempotencyKey(prefix) ?? undefined;
}

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

export async function createCheckoutAndOpen(opts: {
  kind: CheckoutKind;
  tier_level?: 1 | 2;
  package?: TopupKey;
}): Promise<{ ok: boolean; url?: string; session_id?: string; upgraded?: boolean; message: string }> {
  if (!BACKEND_URL) {
    return { ok: false, message: 'Brak EXPO_PUBLIC_BACKEND_URL — ustaw adres backendu (port 8001).' };
  }
  try {
    const idem = makeIdempotencyKey(opts.kind);
    const body: Record<string, unknown> = {
      kind: opts.kind,
      tier_level: opts.tier_level,
      package: opts.package,
    };
    if (idem) body.idempotency_key = idem;

    const res = await fetch(`${BACKEND_URL}/api/billing/create-checkout-session`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail || data.message || `Błąd Stripe (${res.status})`;
      const raw = typeof detail === 'string' ? detail : JSON.stringify(detail);
      const low = raw.toLowerCase();
      const friendly =
        low.includes('already has a subscription')
        || low.includes('already subscribed')
        || low.includes('rezygnow')
          ? (
            'Masz już aktywną subskrypcję w Stripe. Nie anuluj nic ręcznie w banku — '
            + 'kliknij czerwony przycisk „Zrezygnuj z planu” w aplikacji, a potem wybierz wyższy plan '
            + '(albo spróbuj ponownie „Ulepsz plan”).'
          )
          : (low.includes('allowlist') || low.includes('przekierowania spoza'))
            ? (
              'Serwer płatności ma złą konfigurację adresu powrotu. Na Railway ustaw PUBLIC_API_URL '
              + 'na adres HTTPS API (np. …up.railway.app) — nie localhost:8081.'
            )
          : (low.includes('public_api_url') || low.includes('checkout_redirect'))
            ? (
              'Brak publicznego adresu API do powrotu ze Stripe. Ustaw na backendzie PUBLIC_API_URL '
              + '(HTTPS Railway), potem zredeployuj.'
            )
          : raw;
      return {
        ok: false,
        message: friendly,
      };
    }

    // Istniejąca subskrypcja → backend zmienił plan w Stripe bez nowego Checkout
    if (data.upgraded) {
      return {
        ok: true,
        upgraded: true,
        message:
          data.message
          || 'Plan zaktualizowany. Nie musisz rezygnować z poprzedniego — został zastąpiony.',
      };
    }

    const url = data.url as string | undefined;
    const sessionId = data.id as string | undefined;
    if (!url) return { ok: false, message: 'Stripe nie zwrócił URL Checkout.' };

    if (sessionId) {
      try {
        await AsyncStorage.setItem(PENDING_SESSION_KEY, sessionId);
      } catch { /* ignore */ }
    }

    const can = await Linking.canOpenURL(url);
    if (!can && Platform.OS !== 'web') {
      return { ok: false, message: 'Nie można otworzyć okna płatności Stripe.' };
    }
    await Linking.openURL(url);
    return {
      ok: true,
      url,
      session_id: sessionId,
      message:
        'Otwarto Stripe Checkout. Po płatności wróć do aplikacji i kliknij „Potwierdź płatność”.',
    };
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : 'Nie udało się uruchomić płatności.';
    const low = raw.toLowerCase();
    if (
      low.includes('network request failed')
      || low.includes('failed to fetch')
      || low.includes('network error')
    ) {
      return {
        ok: false,
        message:
          'Brak połączenia z serwerem płatności. Sprawdź internet i czy aplikacja ma dobry adres backendu '
          + '(EXPO_PUBLIC_BACKEND_URL — port 8001 / Railway HTTPS, nie 8081).',
      };
    }
    if (low.includes('allowlist') || low.includes('przekierowania spoza')) {
      return {
        ok: false,
        message:
          'Serwer płatności ma złą konfigurację adresu powrotu. Na Railway ustaw PUBLIC_API_URL '
          + 'na adres HTTPS API (np. …up.railway.app) — nie localhost.',
      };
    }
    return { ok: false, message: raw };
  }
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
  if (!BACKEND_URL) {
    return { ok: false, message: 'Brak EXPO_PUBLIC_BACKEND_URL' };
  }
  const res = await fetch(`${BACKEND_URL}/api/billing/portal`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, message: data.detail || data.message || `Błąd portalu (${res.status})` };
  }
  if (!data.url) return { ok: false, message: 'Brak URL portalu Stripe.' };
  await Linking.openURL(data.url);
  return { ok: true, message: 'Otwarto panel zarządzania subskrypcją Stripe.' };
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
    const r = await fetch(`${BACKEND_URL}/api/billing/status`);
    const d = await r.json();
    const mode = d.stripe_key_mode === 'live' || d.stripe_key_mode === 'test'
      ? d.stripe_key_mode
      : 'missing';
    return {
      stripe_configured: !!d.stripe_configured,
      webhook_secret_set: !!d.webhook_secret_set,
      mock_billing: !!d.mock_billing,
      stripe_key_mode: mode,
      public_api_url_ok: !!d.public_api_url_ok,
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
