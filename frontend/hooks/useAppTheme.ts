import { useMemo } from 'react';
import { Colors } from '@/constants/colors';
import { PremiumTokens } from '@/constants/premiumTheme';
import { useThemeMode } from '@/contexts/ThemeModeContext';

export type AppTheme = {
  isPremium: boolean;
  bg: string;
  card: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  danger: string;
  border: string;
  success: string;
  warning: string;
  segmentBg: string;
  segmentActive: string;
};

export function useAppTheme(): AppTheme {
  const { isPremiumUi } = useThemeMode();
  return useMemo(() => {
    if (isPremiumUi) {
      const c = PremiumTokens.color;
      return {
        isPremium: true,
        bg: c.bg,
        card: c.card,
        text: c.text,
        textSecondary: c.textBody,
        textMuted: c.textMuted,
        accent: c.neon,
        accentSoft: c.neonSoft,
        danger: c.alert,
        border: c.border,
        success: c.neon,
        warning: c.warning,
        segmentBg: c.bgMid,
        segmentActive: c.cardElevated,
      };
    }
    return {
      isPremium: false,
      bg: Colors.background,
      card: Colors.card,
      text: Colors.textPrimary,
      textSecondary: Colors.textSecondary,
      textMuted: Colors.textTertiary,
      accent: Colors.accent,
      accentSoft: Colors.accentLight,
      danger: Colors.danger,
      border: Colors.border,
      success: Colors.success,
      warning: Colors.warning,
      segmentBg: Colors.borderLight,
      segmentActive: Colors.card,
    };
  }, [isPremiumUi]);
}
