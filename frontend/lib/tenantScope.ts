/**
 * Multi-tenant helpers — każdy użytkownik widzi tylko swój account_key.
 */
import { getAccountKey } from '@/lib/accountKey';

export function currentAccountKey(): string {
  return getAccountKey();
}

/** Payload insert z account_key bieżącego użytkownika. */
export function withAccountKey<T extends Record<string, unknown>>(row: T): T & { account_key: string } {
  return { ...row, account_key: getAccountKey() };
}

export function withAccountKeyMany<T extends Record<string, unknown>>(
  rows: T[],
): Array<T & { account_key: string }> {
  const key = getAccountKey();
  return rows.map((r) => ({ ...r, account_key: key }));
}

/** Nagłówki do backendu FastAPI (Jarvis / skany / Łowca). */
export function backendTenantHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'X-Account-Key': getAccountKey(),
    ...(extra ?? {}),
  };
}
