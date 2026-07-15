import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import type { FinancialRecord } from '@/lib/types';

interface RevenueChartProps {
  records: FinancialRecord[];
}

const MONTH_LABELS: Record<string, string> = {
  '01': 'Sty', '02': 'Lut', '03': 'Mar', '04': 'Kwi',
  '05': 'Maj', '06': 'Cze', '07': 'Lip', '08': 'Sie',
  '09': 'Wrz', '10': 'Paz', '11': 'Lis', '12': 'Gru',
};

function getMonthLabel(yearMonth: string): string {
  const parts = yearMonth.split('-');
  return MONTH_LABELS[parts[1]] ?? yearMonth;
}

export function RevenueChart({ records }: RevenueChartProps) {
  if (!records.length) return null;

  const sorted = [...records].sort((a, b) => a.year_month.localeCompare(b.year_month));
  const maxVal = Math.max(...sorted.flatMap((r) => [r.revenue_pln, r.variable_costs_pln]), 1);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trend przychodow (ostatnie miesiace)</Text>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.accent }]} />
          <Text style={styles.legendText}>Przychod</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.danger }]} />
          <Text style={styles.legendText}>Koszty zmienne</Text>
        </View>
      </View>
      <View style={styles.chart}>
        {sorted.map((record) => {
          const revenueH = (record.revenue_pln / maxVal) * 100;
          const costsH = (record.variable_costs_pln / maxVal) * 100;
          return (
            <View key={record.year_month} style={styles.barGroup}>
              <View style={styles.barsRow}>
                <View style={[styles.bar, { height: Math.max(revenueH, 4), backgroundColor: Colors.accent }]} />
                <View style={[styles.bar, { height: Math.max(costsH, 4), backgroundColor: Colors.danger }]} />
              </View>
              <Text style={styles.barLabel}>{getMonthLabel(record.year_month)}</Text>
              <Text style={styles.barValue}>
                {(record.revenue_pln / 1000).toFixed(1)}k
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  legend: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  barGroup: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 100,
  },
  bar: {
    width: 10,
    borderRadius: 3,
  },
  barLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  barValue: {
    fontSize: 10,
    color: Colors.textTertiary,
  },
});
