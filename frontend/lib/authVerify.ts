/**
 * Stały deep link po kliknięciu weryfikacji e-mail.
 * NIE używamy Linking.createURL z Metro/localhost — w mailu musi być scheme aplikacji.
 */
export const EMAIL_VERIFY_REDIRECT = 'gastromanager://auth/verified';

export function isEmailConfirmed(user: { email_confirmed_at?: string | null } | null | undefined): boolean {
  return !!(user?.email_confirmed_at);
}
