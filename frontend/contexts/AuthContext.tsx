import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { setAccountKey, getAccountKey } from '@/lib/accountKey';
import { polishAuthError } from '@/lib/authErrors';
import { fetchJson } from '@/lib/safeFetch';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

export type UserProfile = {
  id: string;
  email: string | null;
  account_key: string;
  restaurant_name: string | null;
};

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
    restaurantName?: string,
  ) => Promise<{ ok: true; needsEmailConfirm?: boolean } | { ok: false; message: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<UserProfile | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, account_key, restaurant_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    // Tabela jeszcze nie istnieje — fallback do account_key z uid
    if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
      return null;
    }
    console.warn('[Auth] profiles:', error.message);
    return null;
  }
  if (!data) return null;
  return data as UserProfile;
}

async function ensureLocalProfile(user: User): Promise<UserProfile> {
  const existing = await fetchProfile(user.id);
  if (existing?.account_key) return existing;

  const account_key = `ak_${user.id.replace(/-/g, '')}`;
  const restaurant_name =
    (user.user_metadata?.restaurant_name as string | undefined)?.trim() || null;
  const row = {
    id: user.id,
    email: user.email ?? null,
    account_key,
    restaurant_name,
  };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(row, { onConflict: 'id' })
    .select('id, email, account_key, restaurant_name')
    .single();

  if (!error && data) {
    // Portfel — trigger SQL zwykle tworzy wiersz; tu fallback (ignoruj konflikt)
    const { error: subErr } = await supabase.from('subscriptions').insert({
      account_key,
      tier_level: 0,
      credits_balance: 1000,
      status: 'active',
      free_starter_claimed: true,
    });
    if (subErr && !String(subErr.message || '').toLowerCase().includes('duplicate')) {
      console.warn('[Auth] subscriptions seed:', subErr.message);
    }
    return data as UserProfile;
  }

  return {
    id: user.id,
    email: user.email ?? null,
    account_key,
    restaurant_name,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const applySession = useCallback(async (next: Session | null) => {
    setSession(next);
    if (!next?.user) {
      setProfile(null);
      setAccountKey('default');
      return;
    }
    try {
      const p = await ensureLocalProfile(next.user);
      setProfile(p);
      setAccountKey(p.account_key);
    } catch (e) {
      console.warn('[Auth] profile bootstrap', e);
      const fallback = `ak_${next.user.id.replace(/-/g, '')}`;
      setProfile({
        id: next.user.id,
        email: next.user.email ?? null,
        account_key: fallback,
        restaurant_name: null,
      });
      setAccountKey(fallback);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!cancelled) await applySession(data.session);
      } catch {
        if (!cancelled) await applySession(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      void applySession(next);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
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
    const { error } = await supabase.auth.signInWithPassword({ email: e, password });
    if (error) return { ok: false as const, message: polishAuthError(error) };
    return { ok: true as const };
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, restaurantName?: string) => {
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
      const { data, error } = await supabase.auth.signUp({
        email: e,
        password,
        options: {
          data: {
            restaurant_name: (restaurantName ?? '').trim() || null,
          },
          // Preferujemy natychmiastową sesję (gdy Confirm email wyłączone w Supabase).
        },
      });
      if (error) return { ok: false as const, message: polishAuthError(error) };

      // Closed beta: bez maila potwierdzającego — Admin API na backendzie, potem login.
      if (!data.session && data.user?.id && BACKEND_URL) {
        const conf = await fetchJson(`${BACKEND_URL}/api/auth/auto-confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: data.user.id }),
        });
        if (conf.ok) {
          const { error: signErr } = await supabase.auth.signInWithPassword({
            email: e,
            password,
          });
          if (!signErr) {
            const { data: sess } = await supabase.auth.getSession();
            if (sess.session) await applySession(sess.session);
            return { ok: true as const };
          }
        }
      }

      if (data.session?.user) {
        await applySession(data.session);
        return { ok: true as const };
      }

      // Fallback tylko gdy Confirm email nadal włączone i auto-confirm nie zadziałał
      return {
        ok: true as const,
        needsEmailConfirm: true,
      };
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    setSession(null);
    setProfile(null);
    setAccountKey('default');
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
      signOut,
      refreshProfile,
    }),
    [ready, session, profile, signIn, signUp, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
