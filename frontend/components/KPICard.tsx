import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PremiumColors } from '@/constants/premiumTheme';

interface KPICardProps {
  label: string;
  value: string;
  subLabel?: string;
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'accent';
  wide?: boolean;
  onAdd?: () => void;
}

export function KPICard({ label, value, subLabel, variant = 'default', wide = false, onAdd }: KPICardProps) {
  const theme = useAppTheme();

  const valueColor = theme.isPremium
    ? {
        default: PremiumColors.text,
        success: PremiumColors.neon,
        danger: PremiumColors.alert,
        warning: '#FBBF24',
        accent: PremiumColors.neon,
      }[variant]
    : {
        default: Colors.textPrimary,
        success: Colors.success,
        danger: Colors.danger,
        warning: Colors.warning,
        accent: Colors.accent,
      }[variant];

  const bgColor = theme.isPremium
    ? PremiumColors.card
    : {
        default: Colors.card,
        success: Colors.successLight,
        danger: Colors.dangerLight,
        warning: Colors.warningLight,
        accent: Colors.accentLight,
      }[variant];

  const accentBar = theme.isPremium
    ? {
        default: 'rgba(0,230,118,0.35)',
        success: PremiumColors.neon,
        danger: PremiumColors.alert,
        warning: '#FBBF24',
        accent: PremiumColors.neon,
      }[variant]
    : {
        default: Colors.border,
        success: Colors.success,
        danger: Colors.danger,
        warning: Colors.warning,
        accent: Colors.accent,
      }[variant];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: bgColor,
          flex: wide ? 1 : undefined,
          borderWidth: theme.isPremium ? 1 : 0,
          borderColor: theme.isPremium ? PremiumColors.border : 'transparent',
          borderRadius: theme.isPremium ? 16 : 12,
        },
      ]}
    >
      <View style={[styles.accentBar, { backgroundColor: accentBar }]} />
      <View style={styles.topRow}>
        <Text
          style={[styles.label, { color: theme.isPremium ? PremiumColors.textMuted : Colors.textSecondary }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {onAdd && (
          <TouchableOpacity
            style={[
              styles.addBtn,
              theme.isPremium && { backgroundColor: PremiumColors.neonSoft },
            ]}
            onPress={onAdd}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            activeOpacity={0.7}
          >
            <Plus size={13} color={valueColor} strokeWidth={2.5} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {subLabel ? (
        <Text style={[styles.subLabel, { color: theme.isPremium ? PremiumColors.textSecondary : Colors.textTertiary }]}>
          {subLabel}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    minWidth: 120,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    flex: 1,
  },
  addBtn: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(37,99,235,0.08)',
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subLabel: {
    fontSize: 11,
    marginTop: 4,
    color: Colors.textTertiary,
  },
});
