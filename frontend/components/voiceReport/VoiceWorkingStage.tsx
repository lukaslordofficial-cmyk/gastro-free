import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/colors';
import { styles } from './styles';

export function VoiceWorkingStage({
  workingMessage,
  transcript,
  showTranscript,
}: {
  workingMessage: string;
  transcript: string;
  showTranscript: boolean;
}) {
  return (
    <View style={styles.workingWrap}>
      <ActivityIndicator size="large" color={Colors.accent} />
      <Text style={styles.workingText}>{workingMessage}</Text>
      {transcript && showTranscript && (
        <View style={styles.transcriptBox}>
          <Text style={styles.transcriptLabel}>Rozpoznany tekst:</Text>
          <Text style={styles.transcriptText}>{transcript}</Text>
        </View>
      )}
    </View>
  );
}
