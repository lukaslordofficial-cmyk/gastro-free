/**
 * Wspólny „Pro Dark” chrome — brand header + background.
 */
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FloatingAsset } from '@/components/premium/premiumAnimations';
import { PremiumScreenBackground } from '@/components/premium/PremiumScreenBackground';
import { PremiumBrandHeader } from '@/components/premium/PremiumUI';
import { DS, PremiumTokens } from '@/constants/premiumTheme';

type Props = {
  title: string;
  /** Podtytuł panelu — np. "Panel magazynowy" */
  subtitle?: string;
  /** Meta pod tytułem — np. "96 produktów · 88 alertów" */
  meta?: string;
  right?: React.ReactNode;
  floatNames?: string[];
  showFloats?: boolean;
  belowHeader?: React.ReactNode;
  children?: React.ReactNode;
  headerVariant?: 'default' | 'magazyn' | 'centered';
};

export function PremiumTabChrome({
  title,
  subtitle,
  meta,
  right,
  floatNames = [],
  showFloats = true,
  belowHeader,
  children,
  headerVariant = 'default',
}: Props) {
  const t = useAppTheme();
  const floatKey = showFloats ? floatNames.slice(0, 4).join('|') : '';
  const [floatSrcs, setFloatSrcs] = useState<(number | { uri: string })[]>([]);

  useEffect(() => {
    if (!floatKey) {
      setFloatSrcs([]);
      return;
    }
    const names = floatKey.split('|');
    let cancelled = false;
    void import('@/lib/productImages').then(({ imageSourceForProduct }) => {
      if (cancelled) return;
      setFloatSrcs(names.map((n) => imageSourceForProduct(n)));
    });
    return () => {
      cancelled = true;
    };
  }, [floatKey]);

  if (!t.isPremium) {
    return <>{children}</>;
  }

  const floats = floatSrcs.map((src, i) => ({
    key: `${floatNames[i] || i}-${i}`,
    src,
    delay: i * 400,
  }));

  const panelTitle = subtitle || title;

  return (
    <PremiumScreenBackground>
      <PremiumBrandHeader
        panelTitle={panelTitle}
        meta={meta || undefined}
        right={right}
        variant={headerVariant}
      />
      {belowHeader ? <View style={styles.belowHeader}>{belowHeader}</View> : null}
      {floats.length > 0 ? (
        <View style={styles.floatRow} pointerEvents="none">
          {floats.map((f) => (
            <FloatingAsset key={f.key} source={f.src} size={36} delay={f.delay} />
          ))}
        </View>
      ) : null}
      <View style={{ flex: 1 }}>{children}</View>
    </PremiumScreenBackground>
  );
}

/** Style karty / searcha — stosuj inline gdy theme.isPremium */
export function premiumSurface(theme: {
  isPremium: boolean;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
}) {
  if (!theme.isPremium) return {};
  return {
    card: {
      backgroundColor: DS.color.surfaceCard,
      borderColor: DS.color.borderSubtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: DS.radius.card,
      ...DS.shadow.card,
    },
    search: {
      backgroundColor: DS.color.bgTertiary,
      borderColor: DS.color.borderSubtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: DS.radius.button,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    text: { color: theme.text },
    muted: { color: theme.textMuted },
    accent: { color: theme.accent },
  };
}

const styles = StyleSheet.create({
  belowHeader: {
    paddingHorizontal: DS.space.screen,
    paddingBottom: DS.space[16],
  },
  floatRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: DS.space.screen,
    marginBottom: 8,
  },
});
