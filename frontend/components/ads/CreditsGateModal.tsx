import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ShoppingBag, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useRouter } from 'expo-router';

type Props = {
  visible: boolean;
  onClose: () => void;
  actionLabel?: string;
};

/**
 * Brak kredytów — tylko ścieżka do Subskrypcji (bez reklam za tokeny).
 */
export function CreditsGateModal({
  visible,
  onClose,
  actionLabel = 'tę funkcję AI',
}: Props) {
  const theme = useAppTheme();
  const router = useRouter();
  const prem = theme.isPremium;
  const bg = prem ? DS.color.surfaceCard : Colors.card;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const accent = prem ? DS.color.greenEnd : Colors.accent;

  const goSubscription = () => {
    onClose();
    try {
      router.push('/(tabs)/ustawienia' as never);
    } catch {
      /* ignore */
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: bg, borderColor: border }]}>
          <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={12}>
            <X size={20} color={muted} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: text }]}>Brak kredytów AI</Text>
          <Text style={[styles.body, { color: muted }]}>
            Skończyły się kredyty AI potrzebne do: {actionLabel}. Dokup pakiet lub przejdź na plan
            płatny w zakładce Ustawienia / Subskrypcja.
          </Text>
          <TouchableOpacity
            style={[styles.shopBtn, { backgroundColor: accent }]}
            onPress={goSubscription}
            activeOpacity={0.88}
          >
            <ShoppingBag size={16} color={prem ? '#0A0A0A' : Colors.white} strokeWidth={2.2} />
            <Text style={[styles.shopText, { color: prem ? '#0A0A0A' : Colors.white }]}>
              Przejdź do Subskrypcji
            </Text>
          </TouchableOpacity>
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
  shopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
  },
  shopText: { fontWeight: '800', fontSize: 14 },
});
