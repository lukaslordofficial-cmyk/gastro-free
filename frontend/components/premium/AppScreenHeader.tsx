import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useThemeMode } from '@/contexts/ThemeModeContext';
import { ToggleLeft, ToggleRight } from 'lucide-react-native';

const LOGO = require('@/assets/premium/gastro-manager-logo.webp');

type Props = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  showDevToggle?: boolean;
  /** Free: wyśrodkowany tytuł + podtytuł. */
  centered?: boolean;
};

/** Nagłówek ekranu — w Premium większe logo + ciemny motyw. */
export function AppScreenHeader({ title, subtitle, right, showDevToggle, centered }: Props) {
  const t = useAppTheme();
  const { isPremiumUi, toggleAppearance } = useThemeMode();

  if (centered && !t.isPremium) {
    return (
      <View style={styles.wrapCentered}>
        <Text style={[styles.titleCentered, { color: t.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subCentered, { color: t.textSecondary }]}>{subtitle}</Text>
        ) : null}
        {showDevToggle ? (
          <TouchableOpacity
            style={[styles.toggle, styles.toggleCentered, { backgroundColor: t.card, borderColor: t.border }]}
            onPress={() => void toggleAppearance()}
            activeOpacity={0.85}
          >
            {isPremiumUi ? (
              <ToggleRight size={14} color={t.accent} strokeWidth={2} />
            ) : (
              <ToggleLeft size={14} color="#fff" strokeWidth={2} />
            )}
            <Text style={[styles.toggleText, { color: t.isPremium ? t.accent : '#fff' }]}>
              {isPremiumUi ? 'Free' : 'Premium'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {t.isPremium ? (
          <Image source={LOGO} style={styles.logoLg} resizeMode="contain" />
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: t.isPremium ? t.accent : t.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.sub, { color: t.textSecondary }]}>{subtitle}</Text>
          ) : null}
        </View>
        {right}
        {showDevToggle ? (
          <TouchableOpacity
            style={[styles.toggle, { backgroundColor: t.card, borderColor: t.border }]}
            onPress={() => void toggleAppearance()}
            activeOpacity={0.85}
          >
            {isPremiumUi ? (
              <ToggleRight size={14} color={t.accent} strokeWidth={2} />
            ) : (
              <ToggleLeft size={14} color="#fff" strokeWidth={2} />
            )}
            <Text style={[styles.toggleText, { color: t.isPremium ? t.accent : '#fff' }]}>
              {isPremiumUi ? 'Free' : 'Premium'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  wrapCentered: { marginBottom: 4, alignItems: 'center', alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoLg: { width: 88, height: 88 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  titleCentered: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  sub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  subCentered: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
    textAlign: 'center',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#0F172A',
  },
  toggleCentered: { marginTop: 10 },
  toggleText: { fontSize: 11, fontWeight: '700' },
});
