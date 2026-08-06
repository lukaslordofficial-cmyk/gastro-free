import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';

type Props = {
  title?: string;
  message?: string;
};

export function LocalProducersEmptyState({
  title = 'Brak lokalnych przetwórców',
  message = 'Moduł jest gotowy. Lista producentów lokalnych pojawi się w kolejnych etapach — osobno od dostawców restauracyjnych.',
}: Props) {
  const theme = useAppTheme();
  const muted = theme.isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const titleColor = theme.isPremium ? '#F5F5F5' : Colors.textPrimary;

  return (
    <View style={styles.wrap}>
      <View style={[styles.iconWrap, { borderColor: muted }]}>
        <MapPin size={28} color={muted} strokeWidth={1.75} />
      </View>
      <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
      <Text style={[styles.message, { color: muted }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 48,
    gap: 10,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 320,
  },
});
