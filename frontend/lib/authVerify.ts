/**
 * Redirect po kliknięciu linku weryfikacyjnego w e-mailu.
 * HTTPS na gastromanager.org — NIE localhost / Metro Linking.createURL.
 */
export const EMAIL_VERIFY_REDIRECT = 'https://gastromanager.org/auth/verified';

export function isEmailConfirmed(user: { email_confirmed_at?: string | null } | null | undefined): boolean {
  return !!(user?.email_confirmed_at);
}

/** Dane dostawy zbierane przy rejestracji (te same kolumny co LP / profiles.shipping_*). */
export type RegisterShippingInput = {
  restaurantName: string;
  phone: string;
  street: string;
  building: string;
  city: string;
  postCode: string;
  nip?: string;
  regon?: string;
  contactEmail?: string;
};

export function composeDeliveryAddress(s: {
  street: string;
  building?: string;
  postCode: string;
  city: string;
}): string {
  const line1 = [s.street.trim(), (s.building || '').trim()].filter(Boolean).join(' ');
  const line2 = [s.postCode.trim(), s.city.trim()].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join(', ');
}

export function validateRegisterShipping(s: RegisterShippingInput): string | null {
  if (!s.restaurantName.trim()) return 'Podaj nazwę restauracji / lokalu.';
  if (!s.phone.trim()) return 'Podaj telefon kontaktowy do dostaw.';
  if (!s.street.trim()) return 'Podaj ulicę (adres dostawy).';
  if (!s.city.trim()) return 'Podaj miasto.';
  const post = s.postCode.trim();
  if (!post || !/^\d{2}-\d{3}$/.test(post)) {
    return 'Podaj kod pocztowy w formacie 00-000.';
  }
  const nip = (s.nip || '').replace(/\D/g, '');
  if (nip && nip.length !== 10) return 'NIP powinien mieć 10 cyfr (albo zostaw puste).';
  const regon = (s.regon || '').replace(/\D/g, '');
  if (regon && regon.length !== 9 && regon.length !== 14) {
    return 'REGON powinien mieć 9 lub 14 cyfr (albo zostaw puste).';
  }
  return null;
}
