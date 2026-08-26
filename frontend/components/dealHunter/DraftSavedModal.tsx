import React from 'react';
import { View, Text, Modal, TouchableOpacity } from 'react-native';
import { DS } from '@/constants/premiumTheme';

type Props = {
  info: string | null;
  onClose: () => void;
};

export function DraftSavedModal({ info, onClose }: Props) {
  return (
    <Modal
      visible={!!info}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.78)',
        justifyContent: 'center',
        paddingHorizontal: 28,
      }}>
        <View style={{
          backgroundColor: DS.color.surfaceCard,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: DS.color.borderSubtle,
          padding: 20,
          gap: 14,
        }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: DS.color.heading }}>
            Zapisano w koszyku
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: DS.color.muted }}>
            {info}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.85}
            style={{
              marginTop: 4,
              minHeight: 44,
              borderRadius: 10,
              backgroundColor: DS.color.greenEnd,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#0A0A0A' }}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
