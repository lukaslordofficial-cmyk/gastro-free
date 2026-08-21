/**
 * Proste marki banków (kolory marki + inicjały).
 * Oficjalne PNG/WebP wrzuć do assets/banks/{id}.png — wtedy kafel użyje Image.
 */
import React from 'react';
import { View, Text, StyleSheet, Image, type ImageSourcePropType } from 'react-native';
import type { PolishBankLogin } from '@/lib/polishBankLogins';

/** Opcjonalne lokalne miniatury — dodaj pliki, żeby włączyć prawdziwe logo. */
export const BANK_LOGO_ASSETS: Partial<Record<string, ImageSourcePropType>> = {
  // Przykład po wrzuceniu plików:
  // mbank: require('@/assets/banks/mbank.png'),
};

type Props = {
  bank: PolishBankLogin;
  size?: number;
};

export function BankLogoBadge({ bank, size = 40 }: Props) {
  const asset = BANK_LOGO_ASSETS[bank.id];
  if (asset) {
    return (
      <View style={[styles.wrap, { width: size, height: size, borderRadius: size * 0.28 }]}>
        <Image source={asset} style={{ width: size * 0.72, height: size * 0.72 }} resizeMode="contain" />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size * 0.28,
          backgroundColor: bank.color,
        },
      ]}
    >
      <Text style={[styles.short, { fontSize: size * 0.28 }]} allowFontScaling={false}>
        {bank.short}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  short: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
