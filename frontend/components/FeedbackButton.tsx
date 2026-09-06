/**
 * FeedbackButton – „Zgłoś uwagi” (obok Sterowania głosem w Finanse).
 */
import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { MessageSquarePlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FeedbackModal } from '@/components/FeedbackModal';

type Props = {
  compact?: boolean;
  centered?: boolean;
  darkText?: boolean;
  testID?: string;
  defaultLocation?: string;
};

export function FeedbackButton({
  compact,
  centered,
  darkText,
  testID,
  defaultLocation = 'Finanse',
}: Props) {
  const [open, setOpen] = useState(false);
  const theme = useAppTheme();
  const accent = theme.isPremium ? theme.accent : '#0D9488';

  return (
    <>
      <TouchableOpacity
        style={[
          styles.btn,
          compact && styles.btnCompact,
          centered && styles.btnCentered,
          { backgroundColor: accent, shadowColor: accent },
        ]}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        testID={testID ?? 'feedback-btn'}
      >
        <View style={styles.icon}>
          <MessageSquarePlus
            size={compact ? 13 : 14}
            color={darkText ? '#0A0A0A' : Colors.white}
            strokeWidth={2.5}
          />
        </View>
        {!compact && (
          <Text style={[styles.text, darkText && styles.textDark]}>Zgłoś uwagi</Text>
        )}
      </TouchableOpacity>
      {open ? (
        <FeedbackModal
          visible={open}
          onClose={() => setOpen(false)}
          defaultLocation={defaultLocation}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    backgroundColor: '#0D9488',
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#0D9488',
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
