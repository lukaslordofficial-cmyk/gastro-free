/**
 * Bezpieczny fetch JSON — wykrywa HTML (zły port / Expo zamiast API)
 * i zwraca czytelny komunikat zamiast "JSON Parse error: Unexpected character: <".
 */
export async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string; raw?: string }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Brak połączenia z serwerem';
    return {
      ok: false,
      status: 0,
      error: `${msg}. Sprawdź, czy backend działa i czy EXPO_PUBLIC_BACKEND_URL ma port 8001 (nie 8081).`,
    };
  }

  const text = await res.text();
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return { ok: false, status: res.status, error: `Pusta odpowiedź serwera (HTTP ${res.status}).` };
  }
  if (trimmed.startsWith('<') || trimmed.toLowerCase().startsWith('<!doctype')) {
    return {
      ok: false,
      status: res.status,
      error:
        'Serwer zwrócił stronę HTML zamiast danych API. '
        + 'Najczęściej zły port w EXPO_PUBLIC_BACKEND_URL — ustaw np. http://TWOJE_IP:8001 '
        + '(uvicorn), a nie :8081 (Expo).',
      raw: trimmed.slice(0, 120),
    };
  }

  let data: T;
  try {
    data = JSON.parse(trimmed) as T;
  } catch {
    return {
      ok: false,
      status: res.status,
      error: `Odpowiedź nie jest prawidłowym JSON (HTTP ${res.status}).`,
      raw: trimmed.slice(0, 120),
    };
  }

  if (!res.ok) {
    const detail = (data as { detail?: string })?.detail;
    return {
      ok: false,
      status: res.status,
      error: typeof detail === 'string' ? detail : `HTTP ${res.status}`,
    };
  }

  return { ok: true, status: res.status, data };
}
