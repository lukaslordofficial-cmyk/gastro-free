/**
 * Aktualny account_key zalogowanego użytkownika (multi-tenant).
 * Ustawiany przez AuthProvider; fallback 'default' tylko gdy brak sesji.
 */
let _accountKey = 'default';

export function accountKeyFromUserId(userId: string): string {
  return `ak_${userId.replace(/-/g, '')}`;
}

export function getAccountKey(): string {
  return _accountKey || 'default';
}

export function setAccountKey(key: string | null | undefined): void {
  const next = (key ?? '').trim();
  _accountKey = next || 'default';
}

export const FALLBACK_ACCOUNT_KEY = 'default';
