import { backendTenantHeaders, requireTenantAccountKey } from '@/lib/tenantScope';
import { supabase } from '@/lib/supabase';

async function withAuthTenantHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  // Wymuś prawdziwy account_key zalogowanego usera (nigdy „default” przy sesji).
  requireTenantAccountKey();
  const headers = backendTenantHeaders({
    Accept: 'application/json',
    ...(extra ?? {}),
  });
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  return headers;
}

/** JSON + tenant + Bearer JWT do wywołań backendu. */
export async function apiJsonHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  return withAuthTenantHeaders({
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  });
}

/** Multipart (FormData) + tenant + Bearer JWT — skany dokumentów / menu / voice. */
export async function apiMultipartHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  // Nie ustawiaj Content-Type — fetch/RN doda boundary dla FormData.
  return withAuthTenantHeaders(extra);
}
