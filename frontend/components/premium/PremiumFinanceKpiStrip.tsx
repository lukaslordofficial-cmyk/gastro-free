import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Plus } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PremiumColors } from '@/constants/premiumTheme';
import { AnimatedCounter } from '@/components/premium/premiumAnimations';
import { formatPLN } from './premiumFinanceHelpers';
import { premiumFinanceStyles as styles } from './premiumFinanceStyles';

type Props = {
  totalRevenue: number;
  totalCosts: number;
  netProfit: number;
  onOpenRevenueTree: () => void;
  onOpenCostsTrees: () => void;
  onAddRevenue: () => void;
  onAddFixed: () => void;
};

export function PremiumFinanceKpiStrip({
  totalRevenue,
  totalCosts,
  netProfit,
  onOpenRevenueTree,
  onOpenCostsTrees,
  onAddRevenue,
  onAddFixed,
}: Props) {
  return (
    <>
            <Text style={styles.sectionLabel}>Wyniki bieżącego miesiąca</Text>
            <View style={styles.kpiRow}>
              <Animated.View entering={FadeInDown.delay(120).duration(400)} style={styles.kpi}>
                <TouchableOpacity
                  style={styles.kpiTap}
                  onPress={onOpenRevenueTree}
                  activeOpacity={0.85}
                  testID="kpi-przychod-open-tree"
                >
                  <Text style={styles.kpiTitle}>Przychód</Text>
                  <AnimatedCounter value={totalRevenue} formatValue={formatPLN} style={styles.kpiValue} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.kpiAdd} onPress={onAddRevenue}>
                  <Plus size={14} color={PremiumColors.neon} strokeWidth={2.5} />
                </TouchableOpacity>
              </Animated.View>
              <Animated.View entering={FadeInDown.delay(180).duration(400)} style={styles.kpi}>
                <TouchableOpacity
                  style={styles.kpiTap}
                  onPress={onOpenCostsTrees}
                  activeOpacity={0.85}
                  testID="kpi-koszty-open-trees"
                >
                  <Text style={styles.kpiTitle}>Koszty łącznie</Text>
                  <AnimatedCounter value={totalCosts} formatValue={formatPLN} style={styles.kpiValue} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.kpiAdd} onPress={onAddFixed}>
                  <Plus size={14} color={PremiumColors.neon} strokeWidth={2.5} />
                </TouchableOpacity>
              </Animated.View>
            </View>
            <Animated.View
              entering={FadeInDown.delay(220).duration(400)}
              style={[styles.kpi, { marginBottom: 12, alignItems: 'center' }]}
            >
              <Text style={[styles.kpiTitle, { textAlign: 'center' }]}>Zysk netto</Text>
              <AnimatedCounter
                value={Math.abs(netProfit)}
                formatValue={(n) => (netProfit >= 0 ? '+' : '−') + formatPLN(n)}
                style={[
                  styles.kpiValue,
                  { color: netProfit >= 0 ? PremiumColors.neon : PremiumColors.alert, textAlign: 'center' },
                ]}
              />
              <Text style={[styles.kpiSub, { textAlign: 'center' }]}>
                {netProfit >= 0 ? 'Rentowność pozytywna' : 'Wynik ujemny — wymaga reakcji'}
              </Text>
            </Animated.View>
    </>
  );
}
