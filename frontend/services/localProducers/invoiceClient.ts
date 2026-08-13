/**
 * Rachunek / faktura LP — strumień z API (nie otwieranie pliku z dysku / signed URL).
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getAccountKey } from '@/lib/accountKey';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'X-Account-Key': getAccountKey(),
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

function filenameFromDisposition(header: string | null, fallback: string): string {
  const raw = header || '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(raw);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/"/g, ''));
    } catch {
      /* keep fallback */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(raw);
  return (plain?.[1] || fallback).trim();
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
      { method: 'GET', headers: await authHeaders({ 'Content-Type': 'application/json' }) },
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

/**
 * Pobiera PDF z GET /api/local-producers/orders/{id}/invoice
 * (wygenerowany w locie albo z prywatnego Storage).
 */
export async function downloadProducerOrderInvoice(orderId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const oid = (orderId || '').trim();
  if (!oid) return { ok: false, message: 'Brak ID zamówienia.' };
  if (!BACKEND_URL) {
    return { ok: false, message: 'Brak EXPO_PUBLIC_BACKEND_URL — ustaw adres backendu.' };
  }

  const endpoint = `${BACKEND_URL}/api/local-producers/orders/${encodeURIComponent(oid)}/invoice`;
  const fallbackName = `rachunek-${oid.slice(0, 8)}.pdf`;
  const headers = await authHeaders({ Accept: 'application/pdf' });

  try {
    if (Platform.OS === 'web') {
      const res = await fetch(endpoint, { method: 'GET', headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return {
          ok: false,
          message:
            typeof data.detail === 'string'
              ? data.detail
              : data.message || `Nie udało się pobrać rachunku (${res.status})`,
        };
      }
      const blob = await res.blob();
      const name = filenameFromDisposition(res.headers.get('content-disposition'), fallbackName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return { ok: true, message: 'OK' };
    }

    const dest = `${FileSystem.cacheDirectory || ''}${fallbackName}`;
    const result = await FileSystem.downloadAsync(endpoint, dest, { headers });
    if (result.status < 200 || result.status >= 300) {
      let detail = `Nie udało się pobrać rachunku (${result.status})`;
      try {
        const txt = await FileSystem.readAsStringAsync(result.uri);
        const data = JSON.parse(txt);
        if (typeof data.detail === 'string') detail = data.detail;
      } catch {
        /* ignore */
      }
      return { ok: false, message: detail };
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'Pobierz rachunek',
      });
    }
    return { ok: true, message: 'OK' };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Błąd sieci przy pobieraniu rachunku.',
    };
  }
}
