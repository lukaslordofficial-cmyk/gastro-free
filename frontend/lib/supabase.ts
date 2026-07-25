import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Supabase client — graceful init + persystencja sesji (AsyncStorage).
 * Uwaga: nie używamy SecureStore — limit ~2 KB psuje JWT sesji Supabase.
 *
 * `createClient()` bez URL rzuca "supabaseUri is required" i wywala CAŁĄ apkę
 * (biały ekran / critical error) — nawet zanim ktokolwiek wywoła jakiekolwiek
 * zapytanie. Robimy to bezpiecznie:
 *   • jeżeli brak konfiguracji → logujemy jasny warning po polsku
 *   • budujemy „stub" klient, który rzuca dopiero PRZY UŻYCIU (nie przy imporcie)
 *   • `isSupabaseConfigured` pozwala UI wyświetlić ładny ekran „skonfiguruj .env"
 */

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function makeStubClient(): SupabaseClient<Database> {
  const errMsg =
    'Supabase nie jest skonfigurowany. Uzupełnij plik `frontend/.env` ' +
    '(EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY) i uruchom ' +
    'ponownie `yarn start`. Szablon: frontend/.env.example.';
  // eslint-disable-next-line no-console
  console.error('[Supabase] ' + errMsg);
  const thrower = () => {
    throw new Error(errMsg);
  };
  // Proxy sprawia, że każde odwołanie (`.from(...)`, `.rpc(...)`, `.auth`, ...) rzuca sensowny błąd
  return new Proxy({} as SupabaseClient<Database>, {
    get() { return thrower; },
    apply() { return thrower(); },
  });
}

export const supabase: SupabaseClient<Database> = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : makeStubClient();
