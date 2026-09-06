import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  X,
  CircleAlert,
  ScanLine,
  ReceiptText,
  Check,
  ChevronDown,
} from 'lucide-react-native';
import { formatPln, formatPlnNumber, parsePln } from '@/lib/format';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useAds } from '@/contexts/AdsProvider';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { CreditsGateModal } from '@/components/ads/CreditsGateModal';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import { emitAppDataChanged } from '@/lib/appRefresh';
import {
  InvoiceExpiryReviewForm,
  buildExpiryDrafts,
  type ExpiryProductDraft,
  type CommitProduct,
} from '@/components/InvoiceExpiryReviewForm';
import { CatalogScanChooseStage } from '@/components/catalogScan/CatalogScanChooseStage';
import { CatalogScanProcessingStage } from '@/components/catalogScan/CatalogScanProcessingStage';
import { CatalogScanResultStage } from '@/components/catalogScan/CatalogScanResultStage';
import {
  DOC_CATEGORIES,
  type CatalogScanStage,
  type DocResult,
  type InvoiceProduct,
  type SupplierScanMeta,
} from '@/components/catalogScan/catalogScanTypes';
import {
  CATALOG_SCAN_BACKEND_URL as BACKEND_URL,
  PROCESS_TIMEOUT_MS,
  PROCESSING_MESSAGES,
  SAVING_MESSAGES,
  normalizeSupplierMeta,
  supplierMetaHasContent,
  friendlyCatalogScanApiError as friendlyApiError,
  parseCatalogScanErrorDetail as parseErrorDetail,
} from '@/components/catalogScan/catalogScanHelpers';
import { CATALOG_SCAN_C as C } from '@/components/catalogScan/catalogScanColors';
import { catalogScanStyles as styles } from '@/components/catalogScan/catalogScanStyles';

export { DOC_CATEGORIES } from '@/components/catalogScan/catalogScanTypes';
export type { SupplierScanMeta } from '@/components/catalogScan/catalogScanTypes';

interface Props {
  supplierId?: string | null;
  supplierName?: string;
  visible: boolean;
  onClose: () => void;
  onConfirmed: () => void;
  /**
   * Warstwa tekstowa / UX wejścia:
   * - warehouse — Magazyn / „wgraj fakturę”
   * - supplier — Dostawcy / „wgraj ofertę”
   */
  scanContext?: 'warehouse' | 'supplier';
  /** Gdy AI rozpozna kartę dań — przekieruj do skanera menu. */
  onMenuDetected?: () => void;
}

export function CatalogScanModal({
  supplierId,
  supplierName,
  visible,
  onClose,
  onConfirmed,
  scanContext = 'supplier',
  onMenuDetected,
}: Props) {
  const insets = useSafeAreaInsets();
  const footerPad = Math.max(insets.bottom, 12) + 8;
  const { setCameraOverlay, openDocumentScan } = useUiOverlay();
  const { showInterstitial } = useAds();
  const { tier, credits } = useSubscription();
  const { alert: premiumAlert } = usePremiumAlert();
  const [showCreditsGate, setShowCreditsGate] = useState(false);
  const [stage, setStage] = useState<CatalogScanStage>('choose');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DocResult | null>(null);
  const [invSupplierId, setInvSupplierId] = useState<string | null>(null);
  const [invSupplierName, setInvSupplierName] = useState<string>('');
  const [invSupplierMeta, setInvSupplierMeta] = useState<SupplierScanMeta | null>(null);
  const [invTotal, setInvTotal] = useState<number>(0);
  const [invProducts, setInvProducts] = useState<InvoiceProduct[]>([]);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [expiryDrafts, setExpiryDrafts] = useState<ExpiryProductDraft[]>([]);
  const [userCategories, setUserCategories] = useState<string[]>(DOC_CATEGORIES);
  const [processingMsgIdx, setProcessingMsgIdx] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [scanBusy, setScanBusy] = useState(false);
  const [isSavingProducts, setIsSavingProducts] = useState(false);
  const backgroundRef = useRef(false);
  const processingRef = useRef(false);

  const categoryOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of [...userCategories, ...DOC_CATEGORIES]) {
      const t = (c || '').trim();
      if (t) set.add(t);
    }
    return Array.from(set);
  }, [userCategories]);

  const reset = useCallback(() => {
    setStage('choose');
    setError(null);
    setResult(null);
    setInvProducts([]);
    setInvSupplierId(null);
    setInvSupplierName('');
    setInvSupplierMeta(null);
    setInvTotal(0);
    setPickerIndex(null);
    setExpiryDrafts([]);
    setProcessingMsgIdx(0);
    setElapsedSec(0);
    setScanBusy(false);
    setIsSavingProducts(false);
    backgroundRef.current = false;
    processingRef.current = false;
  }, []);

  useEffect(() => {
    setCameraOverlay(visible || scanBusy);
    return () => setCameraOverlay(false);
  }, [visible, scanBusy, setCameraOverlay]);

  useEffect(() => {
    if (!visible || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('inventory_categories')
          .select('name')
          .eq('account_key', getAccountKey())
          .order('sort_order')
          .limit(200);
        if (cancelled) return;
        const names = (data || [])
          .map((r: any) => String(r?.name || '').trim())
          .filter(Boolean);
        if (names.length) setUserCategories(names);
      } catch {
        /* keep defaults */
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  useEffect(() => {
    if (stage !== 'processing') return;
    setProcessingMsgIdx(0);
    setElapsedSec(0);
    const msgs = isSavingProducts ? SAVING_MESSAGES : PROCESSING_MESSAGES;
    const msgTimer = setInterval(() => {
      setProcessingMsgIdx((i) => (i + 1) % msgs.length);
    }, 3500);
    const secTimer = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => {
      clearInterval(msgTimer);
      clearInterval(secTimer);
    };
  }, [stage, isSavingProducts]);

  const handleClose = useCallback(() => {
    if (stage === 'processing' && !isSavingProducts) {
      backgroundRef.current = true;
      onClose();
      return;
    }
    reset();
    onClose();
  }, [stage, isSavingProducts, reset, onClose]);

  const handleDoneClose = useCallback(async () => {
    await showInterstitial();
    reset();
    onClose();
  }, [showInterstitial, reset, onClose]);

  const ensureCredits = useCallback((): boolean => {
    if (tier === 0 && credits <= 0) {
      setShowCreditsGate(true);
      return false;
    }
    return true;
  }, [tier, credits]);

  const finishWithResult = useCallback(
    (data: DocResult) => {
      processingRef.current = false;
      setScanBusy(false);
      setResult(data);
      setStage('result');
      emitAppDataChanged('all');
      onConfirmed();
      if (backgroundRef.current) {
        backgroundRef.current = false;
        const isOffer = data.document_type === 'OFERTA_HANDLOWA';
        const isInvoice = data.document_type === 'FAKTURA_ZAKUPOWA';
        const refreshHint =
          ' Jeśli produkty nie pojawią się od razu, odśwież aplikację (przeciągnij listę w dół lub otwórz zakładkę ponownie).';
        const pagesHint =
          data.pages_processed != null
            ? ` Przeanalizowano ${data.pages_processed}${
                data.pages_total != null && data.pages_total !== data.pages_processed
                  ? ` z ${data.pages_total}`
                  : ''
              } stron.`
            : '';
        const truncHint = data.pages_truncated
          ? ' Część stron powyżej limitu została pominięta.'
          : '';
        const message = isOffer
          ? `AI zapisało ofertę${data.supplier_name ? ` dla „${data.supplier_name}”` : ''} w zakładce Dostawcy.${pagesHint}${truncHint} Listy odświeżono.${refreshHint}`
          : isInvoice
            ? `AI zaksięgowało fakturę${data.supplier_name ? ` od „${data.supplier_name}”` : ''} w Magazynie.${pagesHint}${truncHint} Listy odświeżono.${refreshHint}`
            : `AI zapisało dane w odpowiednich zakładkach.${pagesHint}${truncHint} Listy odświeżono.${refreshHint}`;
        premiumAlert(
          isOffer ? 'Oferta handlowa gotowa' : isInvoice ? 'Faktura gotowa' : 'Dokument gotowy',
          message,
          [{ text: 'OK', style: 'primary' }],
        );
      }
    },
    [onConfirmed, premiumAlert],
  );

  const processFile = useCallback(
    async (uri: string, name: string, mimeType: string) => {
      if (!ensureCredits()) return;
      if (!BACKEND_URL) {
        setError('Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
        setStage('choose');
        return;
      }
      processingRef.current = true;
      setScanBusy(true);
      backgroundRef.current = false;
      setStage('processing');
      setError(null);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROCESS_TIMEOUT_MS);

      try {
        const form = new FormData();
        form.append('file', { uri, name, type: mimeType } as any);
        if (supplierId) form.append('supplier_id', supplierId);
        const { apiMultipartHeaders } = await import('@/lib/apiHeaders');
        const res = await fetch(`${BACKEND_URL}/api/documents/process`, {
          method: 'POST',
          headers: await apiMultipartHeaders(),
          body: form,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const detail = await parseErrorDetail(res);
          throw new Error(friendlyApiError(res.status, detail));
        }
        const data = await res.json();
        if (data.document_type === 'MENU_RESTAURACYJNE' || data.open_menu_scan) {
          processingRef.current = false;
          setScanBusy(false);
          onMenuDetected?.();
          onClose();
          return;
        }
        if (data.document_type === 'FAKTURA_ZAKUPOWA') {
          processingRef.current = false;
          setScanBusy(false);
          setInvSupplierId(data.supplier_id ?? null);
          setInvSupplierName(data.supplier_name ?? '');
          setInvSupplierMeta(normalizeSupplierMeta(data.supplier));
          setInvTotal(Number(data.total_amount ?? 0));
          if (Array.isArray(data.user_categories) && data.user_categories.length) {
            setUserCategories(data.user_categories.map((c: any) => String(c).trim()).filter(Boolean));
          }
          setInvProducts(
            (data.products ?? []).map((p: any) => ({
              product_name: p.product_name,
              quantity: Number(p.quantity ?? 0),
              price_netto: Number(p.price_netto ?? 0),
              unit: p.unit ?? 'szt',
              category: p.category ?? 'Inne',
              matched_inventory_name: p.matched_inventory_name ?? null,
              will_update_existing: Boolean(p.will_update_existing),
            }))
          );
          setStage('invoice_preview');
          if (backgroundRef.current) {
            backgroundRef.current = false;
            // Automatycznie otwórz okno zatwierdzenia — bez wracania do skanera ręcznie.
            openDocumentScan('invoice');
            premiumAlert(
              'Faktura rozpoznana',
              'Sprawdź pozycje i dane dostawcy, potem zatwierdź — otworzyliśmy podgląd automatycznie.',
              [{ text: 'OK', style: 'primary' }],
            );
          }
        } else {
          finishWithResult(data);
        }
      } catch (e: any) {
        processingRef.current = false;
        setScanBusy(false);
        const aborted = e?.name === 'AbortError' || /aborted/i.test(String(e?.message || ''));
        const msg = aborted
          ? friendlyApiError(504, 'timeout')
          : (e?.message ?? 'Nie udało się przetworzyć dokumentu.');
        setError(msg);
        setStage('choose');
        if (backgroundRef.current) {
          backgroundRef.current = false;
          premiumAlert('Skan nieudany', msg, [{ text: 'OK', style: 'primary' }]);
        }
      } finally {
        clearTimeout(timer);
      }
    },
    [supplierId, ensureCredits, onMenuDetected, onClose, finishWithResult, premiumAlert, openDocumentScan]
  );

  const handlePickFile = useCallback(async () => {
    if (!ensureCredits()) return;
    // Pokaż status od razu — DocumentPicker potrafi „zniknąć” z modalem na Androidzie.
    processingRef.current = true;
    setScanBusy(true);
    setStage('processing');
    setError(null);
    setProcessingMsgIdx(0);
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'],
        copyToCacheDirectory: true,
      });
      if (r.canceled || !r.assets?.[0]) {
        processingRef.current = false;
        setScanBusy(false);
        setStage('choose');
        return;
      }
      const a = r.assets[0];
      await processFile(a.uri, a.name ?? 'dokument', a.mimeType ?? 'application/pdf');
    } catch (e: any) {
      processingRef.current = false;
      setScanBusy(false);
      setError(e?.message ?? 'Nie udało się wybrać pliku.');
      setStage('choose');
    }
  }, [processFile, ensureCredits]);

  const handleCamera = useCallback(async () => {
    if (!ensureCredits()) return;
    processingRef.current = true;
    setScanBusy(true);
    setStage('processing');
    setError(null);
    try {
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        processingRef.current = false;
        setScanBusy(false);
        setError('Brak dostępu do aparatu. Włącz uprawnienia aparatu w Ustawieniach.');
        setStage('choose');
        return;
      }
      const r = await ImagePicker.launchCameraAsync({ quality: 0.85, mediaTypes: ['images'] });
      if (r.canceled || !r.assets?.[0]) {
        processingRef.current = false;
        setScanBusy(false);
        setStage('choose');
        return;
      }
      const a = r.assets[0];
      await processFile(a.uri, a.fileName ?? 'zdjecie.jpg', a.mimeType ?? 'image/jpeg');
    } catch (e: any) {
      processingRef.current = false;
      setScanBusy(false);
      setError(e?.message ?? 'Nie udało się zrobić zdjęcia.');
      setStage('choose');
    }
  }, [processFile, ensureCredits]);

  const confirmInvoice = useCallback(async (productsOverride?: Array<InvoiceProduct | CommitProduct>) => {
    if (!ensureCredits()) return;
    // Ref-lock: chroni przed podwójnym tapnięciem przy wolnym internecie.
    if (processingRef.current) return;

    const products = productsOverride ?? invProducts;
    const productNames = products
      .map((p) => String((p as InvoiceProduct).product_name || (p as CommitProduct).name || '').trim())
      .filter(Boolean);

    const runSave = async (forceDuplicate: boolean) => {
      processingRef.current = true;
      setIsSavingProducts(true);
      setStage('processing');
      setError(null);
      setScanBusy(true);
      try {
        if (!forceDuplicate) {
          try {
            const { findReceivedOrdersForInvoice } = await import('@/services/supplierOrdersService');
            const matches = await findReceivedOrdersForInvoice({
              supplierId: invSupplierId || supplierId || null,
              supplierName: invSupplierName || supplierName || null,
              productNames,
            });
            if (matches.length) {
              processingRef.current = false;
              setScanBusy(false);
              setIsSavingProducts(false);
              setStage(expiryDrafts.length ? 'expiry_review' : 'invoice_preview');
              const first = matches[0];
              const when = first.received_at || first.created_at;
              const whenLabel = (() => {
                try {
                  return new Date(when).toLocaleDateString('pl-PL');
                } catch {
                  return String(when).slice(0, 10);
                }
              })();
              premiumAlert(
                'Dostawa już odebrana',
                `To zamówienie od „${first.suppliers?.name || invSupplierName || 'dostawcy'}” zostało już odebrane ręcznie (${whenLabel}).\n\n`
                + 'Czy na pewno chcesz dodać jeszcze raz te same produkty do magazynu i kwoty do kosztów zmiennych?',
                [
                  {
                    text: 'Nie',
                    style: 'cancel',
                    onPress: () => {
                      processingRef.current = false;
                    },
                  },
                  {
                    text: 'Tak, dodaj jeszcze raz',
                    style: 'primary',
                    onPress: () => void runSave(true),
                  },
                ],
              );
              return;
            }
          } catch {
            /* brak flag / migracji — kontynuuj */
          }
        }

        const { apiJsonHeaders } = await import('@/lib/apiHeaders');
        const res = await fetch(`${BACKEND_URL}/api/documents/confirm-invoice`, {
          method: 'POST',
          headers: await apiJsonHeaders(),
          body: JSON.stringify({
            supplier_id: invSupplierId,
            supplier_name: invSupplierName,
            total_amount: invTotal,
            products,
            destination: 'inventory',
            supplier: invSupplierMeta ?? undefined,
          }),
        });
        if (!res.ok) {
          const detail = await parseErrorDetail(res);
          throw new Error(friendlyApiError(res.status, detail));
        }
        const data = await res.json();
        try {
          const { markPreparingReceivedFromInvoice } = await import('@/services/supplierOrdersService');
          await markPreparingReceivedFromInvoice({
            supplierId: invSupplierId || supplierId || null,
            supplierName: invSupplierName || supplierName || null,
          });
        } catch {
          /* best-effort */
        }
        setIsSavingProducts(false);
        finishWithResult(data);
      } catch (e: any) {
        processingRef.current = false;
        setScanBusy(false);
        setIsSavingProducts(false);
        setError(e.message ?? 'Nie udało się zaksięgować faktury.');
        setStage(expiryDrafts.length ? 'expiry_review' : 'invoice_preview');
      }
    };

    void runSave(false);
  }, [
    invSupplierId,
    invSupplierName,
    invSupplierMeta,
    invTotal,
    invProducts,
    ensureCredits,
    expiryDrafts.length,
    finishWithResult,
    premiumAlert,
    supplierId,
    supplierName,
  ]);

  const goToExpiryReview = useCallback(() => {
    setExpiryDrafts(buildExpiryDrafts(invProducts));
    setStage('expiry_review');
  }, [invProducts]);

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

  // Gdy wracamy z „tła” i wynik już jest — pokaż result
  useEffect(() => {
    if (visible && result && stage === 'result') {
      backgroundRef.current = false;
    }
  }, [visible, result, stage]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <View style={styles.headerLeft}>
            <View style={[styles.headerIcon, { backgroundColor: C.greenSoft }]}>
              <ScanLine size={18} color={C.green} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: C.text }]}>Skan dokumentu AI</Text>
              <Text style={[styles.subtitle, { color: C.muted }]} numberOfLines={1}>{headerSub}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID="doc-scan-close">
            <X size={22} color={C.muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {error && (
          <View style={[styles.errorBox, { backgroundColor: C.dangerSoft, borderColor: 'rgba(255,90,90,0.35)' }]} testID="doc-scan-error">
            <CircleAlert size={15} color={C.danger} strokeWidth={2} />
            <Text style={[styles.errorText, { color: C.danger }]}>{error}</Text>
          </View>
        )}

        {stage === 'choose' && (
          <CatalogScanChooseStage
            scanContext={scanContext}
            onCamera={() => void handleCamera()}
            onPickFile={() => void handlePickFile()}
          />
        )}

        {stage === 'processing' && (
          <CatalogScanProcessingStage
            isSavingProducts={isSavingProducts}
            processingMsgIdx={processingMsgIdx}
            elapsedSec={elapsedSec}
            onBackground={handleClose}
          />
        )}

        {stage === 'invoice_preview' && (
          <>
            <View style={styles.invHeader}>
              <View style={[styles.typeBadge, { backgroundColor: C.greenSoft }]}>
                <ReceiptText size={13} color={C.green} strokeWidth={2} />
                <Text style={[styles.typeBadgeText, { color: C.green }]}>Faktura zakupowa</Text>
              </View>
              <Text style={[styles.invTotal, { color: C.text }]}>Do zapłaty: {formatPln(invTotal)}</Text>
            </View>
            <Text style={[styles.invHint, { color: C.muted }]}>
              Sprawdź ilość, cenę i kategorię. Możesz je poprawić przy każdej pozycji — AI mogło się pomylić przy niewyraźnych cyfrach.
            </Text>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.previewContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {invSupplierName || supplierMetaHasContent(invSupplierMeta) ? (
                <View style={[styles.supplierMetaCard, { backgroundColor: C.card, borderColor: C.border }]} testID="invoice-supplier-meta">
                  <Text style={[styles.supplierMetaTitle, { color: C.text }]}>
                    Dane dostawcy{invSupplierName ? ` · ${invSupplierName}` : ''}
                  </Text>
                  <Text style={[styles.supplierMetaSub, { color: C.muted }]}>
                    Zostaną zapisane w panelu Dostawcy. Numer konta możesz dopisać ręcznie, jeśli nie było go na dokumencie.
                  </Text>
                  <View style={styles.supplierMetaGrid}>
                    {!!invSupplierMeta?.nip && (
                      <View style={styles.supplierMetaRow}>
                        <Text style={[styles.supplierMetaLabel, { color: C.muted }]}>NIP</Text>
                        <Text style={[styles.supplierMetaValue, { color: C.body }]}>{invSupplierMeta.nip}</Text>
                      </View>
                    )}
                    {!!invSupplierMeta?.phone && (
                      <View style={styles.supplierMetaRow}>
                        <Text style={[styles.supplierMetaLabel, { color: C.muted }]}>Telefon</Text>
                        <Text style={[styles.supplierMetaValue, { color: C.body }]}>{invSupplierMeta.phone}</Text>
                      </View>
                    )}
                    {!!invSupplierMeta?.email && (
                      <View style={styles.supplierMetaRow}>
                        <Text style={[styles.supplierMetaLabel, { color: C.muted }]}>E-mail</Text>
                        <Text style={[styles.supplierMetaValue, { color: C.body }]}>{invSupplierMeta.email}</Text>
                      </View>
                    )}
                    {!!invSupplierMeta?.contact_person && (
                      <View style={styles.supplierMetaRow}>
                        <Text style={[styles.supplierMetaLabel, { color: C.muted }]}>Kontakt</Text>
                        <Text style={[styles.supplierMetaValue, { color: C.body }]}>{invSupplierMeta.contact_person}</Text>
                      </View>
                    )}
                    {!!invSupplierMeta?.address && (
                      <View style={styles.supplierMetaRow}>
                        <Text style={[styles.supplierMetaLabel, { color: C.muted }]}>Adres</Text>
                        <Text style={[styles.supplierMetaValue, { color: C.body }]}>{invSupplierMeta.address}</Text>
                      </View>
                    )}
                    <View style={{ marginTop: 4 }}>
                      <Text style={[styles.supplierMetaLabel, { color: C.muted, marginBottom: 6 }]}>
                        Numer konta bankowego
                      </Text>
                      <TextInput
                        style={[
                          styles.bankInput,
                          { color: C.body, borderColor: C.border, backgroundColor: C.inputBg },
                        ]}
                        value={invSupplierMeta?.bank_account ?? ''}
                        onChangeText={(t) =>
                          setInvSupplierMeta((prev) => ({
                            ...(prev ?? {}),
                            bank_account: t,
                          }))
                        }
                        placeholder="PL00 0000 0000 0000 0000 0000 0000"
                        placeholderTextColor={C.muted}
                        autoCapitalize="characters"
                        testID="invoice-supplier-bank-account"
                      />
                    </View>
                    {!!invSupplierMeta?.payment_terms && (
                      <View style={styles.supplierMetaRow}>
                        <Text style={[styles.supplierMetaLabel, { color: C.muted }]}>Płatność</Text>
                        <Text style={[styles.supplierMetaValue, { color: C.body }]}>{invSupplierMeta.payment_terms}</Text>
                      </View>
                    )}
                    {invSupplierMeta?.min_order_value != null && invSupplierMeta.min_order_value > 0 && (
                      <View style={styles.supplierMetaRow}>
                        <Text style={[styles.supplierMetaLabel, { color: C.muted }]}>Min. zamówienie</Text>
                        <Text style={[styles.supplierMetaValue, { color: C.body }]}>
                          {formatPln(invSupplierMeta.min_order_value)}
                        </Text>
                      </View>
                    )}
                    {invSupplierMeta?.shipping_cost != null && (
                      <View style={styles.supplierMetaRow}>
                        <Text style={[styles.supplierMetaLabel, { color: C.muted }]}>Koszt dostawy</Text>
                        <Text style={[styles.supplierMetaValue, { color: C.body }]}>
                          {invSupplierMeta.shipping_cost > 0
                            ? formatPln(invSupplierMeta.shipping_cost)
                            : 'Darmowa'}
                        </Text>
                      </View>
                    )}
                    {invSupplierMeta?.free_shipping_threshold != null
                      && invSupplierMeta.free_shipping_threshold > 0 && (
                      <View style={styles.supplierMetaRow}>
                        <Text style={[styles.supplierMetaLabel, { color: C.muted }]}>Gratis od</Text>
                        <Text style={[styles.supplierMetaValue, { color: C.body }]}>
                          {formatPln(invSupplierMeta.free_shipping_threshold)}
                        </Text>
                      </View>
                    )}
                    {invSupplierMeta?.lead_time_days != null && invSupplierMeta.lead_time_days > 0 && (
                      <View style={styles.supplierMetaRow}>
                        <Text style={[styles.supplierMetaLabel, { color: C.muted }]}>Czas dostawy</Text>
                        <Text style={[styles.supplierMetaValue, { color: C.body }]}>
                          {invSupplierMeta.lead_time_days === 1
                            ? '1 dzień'
                            : `${invSupplierMeta.lead_time_days} dni`}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              ) : null}
              {invProducts.map((p, idx) => (
                <View key={`${p.product_name}-${idx}`} style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]} testID={`invoice-row-${idx}`}>
                  <View style={{ flex: 1, gap: 8 }}>
                    <Text style={[styles.rowName, { color: C.text }]}>{p.product_name}</Text>
                    {p.will_update_existing && p.matched_inventory_name ? (
                      <Text style={[styles.editLabel, { color: C.muted }]}>
                        Zwiększy stan: „{p.matched_inventory_name}”
                      </Text>
                    ) : (
                      <Text style={[styles.editLabel, { color: C.green }]}>
                        Nowy produkt w magazynie
                      </Text>
                    )}

                    <View style={styles.editFieldsRow}>
                      <View style={styles.editField}>
                        <Text style={[styles.editLabel, { color: C.muted }]}>Ilość</Text>
                        <View style={[styles.editInputWrap, { backgroundColor: C.inputBg, borderColor: C.border }]}>
                          <TextInput
                            style={[styles.editInput, { color: C.text }]}
                            value={String(p.quantity ?? '')}
                            onChangeText={(v) => setRowQuantity(idx, v)}
                            keyboardType="decimal-pad"
                            selectTextOnFocus
                            testID={`invoice-quantity-${idx}`}
                          />
                          <Text style={[styles.editSuffix, { color: C.muted }]}>{p.unit}</Text>
                        </View>
                      </View>
                      <View style={styles.editField}>
                        <Text style={[styles.editLabel, { color: C.muted }]}>Cena netto</Text>
                        <View style={[styles.editInputWrap, { backgroundColor: C.inputBg, borderColor: C.border }]}>
                          <TextInput
                            style={[styles.editInput, { color: C.text }]}
                            value={formatPlnNumber(p.price_netto)}
                            onChangeText={(v) => setRowPrice(idx, v)}
                            keyboardType="decimal-pad"
                            selectTextOnFocus
                            testID={`invoice-price-${idx}`}
                          />
                          <Text style={[styles.editSuffix, { color: C.muted }]}>zł</Text>
                        </View>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={[styles.catChip, { backgroundColor: C.greenSoft, borderColor: 'rgba(0,255,120,0.28)' }]}
                      onPress={() => setPickerIndex(idx)}
                      activeOpacity={0.7}
                      testID={`invoice-category-${idx}`}
                    >
                      <Text style={[styles.catChipText, { color: C.green }]}>{p.category}</Text>
                      <ChevronDown size={13} color={C.green} strokeWidth={2.5} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <View style={{ height: 12 }} />
            </ScrollView>
            <View style={[styles.footer, { backgroundColor: C.card, borderTopColor: C.border, paddingBottom: footerPad }]}>
              <Text style={[styles.destLabel, { color: C.muted }]}>
                Po zatwierdzeniu: magazyn + koszt zmienny + dane w panelu Dostawcy.
              </Text>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: C.green }]}
                onPress={goToExpiryReview}
                activeOpacity={0.85}
                testID="invoice-confirm-btn"
              >
                <Check size={18} color={C.blackOnGreen} strokeWidth={2.5} />
                <Text style={[styles.confirmBtnText, { color: C.blackOnGreen }]}>
                  Dalej → daty ważności ({invProducts.length})
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {stage === 'expiry_review' && (
          <InvoiceExpiryReviewForm
            drafts={expiryDrafts}
            onChange={setExpiryDrafts}
            totalCost={invTotal}
            onBack={() => setStage('invoice_preview')}
            onCommit={(products) => void confirmInvoice(products)}
          />
        )}

        {stage === 'result' && result && (
          <CatalogScanResultStage
            result={result}
            isInvoice={isInvoice}
            footerPad={footerPad}
            onDone={() => void handleDoneClose()}
          />
        )}

        <Modal visible={pickerIndex !== null} transparent animationType="fade" onRequestClose={() => setPickerIndex(null)}>
          <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setPickerIndex(null)}>
            <View style={[styles.pickerSheet, { backgroundColor: C.elevated }]}>
              <Text style={[styles.pickerTitle, { color: C.text }]}>Wybierz kategorię</Text>
              {categoryOptions.map((cat) => {
                const active = pickerIndex !== null && invProducts[pickerIndex]?.category === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.pickerRow, active && { backgroundColor: C.greenSoft }]}
                    onPress={() => pickerIndex !== null && setRowCategory(pickerIndex, cat)}
                    testID={`category-option-${cat}`}
                  >
                    <Text style={[styles.pickerRowText, { color: C.text }, active && { color: C.green, fontWeight: '700' }]}>
                      {cat}
                    </Text>
                    {active && <Check size={16} color={C.green} strokeWidth={2.5} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </Modal>
        <CreditsGateModal
          visible={showCreditsGate}
          onClose={() => setShowCreditsGate(false)}
          actionLabel="to skanowanie"
        />
      </SafeAreaView>
    </Modal>
  );
}

