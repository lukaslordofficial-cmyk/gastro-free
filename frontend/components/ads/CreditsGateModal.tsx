import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { PlayCircle, ShoppingBag, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAds } from '@/contexts/AdsProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  actionLabel?: string;
};

export function CreditsGateModal({ visible, onClose, actionLabel = 'to skanowanie' }: Props) {
  const { addRewardCredit } = useSubscription();
  const { showRewarded, canShowRewarded, nativeAvailable } = useAds();
  const [busy, setBusy] = useState(false);

  const watchAd = async () => {
    setBusy(true);
    try {
      if (!nativeAvailable || !canShowRewarded) return;
      const earned = await showRewarded();
      if (earned) {
        await addRewardCredit();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <TouchableOpacity style={styles.close} onPress={onClose}>
            <X size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.title}>Brak kredytów AI</Text>
          <Text style={styles.body}>
            Szefie, skończyły się darmowe kredyty AI. Możesz dokupić pakiet w zakładce Subskrypcja
            lub obejrzeć kilka wideo sponsorowanych, aby zdobyć kredyty na {actionLabel}.
          </Text>
          <TouchableOpacity style={styles.watchBtn} onPress={watchAd} disabled={busy || !canShowRewarded}>
            {busy
              ? <ActivityIndicator color={Colors.white} />
              : <>
                  <PlayCircle size={18} color={Colors.white} strokeWidth={2.2} />
                  <Text style={styles.watchText}>Oglądaj wideo (+1 kredyt)</Text>
                </>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.shopBtn} onPress={onClose}>
            <ShoppingBag size={16} color={Colors.accent} strokeWidth={2.2} />
            <Text style={styles.shopText}>Przejdź do Subskrypcji</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: Colors.card, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: Colors.border },
  close: { position: 'absolute', top: 14, right: 14, padding: 4 },
  title: { fontSize: 18, fontWeight: '900', color: Colors.textPrimary, marginBottom: 10 },
  body: { fontSize: 14, color: Colors.textSecondary, lineHeight: 21, marginBottom: 18 },
  watchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#7C3AED', borderRadius: 12, paddingVertical: 13, marginBottom: 10,
  },
  watchText: { color: Colors.white, fontWeight: '800', fontSize: 14 },
  shopBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  shopText: { color: Colors.accent, fontWeight: '700', fontSize: 13 },
});
