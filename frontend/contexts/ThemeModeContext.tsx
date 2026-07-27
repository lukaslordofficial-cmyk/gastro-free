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
 * Closed beta: dark premium UI jest jedynym chrome'em aplikacji.
 * Plan Free (kredyty / ads) NIE wraca do białego skina.
 * Flaga 'free' tylko w __DEV__ do podglądu starego UI.
 */
export type UiAppearance = 'free' | 'premium';

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
        if (cancelled) return;
        // Produkcja: zawsze premium. Dev: pozwól odczytać 'free' tylko gdy świadomie zapisane.
        if (__DEV__ && raw === 'free') {
          setAppearanceState('free');
        } else {
          setAppearanceState('premium');
          if (raw !== 'premium') {
            try {
              await AsyncStorage.setItem(STORAGE_KEY, 'premium');
            } catch {
              /* ignore */
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
    // Poza __DEV__ nigdy nie stosuj białego skina — nawet jeśli ktoś wywoła 'free'.
    const applied: UiAppearance = !__DEV__ && next === 'free' ? 'premium' : next;
    setAppearanceState(applied);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, applied);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleAppearance = useCallback(async () => {
    if (!__DEV__) return;
    const next: UiAppearance = appearance === 'premium' ? 'free' : 'premium';
    await setAppearance(next);
  }, [appearance, setAppearance]);

  const value = useMemo<ThemeModeContextValue>(
    () => ({
      appearance,
      // Produkcja: zawsze dark premium chrome. Dev: zależy od appearance.
      isPremiumUi: __DEV__ ? appearance === 'premium' : true,
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
