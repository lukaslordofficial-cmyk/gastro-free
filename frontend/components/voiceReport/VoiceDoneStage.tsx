import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Mic, Check, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import type { Interpretation } from './types';
import { PERIOD_INTENTS, UPLOAD_INTENTS } from './constants';
import { IntentDoneSummary } from './IntentDoneSummary';
import { styles } from './styles';

export function VoiceDoneStage({
  interp,
  meta,
  applyResult,
  onExtrasChange,
  onResetAll,
  onClose,
  onFollowUpRecording,
}: {
  interp: Interpretation;
  meta: { icon: string; label: string; color: string };
  applyResult: { detail: string; extras: any; warnings: string[] };
  onExtrasChange: (next: any) => void;
  onResetAll: () => void;
  onClose: () => void;
  onFollowUpRecording: () => void;
}) {
  const visibleWarnings = (applyResult.warnings ?? []).filter((w) => {
    const t = String(w || '').toLowerCase();
    if (/było usunięte|bylo usuniete|przywrócono w magazynie|przywrocono w magazynie/.test(t)) {
      return false;
    }
    if (/klasyfikacja ai|przekroczyła limit czasu|przekroczyla limit czasu|niedostępna — użyto|niedostepna - uzyto/.test(t)) {
      return false;
    }
    return true;
  });

  return (
    <View>
      <View style={[styles.successBox, { backgroundColor: meta.color }]}>
        <Check size={20} color={Colors.white} strokeWidth={3} />
        <Text style={styles.successText}>
          {interp.intent === 'scale_recipe'
            ? 'Kalkulator porcji'
            : PERIOD_INTENTS.has(interp.intent)
              ? `${meta.label} — wynik`
              : UPLOAD_INTENTS.has(interp.intent)
                ? `${meta.label}`
                : `${meta.label} — zapisano`}
        </Text>
      </View>

      <IntentDoneSummary
        intent={interp.intent}
        extras={applyResult.extras}
        onExtrasChange={onExtrasChange}
      />

      {visibleWarnings.length ? (
        <View style={styles.warnBox}>
          <AlertTriangle size={13} color={Colors.warning} strokeWidth={2.5} />
          <View style={{ flex: 1 }}>
            {visibleWarnings.map((w, i) => (
              <Text key={i} style={styles.warnText}>• {w}</Text>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onResetAll} activeOpacity={0.85} testID="voice-done-again">
          <Mic size={14} color={DS.color.muted} strokeWidth={2.5} />
          <Text style={styles.secondaryBtnText} numberOfLines={2}>Zgłoś kolejną</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={onClose} activeOpacity={0.85} testID="voice-done-close">
          <Check size={14} color="#0A0A0A" strokeWidth={2.5} />
          <Text style={styles.primaryBtnText}>Zamknij</Text>
        </TouchableOpacity>
      </View>
      {(interp.intent === 'scale_recipe') ? (
        <TouchableOpacity
          style={[styles.wakeListenBtn, { marginTop: 10 }]}
          onPress={onFollowUpRecording}
          activeOpacity={0.85}
        >
          <Mic size={14} color="#0A0A0A" strokeWidth={2.5} />
          <Text style={[styles.wakeListenText, { color: '#0A0A0A' }]} numberOfLines={2}>
            Zmień porcje głosem (np. „na 40 porcji”)
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
