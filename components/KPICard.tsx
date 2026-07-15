import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface KPICardProps {
  label: string;
  value: string;
  subLabel?: string;
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'accent';
  wide?: boolean;
  onAdd?: () => void;
}

export function KPICard({ label, value, subLabel, variant = 'default', wide = false, onAdd }: KPICardProps) {
  const valueColor = {
    default: Colors.textPrimary,
    success: Colors.success,
    danger: Colors.danger,
    warning: Colors.warning,
    accent: Colors.accent,
  }[variant];

  const bgColor = {
    default: Colors.card,
    success: Colors.successLight,
    danger: Colors.dangerLight,
    warning: Colors.warningLight,
    accent: Colors.accentLight,
  }[variant];

  const accentBar = {
    default: Colors.border,
    success: Colors.success,
    danger: Colors.danger,
    warning: Colors.warning,
    accent: Colors.accent,
  }[variant];

  return (
    <View style={[styles.card, { backgroundColor: bgColor, flex: wide ? 1 : undefined }]}>
      <View style={[styles.accentBar, { backgroundColor: accentBar }]} />
      <View style={styles.topRow}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        {onAdd && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={onAdd}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            activeOpacity={0.7}
          >
            <Plus size={13} color={valueColor} strokeWidth={2.5} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {subLabel ? <Text style={styles.subLabel}>{subLabel}</Text> : null}
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
    borderTopRightRadius: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 6,
    gap: 4,
  },
  label: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 4,
  },
});
