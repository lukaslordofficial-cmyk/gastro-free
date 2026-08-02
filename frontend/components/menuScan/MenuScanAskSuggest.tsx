/**
 * Dialog „Uzupełnić dane AI?” — osobny komponent UI (.agentrules §I).
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';

const C = {
  text: DS.color.heading,
  body: DS.color.body,
  muted: DS.color.muted,
  green: DS.color.greenEnd,
  greenSoft: 'rgba(0,255,120,0.12)',
  blackOnGreen: '#0A0A0A',
  border: DS.color.borderSubtle,
  elevated: DS.color.surfaceElevated,
};

type Props = {
  askMessage: string;
  suggestionCount: number;
  dishesCount: number;
  footerPad: number;
  onNo: () => void;
  onYes: () => void;
};

export function MenuScanAskSuggest({
  askMessage,
  suggestionCount,
  dishesCount,
  footerPad,
  onNo,
  onYes,
}: Props) {
  return (
    <View style={[styles.askWrap, { paddingBottom: footerPad }]}>
      <View style={styles.askIcon}>
        <Sparkles size={30} color={C.green} strokeWidth={2} />
      </View>
      <Text style={styles.askTitle}>Uzupełnić dane AI?</Text>
      <Text style={styles.askText}>{askMessage}</Text>
      <Text style={styles.askMeta}>
        Dotknij TAK, aby AI dopisał brakujące składniki i gramatury (trafią też do magazynu).
        Dotknij NIE, aby zapisać formularz — tak jak jest, bez propozycji AI. Pola pozostaną
        puste i będziesz musiał uzupełnić je sam.
      </Text>
      <View style={styles.askButtons}>
        <TouchableOpacity
          style={[styles.askBtn, styles.askBtnSecondary]}
          onPress={onNo}
          activeOpacity={0.85}
          testID="menu-scan-suggest-no"
        >
          <Text style={styles.askBtnSecondaryText}>Nie, zapisz jak jest</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.askBtn, styles.askBtnPrimary]}
          onPress={onYes}
          activeOpacity={0.85}
          testID="menu-scan-suggest-yes"
        >
          <Sparkles size={15} color={C.blackOnGreen} strokeWidth={2.5} />
          <Text style={styles.askBtnPrimaryText}>Tak, AI dopisz</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.askCount}>
        Dotyczy {suggestionCount} pól z {dishesCount} potraw.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  askWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 14,
  },
  askIcon: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  askTitle: { fontSize: 20, fontWeight: '800', color: C.text, textAlign: 'center' },
  askText: { fontSize: 15, color: C.body, textAlign: 'center', lineHeight: 22 },
  askMeta: { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 19 },
  askButtons: { flexDirection: 'row', gap: 10, marginTop: 8 },
  askBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
  },
  askBtnSecondary: {
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  askBtnPrimary: { backgroundColor: C.green },
  askBtnSecondaryText: { color: C.text, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  askBtnPrimaryText: { color: C.blackOnGreen, fontWeight: '800', fontSize: 13 },
  askCount: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 4 },
});
