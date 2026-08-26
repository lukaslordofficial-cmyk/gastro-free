import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Mic, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import type { Intent } from './types';
import { INTENT_META } from './constants';
import { styles } from './styles';

export function VoiceIdleStage({
  stage,
  errorMsg,
  commandHint,
  commandsUnlocked,
  showCommands,
  onToggleCommands,
  visibleCommands,
  onLegendCommand,
  onStartRecording,
  jarvisAccent,
}: {
  stage: 'idle' | 'error';
  errorMsg: string | null;
  commandHint: string | null;
  commandsUnlocked: boolean;
  showCommands: boolean;
  onToggleCommands: () => void;
  visibleCommands: { intent: Intent; example: string }[];
  onLegendCommand: (c: { intent: Intent; example: string }) => void;
  onStartRecording: () => void;
  jarvisAccent: string;
}) {
  return (
    <View style={styles.idleWrap}>
      <Text
        style={[
          styles.idleHint,
          { color: DS.color.heading },
        ]}
      >
        Powiedz jedną z komend lub kliknij ją na liście
        {commandHint ? `:\n„${commandHint}"` : ', np.:\n„Dodaj do menu pizzę margherita za 32 zł"'}
      </Text>

      {commandsUnlocked ? (
        <>
          <TouchableOpacity
            style={[
              styles.commandsToggle,
              {
                borderColor: 'rgba(0,255,136,0.35)',
                backgroundColor: 'rgba(0,255,120,0.08)',
              },
            ]}
            onPress={onToggleCommands}
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.commandsToggleText,
                { color: jarvisAccent },
              ]}
            >
              {showCommands ? 'Ukryj listę komend' : 'Komendy głosowe'}
            </Text>
          </TouchableOpacity>

          {showCommands ? (
            <ScrollView
              style={[
                styles.commandsList,
                {
                  backgroundColor: 'rgba(22,22,22,0.92)',
                  borderColor: 'rgba(255,255,255,0.08)',
                },
              ]}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {visibleCommands.map((c) => {
                const meta = INTENT_META[c.intent];
                return (
                  <TouchableOpacity
                    key={c.intent + c.example}
                    style={styles.commandRow}
                    onPress={() => { onLegendCommand(c); }}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.commandIcon}>{meta?.icon ?? '🎤'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.commandLabel,
                          { color: '#F8F8F8' },
                        ]}
                      >
                        {meta?.label ?? c.intent}
                      </Text>
                      <Text
                        style={[
                          styles.commandExample,
                          { color: '#A0A0A0' },
                        ]}
                        numberOfLines={2}
                      >
                        „{c.example}"
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}
        </>
      ) : (
        <Text style={[styles.idleHint, { color: DS.color.muted, marginTop: 8 }]}>
          Brak kredytów — lista komend AI jest ukryta. Dostępna pozostaje edycja manualna.
          Doładuj kredyty lub wykup subskrypcję, aby odblokować Jarvis.
        </Text>
      )}

      <TouchableOpacity
        style={[styles.recBtn, styles.recBtnStart, { backgroundColor: jarvisAccent, shadowColor: jarvisAccent }]}
        onPress={onStartRecording}
        activeOpacity={0.85}
        testID="voice-record-start"
      >
        <Mic size={30} color={Colors.white} strokeWidth={2.5} />
      </TouchableOpacity>
      <Text style={styles.recBtnLabel}>Rozpocznij nagrywanie</Text>
      {stage === 'error' && errorMsg && (
        <View style={styles.errorBox} testID="voice-error-box">
          <AlertTriangle size={14} color={Colors.danger} strokeWidth={2.5} />
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}
    </View>
  );
}
