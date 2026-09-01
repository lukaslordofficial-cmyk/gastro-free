import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Square } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { styles } from './styles';

export function VoiceRecordingStage({
  elapsed,
  onStopRecording,
}: {
  elapsed: number;
  onStopRecording: () => void;
}) {
  return (
    <View style={styles.idleWrap}>
      <View style={styles.pulseRing}>
        <TouchableOpacity
          style={[styles.recBtn, styles.recBtnStop]}
          onPress={onStopRecording}
          activeOpacity={0.85}
          testID="voice-record-stop"
        >
          <Square size={22} color={Colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>
      <Text style={[styles.recBtnLabel, { color: Colors.danger }]}>
        Nagrywanie… {elapsed}s
      </Text>
      <Text style={styles.idleHint}>Kliknij ponownie aby zakończyć</Text>
    </View>
  );
}
