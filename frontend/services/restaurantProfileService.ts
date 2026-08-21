import { apiJsonHeaders } from '@/lib/apiHeaders';
import { fetchJson } from '@/lib/safeFetch';
import { stripAssistantOrderFooter } from '@/lib/orderEmailFooter';
import { supabase } from '@/lib/supabase';

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

/** Trwały zapis nazwy/adresu w profiles (JWT) — niezależnie od backend/migracji billing. */
async function syncLokalToAuthProfiles(profile: RestaurantProfile): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;

    const core: Record<string, string> = {
      restaurant_name: profile.company_name || '',
      shipping_street: profile.delivery_address || '',
      shipping_phone: profile.contact_phone || '',
      shipping_building: '',
      shipping_city: '',
      shipping_post_code: '',
    };
    const { error: coreErr } = await supabase.from('profiles').update(core).eq('id', uid);
    if (coreErr) {
      await supabase
        .from('profiles')
        .update({ restaurant_name: profile.company_name || '' })
        .eq('id', uid);
    }

    const withJson = {
      ...core,
      lokal_profile_json: {
        contact_email: profile.contact_email,
        contact_phone: profile.contact_phone,
        company_name: profile.company_name,
        delivery_address: profile.delivery_address,
        bank_account: profile.bank_account,
        nip: profile.nip,
        regon: profile.regon,
      },
      shipping_nip: profile.nip || null,
      shipping_regon: profile.regon || null,
    };
    await supabase.from('profiles').update(withJson).eq('id', uid);
  } catch {
    /* best-effort */
  }
}

export async function fetchRestaurantProfile(): Promise<RestaurantProfile> {
  if (!BACKEND_URL) return { ...EMPTY_RESTAURANT_PROFILE };
  const res = await fetchJson<Partial<RestaurantProfile>>(
    `${BACKEND_URL}/api/restaurant/profile`,
    { headers: await apiJsonHeaders() },
  );
  if (!res.ok) throw new Error(res.error || 'Nie udało się pobrać profilu restauracji.');
  let profile = normalize(res.data);

  if (!profile.company_name || !profile.delivery_address || !profile.bank_account) {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (uid) {
        const { data } = await supabase
          .from('profiles')
          .select(
            'restaurant_name,shipping_street,shipping_building,shipping_city,shipping_post_code,shipping_phone,shipping_nip,shipping_regon,lokal_profile_json',
          )
          .eq('id', uid)
          .maybeSingle();
        if (data) {
          const raw = data as Record<string, unknown>;
          let lokal: Partial<RestaurantProfile> = {};
          const lj = raw.lokal_profile_json;
          if (lj && typeof lj === 'object') {
            lokal = lj as Partial<RestaurantProfile>;
          }
          const street = String(raw.shipping_street || '').trim();
          const building = String(raw.shipping_building || '').trim();
          const city = String(raw.shipping_city || '').trim();
          const post = String(raw.shipping_post_code || '').trim();
          const composed =
            city || post || building
              ? [[street, building].filter(Boolean).join(' '), [post, city].filter(Boolean).join(' ')]
                  .filter(Boolean)
                  .join(', ')
              : street;
          profile = normalize({
            ...profile,
            company_name:
              profile.company_name
              || String(lokal.company_name || '').trim()
              || String(raw.restaurant_name || '').trim(),
            delivery_address:
              profile.delivery_address
              || String(lokal.delivery_address || '').trim()
              || composed,
            contact_phone:
              profile.contact_phone
              || String(lokal.contact_phone || '').trim()
              || String(raw.shipping_phone || '').trim(),
            bank_account: profile.bank_account || String(lokal.bank_account || '').trim(),
            nip:
              profile.nip
              || String(lokal.nip || '').trim()
              || String(raw.shipping_nip || '').trim(),
            regon:
              profile.regon
              || String(lokal.regon || '').trim()
              || String(raw.shipping_regon || '').trim(),
            contact_email: profile.contact_email || String(lokal.contact_email || '').trim(),
          });
        }
      }
    } catch {
      /* ignore */
    }
  }
  return profile;
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
  const optimistic = normalize({ ...EMPTY_RESTAURANT_PROFILE, ...body });
  await syncLokalToAuthProfiles(optimistic);

  const res = await fetchJson<Partial<RestaurantProfile> & { ok?: boolean }>(
    `${BACKEND_URL}/api/restaurant/profile`,
    {
      method: 'PUT',
      headers: await apiJsonHeaders(),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(res.error || 'Nie udało się zapisać danych restauracji.');
  const saved = normalize(res.data);
  const merged = normalize({
    ...optimistic,
    ...saved,
    company_name: saved.company_name || optimistic.company_name,
    delivery_address: saved.delivery_address || optimistic.delivery_address,
    bank_account: saved.bank_account || optimistic.bank_account,
    nip: saved.nip || optimistic.nip,
    regon: saved.regon || optimistic.regon,
  });
  await syncLokalToAuthProfiles(merged);
  return merged;
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
