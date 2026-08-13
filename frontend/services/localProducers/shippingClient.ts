/**
 * Status / tracking przesyłki LP (Furgonetka) — backend Railway.
 */
import { getAccountKey } from '@/lib/accountKey';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

export type LpShippingView = {
  ok: boolean;
  order_id?: string;
  package_id?: string | null;
  courier_name?: string | null;
  tracking?: string | null;
  tracking_state?: string | null;
  shipment_status?: string | null;
  pickup_date?: string | null;
  pickup_min_time?: string | null;
  pickup_max_time?: string | null;
  pickup_label?: string | null;
  parcel_weight_kg?: number | null;
  shipping_error?: string | null;
  label_ready?: boolean;
  timeline_index?: number;
  events?: Array<{
    state?: string;
    status?: string;
    datetime?: string | null;
    location?: string | null;
  }>;
  message?: string;
};

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

export async function fetchProducerOrderShipping(
  orderId: string,
  opts?: { refresh?: boolean },
): Promise<LpShippingView> {
  const oid = (orderId || '').trim();
  if (!oid) return { ok: false, message: 'Brak ID zamówienia.' };
  if (!BACKEND_URL) {
    return { ok: false, message: 'Brak EXPO_PUBLIC_BACKEND_URL.' };
  }
  try {
    const url = opts?.refresh
      ? `${BACKEND_URL}/api/local-producers/orders/${encodeURIComponent(oid)}/sync-tracking`
      : `${BACKEND_URL}/api/local-producers/orders/${encodeURIComponent(oid)}/shipping`;
    const res = await fetch(url, {
      method: opts?.refresh ? 'POST' : 'GET',
      headers: await authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        message:
          typeof data.detail === 'string'
            ? data.detail
            : `Nie udało się pobrać statusu dostawy (${res.status})`,
      };
    }
    return { ok: true, ...data };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Błąd sieci przy statusie dostawy.',
    };
  }
}
