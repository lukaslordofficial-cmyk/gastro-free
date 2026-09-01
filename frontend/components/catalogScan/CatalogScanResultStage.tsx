/**
 * Ekran wyniku skanu dokumentu (faktura / oferta).
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Check, ReceiptText, Tags, TrendingUp, Eye, EyeOff } from 'lucide-react-native';
import { formatPlnNumber } from '@/lib/format';
import type { DocResult } from './catalogScanTypes';
import { supplierMetaHasContent } from './catalogScanHelpers';
import { CATALOG_SCAN_C as C } from './catalogScanColors';
import { catalogScanStyles as styles } from './catalogScanStyles';

type Props = {
  result: DocResult;
  isInvoice: boolean;
  footerPad: number;
  onDone: () => void;
};

export function CatalogScanResultStage({ result, isInvoice, footerPad, onDone }: Props) {
  return (
    <ScrollView contentContainerStyle={[styles.resultWrap, { paddingBottom: footerPad + 24 }]} testID="doc-result">
      <View style={[styles.successCircle, { backgroundColor: C.greenSoft }]}>
        <Check size={38} color={C.green} strokeWidth={2.5} />
      </View>
      {isInvoice ? (
        <>
          <View style={[styles.typeBadge, { backgroundColor: C.greenSoft }]}>
            <ReceiptText size={13} color={C.green} strokeWidth={2} />
            <Text style={[styles.typeBadgeText, { color: C.green }]}>Faktura zaksięgowana</Text>
          </View>
          <Text style={[styles.resultTitle, { color: C.text }]}>Faktura zaksięgowana</Text>
          <Text style={[styles.resultSub, { color: C.body }]}>
            {result.supplier_name || 'Dostawca'} · zaktualizowano magazyn, koszt zmienny
            {result.supplier_fields_updated?.length
              ? ` i profil dostawcy (${result.supplier_fields_updated.length} pól)`
              : supplierMetaHasContent(result.supplier)
                ? ' i dane dostawcy'
                : ''}
            .
          </Text>
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[styles.statNum, { color: C.text }]}>
                {(result.items_updated ?? 0) + (result.items_created ?? 0)}
              </Text>
              <Text style={[styles.statLabel, { color: C.muted }]}>pozycji do magazynu</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <TrendingUp size={16} color={C.danger} strokeWidth={2.5} />
                <Text style={[styles.statNum, { color: C.danger }]}>
                  {formatPlnNumber(result.total_amount ?? 0)}
                </Text>
              </View>
              <Text style={[styles.statLabel, { color: C.muted }]}>PLN kosztu</Text>
            </View>
          </View>
          <Text style={[styles.resultNote, { color: C.body }]}>
            {result.items_created ?? 0} nowych · {result.items_updated ?? 0} zwiększonych
            {result.products_on_invoice != null
              ? ` · z faktury: ${result.products_on_invoice}`
              : ''}
          </Text>
          {(result.created?.length ?? 0) > 0 && (
            <Text style={[styles.resultNote, { color: C.muted, marginTop: 6 }]}>
              Nowe: {(result.created ?? []).map((c) => c.name).filter(Boolean).join(', ')}
            </Text>
          )}
          {(result.updated ?? []).some((u) => u.merged_from) && (
            <Text style={[styles.resultNote, { color: C.muted, marginTop: 4 }]}>
              Scalono:{' '}
              {(result.updated ?? [])
                .filter((u) => u.merged_from)
                .map((u) => `„${u.merged_from}” → „${u.name}”`)
                .join('; ')}
            </Text>
          )}
          {(result.warnings?.length ?? 0) > 0 && (
            <Text style={[styles.resultNote, { color: C.danger, marginTop: 6 }]}>
              {result.warnings!.slice(0, 4).join('\n')}
            </Text>
          )}
        </>
      ) : (
        <>
          <View style={[styles.typeBadge, { backgroundColor: C.greenSoft }]}>
            <Tags size={13} color={C.green} strokeWidth={2} />
            <Text style={[styles.typeBadgeText, { color: C.green }]}>Oferta handlowa</Text>
          </View>
          <Text style={[styles.resultTitle, { color: C.text }]}>Oferta przeanalizowana</Text>
          <Text style={[styles.resultSub, { color: C.body }]}>
            {result.supplier_name || 'Dostawca'} · produkty w katalogu
            {result.supplier_fields_updated?.length
              ? ` · uzupełniono profil (${result.supplier_fields_updated.length} pól)`
              : ''}
            .
          </Text>
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Eye size={15} color={C.green} strokeWidth={2.5} />
                <Text style={[styles.statNum, { color: C.green }]}>{result.visible_count ?? 0}</Text>
              </View>
              <Text style={[styles.statLabel, { color: C.muted }]}>występujące w menu</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <EyeOff size={15} color={C.muted} strokeWidth={2.5} />
                <Text style={[styles.statNum, { color: C.muted }]}>{result.hidden_count ?? 0}</Text>
              </View>
              <Text style={[styles.statLabel, { color: C.muted }]}>dodatkowe (też w katalogu)</Text>
            </View>
          </View>
          <Text style={[styles.resultNote, { color: C.body }]}>
            Znaleziono {result.products_total ?? 0} produktów — wszystkie w katalogu, posegregowane.
          </Text>
        </>
      )}
      {(() => {
        const visibleWarnings = (result.warnings ?? []).filter((w) => {
          const t = String(w || '').toLowerCase();
          if (/klasyfikacja ai|przekroczyła limit czasu|przekroczyla limit czasu|niedostępna — użyto|niedostepna - uzyto|użyto dopasowania|uzyto dopasowania|użyto ścisłego|uzyto scislego/.test(t)) {
            return false;
          }
          if (/było usunięte|bylo usuniete|przywrócono w magazynie|przywrocono w magazynie/.test(t)) {
            return false;
          }
          return true;
        });
        if (!visibleWarnings.length) return null;
        return (
          <View style={[styles.warnBox, { backgroundColor: C.warningSoft, borderColor: C.warningBorder }]}>
            {visibleWarnings.map((w, i) => (
              <Text key={i} style={[styles.warnText, { color: C.warning }]}>• {w}</Text>
            ))}
          </View>
        );
      })()}
      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: C.green }]}
        onPress={onDone}
        testID="doc-result-done"
      >
        <Text style={[styles.primaryBtnText, { color: C.blackOnGreen }]}>Zamknij i powróć do pulpitu</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
