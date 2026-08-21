/**
 * Miniatury banków z assets/banks/{id}.webp (fallback: kolor + inicjały).
 */
import React from 'react';
import { View, Text, StyleSheet, Image, type ImageSourcePropType } from 'react-native';
import type { PolishBankLogin } from '@/lib/polishBankLogins';

export const BANK_LOGO_ASSETS: Partial<Record<string, ImageSourcePropType>> = {
  mbank: require('@/assets/banks/mbank.webp'),
  pko: require('@/assets/banks/pko.webp'),
  santander: require('@/assets/banks/santander.webp'),
  ing: require('@/assets/banks/ing.webp'),
  pekao: require('@/assets/banks/pekao.webp'),
  alior: require('@/assets/banks/alior.webp'),
  millennium: require('@/assets/banks/millennium.webp'),
  bnp: require('@/assets/banks/bnp.webp'),
  bos: require('@/assets/banks/bos.webp'),
  credit_agricole: require('@/assets/banks/credit_agricole.webp'),
  velobank: require('@/assets/banks/velobank.webp'),
  nest: require('@/assets/banks/nest.webp'),
  raiffeisen: require('@/assets/banks/raiffeisen.webp'),
  sgb: require('@/assets/banks/sgb.webp'),
  inteligo: require('@/assets/banks/inteligo.webp'),
  pocztowy: require('@/assets/banks/pocztowy.webp'),
  toyota: require('@/assets/banks/toyota.webp'),
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
        <Image source={asset} style={{ width: size, height: size }} resizeMode="cover" />
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
    backgroundColor: '#0A0A0A',
    overflow: 'hidden',
  },
  short: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
