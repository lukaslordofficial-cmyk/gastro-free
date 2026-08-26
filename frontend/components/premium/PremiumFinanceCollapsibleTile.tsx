import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { PremiumColors } from '@/constants/premiumTheme';
import { premiumFinanceStyles as styles } from './premiumFinanceStyles';

export function PremiumFinanceCollapsibleTile({
  title,
  summary,
  open,
  onToggle,
  right,
  children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.collapseHead} onPress={onToggle} activeOpacity={0.8}>
        {open ? (
          <ChevronDown size={16} color={PremiumColors.neon} strokeWidth={2.5} />
        ) : (
          <ChevronRight size={16} color={PremiumColors.textMuted} strokeWidth={2.5} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          {summary ? <Text style={styles.kpiSub}>{summary}</Text> : null}
        </View>
        {right}
      </TouchableOpacity>
      {open ? <View style={{ marginTop: 10 }}>{children}</View> : null}
    </View>
  );
}
