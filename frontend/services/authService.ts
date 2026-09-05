/**
 * authService — warstwa dostępu do danych dla autoryzacji (Clean Architecture, dekalog §II).
 *
 * DLACZEGO: cała komunikacja z Supabase Auth / tabelami `profiles`, `subscriptions`
 * oraz backendem (auto-confirm) jest zamknięta tutaj. Warstwa UI/stan (AuthContext)
 * NIE importuje `supabase` bezpośrednio — dzięki temu logikę IO można testować i
 * podmieniać niezależnie od widoku. Zachowanie 1:1 z poprzednią implementacją.
 *
 * Zasada: jeden singleton klienta Supabase (z lib/supabase) — bez tworzenia drugiego,
 * aby sesja AsyncStorage i auto-refresh tokenu miały jedno źródło prawdy.
 */
import type { AuthError, Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { fetchJson } from '@/lib/safeFetch';
import { ensureDefaultWarehouseCategories } from '@/lib/warehouseCategories';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

/** Profil tenanta (1 wiersz w tabeli `profiles`). */
export type UserProfile = {
  id: string;
  email: string | null;
  account_key: string;
  restaurant_name: string | null;
};

/** Payload upsertu profilu. */
export type ProfileUpsert = {
  id: string;
  email: string | null;
  account_key: string;
  restaurant_name: string | null;
};

export type SignUpData = { user: User | null; session: Session | null };

const PROFILE_COLUMNS = 'id, email, account_key, restaurant_name';

/** Odczyt bieżącej (persystowanej) sesji z AsyncStorage; odświeża token gdy trzeba. */
export async function getSession(): Promise<{ session: Session | null; error: AuthError | null }> {
  try {
    const { data, error } = await supabase.auth.getSession();
    return { session: data.session ?? null, error };
  } catch (e) {
    if (__DEV__) console.warn('[authService] getSession', e);
    return { session: null, error: e as AuthError };
  }
}

/**
 * Subskrypcja zmian stanu auth. Callback MUSI być synchroniczny (bez await w środku).
 * Zwraca funkcję czyszczącą — wywołaj przy unmount, by nie wyciekła subskrypcja.
 */
export function subscribeToAuthState(
  handler: (session: Session | null) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, next) => {
    handler(next);
  });
  return () => data.subscription.unsubscribe();
}

/** Logowanie e-mail + hasło. Zwraca surowy błąd (mapowany na PL w warstwie UI). */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ error: AuthError | null; user: User | null }> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error, user: null };
    const user = data.user ?? data.session?.user ?? null;
    // Wymagamy kliknięcia linku weryfikacyjnego — bez email_confirmed_at nie wpuszczamy.
    if (user && !user.email_confirmed_at) {
      await supabase.auth.signOut();
      return {
        error: {
          name: 'AuthError',
          message: 'Email not confirmed',
          status: 400,
        } as AuthError,
        user: null,
      };
    }
    return { error: null, user };
  } catch (e) {
    if (__DEV__) console.warn('[authService] signIn', e);
    return { error: e as AuthError, user: null };
  }
}

/** Rejestracja e-mail + hasło (+ dane lokalu / dostawy w metadanych). */
export async function signUp(
  email: string,
  password: string,
  shipping?: {
    restaurantName?: string;
    phone?: string;
    street?: string;
    building?: string;
    city?: string;
    postCode?: string;
    nip?: string;
    regon?: string;
    contactEmail?: string;
  },
): Promise<{ data: SignUpData; error: AuthError | null }> {
  try {
    const { EMAIL_VERIFY_REDIRECT } = await import('@/lib/authVerify');
    const restaurantName = (shipping?.restaurantName ?? '').trim() || null;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          restaurant_name: restaurantName,
          shipping_phone: (shipping?.phone ?? '').trim() || null,
          shipping_street: (shipping?.street ?? '').trim() || null,
          shipping_building: (shipping?.building ?? '').trim() || null,
          shipping_city: (shipping?.city ?? '').trim() || null,
          shipping_post_code: (shipping?.postCode ?? '').trim() || null,
          shipping_nip: (shipping?.nip ?? '').replace(/\D/g, '') || null,
          shipping_regon: (shipping?.regon ?? '').replace(/\D/g, '') || null,
        },
        emailRedirectTo: EMAIL_VERIFY_REDIRECT,
      },
    });
    return { data: { user: data.user, session: data.session }, error };
  } catch (e) {
    if (__DEV__) console.warn('[authService] signUp', e);
    return { data: { user: null, session: null }, error: e as AuthError };
  }
}

/** Wylogowanie — błędy celowo pochłaniane (stan i tak czyścimy po stronie UI). */
export async function signOut(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore */
  }
}

/**
 * Auto-confirm przez backend (Admin API) — tylko closed beta gdy
 * `AUTO_CONFIRM_EMAIL=true`. W sklepie endpoint zwraca 403; tu false.
 */
export async function autoConfirmUser(userId: string, email?: string): Promise<boolean> {
  if (!userId || !BACKEND_URL) return false;
  try {
    const conf = await fetchJson(`${BACKEND_URL}/api/auth/auto-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, email: (email ?? '').trim() }),
    });
    return conf.ok;
  } catch (e) {
    if (__DEV__) console.warn('[authService] autoConfirm', e);
    return false;
  }
}

/**
 * Reset hasła — mail z Supabase, redirect na landing (nie deep link).
 */
export async function resetPasswordForEmail(email: string): Promise<{ error: AuthError | null }> {
  try {
    const { EMAIL_PASSWORD_RESET_REDIRECT } = await import('@/lib/authVerify');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: EMAIL_PASSWORD_RESET_REDIRECT,
    });
    return { error };
  } catch (e) {
    if (__DEV__) console.warn('[authService] resetPassword', e);
    return { error: e as AuthError };
  }
}

/**
 * Powitanie + link weryfikacyjny (Resend → kontakt@gastromanager.org).
 * Backend dodatkowo force-unconfirm (gdy Confirm email OFF) i zapisuje shipping do profiles.
 */
export async function sendWelcomeEmail(input: {
  userId: string;
  email: string;
  restaurantName?: string | null;
  redirectTo?: string | null;
  forceUnconfirm?: boolean;
  shipping?: {
    phone?: string;
    street?: string;
    building?: string;
    city?: string;
    postCode?: string;
    nip?: string;
    regon?: string;
    contactEmail?: string;
  } | null;
}): Promise<boolean> {
  if (!input.userId || !input.email || !BACKEND_URL) return false;
  try {
    const ship = input.shipping;
    const conf = await fetchJson(`${BACKEND_URL}/api/auth/welcome-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: input.userId,
        email: input.email.trim().toLowerCase(),
        restaurant_name: (input.restaurantName ?? '').trim() || null,
        redirect_to: (input.redirectTo ?? '').trim() || null,
        force_unconfirm: input.forceUnconfirm !== false,
        shipping: ship
          ? {
              phone: (ship.phone ?? '').trim() || null,
              street: (ship.street ?? '').trim() || null,
              building: (ship.building ?? '').trim() || null,
              city: (ship.city ?? '').trim() || null,
              post_code: (ship.postCode ?? '').trim() || null,
              nip: (ship.nip ?? '').replace(/\D/g, '') || null,
              regon: (ship.regon ?? '').replace(/\D/g, '') || null,
              contact_email: (ship.contactEmail ?? input.email).trim().toLowerCase() || null,
            }
          : null,
      }),
    });
    return conf.ok;
  } catch (e) {
    if (__DEV__) console.warn('[authService] sendWelcomeEmail', e);
    return false;
  }
}

/** Pobiera profil tenanta. null gdy brak wiersza lub tabela jeszcze nie istnieje. */
export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      // Tabela jeszcze nie istnieje — fallback do account_key z uid.
      if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        return null;
      }
      if (__DEV__) console.warn('[authService] profiles:', error.message);
      return null;
    }
    if (!data) return null;
    return data as unknown as UserProfile;
  } catch (e) {
    if (__DEV__) console.warn('[authService] fetchProfile', e);
    return null;
  }
}

/** Upsert profilu (onConflict: id). Zwraca zapisany wiersz lub błąd. */
export async function upsertProfile(
  row: ProfileUpsert,
): Promise<{ data: UserProfile | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .upsert(row, { onConflict: 'id' })
      .select(PROFILE_COLUMNS)
      .single();
    return {
      data: data ? (data as unknown as UserProfile) : null,
      error: error?.message ?? null,
    };
  } catch (e) {
    if (__DEV__) console.warn('[authService] upsertProfile', e);
    return { data: null, error: e instanceof Error ? e.message : 'upsert_failed' };
  }
}

/**
 * Seed portfela/subskrypcji dla nowego tenanta.
 * DLACZEGO tak: trigger SQL zwykle tworzy wiersz — tu bezpieczny fallback,
 * ignorujący konflikt (duplicate). Free + 100 kredytów + 30-dniowy trial Premium.
 */
export async function seedSubscription(accountKey: string): Promise<void> {
  try {
    const key = (accountKey || '').trim();
    if (!key || key === 'default') return;
    const trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('subscriptions').insert({
      account_key: key,
      tier_level: 0,
      credits_balance: 100,
      status: 'active',
      free_starter_claimed: true,
      trial_ends_at: trialEnds,
    });
    if (error && !String(error.message || '').toLowerCase().includes('duplicate')) {
      if (__DEV__) console.warn('[authService] subscriptions seed:', error.message);
    }
  } catch (e) {
    if (__DEV__) console.warn('[authService] seedSubscription', e);
  }
}

/** Seed domyślnych (pustych) kategorii magazynowych per tenant. */
export async function seedWarehouseCategories(accountKey: string): Promise<void> {
  try {
    const r = await ensureDefaultWarehouseCategories(supabase, accountKey);
    if (r.error && __DEV__) console.warn('[authService] warehouse category seed', r.error);
  } catch (e) {
    if (__DEV__) console.warn('[authService] seedWarehouseCategories', e);
  }
}
