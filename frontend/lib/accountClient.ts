import { apiJsonHeaders } from '@/lib/apiHeaders';

const BACKEND = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

export async function deleteOwnAccount(): Promise<{ ok: boolean; message: string }> {
  if (!BACKEND) return { ok: false, message: 'Brak adresu backendu.' };
  try {
    const res = await fetch(`${BACKEND}/api/account/delete`, {
      method: 'POST',
      headers: await apiJsonHeaders(),
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail || data.message || `Błąd ${res.status}`;
      return { ok: false, message: typeof detail === 'string' ? detail : 'Nie udało się usunąć konta.' };
    }
    return { ok: true, message: data.message || 'Konto usunięte.' };
  } catch {
    return { ok: false, message: 'Brak połączenia z serwerem. Spróbuj ponownie.' };
  }
}
