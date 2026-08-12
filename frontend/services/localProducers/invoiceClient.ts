/**
 * Podpisany URL faktury LP (Storage ref → HTTPS).
 */
import { getAccountKey } from '@/lib/accountKey';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

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

/** Czy surowy ref da się otworzyć bez API (tylko prawdziwy http/https). */
export function isDirectHttpInvoiceUrl(raw: string): boolean {
  const u = (raw || '').trim().toLowerCase();
  return u.startsWith('https://') || u.startsWith('http://');
}

export async function fetchProducerOrderInvoiceUrl(orderId: string): Promise<{
  ok: boolean;
  url?: string;
  message: string;
}> {
  const oid = (orderId || '').trim();
  if (!oid) return { ok: false, message: 'Brak ID zamówienia.' };
  if (!BACKEND_URL) {
    return { ok: false, message: 'Brak EXPO_PUBLIC_BACKEND_URL — ustaw adres backendu.' };
  }
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/local-producers/orders/${encodeURIComponent(oid)}/invoice-url`,
      { method: 'GET', headers: await authHeaders() },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        message:
          typeof data.detail === 'string'
            ? data.detail
            : data.message || `Nie udało się pobrać faktury (${res.status})`,
      };
    }
    const url = typeof data.url === 'string' ? data.url.trim() : '';
    if (!url) return { ok: false, message: 'Backend nie zwrócił URL faktury.' };
    return { ok: true, url, message: 'OK' };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Błąd sieci przy pobieraniu faktury.',
    };
  }
}
