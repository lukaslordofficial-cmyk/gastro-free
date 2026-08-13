/**
 * Stripe Checkout + InPost dla zamówień Lokalnych Przetwórców.
 * Po Stripe: deep link myapp://lp/success (przez HTML na API) → szybki komunikat + confirm.
 */
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { getAccountKey } from '@/lib/accountKey';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');
const PENDING_LP_SESSION_KEY = 'lp_stripe_pending_checkout_session';
const PENDING_LP_ORDER_KEY = 'lp_stripe_pending_order_id';
const LAST_SHOWN_PAID_SESSION_KEY = 'lp_stripe_last_shown_paid_session';

export const LP_PAID_TITLE = 'Opłacono';
export const LP_PAID_MESSAGE =
  'Płatność potwierdzona. Lokalny przetwórca wkrótce otrzyma pieniądze i nada do ciebie paczkę z kurierem.';

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

export async function openProducerOrderCheckout(
  orderId: string,
  opts?: { onOpening?: () => void },
): Promise<{
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
      app_return_url: Linking.createURL('/lp/success'),
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
  try {
    opts?.onOpening?.();
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 120));
  await Linking.openURL(url);
  return {
    ok: true,
    url,
    session_id: sessionId,
    message: 'Otwarto płatność Stripe (BLIK / karta).',
  };
}

export async function confirmProducerOrderPayment(sessionId?: string): Promise<{
  ok: boolean;
  paid?: boolean;
  message: string;
  session_id?: string;
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
      session_id: sid,
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
    session_id: sid,
    message: data.paid
      ? (typeof data.message === 'string' && data.message.trim()
        ? data.message
        : LP_PAID_MESSAGE)
      : data.reason || 'Sesja jeszcze nieopłacona.',
    shipment: data.shipment,
  };
}

/** Parsuje myapp://lp/success?session_id=cs_… */
export function parseLpBillingDeepLink(url: string | null | undefined): {
  kind: 'success' | 'cancel' | null;
  sessionId?: string;
} {
  if (!url) return { kind: null };
  const lower = url.toLowerCase();
  // Także billing-return z API (gdy OS otworzy http zamiast deep linku)
  const isSuccess =
    lower.includes('lp/success')
    || (lower.includes('/success') && (lower.includes('session_id=') || lower.includes('lp')))
    || (lower.includes('billing-return') && lower.includes('status=success'));
  const isCancel =
    lower.includes('lp/cancel')
    || (lower.includes('/cancel') && lower.includes('lp'))
    || (lower.includes('billing-return') && lower.includes('status=cancel'));
  if (!isSuccess && !isCancel) return { kind: null };
  const kind = isSuccess ? 'success' : 'cancel';
  let sessionId: string | undefined;
  try {
    const parsed = Linking.parse(url);
    const q = parsed.queryParams || {};
    const raw = q.session_id ?? q.sessionId;
    if (typeof raw === 'string' && raw.startsWith('cs_')) sessionId = raw;
  } catch {
    const m = url.match(/session_id=(cs_[A-Za-z0-9_]+)/);
    if (m) sessionId = m[1];
  }
  return { kind, sessionId };
}

let confirmInFlight: Promise<{
  ok: boolean;
  paid?: boolean;
  message: string;
  session_id?: string;
}> | null = null;

async function markPaidAlertShown(sessionId: string): Promise<boolean> {
  try {
    const last = await AsyncStorage.getItem(LAST_SHOWN_PAID_SESSION_KEY);
    if (last === sessionId) return false;
    await AsyncStorage.setItem(LAST_SHOWN_PAID_SESSION_KEY, sessionId);
    return true;
  } catch {
    return true;
  }
}

/**
 * Natychmiastowy komunikat po deep linku success (nie czeka na Furgonetkę/SMS).
 * Confirm leci w tle.
 */
export async function claimOptimisticLpPaidAlert(sessionId?: string | null): Promise<{
  shouldShow: boolean;
  session_id?: string;
  message: string;
}> {
  let sid = sessionId || null;
  if (!sid) {
    try {
      sid = await AsyncStorage.getItem(PENDING_LP_SESSION_KEY);
    } catch {
      sid = null;
    }
  }
  if (!sid) return { shouldShow: false, message: LP_PAID_MESSAGE };
  const shouldShow = await markPaidAlertShown(sid);
  return { shouldShow, session_id: sid, message: LP_PAID_MESSAGE };
}

/**
 * Potwierdza pending LP po powrocie do apki (deep link / AppState).
 */
export async function tryConfirmPendingLpPayment(opts?: {
  sessionId?: string;
  forceShow?: boolean;
}): Promise<{
  ok: boolean;
  paid?: boolean;
  message: string;
  shouldShowPaidAlert: boolean;
  session_id?: string;
}> {
  if (confirmInFlight) {
    const r = await confirmInFlight;
    return { ...r, shouldShowPaidAlert: false };
  }
  confirmInFlight = (async () => {
    const conf = await confirmProducerOrderPayment(opts?.sessionId);
    return conf;
  })();
  try {
    const conf = await confirmInFlight;
    if (!conf.paid || !conf.session_id) {
      return { ...conf, shouldShowPaidAlert: false };
    }
    let shouldShow = true;
    if (!opts?.forceShow) {
      shouldShow = await markPaidAlertShown(conf.session_id);
    } else {
      try {
        await AsyncStorage.setItem(LAST_SHOWN_PAID_SESSION_KEY, conf.session_id);
      } catch {
        /* ignore */
      }
    }
    return { ...conf, shouldShowPaidAlert: shouldShow };
  } finally {
    confirmInFlight = null;
  }
}

export function subscribeLpAppStateConfirm(
  onResult: (r: Awaited<ReturnType<typeof tryConfirmPendingLpPayment>>) => void,
): () => void {
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    void (async () => {
      try {
        const pending = await AsyncStorage.getItem(PENDING_LP_SESSION_KEY);
        if (!pending) return;
        // Szybki komunikat przy powrocie z przeglądarki (zainstalowana apka).
        const optimistic = await claimOptimisticLpPaidAlert(pending);
        if (optimistic.shouldShow) {
          onResult({
            ok: true,
            paid: true,
            message: optimistic.message,
            shouldShowPaidAlert: true,
            session_id: optimistic.session_id,
          });
        }
        const r = await tryConfirmPendingLpPayment({ sessionId: pending });
        if (r.paid && r.shouldShowPaidAlert) onResult(r);
      } catch {
        /* ignore */
      }
    })();
  });
  return () => sub.remove();
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
