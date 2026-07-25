import { backendTenantHeaders } from '@/lib/tenantScope';
import { supabase } from '@/lib/supabase';

/** JSON + tenant + opcjonalny Bearer JWT do wywołań backendu. */
export async function apiJsonHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers = backendTenantHeaders({
    'Content-Type': 'application/json',
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
