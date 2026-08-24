/**
 * Klucze AsyncStorage scoped per account_key — zapobiega wyciekowi danych między kontami
 * na tym samym urządzeniu (receptury, miniatury, unlocki).
 */
import { getAccountKey } from '@/lib/accountKey';

export function tenantStorageKey(prefix: string, accountKey?: string): string {
  const ak = (accountKey || getAccountKey() || 'default').trim() || 'default';
  return `${prefix}${ak}`;
}

/**
 * Jednorazowa migracja starego klucza globalnego → klucz tenanta.
 * Legacy jest usuwany po przypisaniu do pierwszego zalogowanego konta.
 */
export async function claimLegacyStorageKey(
  getItem: (k: string) => Promise<string | null>,
  setItem: (k: string, v: string) => Promise<void>,
  removeItem: (k: string) => Promise<void>,
  legacyKey: string,
  scopedKey: string,
): Promise<string | null> {
  const scoped = await getItem(scopedKey);
  if (scoped != null) return scoped;
  const ak = (getAccountKey() || '').trim();
  if (!ak || ak === 'default') return null;
  const legacy = await getItem(legacyKey);
  if (legacy == null) return null;
  await setItem(scopedKey, legacy);
  await removeItem(legacyKey);
  return legacy;
}
