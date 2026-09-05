import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronDown, ChevronRight, Barcode } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';
import type { MenuItemForMapping } from './menuRecipeTypes';
import { menuRecipeRowStyles as styles } from './menuRecipeRowStyles';

type Props = {
  menuItem: MenuItemForMapping;
  expanded: boolean;
  prem: boolean;
  textPrimary: string;
  textSecondary: string;
  inStockCount: number;
  totalCount: number;
  badgeStyle: object;
  onToggle: () => void;
};

export function MenuRecipeRowHeader({
  menuItem,
  expanded,
  prem,
  textPrimary,
  textSecondary,
  inStockCount,
  totalCount,
  badgeStyle,
  onToggle,
}: Props) {
  return (
      <TouchableOpacity style={styles.header} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          {expanded ? (
            <ChevronDown size={18} color={textSecondary} />
          ) : (
            <ChevronRight size={18} color={textSecondary} />
          )}
          <View style={styles.headerText}>
            <Text style={[styles.itemName, { color: textPrimary }]}>{menuItem.name}</Text>
            {menuItem.category ? (
              <Text style={[styles.itemCategory, { color: textSecondary }]}>{menuItem.category}</Text>
            ) : null}
            {menuItem.pos_id ? (
              <Text style={[styles.itemCategory, { color: textSecondary }]}>
                Nr POS: {menuItem.pos_id}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.headerRight}>
          {menuItem.pos_id ? (
            <View style={[styles.posLinkedBadge, prem && styles.posLinkedBadgePrem]}>
              <Barcode size={11} color={prem ? DS.color.greenEnd : '#16A34A'} />
              <Text style={[styles.posLinkedText, prem && { color: DS.color.greenEnd }]}>POS</Text>
            </View>
          ) : null}
          {totalCount > 0 && (
            <View style={[styles.badge, badgeStyle]}>
              <Text style={[styles.badgeText, prem && { color: DS.color.heading }]}>
                {inStockCount}/{totalCount} na stanie
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
  );
}
