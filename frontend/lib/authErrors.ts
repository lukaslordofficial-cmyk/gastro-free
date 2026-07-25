/** Mapowanie błędów Supabase Auth → komunikaty PL. */
export function polishAuthError(err: unknown): string {
  const raw =
    (err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: string }).message)
      : String(err ?? '')) || '';
  const m = raw.toLowerCase();

  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return 'Nieprawidłowy e-mail lub hasło.';
  }
  if (m.includes('email not confirmed') || m.includes('not confirmed')) {
    return 'Potwierdź adres e-mail (link z wiadomości) albo wyłącz „Confirm email” w Supabase Auth na czas bety.';
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'Konto z tym e-mailem już istnieje — zaloguj się.';
  }
  if (m.includes('password') && (m.includes('least') || m.includes('short') || m.includes('6'))) {
    return 'Hasło musi mieć co najmniej 6 znaków.';
  }
  if (m.includes('invalid email') || m.includes('unable to validate email')) {
    return 'Podaj prawidłowy adres e-mail.';
  }
  if (m.includes('rate limit') || m.includes('too many requests')) {
    return 'Zbyt wiele prób — odczekaj chwilę i spróbuj ponownie.';
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.';
  }
  if (m.includes('supabase nie jest skonfigurowany')) {
    return raw;
  }
  return raw.trim() || 'Nie udało się wykonać operacji. Spróbuj ponownie.';
}
