/** Wyciąga czytelny komunikat błędu z odpowiedzi API. */
export async function readApiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const j = await res.json();
    const d = j?.detail ?? j?.message ?? j?.error;
    if (typeof d === 'string' && d.trim()) return d.trim();
    if (Array.isArray(d)) {
      const parts = d
        .map((x: unknown) => {
          if (typeof x === 'string') return x;
          if (x && typeof x === 'object') {
            const o = x as { msg?: string; message?: string };
            return o.msg || o.message || '';
          }
          return '';
        })
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
  } catch {
    /* ignore */
  }
  return fallback;
}
