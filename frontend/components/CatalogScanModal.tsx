import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { DS } from '@/constants/premiumTheme';
import { formatPln, formatPlnNumber, parsePln } from '@/lib/format';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useAds } from '@/contexts/AdsProvider';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { CreditsGateModal } from '@/components/ads/CreditsGateModal';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

import {
  InvoiceExpiryReviewForm,
  buildExpiryDrafts,
  type ExpiryProductDraft,
  type CommitProduct,
} from '@/components/InvoiceExpiryReviewForm';
import { DOC_WAREHOUSE_CATEGORIES } from '@/lib/warehouseCategories';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

/** Client abort — Railway/proxy often dies ~100s; fail with clear message sooner. */
const PROCESS_TIMEOUT_MS = 95_000;

const C = {
  bg: '#0A120E',
  card: DS.color.surfaceCard,
  elevated: DS.color.surfaceElevated,
  border: DS.color.borderSubtle,
  text: DS.color.heading,
  body: DS.color.body,
  muted: DS.color.muted,
  green: DS.color.greenEnd,
  greenSoft: 'rgba(0,255,120,0.12)',
  danger: DS.color.danger,
  dangerSoft: DS.color.dangerSoft,
  warning: DS.color.warning,
  warningSoft: DS.color.warningSoft,
  warningBorder: DS.color.warningBorder,
  blackOnGreen: '#0A0A0A',
  inputBg: DS.color.bgTertiary,
};

export const DOC_CATEGORIES = DOC_WAREHOUSE_CATEGORIES;

type Stage = 'choose' | 'processing' | 'invoice_preview' | 'expiry_review' | 'result';

interface InvoiceProduct {
  product_name: string;
  quantity: number;
  price_netto: number;
  unit: string;
  category: string;
}

/** Pola panelu Dostawcy wyodrębnione ze skanu (podgląd + zapis). */
export interface SupplierScanMeta {
  nip?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_person?: string | null;
  address?: string | null;
  payment_terms?: string | null;
  shipping_cost?: number | null;
  min_order_value?: number | null;
  free_shipping_threshold?: number | null;
  lead_time_days?: number | null;
}

interface DocResult {
  document_type: 'FAKTURA_ZAKUPOWA' | 'OFERTA_HANDLOWA' | 'MENU_RESTAURACYJNE';
  supplier_name?: string | null;
  supplier?: SupplierScanMeta | null;
  supplier_fields_updated?: string[];
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
  /**
   * Warstwa tekstowa / UX wejścia:
   * - warehouse — Magazyn / „wgraj fakturę”
   * - supplier — Dostawcy / „wgraj ofertę”
   */
  scanContext?: 'warehouse' | 'supplier';
  /** Gdy AI rozpozna kartę dań — przekieruj do skanera menu. */
  onMenuDetected?: () => void;
}

const PROCESSING_MESSAGES = [
  'Agent AI analizuje wgrany dokument…',
  'Rozpoznaję typ dokumentu i pozycje…',
  'Segreguję produkty do właściwych zakładek…',
  'Szukam danych dostawcy (NIP, telefon, dostawa)…',
  'Po zakończeniu zapiszę dane i Cię powiadomię.',
];

const SAVING_MESSAGES = [
  'Zapisywanie produktów…',
  'Aktualizuję profil dostawcy…',
  'Aktualizuję stany magazynowe…',
  'Odświeżam listy w Magazynie…',
];

function normalizeSupplierMeta(raw: any): SupplierScanMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: SupplierScanMeta = {};
  const strKeys = ['nip', 'phone', 'email', 'contact_person', 'address', 'payment_terms'] as const;
  for (const k of strKeys) {
    const v = raw[k];
    if (v != null && String(v).trim()) out[k] = String(v).trim();
  }
  const numKeys = [
    'shipping_cost',
    'min_order_value',
    'free_shipping_threshold',
    'lead_time_days',
  ] as const;
  for (const k of numKeys) {
    const v = raw[k];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

function supplierMetaHasContent(m: SupplierScanMeta | null | undefined): boolean {
  return !!m && Object.keys(m).length > 0;
}

function friendlyApiError(status: number, detail: string): string {
  const raw = `${detail || ''}`.toLowerCase();
  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    raw.includes('application failed to respond') ||
    raw.includes('failed to respond') ||
    raw.includes('timeout') ||
    raw.includes('timed out') ||
    raw.includes('aborted')
  ) {
    return (
      'Serwer AI nie zdążył odpowiedzieć (timeout). '
      + 'Spróbuj ponownie z krótszym plikiem (max ~4 strony) albo zdjęciem.'
    );
  }
  if (!BACKEND_URL) return 'Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).';
  if (typeof detail === 'string' && detail.trim() && !raw.startsWith('<!')) {
    return detail.trim();
  }
  return `Błąd serwera (${status || '?'}). Spróbuj ponownie.`;
}

async function parseErrorDetail(res: Response): Promise<string> {
  const txt = await res.text();
  try {
    const j = JSON.parse(txt);
    const d = j?.detail ?? j?.message ?? j?.error ?? txt;
    return typeof d === 'string' ? d : JSON.stringify(d);
  } catch {
    return txt || `HTTP ${res.status}`;
  }
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
  const [stage, setStage] = useState<Stage>('choose');
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
      // Zawsze odśwież Magazyn / Menu / Dostawców (także po „Kontynuuj w tle”).
      onConfirmed();
      if (backgroundRef.current) {
        backgroundRef.current = false;
        const isOffer = data.document_type === 'OFERTA_HANDLOWA';
        const isInvoice = data.document_type === 'FAKTURA_ZAKUPOWA';
        const refreshHint =
          ' Jeśli produkty nie pojawią się od razu, odśwież aplikację (przeciągnij listę w dół lub otwórz zakładkę ponownie).';
        const message = isOffer
          ? `AI zapisało ofertę${data.supplier_name ? ` dla „${data.supplier_name}”` : ''} w zakładce Dostawcy. Listy odświeżono.${refreshHint}`
          : isInvoice
            ? `AI zaksięgowało fakturę${data.supplier_name ? ` od „${data.supplier_name}”` : ''} w Magazynie. Listy odświeżono.${refreshHint}`
            : `AI zapisało dane w odpowiednich zakładkach. Listy odświeżono.${refreshHint}`;
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
    processingRef.current = true;
    setIsSavingProducts(true);
    setStage('processing');
    setError(null);
    setScanBusy(true);
    try {
      const products = productsOverride ?? invProducts;
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
      setIsSavingProducts(false);
      finishWithResult(data);
    } catch (e: any) {
      processingRef.current = false;
      setScanBusy(false);
      setIsSavingProducts(false);
      setError(e.message ?? 'Nie udało się zaksięgować faktury.');
      setStage(expiryDrafts.length ? 'expiry_review' : 'invoice_preview');
    }
  }, [invSupplierId, invSupplierName, invSupplierMeta, invTotal, invProducts, ensureCredits, expiryDrafts.length, finishWithResult]);

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
          <ScrollView contentContainerStyle={styles.chooseWrap}>
            <View style={[styles.hintCard, { backgroundColor: C.warningSoft, borderColor: C.warningBorder }]}>
              <Sparkles size={16} color={C.warning} strokeWidth={2} />
              <Text style={[styles.hintText, { color: C.body }]}>
                {scanContext === 'warehouse' ? (
                  <>
                    <Text style={[styles.b, { color: C.text }]}>Wgraj fakturę zakupową lub ofertę handlową.</Text>
                    {' '}System rozpoznaje typ dokumentu: faktura trafi do magazynu/kosztów, oferta — do katalogu dostawcy.
                    Po analizie AI zapisze dane we właściwych zakładkach i Cię powiadomi.
                  </>
                ) : (
                  <>
                    <Text style={[styles.b, { color: C.text }]}>Wgraj ofertę dostawcy, lub fakturę</Text>
                    {' '}na produkty, które od niego kupiłeś. System automatycznie stworzy profil
                    tego dostawcy, uzupełni jego dane, i doda produkty z dokumentu do jego katalogu.
                    Gdy będziesz chciał złożyć zamówienie produktowe, skorzysta z podanych danych,
                    by przygotować dla Ciebie najkorzystniejszą ofertę.
                  </>
                )}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.sourceBtn, { backgroundColor: C.card, borderColor: C.border }]}
              onPress={handleCamera}
              testID="doc-scan-camera"
              activeOpacity={0.85}
            >
              <View style={[styles.sourceIcon, { backgroundColor: C.greenSoft }]}>
                <Camera size={22} color={C.green} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sourceTitle, { color: C.text }]}>Zrób zdjęcie</Text>
                <Text style={[styles.sourceSub, { color: C.muted }]}>
                  {scanContext === 'warehouse'
                    ? 'Sfotografuj fakturę lub ofertę'
                    : 'Sfotografuj fakturę lub ofertę'}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sourceBtn, { backgroundColor: C.card, borderColor: C.border }]}
              onPress={handlePickFile}
              testID="doc-scan-file"
              activeOpacity={0.85}
            >
              <View style={[styles.sourceIcon, { backgroundColor: C.greenSoft }]}>
                <FileText size={22} color={C.green} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sourceTitle, { color: C.text }]}>Wgraj plik</Text>
                <Text style={[styles.sourceSub, { color: C.muted }]}>PDF, JPG lub PNG</Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        )}

        {stage === 'processing' && (
          <View style={styles.center} testID="doc-scan-processing">
            <View style={[styles.processingOrb, { backgroundColor: C.greenSoft, borderColor: C.green }]}>
              <ActivityIndicator size="large" color={C.green} />
            </View>
            <Text style={[styles.analyzingTitle, { color: C.text }]}>
              {isSavingProducts ? 'Zapisywanie produktów…' : 'Skan dokumentu AI'}
            </Text>
            <Text style={[styles.analyzingSub, { color: C.body }]}>
              {(isSavingProducts ? SAVING_MESSAGES : PROCESSING_MESSAGES)[
                processingMsgIdx % (isSavingProducts ? SAVING_MESSAGES.length : PROCESSING_MESSAGES.length)
              ]}
            </Text>
            <View style={[styles.processingCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[styles.processingCardText, { color: C.muted }]}>
                {isSavingProducts
                  ? 'Zapisuję produkty w magazynie i koszt zmienny. Listy odświeżą się automatycznie.'
                  : 'Po zakończeniu agent przygotuje podgląd pozycji. Możesz zostawić ten ekran otwarty albo wrócić do pulpitu — po rozpoznaniu faktury otworzymy zatwierdzenie automatycznie.'}
              </Text>
              <Text style={[styles.elapsed, { color: C.green }]}>
                {elapsedSec < 60
                  ? `${elapsedSec} s`
                  : `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`}
              </Text>
            </View>
            {!isSavingProducts ? (
              <TouchableOpacity
                style={[styles.bgBtn, { borderColor: C.border }]}
                onPress={handleClose}
                activeOpacity={0.85}
                testID="doc-scan-background"
              >
                <Text style={[styles.bgBtnText, { color: C.body }]}>Kontynuuj w tle</Text>
              </TouchableOpacity>
            ) : null}
          </View>
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
              {supplierMetaHasContent(invSupplierMeta) ? (
                <View style={[styles.supplierMetaCard, { backgroundColor: C.card, borderColor: C.border }]} testID="invoice-supplier-meta">
                  <Text style={[styles.supplierMetaTitle, { color: C.text }]}>
                    Dane dostawcy{invSupplierName ? ` · ${invSupplierName}` : ''}
                  </Text>
                  <Text style={[styles.supplierMetaSub, { color: C.muted }]}>
                    Zostaną zapisane w panelu Dostawcy (uzupełnienie bez kasowania istniejących pól).
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
                </Text>
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
              onPress={() => void handleDoneClose()}
              testID="doc-result-done"
            >
              <Text style={[styles.primaryBtnText, { color: C.blackOnGreen }]}>Zamknij i powróć do pulpitu</Text>
            </TouchableOpacity>
          </ScrollView>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  b: { fontWeight: '700' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 1 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    padding: 12,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 },
  processingOrb: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    marginBottom: 4,
  },
  processingCard: {
    alignSelf: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    marginTop: 8,
  },
  processingCardText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  elapsed: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  bgBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  bgBtnText: { fontSize: 14, fontWeight: '600' },
  chooseWrap: { padding: 16, gap: 12 },
  hintCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  hintText: { flex: 1, fontSize: 13, lineHeight: 19 },
  sourceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
  },
  sourceIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sourceTitle: { fontSize: 15, fontWeight: '700' },
  sourceSub: { fontSize: 12, marginTop: 2 },
  analyzingTitle: { fontSize: 17, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  analyzingSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  invHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  invTotal: { fontSize: 15, fontWeight: '800' },
  invHint: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 8, lineHeight: 16 },
  previewContent: { paddingHorizontal: 12, paddingTop: 4 },
  supplierMetaCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  supplierMetaTitle: { fontSize: 14, fontWeight: '800' },
  supplierMetaSub: { fontSize: 11, lineHeight: 15 },
  supplierMetaGrid: { gap: 6, marginTop: 2 },
  supplierMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  supplierMetaLabel: {
    width: 108,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingTop: 1,
  },
  supplierMetaValue: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  rowName: { fontSize: 14, fontWeight: '600' },
  editFieldsRow: { flexDirection: 'row', gap: 8 },
  editField: { flex: 1, gap: 3 },
  editLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  editInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  editInput: { flex: 1, fontSize: 13, fontWeight: '600', paddingVertical: 0 },
  editSuffix: { fontSize: 11, fontWeight: '600', marginLeft: 4 },
  catChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  catChipText: { fontSize: 12, fontWeight: '700' },
  footer: { padding: 16, borderTopWidth: 1 },
  destLabel: { fontSize: 12, fontWeight: '700', marginBottom: 8 },
  destRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  destChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  destChipText: { fontSize: 11, fontWeight: '700' },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 15,
  },
  confirmBtnText: { fontSize: 15, fontWeight: '700' },
  resultWrap: { padding: 20, alignItems: 'center', gap: 8 },
  successCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  typeBadgeText: { fontSize: 12, fontWeight: '700' },
  resultTitle: { fontSize: 19, fontWeight: '800', marginTop: 4 },
  resultSub: { fontSize: 13, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 14, alignSelf: 'stretch' },
  statCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statNum: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  statLabel: { fontSize: 11, textAlign: 'center', lineHeight: 15 },
  resultNote: { fontSize: 12, marginTop: 10 },
  warnBox: {
    alignSelf: 'stretch',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    gap: 4,
  },
  warnText: { fontSize: 11, lineHeight: 16 },
  primaryBtn: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: Platform.OS === 'ios' ? 20 : 8,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  pickerSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
  },
  pickerTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  pickerRowText: { fontSize: 14, fontWeight: '500' },
});
