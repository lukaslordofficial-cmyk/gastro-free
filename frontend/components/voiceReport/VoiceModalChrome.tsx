import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Mic, X } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';
import { styles } from './styles';

export function VoiceModalChrome({
  visible,
  onClose,
  contextHint,
  jarvisAccent,
  jarvisCtaText,
  creditsNotice,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  contextHint?: string;
  jarvisAccent: string;
  jarvisCtaText: string;
  creditsNotice: string | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.72)' }]}>
        <View style={[
          styles.sheet,
          {
            backgroundColor: DS.color.bgSecondary,
            borderTopWidth: 1,
            borderColor: DS.color.borderSubtle,
          },
        ]}>
          <View style={[styles.header, { borderBottomColor: DS.color.borderSubtle }]}>
            <View style={styles.headerLeft}>
              <View style={[styles.iconBadge, { backgroundColor: jarvisAccent, shadowColor: jarvisAccent }]}>
                <Mic size={16} color={jarvisCtaText} strokeWidth={2.5} />
              </View>
              <View>
                <Text style={[styles.title, { color: jarvisAccent }]} testID="voice-modal-title">
                  Jarvis · dyktowanie
                </Text>
                <Text style={[styles.subtitle, { color: DS.color.muted }]}>
                  {contextHint ? `${contextHint} · ` : ''}dyktowanie AI
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: '#222' }]}
              testID="voice-modal-close"
            >
              <X size={20} color={DS.color.muted} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {creditsNotice ? (
            <View style={styles.creditsNotice} testID="voice-credits-notice">
              <Text style={styles.creditsNoticeText}>{creditsNotice}</Text>
            </View>
          ) : null}

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
      {footer}
    </Modal>
  );
}
