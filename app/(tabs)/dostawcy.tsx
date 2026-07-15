import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import * as Linking from 'expo-linking';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Truck,
  Phone,
  Mail,
  Sparkles,
  X,
  ChevronDown,
  ChevronUp,
  Package,
  User,
  Plus,
  Check,
  FileText,
  Upload,
  CircleAlert,
  Tag,
  Search,
  Eye,
  EyeOff,
  Info,
  Zap,
  Trash2,
  ShoppingCart,
  PenLine,
  ScanLine,
  TrendingUp,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { OrderModal } from '@/components/OrderModal';
import { CatalogScanModal } from '@/components/CatalogScanModal';
import { Colors } from '@/constants/colors';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { formatPln, formatPlnNumber } from '@/lib/format';
import type { SupplierOffer, SupplierOfferItem } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CatalogProduct {
  id: string;
  name: string;
  variant: string;
  volume_label: string;
  unit_count: number;
  price_pln: number;
  liters_total: number;
}

interface Supplier {
  id: string;
  name: string;
  nip: string;
  category: string;
  contact_person: string;
  phone: string;
  email: string;
  notes: string;
  icon_color: string;
  min_order_value: number;
  catalog: CatalogProduct[];
}

type UploadResult = { product_count: number; matched_count: number } | null;

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  'Napoje & Alkohole',
  'Nabiał & Sery',
  'Warzywa & Owoce',
  'Mięso & Wędliny',
  'Alkohole & Napoje Barmańskie',
  'Suche & Sypkie',
  'Ogólnospożywczy',
  'Inne',
];

const ICON_COLORS = [
  '#2563EB', '#DC2626', '#16A34A', '#D97706', '#7C3AED', '#0891B2', '#475569',
];

const UNIT_OPTIONS = ['szt', 'kg', 'g', 'l', 'ml', 'opak', 'butelka'];

const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapDbRow(row: any): Supplier {
  return {
    id: row.id,
    name: row.name,
    nip: row.nip ?? '',
    category: row.category ?? '',
    contact_person: row.contact_person ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    notes: row.notes ?? '',
    icon_color: row.icon_color ?? Colors.textSecondary,
    catalog: (row.supplier_catalog ?? [])
      .filter((c: any) => c.is_visible !== false)
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((c: any): CatalogProduct => ({
        id: c.id,
        name: c.name,
        variant: c.variant,
        volume_label: c.volume_label ?? '',
        unit_count: Number(c.unit_count),
        price_pln: Number(c.price_pln),
        liters_total: Number(c.liters_total),
      })),
  };
}

// ─── OfferStatusBadge ─────────────────────────────────────────────────────────

function OfferStatusBadge({ status }: { status: SupplierOffer['status'] }) {
  if (status === 'processing' || status === 'pending') {
    return (
      <View style={[badge.wrap, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
        <ActivityIndicator size={10} color={Colors.warning} />
        <Text style={[badge.text, { color: Colors.warning }]}>Przetwarzanie…</Text>
      </View>
    );
  }
  if (status === 'done') {
    return (
      <View style={[badge.wrap, { backgroundColor: Colors.successLight, borderColor: '#BBF7D0' }]}>
        <Check size={10} color={Colors.success} strokeWidth={3} />
        <Text style={[badge.text, { color: Colors.success }]}>Gotowe</Text>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View style={[badge.wrap, { backgroundColor: Colors.dangerLight, borderColor: '#FECACA' }]}>
        <CircleAlert size={10} color={Colors.danger} strokeWidth={2.5} />
        <Text style={[badge.text, { color: Colors.danger }]}>Błąd</Text>
      </View>
    );
  }
  return null;
}

const badge = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  text: { fontSize: 10, fontWeight: '700' },
});

// ─── AiProductRow ─────────────────────────────────────────────────────────────

function AiProductRow({ p, last }: { p: SupplierOfferItem; last: boolean }) {
  const isManual = p.offer_id === null;
  return (
    <View style={[aiProdStyles.row, last && aiProdStyles.rowLast]}>
      <View style={aiProdStyles.left}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text style={aiProdStyles.name}>{p.raw_product_name}</Text>
          {isManual && (
            <View style={aiProdStyles.manualBadge}>
              <PenLine size={9} color={Colors.textTertiary} strokeWidth={2} />
            </View>
          )}
        </View>
      </View>
      <View style={aiProdStyles.right}>
        {p.price_net != null
          ? <Text style={aiProdStyles.price}>{formatPlnNumber(p.price_net)} zł/{p.unit}</Text>
          : <Text style={aiProdStyles.noPrice}>b/d</Text>}
      </View>
    </View>
  );
}

const aiProdStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 8 },
  rowLast: { borderBottomWidth: 0 },
  left: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end', gap: 2 },
  name: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  price: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  noPrice: { fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic' },
  manualBadge: { width: 17, height: 17, borderRadius: 4, backgroundColor: Colors.borderLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
});

// ─── CatalogRow ───────────────────────────────────────────────────────────────

function CatalogRow({ product, last }: { product: CatalogProduct; last: boolean }) {
  const perLiter = product.liters_total > 0
    ? ` · ${formatPlnNumber(product.price_pln / product.liters_total)} zł/L`
    : '';
  return (
    <View style={[catStyles.row, last && catStyles.rowLast]}>
      <View style={catStyles.info}>
        <Text style={catStyles.name}>{product.name}</Text>
        <Text style={catStyles.variant}>{product.variant}</Text>
      </View>
      <View style={catStyles.right}>
        <Text style={catStyles.price}>{formatPln(product.price_pln)}</Text>
        {!!perLiter && <Text style={catStyles.perUnit}>{perLiter}</Text>}
      </View>
    </View>
  );
}

const catStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 8 },
  rowLast: { borderBottomWidth: 0 },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  variant: { fontSize: 11, color: Colors.textSecondary },
  right: { alignItems: 'flex-end' },
  price: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  perUnit: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
});

// ─── SupplierCard ─────────────────────────────────────────────────────────────

function SupplierCard({
  supplier,
  totalAnalysesUsed,
  orderTotal,
  onPhone,
  onEmail,
  onUpload,
  onDelete,
  onEdit,
  onRefresh,
}: {
  supplier: Supplier;
  totalAnalysesUsed: number;
  orderTotal: number;
  onPhone: (phone: string) => void;
  onEmail: (email: string) => void;
  onUpload: (supplierId: string, isNewSupplier: boolean, onStage: (s: 'uploading' | 'analyzing') => void) => Promise<UploadResult>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (supplier: Supplier) => void;
  onRefresh: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [offer, setOffer] = useState<SupplierOffer | null>(null);
  const [offerItems, setOfferItems] = useState<SupplierOfferItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<'uploading' | 'analyzing' | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualUnit, setManualUnit] = useState('szt');
  const [manualSizeValue, setManualSizeValue] = useState('');
  const [manualSizeUnit, setManualSizeUnit] = useState<'g' | 'kg' | 'ml' | 'l'>('g');
  const [savingManual, setSavingManual] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const iconBg = supplier.icon_color + '18';

  const visibleItems = useMemo(
    () => offerItems.filter((p) => p.warehouse_product_id !== null),
    [offerItems]
  );
  const hiddenItems = useMemo(
    () => offerItems.filter((p) => p.warehouse_product_id === null),
    [offerItems]
  );

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [{ data: offerData }, { data: itemData }] = await Promise.all([
        supabase
          .from('supplier_offers')
          .select('*')
          .eq('supplier_id', supplier.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('supplier_offer_items')
          .select('*')
          .eq('supplier_id', supplier.id)
          .order('raw_product_name'),
      ]);
      if (offerData) setOffer(offerData as SupplierOffer);
      setOfferItems((itemData ?? []) as SupplierOfferItem[]);
    } finally {
      setLoadingData(false);
    }
  }, [supplier.id]);

  useEffect(() => {
    if (expanded) loadData();
  }, [expanded, loadData]);

  useEffect(() => {
    if (offer?.status === 'pending' || offer?.status === 'processing') {
      pollRef.current = setInterval(async () => {
        const { data } = await supabase
          .from('supplier_offers')
          .select('*')
          .eq('id', offer.id)
          .maybeSingle();
        if (data) {
          setOffer(data as SupplierOffer);
          if (data.status === 'done') {
            const { data: items } = await supabase
              .from('supplier_offer_items')
              .select('*')
              .eq('supplier_id', supplier.id)
              .order('raw_product_name');
            setOfferItems((items ?? []) as SupplierOfferItem[]);
          }
          if (data.status === 'done' || data.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        }
      }, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [offer?.id, offer?.status, supplier.id]);

  async function handleUpload() {
    setUploading(true);
    setUploadStage('uploading');
    try {
      const result = await onUpload(supplier.id, false, (stage) => setUploadStage(stage));
      if (result !== null) await loadData();
    } finally {
      setUploading(false);
      setUploadStage(null);
    }
  }

  function handleDelete() {
    Alert.alert(
      'Usuń dostawcę',
      `Czy na pewno chcesz usunąć "${supplier.name}"?\nWszystkie dane dostawcy zostaną usunięte.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Usuń', style: 'destructive', onPress: () => onDelete(supplier.id) },
      ]
    );
  }

  async function handleAddManualProduct() {
    if (!manualName.trim()) {
      Alert.alert('Błąd', 'Nazwa produktu jest wymagana.');
      return;
    }
    setSavingManual(true);
    try {
      const price = parseFloat(manualPrice.replace(',', '.'));
      // Dla sztuki/opakowania/butelki użytkownik może zdefiniować zawartość (g/kg/ml/l).
      const isPack = manualUnit === 'szt' || manualUnit === 'opak' || manualUnit === 'butelka';
      const sizeVal = parseFloat((manualSizeValue || '').replace(',', '.'));
      const hasSize = isPack && isFinite(sizeVal) && sizeVal > 0;
      // liters_total napędza porównywarkę ofert dla produktów płynnych;
      // kg_total dla produktów sztukowych/opakowaniowych zdefiniowanych wagowo.
      let litersTotal = 0;
      let kgTotal = 0;
      if (hasSize) {
        if (manualSizeUnit === 'ml') litersTotal = sizeVal / 1000;
        else if (manualSizeUnit === 'l') litersTotal = sizeVal;
        else if (manualSizeUnit === 'g') kgTotal = sizeVal / 1000;
        else if (manualSizeUnit === 'kg') kgTotal = sizeVal;
      }
      // Czytelna etykieta zawartości, np. "400 g" / "1 l" — trafia do variant/volume_label.
      const sizeLabel = hasSize
        ? `${manualSizeValue.trim().replace(',', '.')} ${manualSizeUnit}`
        : '';
      // `variant` ma w bazie ograniczenie NOT NULL — nigdy nie zapisujemy null.
      const variant = sizeLabel || manualUnit;
      // Zapis do GŁÓWNEGO katalogu dostawcy (supplier_catalog) — dzięki temu produkt
      // jest brany pod uwagę przez AI podczas tworzenia ofert zamówień (compare-offers).
      const basePayload = {
        supplier_id: supplier.id,
        name: manualName.trim(),
        variant,
        volume_label: sizeLabel || null,
        unit: manualUnit,
        unit_count: 1,
        price_pln: isFinite(price) && price > 0 ? price : 0,
        liters_total: litersTotal,
        sort_order: 999,
        is_visible: true,
      };
      let { error } = await supabase
        .from('supplier_catalog')
        .insert({ ...basePayload, kg_total: kgTotal });
      // Fallback: starszy schemat bez kolumny kg_total → zapisz bez niej (waga zostaje w etykiecie).
      if (error && /kg_total/i.test(error.message ?? '')) {
        ({ error } = await supabase.from('supplier_catalog').insert(basePayload));
      }
      if (error) throw error;
      setShowManualModal(false);
      setManualName('');
      setManualPrice('');
      setManualUnit('szt');
      setManualSizeValue('');
      setManualSizeUnit('g');
      await loadData();
      await onRefresh();
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się dodać produktu.');
    } finally {
      setSavingManual(false);
    }
  }

  const isProcessing = uploading || offer?.status === 'pending' || offer?.status === 'processing';
  const displayItems = showHidden ? offerItems : visibleItems;

  return (
    <View style={cardStyles.container}>
      <View style={cardStyles.header}>
        <TouchableOpacity style={cardStyles.headerMain} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
          <View style={[cardStyles.iconWrap, { backgroundColor: iconBg }]}>
            <Truck size={18} color={supplier.icon_color} strokeWidth={2} />
          </View>
          <View style={cardStyles.titleWrap}>
            <Text style={cardStyles.name}>{supplier.name}</Text>
            <View style={cardStyles.metaRow}>
              <Package size={10} color={Colors.textTertiary} strokeWidth={2} />
              <Text style={cardStyles.category}>{supplier.category}</Text>
              {!!supplier.nip && <Text style={cardStyles.nip}>NIP: {supplier.nip}</Text>}
            </View>
            {orderTotal > 0 && (
              <View style={cardStyles.orderTotalBadge} testID={`order-total-${supplier.id}`}>
                <TrendingUp size={11} color={Colors.success} strokeWidth={2.5} />
                <Text style={cardStyles.orderTotalText}>
                  Zamówiono: {formatPln(orderTotal)}
                </Text>
              </View>
            )}
          </View>
          {expanded
            ? <ChevronUp size={16} color={Colors.textTertiary} strokeWidth={2} />
            : <ChevronDown size={16} color={Colors.textTertiary} strokeWidth={2} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={cardStyles.headerCartBtn}
          onPress={() => setShowOrderModal(true)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ShoppingCart size={17} color={Colors.accent} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {expanded && (
        <>
          {/* Contact & actions */}
          <View style={cardStyles.details}>
            {!!supplier.contact_person && (
              <View style={cardStyles.contactRow}>
                <User size={13} color={Colors.textSecondary} strokeWidth={2} />
                <Text style={cardStyles.contactText}>{supplier.contact_person}</Text>
              </View>
            )}
            {!!supplier.notes && <Text style={cardStyles.notes}>{supplier.notes}</Text>}
            {supplier.min_order_value > 0 && (
              <Text style={cardStyles.minOrderText} testID={`min-order-${supplier.id}`}>
                Min. logistyczne: {formatPln(supplier.min_order_value)}
              </Text>
            )}
            <View style={cardStyles.actions}>
              {!!supplier.phone && (
                <TouchableOpacity style={[cardStyles.actionBtn, cardStyles.actionBtnGreen]} onPress={() => onPhone(supplier.phone)} activeOpacity={0.7}>
                  <Phone size={14} color={Colors.success} strokeWidth={2} />
                  <Text style={[cardStyles.actionBtnText, { color: Colors.success }]}>{supplier.phone}</Text>
                </TouchableOpacity>
              )}
              {!!supplier.email && (
                <TouchableOpacity style={[cardStyles.actionBtn, cardStyles.actionBtnBlue]} onPress={() => onEmail(supplier.email)} activeOpacity={0.7}>
                  <Mail size={14} color={Colors.accent} strokeWidth={2} />
                  <Text style={[cardStyles.actionBtnText, { color: Colors.accent }]}>Email</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[cardStyles.actionBtn, cardStyles.actionBtnBlue]} onPress={() => setShowOrderModal(true)} activeOpacity={0.7}>
                <ShoppingCart size={14} color={Colors.accent} strokeWidth={2} />
                <Text style={[cardStyles.actionBtnText, { color: Colors.accent }]}>Zamówienie</Text>
              </TouchableOpacity>
            </View>
            <View style={cardStyles.manageRow}>
              <TouchableOpacity style={cardStyles.editRow} onPress={() => onEdit(supplier)} activeOpacity={0.7} testID={`edit-supplier-${supplier.id}`}>
                <PenLine size={13} color={Colors.accent} strokeWidth={2} />
                <Text style={cardStyles.editText}>Edytuj dane</Text>
              </TouchableOpacity>
              <TouchableOpacity style={cardStyles.deleteRow} onPress={handleDelete} activeOpacity={0.7}>
                <Trash2 size={13} color={Colors.danger} strokeWidth={2} />
                <Text style={cardStyles.deleteText}>Usuń dostawcę</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Offer section */}
          <View style={cardStyles.pdfSection}>
            <View style={cardStyles.pdfSectionHeader}>
              <FileText size={13} color={Colors.textSecondary} strokeWidth={2} />
              <Text style={cardStyles.pdfSectionTitle}>Oferta AI — Cennik</Text>
              {offer && <OfferStatusBadge status={offer.status} />}
            </View>

            {offer && (
              <View style={cardStyles.pdfInfo}>
                <Text style={cardStyles.pdfFileName} numberOfLines={1}>{offer.file_name}</Text>

                {offer.status === 'done' && (
                  <>
                    <View style={cardStyles.resultRow}>
                      <View style={cardStyles.resultStat}>
                        <Text style={cardStyles.resultStatNum}>{offer.parsed_count}</Text>
                        <Text style={cardStyles.resultStatLabel}>znaleziono</Text>
                      </View>
                      <View style={cardStyles.resultDivider} />
                      <View style={cardStyles.resultStat}>
                        <Text style={[cardStyles.resultStatNum, visibleItems.length === 0 && cardStyles.resultStatNumZero]}>
                          {visibleItems.length}
                        </Text>
                        <Text style={cardStyles.resultStatLabel}>pasuje do magazynu</Text>
                      </View>
                      <View style={cardStyles.resultDivider} />
                      <View style={cardStyles.resultStat}>
                        <Text style={cardStyles.resultStatNum}>{hiddenItems.length}</Text>
                        <Text style={cardStyles.resultStatLabel}>bez dopasowania</Text>
                      </View>
                    </View>

                    {visibleItems.length === 0 && offer.parsed_count > 0 && (
                      <View style={cardStyles.noMatchBox}>
                        <Info size={13} color={Colors.warning} strokeWidth={2} />
                        <Text style={cardStyles.noMatchText}>
                          Żaden produkt z tej oferty nie pasuje jeszcze do Twojego magazynu.
                          Dodaj produkty do magazynu — system automatycznie je odblokuje.
                        </Text>
                      </View>
                    )}

                    <View style={cardStyles.analysisRow}>
                      <Zap size={11} color={Colors.textTertiary} strokeWidth={2} />
                      <Text style={cardStyles.analysisText}>
                        Zużyto 1 analizę z Twojego planu · łącznie {totalAnalysesUsed}
                      </Text>
                    </View>
                  </>
                )}

                {offer.status === 'error' && offer.error_message && (
                  <View style={cardStyles.errorBox}>
                    <CircleAlert size={13} color={Colors.danger} strokeWidth={2} />
                    <Text style={cardStyles.errorBoxText}>{offer.error_message}</Text>
                  </View>
                )}
              </View>
            )}

            <TouchableOpacity
              style={cardStyles.scanBtn}
              onPress={() => setShowScanModal(true)}
              activeOpacity={0.85}
              testID={`scan-catalog-btn-${supplier.id}`}
            >
              <ScanLine size={16} color={Colors.white} strokeWidth={2.5} />
              <Text style={cardStyles.scanBtnText}>Wgraj fakturę lub ofertę (AI)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={cardStyles.manualAddBtn}
              onPress={() => setShowManualModal(true)}
              activeOpacity={0.75}
            >
              <PenLine size={13} color={Colors.textSecondary} strokeWidth={2} />
              <Text style={cardStyles.manualAddText}>Dodaj produkt ręcznie</Text>
            </TouchableOpacity>
          </View>

          {/* AI / manual Products */}
          {loadingData && (
            <View style={cardStyles.loadingRow}>
              <ActivityIndicator size={14} color={Colors.textTertiary} />
              <Text style={cardStyles.loadingText}>Ładowanie…</Text>
            </View>
          )}

          {!loadingData && offerItems.length > 0 && (
            <>
              <View style={cardStyles.catalogHeader}>
                <Sparkles size={11} color={Colors.warning} strokeWidth={2} />
                <Text style={cardStyles.catalogLabel}>Produkty dostawcy</Text>
                <Text style={cardStyles.catalogCount}>{displayItems.length} pozycji</Text>
              </View>
              {displayItems.map((p, idx) => (
                <AiProductRow key={p.id} p={p} last={idx === displayItems.length - 1} />
              ))}
              {hiddenItems.length > 0 && (
                <TouchableOpacity
                  style={cardStyles.toggleHiddenBtn}
                  onPress={() => setShowHidden((v) => !v)}
                  activeOpacity={0.75}
                >
                  {showHidden
                    ? <EyeOff size={13} color={Colors.textTertiary} strokeWidth={2} />
                    : <Eye size={13} color={Colors.textTertiary} strokeWidth={2} />}
                  <Text style={cardStyles.toggleHiddenText}>
                    {showHidden
                      ? `Ukryj ${hiddenItems.length} produktów bez dopasowania`
                      : `Pokaż ${hiddenItems.length} bez dopasowania w magazynie`}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Legacy manual catalog */}
          {supplier.catalog.length > 0 && (
            <>
              <View style={cardStyles.catalogHeader}>
                <Tag size={11} color={Colors.textTertiary} strokeWidth={2} />
                <Text style={cardStyles.catalogLabel}>Katalog produktów</Text>
                <Text style={cardStyles.catalogCount}>{supplier.catalog.length} pozycji</Text>
              </View>
              {supplier.catalog.map((product, idx) => (
                <CatalogRow key={product.id} product={product} last={idx === supplier.catalog.length - 1} />
              ))}
            </>
          )}
        </>
      )}

      {/* Manual product modal */}
      <Modal
        visible={showManualModal}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={() => setShowManualModal(false)}
      >
        <KeyboardAvoidingView
          style={cardStyles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={cardStyles.manualSheet}>
            <View style={cardStyles.manualHeader}>
              <Text style={cardStyles.manualTitle}>Dodaj produkt ręcznie</Text>
              <TouchableOpacity onPress={() => setShowManualModal(false)}>
                <X size={20} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <Text style={cardStyles.manualLabel}>Nazwa produktu *</Text>
            <TextInput
              style={cardStyles.manualInput}
              value={manualName}
              onChangeText={setManualName}
              placeholder="np. Filet z kurczaka"
              placeholderTextColor={Colors.textTertiary}
              autoFocus
            />

            <Text style={cardStyles.manualLabel}>Cena netto (opcjonalnie)</Text>
            <TextInput
              style={cardStyles.manualInput}
              value={manualPrice}
              onChangeText={setManualPrice}
              placeholder="0.00"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="decimal-pad"
            />

            <Text style={cardStyles.manualLabel}>Jednostka</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 16 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
                {UNIT_OPTIONS.map((u) => (
                  <TouchableOpacity
                    key={u}
                    style={[cardStyles.unitPill, manualUnit === u && cardStyles.unitPillActive]}
                    onPress={() => setManualUnit(u)}
                    testID={`manual-unit-${u}`}
                  >
                    <Text style={[cardStyles.unitPillText, manualUnit === u && cardStyles.unitPillTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {(manualUnit === 'szt' || manualUnit === 'opak' || manualUnit === 'butelka') && (
              <View testID="manual-size-section">
                <Text style={cardStyles.manualLabel}>
                  Ile waży / zawiera 1 {manualUnit}? (opcjonalnie)
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <TextInput
                    style={[cardStyles.manualInput, { flex: 1, marginBottom: 0 }]}
                    value={manualSizeValue}
                    onChangeText={setManualSizeValue}
                    placeholder="np. 400"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="decimal-pad"
                    testID="manual-size-value"
                  />
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {(['g', 'kg', 'ml', 'l'] as const).map((su) => (
                      <TouchableOpacity
                        key={su}
                        style={[cardStyles.unitPill, manualSizeUnit === su && cardStyles.unitPillActive]}
                        onPress={() => setManualSizeUnit(su)}
                        testID={`manual-size-unit-${su}`}
                      >
                        <Text style={[cardStyles.unitPillText, manualSizeUnit === su && cardStyles.unitPillTextActive]}>{su}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <Text style={[cardStyles.manualLabel, { marginTop: 6, fontWeight: '400', textTransform: 'none', letterSpacing: 0 }]}>
                  Pozwala przeliczyć porcje i porównać ceny (np. 1 opak. = 400 g).
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[cardStyles.manualSaveBtn, savingManual && cardStyles.manualSaveBtnDisabled]}
              onPress={handleAddManualProduct}
              disabled={savingManual}
              activeOpacity={0.85}
            >
              {savingManual
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Text style={cardStyles.manualSaveBtnText}>Dodaj produkt</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Order modal */}
      <OrderModal
        supplierId={supplier.id}
        supplierName={supplier.name}
        visible={showOrderModal}
        onClose={() => setShowOrderModal(false)}
      />

      {/* AI catalog scan modal (GPT-4o Vision) */}
      <CatalogScanModal
        supplierId={supplier.id}
        supplierName={supplier.name}
        visible={showScanModal}
        onClose={() => setShowScanModal(false)}
        onConfirmed={async () => { await onRefresh(); }}
      />
    </View>
  );
}

const cardStyles = StyleSheet.create({
  container: { backgroundColor: Colors.card, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: Colors.border, shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  headerCartBtn: { paddingRight: 14, paddingVertical: 14 },
  iconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, gap: 4 },
  name: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  category: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  nip: { fontSize: 11, color: Colors.textTertiary },
  details: { borderTopWidth: 1, borderTopColor: Colors.borderLight, padding: 14, gap: 10 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contactText: { fontSize: 13, color: Colors.textSecondary },
  notes: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, backgroundColor: Colors.borderLight, borderRadius: 6, padding: 8 },
  minOrderText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 4 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 },
  editText: { fontSize: 12, color: Colors.accent, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  actionBtnGreen: { backgroundColor: Colors.successLight, borderColor: '#BBF7D0' },
  actionBtnBlue: { backgroundColor: Colors.accentLight, borderColor: '#BFDBFE' },
  actionBtnText: { fontSize: 13, fontWeight: '600' },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 2 },
  deleteText: { fontSize: 12, color: Colors.danger, fontWeight: '500' },
  pdfSection: { borderTopWidth: 1, borderTopColor: Colors.borderLight, padding: 14, gap: 10, backgroundColor: '#F8FAFF' },
  pdfSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pdfSectionTitle: { flex: 1, fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  pdfInfo: { gap: 8 },
  pdfFileName: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },
  resultRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.borderLight, borderRadius: 10, padding: 10, gap: 4 },
  resultStat: { flex: 1, alignItems: 'center', gap: 2 },
  resultStatNum: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  resultStatNumZero: { color: Colors.warning },
  resultStatLabel: { fontSize: 10, color: Colors.textTertiary, textAlign: 'center' },
  resultDivider: { width: 1, height: 28, backgroundColor: Colors.border },
  noMatchBox: { flexDirection: 'row', gap: 8, backgroundColor: Colors.warningLight, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#FDE68A', alignItems: 'flex-start' },
  noMatchText: { flex: 1, fontSize: 12, color: Colors.warning, lineHeight: 17 },
  analysisRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  analysisText: { fontSize: 11, color: Colors.textTertiary },
  errorBox: { flexDirection: 'row', gap: 8, backgroundColor: Colors.dangerLight, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#FECACA', alignItems: 'flex-start' },
  errorBoxText: { flex: 1, fontSize: 12, color: Colors.danger, lineHeight: 17 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.accentLight, borderWidth: 1.5, borderColor: '#BFDBFE', borderStyle: 'dashed', borderRadius: 10, paddingVertical: 12 },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 13, shadowColor: Colors.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 5, elevation: 3 },
  scanBtnText: { fontSize: 13.5, fontWeight: '700', color: Colors.white },
  orderTotalBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 5, backgroundColor: '#F0FDF4', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: '#BBF7D0' },
  orderTotalText: { fontSize: 11, fontWeight: '700', color: Colors.success },
  uploadBtnDisabled: { opacity: 0.5 },
  uploadBtnText: { fontSize: 13, fontWeight: '600', color: Colors.accent },
  manualAddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: Colors.borderLight, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingVertical: 10 },
  manualAddText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  loadingText: { fontSize: 13, color: Colors.textTertiary },
  catalogHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Colors.borderLight, borderTopWidth: 1, borderTopColor: Colors.border },
  catalogLabel: { flex: 1, fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  catalogCount: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' },
  toggleHiddenBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  toggleHiddenText: { fontSize: 12, color: Colors.textTertiary, fontWeight: '500', fontStyle: 'italic' },
  // Manual product modal
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  manualSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 20 },
  manualHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  manualTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  manualLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 7, marginTop: 4 },
  manualInput: { backgroundColor: Colors.borderLight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 10, fontSize: 14, color: Colors.textPrimary, marginBottom: 14, borderWidth: 1, borderColor: Colors.border },
  unitPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: Colors.borderLight, borderWidth: 1.5, borderColor: 'transparent' },
  unitPillActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  unitPillText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  unitPillTextActive: { color: Colors.accent },
  manualSaveBtn: { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  manualSaveBtnDisabled: { opacity: 0.6 },
  manualSaveBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});

// ─── GlobalBasketModal ────────────────────────────────────────────────────────

interface GlobalBasketItem {
  supplier_id: string;
  supplier_name: string;
  supplier_color: string;
  item_id: string;
  raw_product_name: string;
  price_net: number | null;
  unit: string;
}

interface GlobalBasketGroup {
  supplier_id: string;
  supplier_name: string;
  supplier_color: string;
  items: GlobalBasketItem[];
}

function GlobalBasketModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [groups, setGroups] = useState<GlobalBasketGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [orderSupplierId, setOrderSupplierId] = useState<string | null>(null);
  const [orderSupplierName, setOrderSupplierName] = useState('');

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    supabase
      .from('supplier_offer_items')
      .select('id, supplier_id, raw_product_name, price_net, unit, suppliers(name, icon_color)')
      .order('raw_product_name')
      .then(({ data }) => {
        const map = new Map<string, GlobalBasketGroup>();
        for (const row of data ?? []) {
          const sid = row.supplier_id as string;
          if (!map.has(sid)) {
            map.set(sid, {
              supplier_id: sid,
              supplier_name: (row as any).suppliers?.name ?? 'Nieznany',
              supplier_color: (row as any).suppliers?.icon_color ?? Colors.textSecondary,
              items: [],
            });
          }
          map.get(sid)!.items.push({
            supplier_id: sid,
            supplier_name: (row as any).suppliers?.name ?? 'Nieznany',
            supplier_color: (row as any).suppliers?.icon_color ?? Colors.textSecondary,
            item_id: row.id as string,
            raw_product_name: row.raw_product_name as string,
            price_net: row.price_net != null ? Number(row.price_net) : null,
            unit: row.unit as string,
          });
        }
        setGroups(Array.from(map.values()).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name)));
        setLoading(false);
      });
  }, [visible]);

  const totalItems = groups.reduce((acc, g) => acc + g.items.length, 0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={gbStyles.container}>
        <View style={gbStyles.header}>
          <View style={gbStyles.headerLeft}>
            <ShoppingCart size={18} color={Colors.accent} strokeWidth={2} />
            <Text style={gbStyles.title}>Koszyk zamówień</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={22} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={gbStyles.center}>
            <ActivityIndicator size="large" color={Colors.accent} />
          </View>
        ) : totalItems === 0 ? (
          <View style={gbStyles.center}>
            <ShoppingCart size={48} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={gbStyles.emptyTitle}>Koszyk jest pusty</Text>
            <Text style={gbStyles.emptySub}>
              Dodaj produkty do dostawców — pojawią się tutaj pogrupowane według dostawcy.
            </Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
            <Text style={gbStyles.summary}>{totalItems} produktów · {groups.length} dostawców</Text>
            {groups.map((group) => (
              <View key={group.supplier_id} style={gbStyles.group}>
                <View style={gbStyles.groupHeader}>
                  <View style={[gbStyles.supplierIcon, { backgroundColor: group.supplier_color + '18' }]}>
                    <Truck size={14} color={group.supplier_color} strokeWidth={2} />
                  </View>
                  <Text style={gbStyles.supplierName}>{group.supplier_name}</Text>
                  <Text style={gbStyles.itemCount}>{group.items.length} poz.</Text>
                  <TouchableOpacity
                    style={gbStyles.orderBtn}
                    onPress={() => { setOrderSupplierId(group.supplier_id); setOrderSupplierName(group.supplier_name); }}
                    activeOpacity={0.8}
                  >
                    <Text style={gbStyles.orderBtnText}>Zamów</Text>
                  </TouchableOpacity>
                </View>
                {group.items.map((item, idx) => (
                  <View key={item.item_id} style={[gbStyles.itemRow, idx === group.items.length - 1 && gbStyles.itemRowLast]}>
                    <Text style={gbStyles.itemName} numberOfLines={1}>{item.raw_product_name}</Text>
                    {item.price_net != null
                      ? <Text style={gbStyles.itemPrice}>{formatPlnNumber(item.price_net)} zł/{item.unit}</Text>
                      : <Text style={gbStyles.itemPriceNone}>b/d</Text>}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
      <OrderModal
        supplierId={orderSupplierId ?? ''}
        supplierName={orderSupplierName}
        visible={orderSupplierId != null}
        onClose={() => setOrderSupplierId(null)}
      />
    </Modal>
  );
}

const gbStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.card },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' },
  emptySub: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center', lineHeight: 19 },
  summary: { fontSize: 12, color: Colors.textTertiary, paddingHorizontal: 16, paddingVertical: 12, fontWeight: '500' },
  group: { backgroundColor: Colors.card, marginHorizontal: 16, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: Colors.borderLight, borderBottomWidth: 1, borderBottomColor: Colors.border },
  supplierIcon: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  supplierName: { flex: 1, fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  itemCount: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' },
  orderBtn: { backgroundColor: Colors.accent, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5 },
  orderBtnText: { fontSize: 11, fontWeight: '700', color: Colors.white },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  itemRowLast: { borderBottomWidth: 0 },
  itemName: { flex: 1, fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  itemPrice: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginLeft: 8 },
  itemPriceNone: { fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic', marginLeft: 8 },
});

// ─── DostawcyScreen ───────────────────────────────────────────────────────────

export default function DostawcyScreen() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGlobalBasket, setShowGlobalBasket] = useState(false);
  const [showTopScan, setShowTopScan] = useState(false);
  const [totalAnalyses, setTotalAnalyses] = useState(0);
  const [orderTotals, setOrderTotals] = useState<Record<string, number>>({});

  const [formName, setFormName] = useState('');
  const [formNip, setFormNip] = useState('');
  const [formContact, setFormContact] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formCategory, setFormCategory] = useState(CATEGORY_OPTIONS[0]);
  const [formNotes, setFormNotes] = useState('');
  const [formMinOrder, setFormMinOrder] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSuppliers = useCallback(async () => {
    const SEL_VISIBLE =
      'id, name, nip, category, contact_person, phone, email, notes, icon_color, supplier_catalog(id, name, variant, volume_label, unit_count, price_pln, liters_total, sort_order, is_visible)';
    const SEL_BASE =
      'id, name, nip, category, contact_person, phone, email, notes, icon_color, supplier_catalog(id, name, variant, volume_label, unit_count, price_pln, liters_total, sort_order)';
    try {
      const [suppliersRes, countRes] = await Promise.all([
        supabase.from('suppliers').select(SEL_VISIBLE).order('name'),
        supabase
          .from('supplier_offers')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'done'),
      ]);
      let data = suppliersRes.data;
      if (suppliersRes.error) {
        // is_visible column not migrated yet → retry without it
        if (/is_visible/.test(suppliersRes.error.message ?? '')) {
          const retry = await supabase.from('suppliers').select(SEL_BASE).order('name');
          if (retry.error) throw retry.error;
          data = retry.data;
        } else {
          throw suppliersRes.error;
        }
      }
      setSuppliers((data ?? []).map(mapDbRow));
      setTotalAnalyses(countRes.count ?? 0);
      setError(null);

      // Suma zamówień (faktury) per dostawca — z variable_cost_entries (note: supplier:<id>)
      const { data: costs } = await supabase
        .from('variable_cost_entries')
        .select('amount_pln, note')
        .eq('type', 'materials');
      const totals: Record<string, number> = {};
      (costs ?? []).forEach((c: any) => {
        const m = /supplier:([0-9a-fA-F-]{36})/.exec(c.note ?? '');
        if (m) totals[m[1]] = (totals[m[1]] ?? 0) + Number(c.amount_pln ?? 0);
      });
      setOrderTotals(totals);
    } catch (e: any) {
      setError(e.message ?? 'Błąd ładowania dostawców');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  const handleUpload = useCallback(async (
    supplierId: string,
    _isNewSupplier: boolean,
    onStage: (s: 'uploading' | 'analyzing') => void
  ): Promise<UploadResult> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ACCEPTED_MIME_TYPES,
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.[0]) return null;

    const asset = result.assets[0];
    if (!ACCEPTED_MIME_TYPES.includes(asset.mimeType ?? '')) {
      Alert.alert('Nieobsługiwany format', 'Wgraj plik PDF, JPG lub PNG.');
      return null;
    }

    onStage('uploading');

    const base64Data = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const { data: inventoryItems } = await supabase
      .from('inventory_items')
      .select('id, name, unit')
      .order('name');

    onStage('analyzing');

    const { data: fnData, error: fnError } = await supabase.functions.invoke('process-offer', {
      body: {
        supplier_id: supplierId,
        file_base64: base64Data,
        mime_type: asset.mimeType ?? 'application/pdf',
        file_name: asset.name,
        inventory_items: inventoryItems ?? [],
      },
    });

    if (fnError) {
      Alert.alert(
        'Błąd połączenia',
        'Nie udało się połączyć z funkcją analizy. Sprawdź połączenie z Internetem i spróbuj ponownie.'
      );
      return null;
    }

    if (!fnData?.success) {
      Alert.alert(
        'Błąd analizy Gemini',
        fnData?.error ?? 'Nie udało się przetworzyć pliku. Spróbuj ponownie lub użyj innego formatu.'
      );
      return null;
    }

    setTotalAnalyses((prev) => prev + 1);
    return {
      product_count: fnData.product_count ?? 0,
      matched_count: fnData.matched_count ?? 0,
    };
  }, []);

  const handleDeleteSupplier = useCallback(async (supplierId: string) => {
    try {
      const { error: err } = await supabase.from('suppliers').delete().eq('id', supplierId);
      if (err) throw err;
      setSuppliers((prev) => prev.filter((s) => s.id !== supplierId));
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się usunąć dostawcy.');
    }
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setFormName(''); setFormNip(''); setFormContact('');
    setFormPhone(''); setFormEmail(''); setFormMinOrder('');
    setFormCategory(CATEGORY_OPTIONS[0]); setFormNotes('');
  };

  const openAddSupplier = () => { resetForm(); setShowAddModal(true); };

  const openEditSupplier = (s: Supplier) => {
    setEditingId(s.id);
    setFormName(s.name ?? '');
    setFormNip(s.nip ?? '');
    setFormContact(s.contact_person ?? '');
    setFormPhone(s.phone ?? '');
    setFormEmail(s.email ?? '');
    setFormCategory(s.category || CATEGORY_OPTIONS[0]);
    setFormNotes(s.notes ?? '');
    setFormMinOrder(s.min_order_value ? String(s.min_order_value) : '');
    setShowAddModal(true);
  };

  const handleAddSupplier = async () => {
    if (!formName.trim()) {
      Alert.alert('Błąd', 'Nazwa dostawcy jest wymagana.');
      return;
    }
    setSaving(true);
    try {
      const minVal = parseFloat(formMinOrder.replace(',', '.'));
      const payload = {
        name: formName.trim(),
        nip: formNip.trim() || null,
        contact_person: formContact.trim() || null,
        phone: formPhone.trim() || null,
        email: formEmail.trim() || null,
        category: formCategory,
        notes: formNotes.trim() || null,
        min_order_value: isFinite(minVal) && minVal >= 0 ? minVal : 0,
      };
      let err: any = null;
      if (editingId) {
        ({ error: err } = await supabase.from('suppliers').update(payload).eq('id', editingId));
      } else {
        const iconColor = ICON_COLORS[Math.floor(Math.random() * ICON_COLORS.length)];
        ({ error: err } = await supabase.from('suppliers').insert({ ...payload, icon_color: iconColor }));
      }
      if (err) throw err;
      setShowAddModal(false);
      resetForm();
      await fetchSuppliers();
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się zapisać dostawcy.');
    } finally {
      setSaving(false);
    }
  };

  const filteredSuppliers = useMemo(() => {
    if (!search.trim()) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter(
      (s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    );
  }, [suppliers, search]);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  return (
    <SafeAreaView style={mainStyles.container} edges={['top']}>
      <View style={mainStyles.header}>
        <View>
          <Text style={mainStyles.headerTitle}>Dostawcy</Text>
          <Text style={mainStyles.headerSub}>
            {suppliers.length} dostawców
            {totalAnalyses > 0 ? ` · ${totalAnalyses} analiz AI` : ''}
          </Text>
        </View>
        <View style={mainStyles.headerRight}>
          <TouchableOpacity
            style={mainStyles.basketBtn}
            onPress={() => setShowGlobalBasket(true)}
            activeOpacity={0.8}
            testID="global-basket-btn"
          >
            <ShoppingCart size={18} color={Colors.accent} strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity style={mainStyles.addBtn} onPress={() => openAddSupplier()} activeOpacity={0.8} testID="add-supplier-btn">
            <Plus size={18} color={Colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
        <ReportInfoButton contextHint="Dostawcy" onApplied={fetchSuppliers} testID="dostawcy-report-info" />
      </View>

      <View style={mainStyles.searchWrap}>
        <Search size={16} color={Colors.textTertiary} strokeWidth={2} />
        <TextInput
          style={mainStyles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Szukaj dostawcy..."
          placeholderTextColor={Colors.textTertiary}
          autoCapitalize="none"
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={16} color={Colors.textTertiary} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={mainStyles.topScanBtn}
        onPress={() => setShowTopScan(true)}
        activeOpacity={0.9}
        testID="top-scan-doc-btn"
      >
        <View style={mainStyles.topScanIcon}>
          <ScanLine size={18} color={Colors.white} strokeWidth={2.5} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={mainStyles.topScanTitle}>Wgraj fakturę lub ofertę (AI)</Text>
          <Text style={mainStyles.topScanSub}>Nowy dostawca zostanie dodany automatycznie</Text>
        </View>
        <Sparkles size={16} color={Colors.white} strokeWidth={2} />
      </TouchableOpacity>

      <ScrollView
        style={mainStyles.list}
        contentContainerStyle={mainStyles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchSuppliers(); }}
            tintColor={Colors.accent}
          />
        }
      >
        {filteredSuppliers.length === 0 ? (
          <View style={mainStyles.empty}>
            <Truck size={40} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={mainStyles.emptyTitle}>
              {search ? 'Brak wyników' : 'Brak dostawców'}
            </Text>
            <Text style={mainStyles.emptySub}>
              {search
                ? 'Zmień kryteria wyszukiwania.'
                : 'Dodaj pierwszego dostawcę przyciskiem + powyżej.'}
            </Text>
          </View>
        ) : (
          filteredSuppliers.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              totalAnalysesUsed={totalAnalyses}
              orderTotal={orderTotals[supplier.id] ?? 0}
              onPhone={(phone) => Linking.openURL(`tel:${phone}`)}
              onEmail={(email) => Linking.openURL(`mailto:${email}`)}
              onUpload={handleUpload}
              onDelete={handleDeleteSupplier}
              onEdit={openEditSupplier}
              onRefresh={fetchSuppliers}
            />
          ))
        )}
        <View style={{ height: 80 }} />
      </ScrollView>

      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={() => { setShowAddModal(false); resetForm(); }}
      >
        <KeyboardAvoidingView
          style={mainStyles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={mainStyles.modalSheet}>
            <View style={mainStyles.modalHeader}>
              <Text style={mainStyles.modalTitle}>{editingId ? 'Edytuj dostawcę' : 'Nowy dostawca'}</Text>
              <TouchableOpacity onPress={() => { setShowAddModal(false); resetForm(); }}>
                <X size={22} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={mainStyles.fieldLabel}>Nazwa dostawcy *</Text>
              <TextInput style={mainStyles.input} value={formName} onChangeText={setFormName} placeholder="np. Makro Cash & Carry" placeholderTextColor={Colors.textTertiary} />

              <Text style={mainStyles.fieldLabel}>Kategoria</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} keyboardShouldPersistTaps="handled">
                <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <TouchableOpacity key={cat} style={[mainStyles.catPill, formCategory === cat && mainStyles.catPillActive]} onPress={() => setFormCategory(cat)}>
                      <Text style={[mainStyles.catPillText, formCategory === cat && mainStyles.catPillTextActive]}>{cat}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={mainStyles.fieldLabel}>NIP</Text>
              <TextInput style={mainStyles.input} value={formNip} onChangeText={setFormNip} placeholder="000-000-00-00" placeholderTextColor={Colors.textTertiary} keyboardType="numeric" />

              <Text style={mainStyles.fieldLabel}>Osoba kontaktowa</Text>
              <TextInput style={mainStyles.input} value={formContact} onChangeText={setFormContact} placeholder="Jan Kowalski" placeholderTextColor={Colors.textTertiary} />

              <Text style={mainStyles.fieldLabel}>Telefon</Text>
              <TextInput style={mainStyles.input} value={formPhone} onChangeText={setFormPhone} placeholder="+48 500 000 000" placeholderTextColor={Colors.textTertiary} keyboardType="phone-pad" />

              <Text style={mainStyles.fieldLabel}>Adres e-mail zamówień</Text>
              <TextInput style={mainStyles.input} value={formEmail} onChangeText={setFormEmail} placeholder="zamowienia@dostawca.pl" placeholderTextColor={Colors.textTertiary} keyboardType="email-address" autoCapitalize="none" testID="supplier-email-input" />

              <Text style={mainStyles.fieldLabel}>Minimum logistyczne (PLN)</Text>
              <TextInput style={mainStyles.input} value={formMinOrder} onChangeText={setFormMinOrder} placeholder="np. 300" placeholderTextColor={Colors.textTertiary} keyboardType="decimal-pad" testID="supplier-min-order-input" />

              <Text style={mainStyles.fieldLabel}>Notatki</Text>
              <TextInput style={[mainStyles.input, mainStyles.inputMultiline]} value={formNotes} onChangeText={setFormNotes} placeholder="Warunki współpracy..." placeholderTextColor={Colors.textTertiary} multiline numberOfLines={3} textAlignVertical="top" />

              <TouchableOpacity style={[mainStyles.saveBtn, saving && mainStyles.saveBtnDisabled]} onPress={handleAddSupplier} disabled={saving} activeOpacity={0.85} testID="supplier-save-btn">
                {saving
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={mainStyles.saveBtnText}>{editingId ? 'Zapisz zmiany' : 'Dodaj dostawcę'}</Text>}
              </TouchableOpacity>
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <GlobalBasketModal
        visible={showGlobalBasket}
        onClose={() => setShowGlobalBasket(false)}
      />

      {/* Top-level document scan (no supplier — auto-detect/create) */}
      <CatalogScanModal
        supplierId={null}
        visible={showTopScan}
        onClose={() => setShowTopScan(false)}
        onConfirmed={fetchSuppliers}
      />
    </SafeAreaView>
  );
}

const mainStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  addBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  basketBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.accentLight, borderWidth: 1, borderColor: '#BFDBFE', alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  topScanBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.accent, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, shadowColor: Colors.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.28, shadowRadius: 6, elevation: 4 },
  topScanIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  topScanTitle: { fontSize: 14.5, fontWeight: '700', color: Colors.white },
  topScanSub: { fontSize: 11.5, color: 'rgba(255,255,255,0.85)', marginTop: 1 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.textPrimary },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textSecondary },
  emptySub: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center', lineHeight: 19 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, marginTop: 4 },
  input: { backgroundColor: Colors.borderLight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 10, fontSize: 14, color: Colors.textPrimary, marginBottom: 14, borderWidth: 1, borderColor: Colors.border },
  inputMultiline: { height: 80, textAlignVertical: 'top' },
  catPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: Colors.borderLight, borderWidth: 1.5, borderColor: 'transparent' },
  catPillActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  catPillText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  catPillTextActive: { color: Colors.accent },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
