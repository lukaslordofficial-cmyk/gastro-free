/**
 * Przycisk Samouczek — obok Powiadomień na Wynikach.
 */
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { BookOpen } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useUiOverlay } from '@/contexts/UiOverlayContext';

type Props = {
  compact?: boolean;
  centered?: boolean;
  darkText?: boolean;
  testID?: string;
};

export function TutorialButton({ compact, centered, darkText, testID }: Props) {
  const theme = useAppTheme();
  const { openTutorial } = useUiOverlay();
  const accent = theme.isPremium ? theme.accent : '#2563EB';

  return (
    <TouchableOpacity
      style={[
        styles.btn,
        compact && styles.btnCompact,
        centered && styles.btnCentered,
        { backgroundColor: accent, shadowColor: accent },
      ]}
      onPress={() => openTutorial(0)}
      activeOpacity={0.85}
      testID={testID ?? 'tutorial-btn'}
    >
      <View style={styles.icon}>
        <BookOpen
          size={compact ? 13 : 14}
          color={darkText ? '#0A0A0A' : Colors.white}
          strokeWidth={2.5}
        />
      </View>
      {!compact && (
        <Text style={[styles.text, darkText && styles.textDark]}>Samouczek</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  btnCentered: { alignSelf: 'center' },
  btnCompact: { paddingRight: 6 },
  icon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { color: Colors.white, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  textDark: { color: '#0A0A0A' },
});
