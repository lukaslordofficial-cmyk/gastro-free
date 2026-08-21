/**
 * Składana podsekcja ustawień (Dane lokalu / Integracja POS).
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { settingsScreenStyles as styles } from '@/components/settings/settingsScreenStyles';

type Props = {
  title: string;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  testID?: string;
};

export function SettingsSubSection({ title, icon: Icon, open, onToggle, children, testID }: Props) {
  const theme = useAppTheme();
  const muted = theme.textSecondary;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={[
          styles.sectionHeader,
          {
            paddingVertical: 10,
            paddingHorizontal: 4,
            borderRadius: 10,
            backgroundColor: theme.isPremium ? theme.segmentBg : 'transparent',
          },
        ]}
        onPress={onToggle}
        activeOpacity={0.75}
        testID={testID}
      >
        <Icon size={16} color={muted} />
        <Text style={[styles.sectionTitle, { color: muted, flex: 1 }]}>{title}</Text>
        <Chevron size={18} color={muted} />
      </TouchableOpacity>
      {open ? <View style={{ marginTop: 8 }}>{children}</View> : null}
    </View>
  );
}
