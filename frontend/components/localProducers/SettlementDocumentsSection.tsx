/**
 * Sekcja „Dokumenty rozliczeniowe” — faktura/rachunek od dystrybutora.
 * Storage ref (bucket:path) → podpisany URL przez API, potem WebBrowser / Linking.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { FileText, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  fetchProducerOrderInvoiceUrl,
  isDirectHttpInvoiceUrl,
} from '@/services/localProducers/invoiceClient';

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
  const raw = orderInvoiceUrl(order);
  const orderId = String(order.id || '').trim();
  const titleColor = isPremium ? '#F5F5F5' : Colors.textPrimary;
  const muted = isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const cardBg = isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = isPremium ? 'rgba(255,255,255,0.10)' : Colors.border;
  const accent = isPremium ? DS_NEON : Colors.accent;

  const openInvoice = () => {
    if (!raw || busy) return;
    void (async () => {
      setBusy(true);
      try {
        let openUrl = raw;
        if (!isDirectHttpInvoiceUrl(raw)) {
          if (!orderId) {
            alert('Dokument', 'Brak ID zamówienia — nie można pobrać faktury.', [
              { text: 'OK', style: 'primary' },
            ]);
            return;
          }
          const resolved = await fetchProducerOrderInvoiceUrl(orderId);
          if (!resolved.ok || !resolved.url) {
            alert('Dokument', resolved.message || 'Nie udało się pobrać faktury.', [
              { text: 'OK', style: 'primary' },
            ]);
            return;
          }
          openUrl = resolved.url;
        }

        try {
          await WebBrowser.openBrowserAsync(openUrl, {
            enableBarCollapsing: true,
            showTitle: true,
          });
          return;
        } catch {
          /* fallback Linking */
        }

        if (Platform.OS !== 'web') {
          // Nie gate’uj canOpenURL — signed Storage URL czasem zwraca false na Androidzie.
          await Linking.openURL(openUrl);
          return;
        }
        await Linking.openURL(openUrl);
      } catch (e) {
        alert(
          'Dokument',
          e instanceof Error ? e.message : 'Nie udało się otworzyć faktury.',
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
      {raw ? (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: accent, opacity: busy ? 0.7 : 1 }]}
          onPress={openInvoice}
          activeOpacity={0.85}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Pobierz Fakturę / Rachunek"
        >
          {busy ? (
            <ActivityIndicator color={isPremium ? '#0A0A0A' : '#fff'} />
          ) : (
            <Download size={16} color={isPremium ? '#0A0A0A' : '#fff'} />
          )}
          <Text style={[styles.btnText, { color: isPremium ? '#0A0A0A' : '#fff' }]}>
            {busy ? 'Otwieranie…' : 'Pobierz Fakturę / Rachunek'}
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
