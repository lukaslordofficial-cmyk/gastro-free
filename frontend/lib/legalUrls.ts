const BACKEND = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

export function privacyPolicyUrl(): string | null {
  return BACKEND ? `${BACKEND}/privacy` : null;
}

export function termsUrl(): string | null {
  return BACKEND ? `${BACKEND}/terms` : null;
}
