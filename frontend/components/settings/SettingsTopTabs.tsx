/**
 * Trzy zakładki u góry ekranu Ustawienia (pod tytułem, nad „Konto”).
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Building2, Webhook, Map as MapIcon, type LucideIcon } from 'lucide-react-native';
import { useAppTheme } from '@/hooks/useAppTheme';

export type SettingsPaneId = 'lokal' | 'pos' | 'mapowanie';

const TABS: { id: SettingsPaneId; label: string; icon: LucideIcon }[] = [
  { id: 'lokal', label: 'Dane lokalu', icon: Building2 },
  { id: 'pos', label: 'Integracja POS', icon: Webhook },
  { id: 'mapowanie', label: 'Mapowanie receptur', icon: MapIcon },
];

type Props = {
  value: SettingsPaneId;
  onChange: (id: SettingsPaneId) => void;
};

export function SettingsTopTabs({ value, onChange }: Props) {
  const theme = useAppTheme();

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.isPremium ? theme.segmentBg : '#F1F5F9',
          borderColor: theme.border,
        },
      ]}
      testID="settings-top-tabs"
    >
      {TABS.map((tab) => {
        const active = value === tab.id;
        const Icon = tab.icon;
        const color = active
          ? theme.isPremium
            ? '#0A0A0A'
            : '#fff'
          : theme.textSecondary;
        return (
          <TouchableOpacity
            key={tab.id}
            style={[
              styles.tab,
              active && {
                backgroundColor: theme.isPremium ? theme.accent : theme.accent,
              },
            ]}
            onPress={() => onChange(tab.id)}
            activeOpacity={0.85}
            testID={`settings-tab-${tab.id}`}
          >
            <Icon size={14} color={color} strokeWidth={2.2} />
            <Text style={[styles.label, { color }]} numberOfLines={2}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    padding: 6,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 10,
    minHeight: 58,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 14,
  },
});
