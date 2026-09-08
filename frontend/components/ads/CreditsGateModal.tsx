import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { RewardedCreditsButton } from '@/components/ads/RewardedCreditsButton';

type Props = {
  visible: boolean;
  onClose: () => void;
  actionLabel?: string;
};

/**
 * Brak kredytów — tylko reklama rewarded (bez steerowania do zakupu).
 */
export function CreditsGateModal({
  visible,
  onClose,
  actionLabel = 'tę funkcję AI',
}: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const bg = prem ? DS.color.surfaceCard : Colors.card;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const border = prem ? DS.color.borderSubtle : Colors.border;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: bg, borderColor: border }]}>
          <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={12}>
            <X size={20} color={muted} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: text }]}>Brak kredytów AI</Text>
          <Text style={[styles.body, { color: muted }]}>
            Skończyły się kredyty AI potrzebne do: {actionLabel}. Obejrzyj krótką reklamę, żeby
            dostać darmowy kredyt.
          </Text>
          <RewardedCreditsButton
            testID="credits-gate-rewarded"
            onGranted={() => onClose()}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
  },
  close: { position: 'absolute', top: 14, right: 14, padding: 4, zIndex: 2 },
  title: { fontSize: 18, fontWeight: '900', marginBottom: 10, paddingRight: 28 },
  body: { fontSize: 14, lineHeight: 21, marginBottom: 18 },
});
