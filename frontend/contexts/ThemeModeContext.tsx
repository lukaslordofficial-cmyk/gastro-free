import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@gm/ui_appearance';

/**
 * Closed beta: dark premium UI jest domyślny dla wszystkich zalogowanych.
 * Plan Free nadal dostaje ciemny chrome — nie bramkujemy wyglądu płatnym Premium.
 * Flaga 'free' zostaje tylko do ewentualnego debug toggle / wylogowany stan.
 */
export type UiAppearance = 'free' | 'premium';

/** Closed beta — zawsze startuj od dark premium (nie od białego free). */
const DEFAULT_APPEARANCE: UiAppearance = 'premium';

type ThemeModeContextValue = {
  appearance: UiAppearance;
  isPremiumUi: boolean;
  ready: boolean;
  setAppearance: (next: UiAppearance) => Promise<void>;
  toggleAppearance: () => Promise<void>;
};

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearanceState] = useState<UiAppearance>(DEFAULT_APPEARANCE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        // Migrate legacy 'free' → premium (closed beta: nie wracamy do białego po wipe SQL).
        if (!cancelled) {
          if (raw === 'premium') {
            setAppearanceState('premium');
          } else {
            setAppearanceState(DEFAULT_APPEARANCE);
            if (raw !== 'premium') {
              try {
                await AsyncStorage.setItem(STORAGE_KEY, DEFAULT_APPEARANCE);
              } catch {
                /* ignore */
              }
            }
          }
        }
      } catch {
        if (!cancelled) setAppearanceState(DEFAULT_APPEARANCE);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setAppearance = useCallback(async (next: UiAppearance) => {
    setAppearanceState(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleAppearance = useCallback(async () => {
    const next: UiAppearance = appearance === 'premium' ? 'free' : 'premium';
    await setAppearance(next);
  }, [appearance, setAppearance]);

  const value = useMemo<ThemeModeContextValue>(
    () => ({
      appearance,
      isPremiumUi: appearance === 'premium',
      ready,
      setAppearance,
      toggleAppearance,
    }),
    [appearance, ready, setAppearance, toggleAppearance]
  );

  return (
    <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode must be used within ThemeModeProvider');
  return ctx;
}
