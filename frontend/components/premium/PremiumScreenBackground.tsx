/**
 * PremiumScreenBackground — gradient + subtelna zielona poświata.
 */
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PremiumTokens } from '@/constants/premiumTheme';

type Props = {
  children?: React.ReactNode;
  style?: ViewStyle;
};

export function PremiumScreenBackground({ children, style }: Props) {
  return (
    <View style={[styles.root, style]}>
      <LinearGradient
        colors={[...PremiumTokens.bgGradient]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.glowTop} pointerEvents="none" />
      <View style={styles.glowBottom} pointerEvents="none" />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PremiumTokens.color.bg },
  glowTop: {
    position: 'absolute',
    top: -80,
    left: '15%',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: PremiumTokens.color.neonGlow,
    opacity: 0.55,
  },
  glowBottom: {
    position: 'absolute',
    bottom: 120,
    right: -60,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(0,216,107,0.08)',
  },
});
