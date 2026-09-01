import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Truck, ChevronDown, ChevronUp, ShoppingCart, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { formatPln } from '@/lib/format';
import { useAppTheme } from '@/hooks/useAppTheme';
import type { Supplier } from './types';
import { cardStyles } from './supplierCardStyles';

type Props = {
  supplier: Supplier;
  expanded: boolean;
  displayCategory: string;
  orderTotal: number;
  iconBg: string;
  onToggleExpanded: () => void;
  onOpenOrder: () => void;
};

export function SupplierCardHeader({
  supplier,
  expanded,
  displayCategory,
  orderTotal,
  iconBg,
  onToggleExpanded,
  onOpenOrder,
}: Props) {
  const theme = useAppTheme();
  return (
      <View style={cardStyles.header}>
        <TouchableOpacity style={cardStyles.headerMain} onPress={onToggleExpanded} activeOpacity={0.7}>
          <View style={[cardStyles.iconWrap, { backgroundColor: theme.isPremium ? 'rgba(0,255,120,0.1)' : iconBg }]}>
            <Truck size={18} color={theme.isPremium ? DS.color.greenEnd : supplier.icon_color} strokeWidth={2} />
          </View>
          <View style={cardStyles.titleWrap}>
            <Text style={[cardStyles.name, theme.isPremium && { color: DS.color.heading, fontSize: 14 }]} numberOfLines={1} allowFontScaling={false}>{supplier.name}</Text>
            <View style={cardStyles.metaRow}>
              {!!displayCategory && (
                <Text style={[cardStyles.category, theme.isPremium && { color: DS.color.muted }]} numberOfLines={1}>
                  {displayCategory}
                </Text>
              )}
              {!!supplier.nip && (
                <Text style={[cardStyles.nip, theme.isPremium && { color: DS.color.muted }]} numberOfLines={1}>
                  {supplier.nip}
                </Text>
              )}
            </View>
            {orderTotal > 0 && (
              <View style={cardStyles.orderTotalBadge} testID={`order-total-${supplier.id}`}>
                <TrendingUp size={11} color={Colors.success} strokeWidth={2.5} />
                <Text style={cardStyles.orderTotalText}>
                  Zamówiono: {formatPln(orderTotal)}
                </Text>
              </View>
            )}
          </View>
          {expanded
            ? <ChevronUp size={16} color={Colors.textTertiary} strokeWidth={2} />
            : <ChevronDown size={16} color={Colors.textTertiary} strokeWidth={2} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={cardStyles.headerCartBtn}
          onPress={onOpenOrder}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ShoppingCart size={17} color={Colors.accent} strokeWidth={2} />
        </TouchableOpacity>
      </View>
  );
}
