/**
 * Czytelny podgląd pozycji faktury / kosztu zmiennego (modal).
 */
import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/hooks/useAppTheme';
import {
  formatInvoiceLineLabel,
  parseInvoiceCostNote,
  type InvoiceCostPayload,
} from '@/lib/invoiceCostNote';
import { formatPln } from '@/lib/format';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  amountPln?: number;
  note?: string | null;
};

export function InvoiceCostPreviewModal({
  visible,
  onClose,
  title,
  amountPln,
  note,
}: Props) {
  const t = useAppTheme();
  const invoice: InvoiceCostPayload | null = parseInvoiceCostNote(note);
  const lines = invoice?.lines ?? [];
  const supplier = invoice?.supplier_name;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
            <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>
              {title}
            </Text>
            {supplier ? (
              <Text style={{ color: t.textMuted, fontSize: 13, marginTop: 4 }}>
                {supplier}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={[styles.close, { backgroundColor: t.border }]}
          >
            <X size={18} color={t.text} strokeWidth={2.2} />
          </Pressable>
        </View>
        {amountPln != null ? (
          <View style={[styles.amountRow, { borderBottomColor: t.border }]}>
            <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>Kwota</Text>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>
              {formatPln(amountPln)}
            </Text>
          </View>
        ) : null}
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={[styles.section, { color: t.textSecondary }]}>
            Pozycje ({lines.length})
          </Text>
          {lines.length === 0 ? (
            <Text style={{ color: t.textMuted, fontSize: 14, lineHeight: 20 }}>
              Brak szczegółowych pozycji w notatce.
            </Text>
          ) : (
            lines.map((line, i) => (
              <View
                key={`line-${i}`}
                style={[styles.line, { borderBottomColor: t.border }]}
              >
                <Text style={[styles.lineText, { color: t.text }]}>
                  {formatInvoiceLineLabel(line)}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  line: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lineText: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
});
