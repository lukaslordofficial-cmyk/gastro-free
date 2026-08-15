/**
 * Modal eksportu raportów Finanse: typ + zakres dat + PDF / Excel.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import { FileDown, FileSpreadsheet, X } from 'lucide-react-native';
import { PremiumColors, PremiumTokens, DS } from '@/constants/premiumTheme';
import { ExpiryDateField } from '@/components/ExpiryDateField';
import {
  generateAndShareFinancePdf,
  type FinancePdfReportKind,
} from '@/services/financeReportPdf';
import { generateAndShareFinanceExcel } from '@/services/financeReportExcel';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Domyślny miesiąc panelu YYYY-MM — ustawia zakres na cały ten miesiąc. */
  defaultMonth?: string;
};

type ExportFormat = 'pdf' | 'excel';

function monthBounds(ym: string | undefined): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
  const now = new Date();
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) : now.getMonth() + 1;
  const from = `${y}-${String(mo).padStart(2, '0')}-01`;
  const last = new Date(y, mo, 0).getDate();
  const to = `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

const KINDS: { key: FinancePdfReportKind; title: string; subtitle: string }[] = [
  {
    key: 'comprehensive',
    title: 'Raport zbiorczy',
    subtitle:
      'P&L, top/najsłabsze dania, zużycie magazynu, straty w zł, najlepsze i najgorsze dni, dostawy',
  },
  {
    key: 'pnl',
    title: 'Koszty, przychody i zyski',
    subtitle: 'Podsumowanie KPI + listy pozycji w okresie',
  },
  {
    key: 'purchases',
    title: 'Dostawy i zakupy',
    subtitle: 'Faktury materiałowe oraz zamówienia do dostawców',
  },
];

export function FinancePdfExportModal({ visible, onClose, defaultMonth }: Props) {
  const initial = useMemo(() => monthBounds(defaultMonth), [defaultMonth]);
  const [kind, setKind] = useState<FinancePdfReportKind>('comprehensive');
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (!visible) return;
    const b = monthBounds(defaultMonth);
    setFrom(b.from);
    setTo(b.to);
  }, [visible, defaultMonth]);

  const onGenerate = async () => {
    if (busy) return;
    if (!from || !to) {
      Alert.alert('Zakres dat', 'Wybierz datę początkową i końcową.');
      return;
    }
    if (from > to) {
      Alert.alert('Zakres dat', 'Data „od” nie może być późniejsza niż „do”.');
      return;
    }
    setBusy(true);
    try {
      if (format === 'excel') {
        await generateAndShareFinanceExcel(kind, { from, to });
      } else {
        await generateAndShareFinancePdf(kind, { from, to });
      }
      onClose();
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : format === 'excel'
            ? 'Nie udało się wygenerować Excela.'
            : 'Nie udało się wygenerować PDF.';
      Alert.alert(format === 'excel' ? 'Eksport Excel' : 'Eksport PDF', msg);
    } finally {
      setBusy(false);
    }
  };

  const ctaLabel =
    format === 'excel'
      ? Platform.OS === 'web'
        ? 'Pobierz Excel'
        : 'Generuj i udostępnij Excel'
      : Platform.OS === 'web'
        ? 'Generuj i drukuj PDF'
        : 'Generuj i udostępnij PDF';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={styles.headTitleRow}>
              <FileDown size={18} color={PremiumColors.neon} strokeWidth={2.4} />
              <Text style={styles.title}>Pobierz raport</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} disabled={busy}>
              <X size={20} color={PremiumColors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <Text style={styles.sectionLabel}>Format</Text>
          <View style={styles.formatRow}>
            <TouchableOpacity
              style={[styles.formatBtn, format === 'pdf' && styles.formatBtnActive]}
              onPress={() => setFormat('pdf')}
              disabled={busy}
              activeOpacity={0.85}
            >
              <FileDown
                size={16}
                color={format === 'pdf' ? PremiumColors.neon : PremiumColors.textMuted}
              />
              <Text style={[styles.formatText, format === 'pdf' && styles.formatTextActive]}>
                PDF
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.formatBtn, format === 'excel' && styles.formatBtnActive]}
              onPress={() => setFormat('excel')}
              disabled={busy}
              activeOpacity={0.85}
              testID="finance-export-format-excel"
            >
              <FileSpreadsheet
                size={16}
                color={format === 'excel' ? PremiumColors.neon : PremiumColors.textMuted}
              />
              <Text style={[styles.formatText, format === 'excel' && styles.formatTextActive]}>
                Excel
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Typ raportu</Text>
          {KINDS.map((k) => {
            const active = kind === k.key;
            return (
              <TouchableOpacity
                key={k.key}
                style={[styles.kindBtn, active && styles.kindBtnActive]}
                onPress={() => setKind(k.key)}
                disabled={busy}
                activeOpacity={0.85}
              >
                <Text style={[styles.kindTitle, active && styles.kindTitleActive]}>{k.title}</Text>
                <Text style={styles.kindSub}>{k.subtitle}</Text>
              </TouchableOpacity>
            );
          })}

          <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Zakres dat</Text>
          <View style={styles.dates}>
            <View style={{ flex: 1 }}>
              <ExpiryDateField
                label="Od"
                value={from}
                onChange={setFrom}
                textColor={PremiumColors.text}
                mutedColor={PremiumColors.textMuted}
                borderColor={PremiumColors.border}
                bgColor={PremiumTokens.color.bgMid}
                accentColor={PremiumColors.neon}
                sheetBgColor={DS.color.bgSecondary}
                testID="finance-pdf-from"
              />
            </View>
            <View style={{ flex: 1 }}>
              <ExpiryDateField
                label="Do"
                value={to}
                onChange={setTo}
                textColor={PremiumColors.text}
                mutedColor={PremiumColors.textMuted}
                borderColor={PremiumColors.border}
                bgColor={PremiumTokens.color.bgMid}
                accentColor={PremiumColors.neon}
                sheetBgColor={DS.color.bgSecondary}
                testID="finance-pdf-to"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.cta, busy && styles.ctaDisabled]}
            onPress={() => void onGenerate()}
            disabled={busy}
            activeOpacity={0.88}
            testID="finance-pdf-generate"
          >
            {busy ? (
              <ActivityIndicator color="#04140C" />
            ) : (
              <Text style={styles.ctaText}>{ctaLabel}</Text>
            )}
          </TouchableOpacity>
          </ScrollView>
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
    padding: 20,
  },
  sheet: {
    backgroundColor: PremiumTokens.color.cardElevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    padding: 18,
    maxHeight: '92%',
  },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: 4 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: PremiumColors.text, fontSize: 17, fontWeight: '800' },
  sectionLabel: {
    color: PremiumColors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  formatRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  formatBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    backgroundColor: PremiumTokens.color.bgMid,
    borderRadius: 12,
    paddingVertical: 12,
  },
  formatBtnActive: {
    borderColor: PremiumColors.neon,
    backgroundColor: PremiumColors.neonSoft,
  },
  formatText: { color: PremiumColors.textMuted, fontSize: 14, fontWeight: '700' },
  formatTextActive: { color: PremiumColors.neon },
  kindBtn: {
    borderWidth: 1,
    borderColor: PremiumColors.border,
    backgroundColor: PremiumTokens.color.bgMid,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  kindBtnActive: {
    borderColor: PremiumColors.neon,
    backgroundColor: PremiumColors.neonSoft,
  },
  kindTitle: { color: PremiumColors.text, fontSize: 14, fontWeight: '700' },
  kindTitleActive: { color: PremiumColors.neon },
  kindSub: { color: PremiumColors.textMuted, fontSize: 12, marginTop: 2 },
  dates: { flexDirection: 'row', gap: 10 },
  cta: {
    marginTop: 18,
    backgroundColor: PremiumColors.neon,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.7 },
  ctaText: { color: '#04140C', fontWeight: '800', fontSize: 14 },
});
