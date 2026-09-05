/**
 * AuthContext — warstwa STANU/orkiestracji autoryzacji (dekalog §II).
 *
 * DLACZEGO: ten plik nie wykonuje już żadnych zapytań do Supabase. Całe IO żyje
 * w `@/services/authService`. Tutaj zostaje wyłącznie stan React + orkiestracja
 * (kolejność kroków, ustawianie account_key, mapowanie błędów na PL dla UI).
 * Publiczne API hooka `useAuth()` jest identyczne jak wcześniej — ekrany
 * login/register działają bez zmian.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '@/lib/supabase';
import { setAccountKey, getAccountKey, accountKeyFromUserId } from '@/lib/accountKey';
import { polishAuthError } from '@/lib/authErrors';
import * as authService from '@/services/authService';
import type { UserProfile } from '@/services/authService';
import { resetMenuThumbCacheMemory } from '@/lib/menuThumbCache';
import { resetDishCustomImagesMemory } from '@/lib/dishCustomImages';
import { resetProductCustomImagesMemory } from '@/lib/productCustomImages';
import type { RegisterShippingInput } from '@/lib/authVerify';
import { validateRegisterShipping } from '@/lib/authVerify';

export type { UserProfile };

type AuthContextValue = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  accountKey: string;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  signUp: (
    email: string,
    password: string,
    shipping: RegisterShippingInput,
  ) => Promise<{ ok: true; needsEmailConfirm?: boolean } | { ok: false; message: string }>;
  resetPassword: (email: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  /**
   * Zapewnia lokalny profil tenanta. Orkiestracja: fetch → (fallback) upsert +
   * seed subskrypcji. account_key ustawiany synchronicznie, zanim await się
   * skończy — by skany/subskrypcja nie trafiły na współdzielone „default".
   */
  const ensureLocalProfile = useCallback(async (user: User): Promise<UserProfile> => {
    const existing = await authService.fetchProfile(user.id);
    if (existing?.account_key) return existing;

    const account_key = accountKeyFromUserId(user.id);
    setAccountKey(account_key);
    const restaurant_name =
      (user.user_metadata?.restaurant_name as string | undefined)?.trim() || null;

    const { data, error } = await authService.upsertProfile({
      id: user.id,
      email: user.email ?? null,
      account_key,
      restaurant_name,
    });

    if (!error && data) {
      await authService.seedSubscription(account_key);
      return data;
    }

    return { id: user.id, email: user.email ?? null, account_key, restaurant_name };
  }, []);

  const applySession = useCallback(
    async (next: Session | null) => {
      setSession(next);
      if (!next?.user) {
        setProfile(null);
        setAccountKey('default');
        resetMenuThumbCacheMemory();
        resetDishCustomImagesMemory();
        resetProductCustomImagesMemory();
        return;
      }
      // Sesja bez potwierdzonego e-maila — wyloguj (np. stary persist po rejestracji).
      if (!next.user.email_confirmed_at) {
        await authService.signOut();
        setSession(null);
        setProfile(null);
        setAccountKey('default');
        resetMenuThumbCacheMemory();
        resetDishCustomImagesMemory();
        resetProductCustomImagesMemory();
        return;
      }
      // Synchronicznie — zanim await — żeby SubscriptionContext / skany nie czytały „default".
      const immediateKey = accountKeyFromUserId(next.user.id);
      if (getAccountKey() !== immediateKey) {
        resetMenuThumbCacheMemory();
        resetDishCustomImagesMemory();
        resetProductCustomImagesMemory();
      }
      setAccountKey(immediateKey);
      try {
        const p = await ensureLocalProfile(next.user);
        setProfile(p);
        setAccountKey(p.account_key);
        void authService.seedWarehouseCategories(p.account_key);
      } catch (e) {
        if (__DEV__) console.warn('[Auth] profile bootstrap', e);
        const fallback = immediateKey;
        setProfile({
          id: next.user.id,
          email: next.user.email ?? null,
          account_key: fallback,
          restaurant_name: null,
        });
        setAccountKey(fallback);
        void authService.seedWarehouseCategories(fallback);
      }
    },
    [ensureLocalProfile],
  );

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }

    (async () => {
      try {
        const { session: current } = await authService.getSession();
        if (!cancelled) await applySession(current);
      } catch {
        if (!cancelled) await applySession(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    const unsubscribe = authService.subscribeToAuthState((next) => {
      void applySession(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      return { ok: false as const, message: 'Supabase nie jest skonfigurowany (frontend/.env).' };
    }
    const e = email.trim().toLowerCase();
    if (!e || !password) {
      return { ok: false as const, message: 'Podaj e-mail i hasło.' };
    }
    const { error } = await authService.signInWithPassword(e, password);
    if (error) return { ok: false as const, message: polishAuthError(error) };
    return { ok: true as const };
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, shipping: RegisterShippingInput) => {
      if (!isSupabaseConfigured) {
        return { ok: false as const, message: 'Supabase nie jest skonfigurowany (frontend/.env).' };
      }
      const e = email.trim().toLowerCase();
      if (!e || !password) {
        return { ok: false as const, message: 'Podaj e-mail i hasło.' };
      }
      if (password.length < 6) {
        return { ok: false as const, message: 'Hasło musi mieć co najmniej 6 znaków.' };
      }
      const shippingErr = validateRegisterShipping({ ...shipping, contactEmail: shipping.contactEmail || e });
      if (shippingErr) {
        return { ok: false as const, message: shippingErr };
      }

      // Rejestracja przez backend (Resend) — bez limitu maili Supabase Auth.
      const reg = await authService.registerViaBackend(e, password, shipping);
      if (!reg.ok) {
        return { ok: false as const, message: polishAuthError({ message: reg.message }) };
      }

      await applySession(null);
      return { ok: true as const, needsEmailConfirm: true };
    },
    [applySession],
  );

  const resetPassword = useCallback(async (email: string) => {
    if (!isSupabaseConfigured) {
      return { ok: false as const, message: 'Supabase nie jest skonfigurowany (frontend/.env).' };
    }
    const e = email.trim().toLowerCase();
    if (!e) {
      return { ok: false as const, message: 'Podaj e-mail, na który wyślemy link resetu hasła.' };
    }
    const { error } = await authService.resetPasswordForEmail(e);
    if (error) return { ok: false as const, message: polishAuthError(error) };
    return { ok: true as const };
  }, []);

  const signOut = useCallback(async () => {
    await authService.signOut();
    setSession(null);
    setProfile(null);
    setAccountKey('default');
    resetMenuThumbCacheMemory();
    resetDishCustomImagesMemory();
    resetProductCustomImagesMemory();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return;
    await applySession(session);
  }, [applySession, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      profile,
      accountKey: profile?.account_key ?? getAccountKey(),
      isAuthenticated: !!session?.user,
      signIn,
      signUp,
      resetPassword,
      signOut,
      refreshProfile,
    }),
    [ready, session, profile, signIn, signUp, resetPassword, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
