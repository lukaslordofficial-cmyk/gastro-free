/**
 * Sekcja „Dokumenty rozliczeniowe” — rachunek/faktura ze strumienia API.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { FileText, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { downloadProducerOrderInvoice } from '@/services/localProducers/invoiceClient';

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
    id?: string | null;
    invoice_url?: string | null;
    settlement_invoice_url?: string | null;
    invoice_file_url?: string | null;
  };
  isPremium?: boolean;
};

export function SettlementDocumentsSection({ order, isPremium }: Props) {
  const { alert } = usePremiumAlert();
  const [busy, setBusy] = useState(false);
  const uploaded = Boolean(orderInvoiceUrl(order));
  const orderId = String(order.id || '').trim();
  const titleColor = isPremium ? '#F5F5F5' : Colors.textPrimary;
  const muted = isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const cardBg = isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = isPremium ? 'rgba(255,255,255,0.10)' : Colors.border;
  const accent = isPremium ? DS_NEON : Colors.accent;

  const downloadInvoice = () => {
    if (!orderId || busy) return;
    void (async () => {
      setBusy(true);
      try {
        const result = await downloadProducerOrderInvoice(orderId);
        if (!result.ok) {
          alert('Dokument', result.message || 'Nie udało się pobrać rachunku.', [
            { text: 'OK', style: 'primary' },
          ]);
        }
      } catch (e) {
        alert(
          'Dokument',
          e instanceof Error ? e.message : 'Nie udało się pobrać rachunku.',
          [{ text: 'OK', style: 'primary' }],
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <View
      style={[styles.box, { backgroundColor: cardBg, borderColor: border }]}
      onStartShouldSetResponder={() => true}
    >
      <View style={styles.head}>
        <FileText size={16} color={accent} />
        <Text style={[styles.title, { color: titleColor }]}>Dokumenty rozliczeniowe</Text>
      </View>
      <Text style={[styles.wait, { color: muted }]}>
        {uploaded
          ? 'Dokument od dostawcy jest gotowy — pobierz PDF w aplikacji.'
          : 'Rachunek pojawi się tutaj, gdy lokalny dystrybutor wgra dokument w panelu.'}
      </Text>
      {uploaded ? (
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: accent, opacity: busy || !orderId ? 0.7 : 1 }]}
        onPress={downloadInvoice}
        activeOpacity={0.85}
        disabled={busy || !orderId}
        accessibilityRole="button"
        accessibilityLabel="Pobierz rachunek"
      >
        {busy ? (
          <ActivityIndicator color={isPremium ? '#0A0A0A' : '#fff'} />
        ) : (
          <Download size={16} color={isPremium ? '#0A0A0A' : '#fff'} />
        )}
        <Text style={[styles.btnText, { color: isPremium ? '#0A0A0A' : '#fff' }]}>
          {busy ? 'Pobieranie…' : 'Pobierz rachunek'}
        </Text>
      </TouchableOpacity>
      ) : null}
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
