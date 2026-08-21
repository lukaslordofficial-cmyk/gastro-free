import { apiJsonHeaders } from '@/lib/apiHeaders';
import { fetchJson } from '@/lib/safeFetch';
import { stripAssistantOrderFooter } from '@/lib/orderEmailFooter';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

export type RestaurantProfile = {
  contact_email: string;
  contact_phone: string;
  company_name: string;
  delivery_address: string;
  bank_account: string;
  nip: string;
  regon: string;
  complete?: boolean;
};

export const EMPTY_RESTAURANT_PROFILE: RestaurantProfile = {
  contact_email: '',
  contact_phone: '',
  company_name: '',
  delivery_address: '',
  bank_account: '',
  nip: '',
  regon: '',
};

function normalize(raw: Partial<RestaurantProfile> | null | undefined): RestaurantProfile {
  return {
    contact_email: (raw?.contact_email || '').trim(),
    contact_phone: (raw?.contact_phone || '').trim(),
    company_name: (raw?.company_name || '').trim(),
    delivery_address: (raw?.delivery_address || '').trim(),
    bank_account: (raw?.bank_account || '').trim(),
    nip: (raw?.nip || '').trim(),
    regon: (raw?.regon || '').trim(),
    complete: Boolean(raw?.complete),
  };
}

export async function fetchRestaurantProfile(): Promise<RestaurantProfile> {
  if (!BACKEND_URL) return { ...EMPTY_RESTAURANT_PROFILE };
  const res = await fetchJson<Partial<RestaurantProfile>>(
    `${BACKEND_URL}/api/restaurant/profile`,
    { headers: await apiJsonHeaders() },
  );
  if (!res.ok) throw new Error(res.error || 'Nie udało się pobrać profilu restauracji.');
  return normalize(res.data);
}

export async function saveRestaurantProfile(
  patch: Partial<RestaurantProfile>,
): Promise<RestaurantProfile> {
  if (!BACKEND_URL) {
    throw new Error('Brak EXPO_PUBLIC_BACKEND_URL (port 8001, nie 8081).');
  }
  const body: Record<string, string> = {};
  (['contact_email', 'contact_phone', 'company_name', 'delivery_address', 'bank_account', 'nip', 'regon'] as const).forEach(
    (k) => {
      if (patch[k] !== undefined && patch[k] !== null) {
        body[k] = String(patch[k]).trim();
      }
    },
  );
  const res = await fetchJson<Partial<RestaurantProfile> & { ok?: boolean }>(
    `${BACKEND_URL}/api/restaurant/profile`,
    {
      method: 'PUT',
      headers: await apiJsonHeaders(),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(res.error || 'Nie udało się zapisać danych restauracji.');
  return normalize(res.data);
}

/**
 * Preferuj mail restauracji z ustawień; potem e-mail konta (rejestracja);
 * na końcu fallback asystenta. Bez stopki asystenta gdy mail restauracji/konta.
 */
export async function resolveOrderEmailFrom(
  body: string,
  assistantFallback: string,
  accountEmail?: string | null,
): Promise<{ fromEmail: string; body: string }> {
  try {
    const profile = await fetchRestaurantProfile();
    const mail = (profile.contact_email || '').trim();
    if (mail) {
      return { fromEmail: mail, body: stripAssistantOrderFooter(body) };
    }
  } catch {
    /* dalej: konto / asystent */
  }
  const account = (accountEmail || '').trim();
  if (account.includes('@')) {
    return { fromEmail: account, body: stripAssistantOrderFooter(body) };
  }
  return { fromEmail: assistantFallback, body };
}
