/**
 * ReportInfoButton – widoczna ikona mikrofonu z podpisem „Sterowanie głosem”.
 */
import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Mic } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { VoiceReportModal } from './VoiceReportModal';
import { useUiOverlay } from '@/contexts/UiOverlayContext';

interface Props {
  contextHint?: string;
  onApplied?: () => void;
  compact?: boolean;
  centered?: boolean;
  /** Czarny tekst etykiety (np. Magazyn). */
  darkText?: boolean;
  testID?: string;
}

export function ReportInfoButton({ contextHint, onApplied, compact, centered, darkText, testID }: Props) {
  const [open, setOpen] = useState(false);
  const { setVoiceOverlay } = useUiOverlay();
  const theme = useAppTheme();
  const accent = theme.isPremium ? theme.accent : '#8B5CF6';

  useEffect(() => {
    setVoiceOverlay(open);
    return () => setVoiceOverlay(false);
  }, [open, setVoiceOverlay]);

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
        testID={testID ?? 'report-info-btn'}
      >
        <View style={styles.icon}>
          <Mic size={compact ? 13 : 14} color={darkText ? '#0A0A0A' : Colors.white} strokeWidth={2.5} />
        </View>
        {!compact && (
          <Text style={[styles.text, darkText && styles.textDark]}>Sterowanie głosem</Text>
        )}
      </TouchableOpacity>
      {open ? (
        <VoiceReportModal
          visible={open}
          onClose={() => setOpen(false)}
          onApplied={onApplied}
          contextHint={contextHint}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    alignSelf: 'flex-start',
    backgroundColor: '#8B5CF6',
    paddingLeft: 6, paddingRight: 12, paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4,
  },
  btnCentered: { alignSelf: 'center' },
  btnCompact: { paddingRight: 6 },
  icon: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  text: { color: Colors.white, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  textDark: { color: '#0A0A0A' },
});
