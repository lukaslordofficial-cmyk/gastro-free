import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import type { InventoryItemWithCategory } from '@/lib/types';

interface InventoryItemRowProps {
  item: InventoryItemWithCategory;
}

function getStatus(item: InventoryItemWithCategory): 'critical' | 'warning' | 'ok' {
  const ratio = item.quantity / item.min_quantity;
  if (ratio <= 0.5) return 'critical';
  if (ratio <= 1) return 'warning';
  return 'ok';
}

function getPortionsRemaining(item: InventoryItemWithCategory): number | null {
  if (!item.portion_size || item.portion_size === 0) return null;
  return Math.floor(item.quantity / item.portion_size);
}

function formatQuantity(quantity: number, unit: string): string {
  if (quantity >= 1000 && (unit === 'g' || unit === 'ml')) {
    const val = quantity / 1000;
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)} ${unit === 'g' ? 'kg' : 'L'}`;
  }
  const display = quantity % 1 === 0 ? quantity.toFixed(0) : quantity.toFixed(2);
  return `${display} ${unit}`;
}

export function InventoryItemRow({ item }: InventoryItemRowProps) {
  const status = getStatus(item);
  const portions = getPortionsRemaining(item);
  const catColor = item.inventory_categories?.color ?? Colors.textSecondary;

  const statusConfig = {
    ok: {
      bg: Colors.card,
      border: Colors.border,
      badge: Colors.successLight,
      badgeText: Colors.success,
      badgeLabel: 'OK',
    },
    warning: {
      bg: Colors.warningLight,
      border: '#FDE68A',
      badge: '#FEF3C7',
      badgeText: Colors.warning,
      badgeLabel: 'Niski stan',
    },
    critical: {
      bg: Colors.dangerLight,
      border: '#FECACA',
      badge: '#FEE2E2',
      badgeText: Colors.danger,
      badgeLabel: 'Krytyczny',
    },
  }[status];

  return (
    <View style={[styles.row, { backgroundColor: statusConfig.bg, borderColor: statusConfig.border }]}>
      <View style={[styles.categoryBar, { backgroundColor: catColor }]} />
      <View style={styles.content}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <View style={[styles.badge, { backgroundColor: statusConfig.badge }]}>
            <Text style={[styles.badgeText, { color: statusConfig.badgeText }]}>{statusConfig.badgeLabel}</Text>
          </View>
        </View>

        <View style={styles.bottom}>
          <View style={styles.quantityWrap}>
            <Text style={[styles.quantity, status !== 'ok' && { color: statusConfig.badgeText }]}>
              {formatQuantity(item.quantity, item.unit)}
            </Text>
            <Text style={styles.minLabel}> / min {formatQuantity(item.min_quantity, item.unit)}</Text>
          </View>

          {status !== 'ok' && portions !== null && (
            <Text style={[styles.portionsAlert, { color: statusConfig.badgeText }]}>
              Niski stan! Wystarczy na {portions} {portions === 1 ? 'porcję' : portions < 5 ? 'porcje' : 'porcji'}
            </Text>
          )}
        </View>

        {item.inventory_categories && (
          <Text style={[styles.category, { color: catColor }]}>{item.inventory_categories.name}</Text>
        )}
      </View>

      <View style={styles.stockBar}>
        <View style={styles.stockBarBg}>
          <View
            style={[
              styles.stockBarFill,
              {
                width: `${Math.min(100, (item.quantity / item.min_quantity) * 100)}%` as any,
                backgroundColor: statusConfig.badgeText,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden',
  },
  categoryBar: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: 12,
    gap: 4,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  quantityWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  quantity: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  minLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  portionsAlert: {
    fontSize: 11,
    fontWeight: '600',
  },
  category: {
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  stockBar: {
    justifyContent: 'center',
    paddingRight: 12,
  },
  stockBarBg: {
    width: 4,
    height: 48,
    backgroundColor: Colors.borderLight,
    borderRadius: 2,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  stockBarFill: {
    width: '100%',
    borderRadius: 2,
    minHeight: 4,
  },
});
