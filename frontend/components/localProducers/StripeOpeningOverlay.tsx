/**
 * Pełnoekranowy komunikat podczas przygotowania / otwierania Stripe Checkout.
 */
import React from 'react';
import { Modal, View, Text, ActivityIndicator, StyleSheet } from 'react-native';

type Props = {
  visible: boolean;
  message?: string;
};

export function StripeOpeningOverlay({
  visible,
  message = 'Otwieranie Stripe…',
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay} pointerEvents="auto">
        <View style={styles.card}>
          <ActivityIndicator size="large" color="#00FF88" />
          <Text style={styles.title}>{message}</Text>
          <Text style={styles.hint}>Za chwilę otworzy się bezpieczna płatność BLIK / kartą.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#121A16',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: '#F5F5F5',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  hint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
