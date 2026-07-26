/**
 * Multi-tenant helpers — każdy użytkownik widzi tylko swój account_key.
 */
import { getAccountKey } from '@/lib/accountKey';

export function currentAccountKey(): string {
  return getAccountKey();
}

/** true gdy klucz wygląda na prawdziwy tenant (nie legacy demo). */
export function isRealAccountKey(key: string | null | undefined): boolean {
  const k = (key ?? '').trim();
  return !!k && k !== 'default';
}

/**
 * Rzuca, gdy brak prawdziwego account_key — chroni przed zapisem na shared „default”.
 */
export function requireTenantAccountKey(): string {
  const key = getAccountKey();
  if (!isRealAccountKey(key)) {
    throw new Error(
      'Brak aktywnego konta (account_key). Zaloguj się ponownie i spróbuj jeszcze raz.',
    );
  }
  return key;
}

/** Payload insert z account_key bieżącego użytkownika. */
export function withAccountKey<T extends Record<string, unknown>>(row: T): T & { account_key: string } {
  return { ...row, account_key: requireTenantAccountKey() };
}

export function withAccountKeyMany<T extends Record<string, unknown>>(
  rows: T[],
): Array<T & { account_key: string }> {
  const key = requireTenantAccountKey();
  return rows.map((r) => ({ ...r, account_key: key }));
}

/** Nagłówki do backendu FastAPI (Jarvis / skany / Łowca). */
export function backendTenantHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'X-Account-Key': getAccountKey(),
    ...(extra ?? {}),
  };
}
