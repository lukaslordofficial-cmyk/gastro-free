import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  X,
  FileText,
  Camera,
  Sparkles,
  Check,
  CircleAlert,
  ScanLine,
  ReceiptText,
  Tags,
  Eye,
  EyeOff,
  TrendingUp,
  ChevronDown,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { formatPln, formatPlnNumber, parsePln } from '@/lib/format';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

export const DOC_CATEGORIES = [
  'Mięso i wędliny', 'Nabiał', 'Warzywa i owoce', 'Alkohole', 'Napoje',
  'Mrożonki', 'Chemia i czystość', 'Opakowania', 'Inne',
];

type Stage = 'choose' | 'processing' | 'invoice_preview' | 'result';

interface InvoiceProduct {
  product_name: string;
  quantity: number;
  price_netto: number;
  unit: string;
  category: string;
}

interface DocResult {
  document_type: 'FAKTURA_ZAKUPOWA' | 'OFERTA_HANDLOWA';
  supplier_name?: string | null;
  items_updated?: number;
  items_created?: number;
  total_amount?: number;
  products_total?: number;
  visible_count?: number;
  hidden_count?: number;
  warnings?: string[];
}

interface Props {
  supplierId?: string | null;
  supplierName?: string;
  visible: boolean;
  onClose: () => void;
  onConfirmed: () => void;
}

export function CatalogScanModal({ supplierId, supplierName, visible, onClose, onConfirmed }: Props) {
  const [stage, setStage] = useState<Stage>('choose');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DocResult | null>(null);
  // invoice preview
  const [invSupplierId, setInvSupplierId] = useState<string | null>(null);
  const [invSupplierName, setInvSupplierName] = useState<string>('');
  const [invTotal, setInvTotal] = useState<number>(0);
  const [invProducts, setInvProducts] = useState<InvoiceProduct[]>([]);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  const reset = useCallback(() => {
    setStage('choose');
    setError(null);
    setResult(null);
    setInvProducts([]);
    setPickerIndex(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const processFile = useCallback(
    async (uri: string, name: string, mimeType: string) => {
      setStage('processing');
      setError(null);
      try {
        const form = new FormData();
        form.append('file', { uri, name, type: mimeType } as any);
        if (supplierId) form.append('supplier_id', supplierId);
        const res = await fetch(`${BACKEND_URL}/api/documents/process`, { method: 'POST', body: form });
        if (!res.ok) {
          const txt = await res.text();
          let detail = txt;
          try { detail = JSON.parse(txt).detail ?? txt; } catch {}
          throw new Error(detail || `Błąd serwera (${res.status})`);
        }
        const data = await res.json();
        if (data.document_type === 'FAKTURA_ZAKUPOWA') {
          setInvSupplierId(data.supplier_id ?? null);
          setInvSupplierName(data.supplier_name ?? '');
          setInvTotal(Number(data.total_amount ?? 0));
          setInvProducts(
            (data.products ?? []).map((p: any) => ({
              product_name: p.product_name,
              quantity: Number(p.quantity ?? 0),
              price_netto: Number(p.price_netto ?? 0),
              unit: p.unit ?? 'szt',
              category: p.category ?? 'Inne',
            }))
          );
          setStage('invoice_preview');
        } else {
          setResult(data);
          setStage('result');
          onConfirmed();
        }
      } catch (e: any) {
        setError(e.message ?? 'Nie udało się przetworzyć dokumentu.');
        setStage('choose');
      }
    },
    [supplierId, onConfirmed]
  );

  const handlePickFile = useCallback(async () => {
    const r = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'],
      copyToCacheDirectory: true,
    });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    await processFile(a.uri, a.name ?? 'dokument', a.mimeType ?? 'application/pdf');
  }, [processFile]);

  const handleCamera = useCallback(async () => {
    let perm = await ImagePicker.getCameraPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Brak dostępu do aparatu. Włącz uprawnienia aparatu w Ustawieniach.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.85, mediaTypes: ['images'] });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    await processFile(a.uri, a.fileName ?? 'zdjecie.jpg', a.mimeType ?? 'image/jpeg');
  }, [processFile]);

  const confirmInvoice = useCallback(async () => {
    setStage('processing');
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/documents/confirm-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: invSupplierId,
          supplier_name: invSupplierName,
          total_amount: invTotal,
          products: invProducts,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        let detail = txt;
        try { detail = JSON.parse(txt).detail ?? txt; } catch {}
        throw new Error(detail || `Błąd serwera (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
      setStage('result');
      onConfirmed();
    } catch (e: any) {
      setError(e.message ?? 'Nie udało się zaksięgować faktury.');
      setStage('invoice_preview');
    }
  }, [invSupplierId, invSupplierName, invTotal, invProducts, onConfirmed]);

  const setRowCategory = useCallback((idx: number, cat: string) => {
    setInvProducts((prev) => prev.map((p, i) => (i === idx ? { ...p, category: cat } : p)));
    setPickerIndex(null);
  }, []);

  const setRowQuantity = useCallback((idx: number, value: string) => {
    setInvProducts((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, quantity: parsePln(value) } : p))
    );
  }, []);

  const setRowPrice = useCallback((idx: number, value: string) => {
    setInvProducts((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, price_netto: parsePln(value) } : p))
    );
  }, []);

  const isInvoice = result?.document_type === 'FAKTURA_ZAKUPOWA';
  const headerSub = supplierId ? supplierName : (invSupplierName || 'AI rozpozna dostawcę');

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}><ScanLine size={18} color={Colors.accent} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Skan dokumentu AI</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{headerSub}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID="doc-scan-close">
            <X size={22} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {error && (
          <View style={styles.errorBox} testID="doc-scan-error">
            <CircleAlert size={15} color={Colors.danger} strokeWidth={2} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {stage === 'choose' && (
          <ScrollView contentContainerStyle={styles.chooseWrap}>
            <View style={styles.hintCard}>
              <Sparkles size={16} color={Colors.warning} strokeWidth={2} />
              <Text style={styles.hintText}>
                Wgraj <Text style={styles.b}>fakturę</Text> lub <Text style={styles.b}>ofertę/gazetkę</Text>.
                GPT-4o rozpozna dokument, skategoryzuje produkty, a fakturę pokaże do zatwierdzenia.
                {!supplierId ? ' Dostawca zostanie rozpoznany i dodany automatycznie.' : ''} Plik nie jest zapisywany.
              </Text>
            </View>
            <View style={styles.pathRow}>
              <View style={styles.pathCard}>
                <ReceiptText size={18} color={Colors.success} strokeWidth={2} />
                <Text style={styles.pathTitle}>Faktura</Text>
                <Text style={styles.pathSub}>podgląd → magazyn + koszt</Text>
              </View>
              <View style={styles.pathCard}>
                <Tags size={18} color={Colors.accent} strokeWidth={2} />
                <Text style={styles.pathTitle}>Oferta</Text>
                <Text style={styles.pathSub}>→ katalog dostawcy</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.sourceBtn} onPress={handleCamera} testID="doc-scan-camera" activeOpacity={0.85}>
              <View style={[styles.sourceIcon, { backgroundColor: Colors.accentLight }]}><Camera size={22} color={Colors.accent} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceTitle}>Zrób zdjęcie</Text>
                <Text style={styles.sourceSub}>Sfotografuj fakturę lub ofertę</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sourceBtn} onPress={handlePickFile} testID="doc-scan-file" activeOpacity={0.85}>
              <View style={[styles.sourceIcon, { backgroundColor: '#F0FDF4' }]}><FileText size={22} color={Colors.success} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceTitle}>Wgraj plik</Text>
                <Text style={styles.sourceSub}>PDF, JPG lub PNG</Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        )}

        {stage === 'processing' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.analyzingTitle}>Przetwarzanie…</Text>
            <Text style={styles.analyzingSub}>GPT-4o rozpoznaje i kategoryzuje</Text>
          </View>
        )}

        {stage === 'invoice_preview' && (
          <>
            <View style={styles.invHeader}>
              <View style={styles.typeBadge}>
                <ReceiptText size={13} color={Colors.success} strokeWidth={2} />
                <Text style={[styles.typeBadgeText, { color: Colors.success }]}>Faktura zakupowa</Text>
              </View>
              <Text style={styles.invTotal}>Do zapłaty: {formatPln(invTotal)}</Text>
            </View>
            <Text style={styles.invHint}>Sprawdź ilość, cenę i kategorię. Możesz je poprawić przy każdej pozycji — AI mogło się pomylić przy niewyraźnych cyfrach.</Text>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.previewContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {invProducts.map((p, idx) => (
                <View key={`${p.product_name}-${idx}`} style={styles.row} testID={`invoice-row-${idx}`}>
                  <View style={{ flex: 1, gap: 8 }}>
                    <Text style={styles.rowName}>{p.product_name}</Text>

                    <View style={styles.editFieldsRow}>
                      <View style={styles.editField}>
                        <Text style={styles.editLabel}>Ilość</Text>
                        <View style={styles.editInputWrap}>
                          <TextInput
                            style={styles.editInput}
                            value={String(p.quantity ?? '')}
                            onChangeText={(v) => setRowQuantity(idx, v)}
                            keyboardType="decimal-pad"
                            selectTextOnFocus
                            testID={`invoice-quantity-${idx}`}
                          />
                          <Text style={styles.editSuffix}>{p.unit}</Text>
                        </View>
                      </View>
                      <View style={styles.editField}>
                        <Text style={styles.editLabel}>Cena netto</Text>
                        <View style={styles.editInputWrap}>
                          <TextInput
                            style={styles.editInput}
                            value={formatPlnNumber(p.price_netto)}
                            onChangeText={(v) => setRowPrice(idx, v)}
                            keyboardType="decimal-pad"
                            selectTextOnFocus
                            testID={`invoice-price-${idx}`}
                          />
                          <Text style={styles.editSuffix}>zł</Text>
                        </View>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={styles.catChip}
                      onPress={() => setPickerIndex(idx)}
                      activeOpacity={0.7}
                      testID={`invoice-category-${idx}`}
                    >
                      <Text style={styles.catChipText}>{p.category}</Text>
                      <ChevronDown size={13} color={Colors.accent} strokeWidth={2.5} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <View style={{ height: 12 }} />
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirmInvoice} activeOpacity={0.85} testID="invoice-confirm-btn">
                <Check size={18} color={Colors.white} strokeWidth={2.5} />
                <Text style={styles.confirmBtnText}>Zatwierdź fakturę ({invProducts.length})</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {stage === 'result' && result && (
          <ScrollView contentContainerStyle={styles.resultWrap} testID="doc-result">
            <View style={styles.successCircle}><Check size={38} color={Colors.success} strokeWidth={2.5} /></View>
            {isInvoice ? (
              <>
                <View style={[styles.typeBadge, { backgroundColor: Colors.successLight }]}>
                  <ReceiptText size={13} color={Colors.success} strokeWidth={2} />
                  <Text style={[styles.typeBadgeText, { color: Colors.success }]}>Faktura zaksięgowana</Text>
                </View>
                <Text style={styles.resultTitle}>Faktura zaksięgowana</Text>
                <Text style={styles.resultSub}>{result.supplier_name || 'Dostawca'} · zaktualizowano magazyn i koszty.</Text>
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <Text style={styles.statNum}>{(result.items_updated ?? 0) + (result.items_created ?? 0)}</Text>
                    <Text style={styles.statLabel}>pozycji do magazynu</Text>
                  </View>
                  <View style={styles.statCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <TrendingUp size={16} color={Colors.danger} strokeWidth={2.5} />
                      <Text style={[styles.statNum, { color: Colors.danger }]}>{formatPlnNumber(result.total_amount ?? 0)}</Text>
                    </View>
                    <Text style={styles.statLabel}>PLN kosztu</Text>
                  </View>
                </View>
                <Text style={styles.resultNote}>{result.items_created ?? 0} nowych · {result.items_updated ?? 0} zwiększonych</Text>
              </>
            ) : (
              <>
                <View style={[styles.typeBadge, { backgroundColor: Colors.accentLight }]}>
                  <Tags size={13} color={Colors.accent} strokeWidth={2} />
                  <Text style={[styles.typeBadgeText, { color: Colors.accent }]}>Oferta handlowa</Text>
                </View>
                <Text style={styles.resultTitle}>Oferta przeanalizowana</Text>
                <Text style={styles.resultSub}>{result.supplier_name || 'Dostawca'} · produkty w katalogu.</Text>
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Eye size={15} color={Colors.success} strokeWidth={2.5} />
                      <Text style={[styles.statNum, { color: Colors.success }]}>{result.visible_count ?? 0}</Text>
                    </View>
                    <Text style={styles.statLabel}>widocznych (masz w magazynie)</Text>
                  </View>
                  <View style={styles.statCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <EyeOff size={15} color={Colors.textTertiary} strokeWidth={2.5} />
                      <Text style={[styles.statNum, { color: Colors.textTertiary }]}>{result.hidden_count ?? 0}</Text>
                    </View>
                    <Text style={styles.statLabel}>ukrytych (pojawią się po dodaniu do magazynu)</Text>
                  </View>
                </View>
                <Text style={styles.resultNote}>Znaleziono {result.products_total ?? 0} produktów</Text>
              </>
            )}
            {!!result.warnings?.length && (
              <View style={styles.warnBox}>
                {result.warnings.map((w, i) => (<Text key={i} style={styles.warnText}>• {w}</Text>))}
              </View>
            )}
            <TouchableOpacity style={styles.primaryBtn} onPress={handleClose} testID="doc-result-done">
              <Text style={styles.primaryBtnText}>Gotowe</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* Category picker overlay */}
        <Modal visible={pickerIndex !== null} transparent animationType="fade" onRequestClose={() => setPickerIndex(null)}>
          <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setPickerIndex(null)}>
            <View style={styles.pickerSheet}>
              <Text style={styles.pickerTitle}>Wybierz kategorię</Text>
              {DOC_CATEGORIES.map((cat) => {
                const active = pickerIndex !== null && invProducts[pickerIndex]?.category === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.pickerRow, active && styles.pickerRowActive]}
                    onPress={() => pickerIndex !== null && setRowCategory(pickerIndex, cat)}
                    testID={`category-option-${cat}`}
                  >
                    <Text style={[styles.pickerRowText, active && styles.pickerRowTextActive]}>{cat}</Text>
                    {active && <Check size={16} color={Colors.accent} strokeWidth={2.5} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  b: { fontWeight: '700', color: Colors.textPrimary },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.card },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.dangerLight, borderColor: '#FECACA', borderWidth: 1, marginHorizontal: 16, marginTop: 12, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 12, color: Colors.danger, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  chooseWrap: { padding: 16, gap: 12 },
  hintCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: Colors.warningLight, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FDE68A' },
  hintText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  pathRow: { flexDirection: 'row', gap: 10 },
  pathCard: { flex: 1, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 12, gap: 3, alignItems: 'flex-start' },
  pathTitle: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  pathSub: { fontSize: 11, color: Colors.textTertiary },
  sourceBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.card, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: Colors.border },
  sourceIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sourceTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  sourceSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  analyzingTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginTop: 6 },
  analyzingSub: { fontSize: 13, color: Colors.textTertiary },
  invHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  invTotal: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  invHint: { fontSize: 12, color: Colors.textTertiary, paddingHorizontal: 16, paddingBottom: 8, lineHeight: 16 },
  previewContent: { paddingHorizontal: 12, paddingTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: Colors.border },
  rowName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowMetaText: { fontSize: 12, color: Colors.textSecondary },
  editFieldsRow: { flexDirection: 'row', gap: 8 },
  editField: { flex: 1, gap: 3 },
  editLabel: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  editInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 8, paddingVertical: 6 },
  editInput: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.textPrimary, paddingVertical: 0 },
  editSuffix: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary, marginLeft: 4 },
  catChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.accentLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#BFDBFE' },
  catChipText: { fontSize: 12, fontWeight: '700', color: Colors.accent },
  footer: { padding: 16, paddingBottom: Platform.OS === 'ios' ? 28 : 16, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.card },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 15 },
  confirmBtnText: { fontSize: 15, fontWeight: '700', color: Colors.white },
  resultWrap: { padding: 20, alignItems: 'center', gap: 8 },
  successCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.successLight, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: Colors.successLight },
  typeBadgeText: { fontSize: 12, fontWeight: '700' },
  resultTitle: { fontSize: 19, fontWeight: '800', color: Colors.textPrimary, marginTop: 4 },
  resultSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 14, alignSelf: 'stretch' },
  statCard: { flex: 1, backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14, alignItems: 'center', gap: 4 },
  statNum: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: Colors.textTertiary, textAlign: 'center', lineHeight: 15 },
  resultNote: { fontSize: 12, color: Colors.textSecondary, marginTop: 10 },
  warnBox: { alignSelf: 'stretch', backgroundColor: Colors.warningLight, borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#FDE68A', gap: 4 },
  warnText: { fontSize: 11, color: Colors.warning, lineHeight: 16 },
  primaryBtn: { alignSelf: 'stretch', backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 20, marginBottom: Platform.OS === 'ios' ? 20 : 8 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: Colors.white },
  pickerOverlay: { flex: 1, backgroundColor: Colors.overlay ?? 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 20 },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary, marginBottom: 10 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 12, borderRadius: 10 },
  pickerRowActive: { backgroundColor: Colors.accentLight },
  pickerRowText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '500' },
  pickerRowTextActive: { color: Colors.accent, fontWeight: '700' },
});
