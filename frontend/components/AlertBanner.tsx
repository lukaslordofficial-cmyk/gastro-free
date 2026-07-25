import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface AlertBannerProps {
  count: number;
  onPress?: () => void;
  subtitle?: string;
}

export function AlertBanner({ count, onPress, subtitle }: AlertBannerProps) {
  if (count === 0) return null;

  return (
    <TouchableOpacity style={styles.banner} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.iconWrap}>
        <TriangleAlert size={18} color={Colors.warning} strokeWidth={2.2} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>
          {count} {count === 1 ? 'produkt wymaga' : count < 5 ? 'produkty wymagają' : 'produktów wymaga'} uzupełnienia
        </Text>
        <Text style={styles.sub}>{subtitle ?? 'Dotknij, aby przejść do magazynu'}</Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.warningLight,
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
  },
  sub: {
    fontSize: 11,
    color: '#A16207',
    marginTop: 1,
  },
  arrow: {
    fontSize: 20,
    color: Colors.warning,
    fontWeight: '300',
  },
});
