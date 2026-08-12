/**
 * Sekcja „Dokumenty rozliczeniowe” — faktura/rachunek od dystrybutora.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { FileText, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { usePremiumAlert } from '@/components/PremiumAlert';

const DS_NEON = '#00FF88';

export function orderInvoiceUrl(order: {
  invoice_url?: string | null;
  settlement_invoice_url?: string | null;
  invoice_file_url?: string | null;
}): string {
  return String(
    order.invoice_url || order.settlement_invoice_url || order.invoice_file_url || '',
  ).trim();
}

type Props = {
  order: {
    invoice_url?: string | null;
    settlement_invoice_url?: string | null;
    invoice_file_url?: string | null;
  };
  isPremium?: boolean;
};

export function SettlementDocumentsSection({ order, isPremium }: Props) {
  const { alert } = usePremiumAlert();
  const url = orderInvoiceUrl(order);
  const titleColor = isPremium ? '#F5F5F5' : Colors.textPrimary;
  const muted = isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const cardBg = isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = isPremium ? 'rgba(255,255,255,0.10)' : Colors.border;
  const accent = isPremium ? DS_NEON : Colors.accent;

  const openInvoice = () => {
    if (!url) return;
    void (async () => {
      try {
        const can = await Linking.canOpenURL(url);
        if (!can) {
          alert('Dokument', 'Nie można otworzyć pliku na tym urządzeniu.', [
            { text: 'OK', style: 'primary' },
          ]);
          return;
        }
        await Linking.openURL(url);
      } catch (e) {
        alert(
          'Dokument',
          e instanceof Error ? e.message : 'Nie udało się otworzyć faktury.',
          [{ text: 'OK', style: 'primary' }],
        );
      }
    })();
  };

  return (
    <View style={[styles.box, { backgroundColor: cardBg, borderColor: border }]}>
      <View style={styles.head}>
        <FileText size={16} color={accent} />
        <Text style={[styles.title, { color: titleColor }]}>Dokumenty rozliczeniowe</Text>
      </View>
      {url ? (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: accent }]}
          onPress={openInvoice}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Pobierz Fakturę / Rachunek"
        >
          <Download size={16} color={isPremium ? '#0A0A0A' : '#fff'} />
          <Text style={[styles.btnText, { color: isPremium ? '#0A0A0A' : '#fff' }]}>
            Pobierz Fakturę / Rachunek
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={[styles.wait, { color: muted }]}>
          Oczekiwanie na dokument od dostawcy
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginTop: 10,
    gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 13, fontWeight: '800' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  btnText: { fontSize: 13, fontWeight: '800' },
  wait: { fontSize: 12, lineHeight: 17 },
});
