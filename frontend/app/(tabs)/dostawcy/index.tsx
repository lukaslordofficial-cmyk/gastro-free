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
  Switch,
  Image,
} from 'react-native';
import * as Linking from 'expo-linking';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Truck,
  Sparkles,
  X,
  ChevronDown,
  ChevronUp,
  ChevronRight,
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
import { LinearGradient } from 'expo-linear-gradient';
import * as suppliersService from '@/services/suppliersService';
import * as supplierOrdersService from '@/services/supplierOrdersService';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { OrderModal } from '@/components/OrderModal';
import {
  OrderEmailComposer,
  type OrderEmailDraft,
  ASSISTANT_FROM_EMAIL,
} from '@/components/OrderEmailComposer';
import { CatalogScanModal } from '@/components/CatalogScanModal';
import { fetchOrderEmailTemplate, isInternalOrderNote } from '@/lib/orderEmailTemplate';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PremiumTabChrome } from '@/components/premium/PremiumTabChrome';
import {
  PremiumGlowCta,
  PremiumOutlineBtn,
} from '@/components/premium/PremiumUI';
import { DS } from '@/constants/premiumTheme';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { AdBannerFooter } from '@/components/ads/AdBannerFooter';
import { formatPln, formatPlnNumber } from '@/lib/format';
import type { SupplierOffer, SupplierOfferItem } from '@/lib/types';
import { matchesAnyMenuIngredient } from '@/lib/fuzzyProductMatch';
import { secureId } from '@/lib/secureId';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CatalogProduct {
  id: string;
  name: string;
  variant: string;
  volume_label: string;
  unit_count: number;
  price_pln: number;
  liters_total: number;
  /** true = występuje w menu/magazynie; false = dodatkowy z oferty */
  in_menu: boolean;
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
  shipping_cost: number;
  free_shipping_threshold: number;
  lead_time_days: number | null;
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

function mapDbRow(row: any, menuIngredientNames: string[] = []): Supplier {
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
    min_order_value: Number(row.min_order_value ?? 0),
    shipping_cost: Number(row.shipping_cost ?? 0),
    free_shipping_threshold: Number(row.free_shipping_threshold ?? 0),
    lead_time_days:
      row.lead_time_days != null && row.lead_time_days !== ''
        ? Number(row.lead_time_days)
        : null,
    catalog: (row.supplier_catalog ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((c: any): CatalogProduct => {
        const fromDb = c.is_visible !== false;
        const fromFuzzy =
          !fromDb &&
          menuIngredientNames.length > 0 &&
          matchesAnyMenuIngredient(c.name, menuIngredientNames, 72);
        return {
          id: c.id,
          name: c.name,
          variant: c.variant,
          volume_label: c.volume_label ?? '',
          unit_count: Number(c.unit_count),
          price_pln: Number(c.price_pln),
          liters_total: Number(c.liters_total),
          in_menu: fromDb || fromFuzzy,
        };
      }),
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

function CatalogRow({
  product,
  last,
  onDelete,
}: {
  product: CatalogProduct;
  last: boolean;
  onDelete?: (id: string) => void;
}) {
  const theme = useAppTheme();
  const perLiter = product.liters_total > 0
    ? ` · ${formatPlnNumber(product.price_pln / product.liters_total)} zł/L`
    : '';
  return (
    <View
      style={[
        catStyles.row,
        last && catStyles.rowLast,
        theme.isPremium && { borderBottomColor: theme.border },
      ]}
    >
      <View style={catStyles.info}>
        <Text style={[catStyles.name, { color: theme.text }]}>{product.name}</Text>
        <Text style={[catStyles.variant, { color: theme.textSecondary }]}>{product.variant}</Text>
      </View>
      <View style={catStyles.right}>
        <Text style={[catStyles.price, { color: theme.isPremium ? theme.accent : Colors.textPrimary }]}>
          {formatPln(product.price_pln)}
        </Text>
        {!!perLiter && (
          <Text style={[catStyles.perUnit, { color: theme.textMuted }]}>{perLiter}</Text>
        )}
      </View>
      {onDelete ? (
        <TouchableOpacity
          onPress={() => {
            Alert.alert('Usuń z katalogu', `Usunąć „${product.name}” z katalogu dostawcy?`, [
              { text: 'Anuluj', style: 'cancel' },
              {
                text: 'Usuń',
                style: 'destructive',
                onPress: () => onDelete(product.id),
              },
            ]);
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ padding: 4 }}
        >
          <Trash2 size={14} color={theme.danger} strokeWidth={2} />
        </TouchableOpacity>
      ) : null}
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
  onUpload,
  onDelete,
  onEdit,
  onRefresh,
}: {
  supplier: Supplier;
  totalAnalysesUsed: number;
  orderTotal: number;
  onPhone?: (phone: string) => void;
  onEmail?: (email: string) => void;
  onUpload: (supplierId: string, isNewSupplier: boolean, onStage: (s: 'uploading' | 'analyzing') => void) => Promise<UploadResult>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (supplier: Supplier) => void;
  onRefresh: () => Promise<void>;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { notifyDocumentScanComplete } = useUiOverlay();
  const [expanded, setExpanded] = useState(false);
  const [offer, setOffer] = useState<SupplierOffer | null>(null);
  const [offerItems, setOfferItems] = useState<SupplierOfferItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<'uploading' | 'analyzing' | null>(null);
  const [menuCatalogOpen, setMenuCatalogOpen] = useState(true);
  const [extraCatalogOpen, setExtraCatalogOpen] = useState(true);
  const [menuOffersOpen, setMenuOffersOpen] = useState(true);
  const [extraOffersOpen, setExtraOffersOpen] = useState(true);
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
      const { offer: offerData, items: itemData } = await suppliersService.fetchSupplierOfferData(supplier.id);
      if (offerData) setOffer(offerData);
      setOfferItems(itemData);
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
        const data = await suppliersService.fetchOfferById(offer.id);
        if (data) {
          setOffer(data as SupplierOffer);
          if (data.status === 'done') {
            setOfferItems(await suppliersService.fetchOfferItems(supplier.id));
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
      } else if (manualUnit === 'kg') {
        kgTotal = 1;
      } else if (manualUnit === 'g') {
        kgTotal = 0.001;
      } else if (manualUnit === 'l') {
        litersTotal = 1;
      } else if (manualUnit === 'ml') {
        litersTotal = 0.001;
      }
      // Czytelna etykieta zawartości, np. "400 g" / "1 l" — trafia do variant/volume_label.
      // Dla kg/g/l (bez osobnego size) volume_label = jednostka — kolumna jest NOT NULL.
      const sizeLabel = hasSize
        ? `${manualSizeValue.trim().replace(',', '.')} ${manualSizeUnit}`
        : '';
      // `variant` ma w bazie ograniczenie NOT NULL — nigdy nie zapisujemy null.
      const variant = sizeLabel || manualUnit || '';
      const volumeLabel = sizeLabel || manualUnit || '';
      // Zapis do GŁÓWNEGO katalogu dostawcy (supplier_catalog) — dzięki temu produkt
      // jest brany pod uwagę przez AI podczas tworzenia ofert zamówień (compare-offers).
      const basePayload = {
        supplier_id: supplier.id,
        name: manualName.trim(),
        variant,
        volume_label: volumeLabel,
        unit: manualUnit,
        unit_count: 1,
        price_pln: isFinite(price) && price > 0 ? price : 0,
        liters_total: litersTotal,
        sort_order: 999,
        is_visible: true,
      };
      const { error } = await suppliersService.insertCatalogProduct(basePayload, kgTotal);
      if (error) throw new Error(error.message);
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
  const catalogInMenu = useMemo(() => supplier.catalog.filter((p) => p.in_menu), [supplier.catalog]);
  const catalogExtra = useMemo(() => supplier.catalog.filter((p) => !p.in_menu), [supplier.catalog]);
  const displayCategory = useMemo(() => {
    const c = (supplier.category || '').trim();
    if (!c) return '';
    const fold = c.toLowerCase().replace(/\s+/g, ' ');
    // Nie pokazuj oznaczeń testowych / symulacji
    if (fold === 'sim' || fold === 'sup' || fold === 'sim sup' || /^sim[\s_-]*sup/.test(fold)) {
      return '';
    }
    return c;
  }, [supplier.category]);

  const deleteCatalogProduct = async (id: string) => {
    const { error } = await suppliersService.deleteCatalogProduct(id);
    if (error) {
      Alert.alert('Błąd', error.message);
      return;
    }
    await onRefresh();
  };

  const manualAddButton = (
    <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12) }}>
      <TouchableOpacity
        style={[
          cardStyles.manualAddBtn,
          theme.isPremium && { borderWidth: 0, overflow: 'hidden', paddingVertical: 0 },
        ]}
        onPress={() => setShowManualModal(true)}
        activeOpacity={0.75}
      >
        {theme.isPremium ? (
          <LinearGradient
            colors={[...DS.gradient.green]}
            start={{ x: 0, y: 0.15 }}
            end={{ x: 1, y: 0.85 }}
            style={cardStyles.manualAddGrad}
          >
            <PenLine size={13} color="#0A0A0A" strokeWidth={2} />
            <Text style={cardStyles.manualAddTextPrem}>Dodaj produkt ręcznie</Text>
          </LinearGradient>
        ) : (
          <>
            <PenLine size={13} color={Colors.textSecondary} strokeWidth={2} />
            <Text style={cardStyles.manualAddText}>Dodaj produkt ręcznie</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[
      cardStyles.container,
      theme.isPremium && {
        backgroundColor: DS.color.surfaceCard,
        borderColor: DS.color.borderSubtle,
        borderRadius: DS.radius.card,
        borderWidth: StyleSheet.hairlineWidth,
        ...DS.shadow.card,
        marginBottom: DS.space[16],
      },
    ]}>
      <View style={cardStyles.header}>
        <TouchableOpacity style={cardStyles.headerMain} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
          <View style={[cardStyles.iconWrap, { backgroundColor: theme.isPremium ? 'rgba(0,255,120,0.1)' : iconBg }]}>
            <Truck size={18} color={theme.isPremium ? DS.color.greenEnd : supplier.icon_color} strokeWidth={2} />
          </View>
          <View style={cardStyles.titleWrap}>
            <Text style={[cardStyles.name, theme.isPremium && { color: DS.color.heading, fontSize: 14 }]} numberOfLines={1} allowFontScaling={false}>{supplier.name}</Text>
            <View style={cardStyles.metaRow}>
              {!!displayCategory && (
                <Text style={[cardStyles.category, theme.isPremium && { color: DS.color.muted }]} numberOfLines={1}>
                  {displayCategory}
                </Text>
              )}
              {!!supplier.nip && (
                <Text style={[cardStyles.nip, theme.isPremium && { color: DS.color.muted }]} numberOfLines={1}>
                  {supplier.nip}
                </Text>
              )}
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
          {/* Dane + zarządzanie */}
          <View style={cardStyles.details}>
            {/* Edytuj / Usuń — u góry, ponad danymi */}
            <View style={cardStyles.managePanelRow}>
              <TouchableOpacity
                style={[
                  cardStyles.managePanelBtn,
                  theme.isPremium
                    ? { backgroundColor: 'rgba(0,230,118,0.22)', borderWidth: 1, borderColor: DS.color.greenEnd }
                    : { backgroundColor: Colors.accentLight, borderWidth: 1, borderColor: '#BFDBFE' },
                ]}
                onPress={() => onEdit(supplier)}
                activeOpacity={0.7}
                testID={`edit-supplier-${supplier.id}`}
              >
                <PenLine size={13} color={theme.isPremium ? DS.color.greenEnd : Colors.accent} strokeWidth={2.4} />
                <Text
                  style={[
                    cardStyles.managePanelBtnText,
                    { color: theme.isPremium ? DS.color.greenEnd : Colors.accent },
                  ]}
                >
                  Edytuj
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  cardStyles.managePanelBtn,
                  theme.isPremium
                    ? { backgroundColor: 'rgba(255,82,82,0.18)', borderWidth: 1, borderColor: DS.color.danger }
                    : { backgroundColor: Colors.dangerLight, borderWidth: 1, borderColor: '#FECACA' },
                ]}
                onPress={handleDelete}
                activeOpacity={0.7}
                testID={`delete-supplier-${supplier.id}`}
              >
                <Trash2 size={13} color={theme.isPremium ? DS.color.danger : Colors.danger} strokeWidth={2.4} />
                <Text
                  style={[
                    cardStyles.managePanelBtnText,
                    { color: theme.isPremium ? DS.color.danger : Colors.danger },
                  ]}
                >
                  Usuń
                </Text>
              </TouchableOpacity>
            </View>

            {/* Dane dostawcy — etykiety + wartości */}
            <View
              style={[
                cardStyles.dataBlock,
                theme.isPremium && { backgroundColor: '#000000' },
              ]}
            >
              <View style={cardStyles.dataRow}>
                <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Nazwa</Text>
                <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                  {supplier.name}
                </Text>
              </View>
              {!!displayCategory && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Kategoria</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {displayCategory}
                  </Text>
                </View>
              )}
              {!!supplier.nip && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>NIP</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.nip}
                  </Text>
                </View>
              )}
              {!!supplier.contact_person && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Kontakt</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.contact_person}
                  </Text>
                </View>
              )}
              {!!supplier.phone && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Telefon</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.phone}
                  </Text>
                </View>
              )}
              {!!supplier.email && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>E-mail</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.email}
                  </Text>
                </View>
              )}
              {!!supplier.notes && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Notatki</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.notes}
                  </Text>
                </View>
              )}
              {supplier.min_order_value > 0 && (
                <View style={cardStyles.dataRow} testID={`min-order-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>
                    Min. zamówienie
                  </Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {formatPln(supplier.min_order_value)}
                  </Text>
                </View>
              )}
              {supplier.shipping_cost > 0 && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Dostawa</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {formatPln(supplier.shipping_cost)}
                    {supplier.free_shipping_threshold > 0
                      ? ` · gratis od ${formatPln(supplier.free_shipping_threshold)}`
                      : ''}
                  </Text>
                </View>
              )}
              {supplier.lead_time_days != null && supplier.lead_time_days > 0 ? (
                <View style={cardStyles.dataRow} testID={`lead-time-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>
                    Czas dostawy
                  </Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.lead_time_days === 1
                      ? '1 dzień'
                      : `${supplier.lead_time_days} dni`}
                  </Text>
                </View>
              ) : (
                <View style={cardStyles.dataRow} testID={`lead-time-missing-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>
                    Czas dostawy
                  </Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && { color: DS.color.muted }]}>
                    Uzupełnij czas dostawy
                  </Text>
                </View>
              )}
              <View style={cardStyles.dataRow} testID={`reliability-${supplier.id}`}>
                <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>
                  Niezawodność
                </Text>
                <Text style={[cardStyles.dataValue, theme.isPremium && { color: DS.color.muted }]}>
                  brak danych / wstępna
                </Text>
              </View>
              <Text
                style={[
                  cardStyles.dataLabel,
                  { marginBottom: 8, fontSize: 11, lineHeight: 15 },
                  theme.isPremium && { color: DS.color.muted },
                ]}
              >
                Score z ocen dostaw pojawi się po wgraniu co najmniej 5 ofert od tego dostawcy.
              </Text>
            </View>

            {/* Złóż zamówienie — pod danymi */}
            <TouchableOpacity
              style={[
                cardStyles.managePanelBtn,
                cardStyles.managePanelBtnFull,
                theme.isPremium
                  ? { backgroundColor: DS.color.greenEnd }
                  : { backgroundColor: Colors.accent },
              ]}
              onPress={() => setShowOrderModal(true)}
              activeOpacity={0.7}
            >
              <ShoppingCart size={15} color={theme.isPremium ? '#0A0A0A' : Colors.white} strokeWidth={2.4} />
              <Text
                style={[
                  cardStyles.managePanelBtnText,
                  { color: theme.isPremium ? '#0A0A0A' : Colors.white, fontSize: 13 },
                ]}
              >
                Złóż zamówienie
              </Text>
            </TouchableOpacity>
          </View>

          {/* Offer section */}
          <View
            style={[
              cardStyles.pdfSection,
              theme.isPremium && {
                backgroundColor: DS.color.bgTertiary,
                borderTopColor: DS.color.borderSubtle,
              },
            ]}
          >
            <View style={cardStyles.pdfSectionHeader}>
              <FileText size={13} color={theme.isPremium ? DS.color.greenEnd : Colors.textSecondary} strokeWidth={2} />
              <Text style={[cardStyles.pdfSectionTitle, theme.isPremium && { color: DS.color.heading }]}>Oferta AI — Cennik</Text>
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
                <Text style={cardStyles.catalogLabel}>Produkty dostawcy (skan)</Text>
                <Text style={cardStyles.catalogCount}>{offerItems.length} pozycji</Text>
              </View>

              <TouchableOpacity
                style={[
                  cardStyles.sectionToggle,
                  theme.isPremium && {
                    backgroundColor: DS.color.greenEnd,
                    borderTopColor: 'rgba(0,0,0,0.15)',
                  },
                ]}
                onPress={() => setMenuOffersOpen((v) => !v)}
                activeOpacity={0.75}
              >
                {menuOffersOpen
                  ? <ChevronDown size={14} color={theme.isPremium ? '#0A0A0A' : Colors.success} />
                  : <ChevronRight size={14} color={theme.isPremium ? '#0A0A0A' : Colors.success} />}
                <Text
                  style={[
                    cardStyles.sectionToggleText,
                    { color: theme.isPremium ? '#0A0A0A' : Colors.success },
                  ]}
                >
                  Występujące w menu · {visibleItems.length}
                </Text>
              </TouchableOpacity>
              {manualAddButton}
              {menuOffersOpen && visibleItems.map((p, idx) => (
                <AiProductRow key={p.id} p={p} last={idx === visibleItems.length - 1} />
              ))}

              <TouchableOpacity
                style={[
                  cardStyles.sectionToggle,
                  theme.isPremium && {
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    borderTopColor: DS.color.borderSubtle,
                  },
                ]}
                onPress={() => setExtraOffersOpen((v) => !v)}
                activeOpacity={0.75}
              >
                {extraOffersOpen
                  ? <ChevronDown size={14} color={theme.isPremium ? '#0A0A0A' : Colors.textTertiary} />
                  : <ChevronRight size={14} color={theme.isPremium ? '#0A0A0A' : Colors.textTertiary} />}
                <Text
                  style={[
                    cardStyles.sectionToggleText,
                    { color: theme.isPremium ? '#0A0A0A' : Colors.textTertiary },
                  ]}
                >
                  Dodatkowe · {hiddenItems.length}
                </Text>
              </TouchableOpacity>
              {extraOffersOpen && hiddenItems.map((p, idx) => (
                <AiProductRow key={p.id} p={p} last={idx === hiddenItems.length - 1} />
              ))}
            </>
          )}

          {/* Katalog: wszystkie produkty — Występujące w menu / Dodatkowe */}
          {supplier.catalog.length > 0 && (
            <>
              <View
                style={[
                  cardStyles.catalogHeader,
                  theme.isPremium && {
                    backgroundColor: 'rgba(0,230,118,0.14)',
                    borderTopColor: DS.color.borderSubtle,
                  },
                ]}
              >
                <Tag size={11} color={theme.isPremium ? DS.color.greenEnd : Colors.textTertiary} strokeWidth={2} />
                <Text
                  style={[
                    cardStyles.catalogLabel,
                    theme.isPremium && { color: DS.color.greenEnd },
                  ]}
                >
                  Katalog (zamawianie)
                </Text>
                <Text
                  style={[
                    cardStyles.catalogCount,
                    theme.isPremium && { color: DS.color.greenEnd },
                  ]}
                >
                  {supplier.catalog.length} pozycji
                </Text>
              </View>
              <Text
                style={[
                  cardStyles.catalogHint,
                  theme.isPremium && { color: DS.color.muted },
                ]}
              >
                Wszystkie produkty z oferty. Segregacja: pasujące do menu/magazynu vs dodatkowe.
              </Text>

              <TouchableOpacity
                style={[
                  cardStyles.sectionToggle,
                  theme.isPremium && {
                    backgroundColor: DS.color.greenEnd,
                    borderTopColor: 'rgba(0,0,0,0.15)',
                  },
                ]}
                onPress={() => setMenuCatalogOpen((v) => !v)}
                activeOpacity={0.75}
              >
                {menuCatalogOpen
                  ? <ChevronDown size={14} color={theme.isPremium ? '#0A0A0A' : Colors.success} />
                  : <ChevronRight size={14} color={theme.isPremium ? '#0A0A0A' : Colors.success} />}
                <Text
                  style={[
                    cardStyles.sectionToggleText,
                    { color: theme.isPremium ? '#0A0A0A' : Colors.success },
                  ]}
                >
                  Występujące w menu · {catalogInMenu.length}
                </Text>
              </TouchableOpacity>
              {manualAddButton}
              {menuCatalogOpen && catalogInMenu.map((product, idx) => (
                <CatalogRow
                  key={product.id}
                  product={product}
                  last={idx === catalogInMenu.length - 1}
                  onDelete={deleteCatalogProduct}
                />
              ))}

              <TouchableOpacity
                style={[
                  cardStyles.sectionToggle,
                  theme.isPremium && {
                    backgroundColor: 'rgba(0,230,118,0.18)',
                    borderTopColor: DS.color.borderSubtle,
                  },
                ]}
                onPress={() => setExtraCatalogOpen((v) => !v)}
                activeOpacity={0.75}
              >
                {extraCatalogOpen
                  ? <ChevronDown size={14} color={theme.isPremium ? DS.color.greenEnd : Colors.textTertiary} />
                  : <ChevronRight size={14} color={theme.isPremium ? DS.color.greenEnd : Colors.textTertiary} />}
                <Text
                  style={[
                    cardStyles.sectionToggleText,
                    { color: theme.isPremium ? DS.color.greenEnd : Colors.textTertiary },
                  ]}
                >
                  Dodatkowe · {catalogExtra.length}
                </Text>
              </TouchableOpacity>
              {extraCatalogOpen && catalogExtra.map((product, idx) => (
                <CatalogRow
                  key={product.id}
                  product={product}
                  last={idx === catalogExtra.length - 1}
                  onDelete={deleteCatalogProduct}
                />
              ))}
            </>
          )}

          {/* Brak katalogu — nadal pozwól dodać produkt ręcznie */}
          {!loadingData && supplier.catalog.length === 0 && offerItems.length === 0 && (
            manualAddButton
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
          style={[
            cardStyles.modalOverlay,
            theme.isPremium && { backgroundColor: 'rgba(0,0,0,0.72)' },
          ]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={[
              cardStyles.manualSheet,
              { paddingBottom: Math.max(insets.bottom, 20) + 12 },
              theme.isPremium && {
                backgroundColor: DS.color.surfaceCard,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: DS.color.borderSubtle,
              },
            ]}
          >
            <View style={cardStyles.manualHeader}>
              <Text
                style={[
                  cardStyles.manualTitle,
                  theme.isPremium && { color: DS.color.heading },
                ]}
              >
                Dodaj produkt ręcznie
              </Text>
              <TouchableOpacity onPress={() => setShowManualModal(false)} hitSlop={10}>
                <X
                  size={20}
                  color={theme.isPremium ? DS.color.muted : Colors.textSecondary}
                  strokeWidth={2}
                />
              </TouchableOpacity>
            </View>

            <Text
              style={[
                cardStyles.manualLabel,
                theme.isPremium && { color: DS.color.muted },
              ]}
            >
              Nazwa produktu *
            </Text>
            <TextInput
              style={[
                cardStyles.manualInput,
                theme.isPremium && {
                  backgroundColor: DS.color.bgTertiary,
                  borderColor: DS.color.borderSubtle,
                  color: DS.color.heading,
                },
              ]}
              value={manualName}
              onChangeText={setManualName}
              placeholder="np. Filet z kurczaka"
              placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
              autoFocus
            />

            <Text
              style={[
                cardStyles.manualLabel,
                theme.isPremium && { color: DS.color.muted },
              ]}
            >
              Cena netto (opcjonalnie)
            </Text>
            <TextInput
              style={[
                cardStyles.manualInput,
                theme.isPremium && {
                  backgroundColor: DS.color.bgTertiary,
                  borderColor: DS.color.borderSubtle,
                  color: DS.color.heading,
                },
              ]}
              value={manualPrice}
              onChangeText={setManualPrice}
              placeholder="0.00"
              placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
              keyboardType="decimal-pad"
            />

            <Text
              style={[
                cardStyles.manualLabel,
                theme.isPremium && { color: DS.color.muted },
              ]}
            >
              Jednostka
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 16 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
                {UNIT_OPTIONS.map((u) => {
                  const active = manualUnit === u;
                  return (
                    <TouchableOpacity
                      key={u}
                      style={[
                        cardStyles.unitPill,
                        theme.isPremium && {
                          backgroundColor: DS.color.bgTertiary,
                          borderColor: DS.color.borderSubtle,
                        },
                        active && (theme.isPremium
                          ? { backgroundColor: 'rgba(0,255,120,0.18)', borderColor: DS.color.greenEnd }
                          : cardStyles.unitPillActive),
                      ]}
                      onPress={() => setManualUnit(u)}
                      testID={`manual-unit-${u}`}
                    >
                      <Text
                        style={[
                          cardStyles.unitPillText,
                          theme.isPremium && { color: DS.color.muted },
                          active && (theme.isPremium
                            ? { color: DS.color.greenEnd, fontWeight: '800' }
                            : cardStyles.unitPillTextActive),
                        ]}
                      >
                        {u}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {(manualUnit === 'szt' || manualUnit === 'opak' || manualUnit === 'butelka') && (
              <View testID="manual-size-section">
                <Text
                  style={[
                    cardStyles.manualLabel,
                    theme.isPremium && { color: DS.color.muted },
                  ]}
                >
                  Ile waży / zawiera 1 {manualUnit}? (opcjonalnie)
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <TextInput
                    style={[
                      cardStyles.manualInput,
                      { flex: 1, marginBottom: 0 },
                      theme.isPremium && {
                        backgroundColor: DS.color.bgTertiary,
                        borderColor: DS.color.borderSubtle,
                        color: DS.color.heading,
                      },
                    ]}
                    value={manualSizeValue}
                    onChangeText={setManualSizeValue}
                    placeholder="np. 400"
                    placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                    keyboardType="decimal-pad"
                    testID="manual-size-value"
                  />
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {(['g', 'kg', 'ml', 'l'] as const).map((su) => {
                      const active = manualSizeUnit === su;
                      return (
                        <TouchableOpacity
                          key={su}
                          style={[
                            cardStyles.unitPill,
                            theme.isPremium && {
                              backgroundColor: DS.color.bgTertiary,
                              borderColor: DS.color.borderSubtle,
                            },
                            active && (theme.isPremium
                              ? { backgroundColor: 'rgba(0,255,120,0.18)', borderColor: DS.color.greenEnd }
                              : cardStyles.unitPillActive),
                          ]}
                          onPress={() => setManualSizeUnit(su)}
                          testID={`manual-size-unit-${su}`}
                        >
                          <Text
                            style={[
                              cardStyles.unitPillText,
                              theme.isPremium && { color: DS.color.muted },
                              active && (theme.isPremium
                                ? { color: DS.color.greenEnd, fontWeight: '800' }
                                : cardStyles.unitPillTextActive),
                            ]}
                          >
                            {su}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                <Text
                  style={[
                    cardStyles.manualLabel,
                    { marginTop: 6, fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
                    theme.isPremium && { color: DS.color.muted },
                  ]}
                >
                  Pozwala przeliczyć porcje i porównać ceny (np. 1 opak. = 400 g).
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[
                cardStyles.manualSaveBtn,
                theme.isPremium && {
                  backgroundColor: 'transparent',
                  overflow: 'hidden',
                  paddingVertical: 0,
                },
                savingManual && cardStyles.manualSaveBtnDisabled,
              ]}
              onPress={handleAddManualProduct}
              disabled={savingManual}
              activeOpacity={0.85}
            >
              {theme.isPremium ? (
                <LinearGradient
                  colors={[...DS.gradient.green]}
                  start={{ x: 0, y: 0.15 }}
                  end={{ x: 1, y: 0.85 }}
                  style={cardStyles.manualSaveGrad}
                >
                  {savingManual
                    ? <ActivityIndicator size="small" color="#0A0A0A" />
                    : <Text style={cardStyles.manualSaveBtnTextPrem}>Dodaj produkt</Text>}
                </LinearGradient>
              ) : savingManual ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={cardStyles.manualSaveBtnText}>Dodaj produkt</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Order modal */}
      <OrderModal
        supplierId={supplier.id}
        supplierName={supplier.name}
        supplierEmail={supplier.email}
        visible={showOrderModal}
        onClose={() => setShowOrderModal(false)}
      />

      {/* AI catalog scan modal (GPT-4o Vision) */}
      <CatalogScanModal
        supplierId={supplier.id}
        supplierName={supplier.name}
        visible={showScanModal}
        onClose={() => setShowScanModal(false)}
        onConfirmed={async () => {
          await onRefresh();
          notifyDocumentScanComplete('offer');
        }}
        scanContext="supplier"
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
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4, flexWrap: 'wrap' },
  managePanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.borderLight,
    padding: 10,
    gap: 8,
  },
  managePanelTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
  },
  managePanelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  managePanelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    minHeight: 40,
  },
  managePanelBtnFull: {
    flex: 0,
    width: '100%',
    paddingVertical: 12,
    marginTop: 2,
  },
  managePanelBtnText: { fontSize: 12, fontWeight: '800' },
  dataBlock: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
    backgroundColor: Colors.borderLight,
  },
  dataRow: {
    gap: 4,
  },
  dataLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
  },
  dataLabelPrem: {
    color: 'rgba(255,255,255,0.45)',
  },
  dataValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  dataValuePrem: {
    color: '#FFFFFF',
  },
  dataLine: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  dataLinePrem: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
  },
  manageBtnText: { fontSize: 12.5, fontWeight: '800' },
  editRowLegacy: { backgroundColor: Colors.accentLight, borderColor: '#BFDBFE' },
  deleteRowLegacy: { backgroundColor: Colors.dangerLight, borderColor: '#FECACA' },
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
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 12,
    minHeight: 52,
    overflow: 'hidden',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  scanBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    minHeight: 52,
    width: '100%',
  },
  scanBtnText: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: Colors.white, textAlign: 'center' },
  scanBtnTextPrem: { flexShrink: 1, flex: 1, fontSize: 13, fontWeight: '800', color: '#0A0A0A', textAlign: 'center' },
  orderTotalBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 5, backgroundColor: '#F0FDF4', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: '#BBF7D0' },
  orderTotalText: { fontSize: 11, fontWeight: '700', color: Colors.success },
  uploadBtnDisabled: { opacity: 0.5 },
  uploadBtnText: { fontSize: 13, fontWeight: '600', color: Colors.accent },
  manualAddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: Colors.borderLight, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingVertical: 10, overflow: 'hidden' },
  manualAddGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    width: '100%',
  },
  manualAddText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  manualAddTextPrem: { fontSize: 12, fontWeight: '800', color: '#0A0A0A' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  loadingText: { fontSize: 13, color: Colors.textTertiary },
  catalogHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Colors.borderLight, borderTopWidth: 1, borderTopColor: Colors.border },
  catalogLabel: { flex: 1, fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  catalogCount: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' },
  catalogHint: {
    fontSize: 11, color: Colors.textTertiary, lineHeight: 15,
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 2,
  },
  sectionToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: Colors.card, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  sectionToggleText: { fontSize: 12.5, fontWeight: '800', color: Colors.textSecondary, letterSpacing: 0.1 },
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
  manualSaveGrad: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualSaveBtnDisabled: { opacity: 0.6 },
  manualSaveBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
  manualSaveBtnTextPrem: { color: '#0A0A0A', fontSize: 15, fontWeight: '800' },
});

// ─── DraftCartEditor — edycja zapisanego koszyka Łowcy ───────────────────────

type DraftItem = {
  id: string;
  name: string;
  qty: number;
  unit: string;
  price: number | null;
};

type DraftOrder = {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  supplier_email: string | null;
  notes: string | null;
  items: DraftItem[];
};

function DraftCartEditor({
  draft,
  onClose,
  onSaved,
}: {
  draft: DraftOrder;
  onClose: () => void;
  onSaved: () => void;
}) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const bg = prem ? DS.color.bgPrimary : Colors.background;
  const card = prem ? DS.color.surfaceCard : Colors.card;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const tile = prem ? DS.color.bgTertiary : Colors.borderLight;
  const [items, setItems] = useState<DraftItem[]>(draft.items);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newUnit, setNewUnit] = useState('szt');
  const [newPrice, setNewPrice] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalog, setCatalog] = useState<{ id: string; name: string; price_pln: number | null; unit: string | null }[]>([]);
  const [catalogQ, setCatalogQ] = useState('');

  useEffect(() => {
    if (!catalogOpen || !draft.supplier_id) return;
    void (async () => {
      const data = await suppliersService.fetchSupplierCatalog(draft.supplier_id!);
      setCatalog((data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        price_pln: r.price_pln != null ? Number(r.price_pln) : null,
        unit: r.unit || 'szt',
      })));
    })();
  }, [catalogOpen, draft.supplier_id]);

  const updateQty = (id: string, qty: number) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, qty: Math.max(0, qty) } : it)),
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const addManual = () => {
    const name = newName.trim();
    const qty = parseFloat(newQty.replace(',', '.'));
    if (!name || !(qty > 0)) {
      Alert.alert('Uzupełnij', 'Podaj nazwę i ilość > 0.');
      return;
    }
    const price = newPrice.trim() ? parseFloat(newPrice.replace(',', '.')) : null;
    setItems((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        name,
        qty,
        unit: newUnit || 'szt',
        price: price != null && !Number.isNaN(price) ? price : null,
      },
    ]);
    setNewName('');
    setNewQty('1');
    setNewPrice('');
  };

  const addFromCatalog = (c: { name: string; price_pln: number | null; unit: string | null }) => {
    setItems((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        name: c.name,
        qty: 1,
        unit: c.unit || 'szt',
        price: c.price_pln,
      },
    ]);
    setCatalogOpen(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Usuń stare pozycje, wstaw aktualne, zapisz notatki (w serwisie).
      const rows = items
        .filter((it) => it.qty > 0 && it.name.trim())
        .map((it) => ({
          order_id: draft.id,
          raw_product_name: it.name.trim(),
          price_net: it.price,
          unit: it.unit || 'szt',
          quantity_ordered: it.qty,
          warehouse_product_id: null,
        }));
      await supplierOrdersService.saveOrderItems(draft.id, rows, draft.notes?.trim() || null);
      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert('Błąd', e?.message ?? 'Nie udało się zapisać koszyka.');
    } finally {
      setSaving(false);
    }
  };

  const filteredCat = catalog.filter((c) =>
    c.name.toLowerCase().includes(catalogQ.toLowerCase()),
  );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: border }}>
          <ShoppingCart size={18} color={accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: text }}>Edycja koszyka</Text>
            <Text style={{ fontSize: 12, color: muted }}>{draft.supplier_name}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <X size={22} color={muted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {items.map((it) => (
            <View
              key={it.id}
              style={{
                backgroundColor: card,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: border,
                padding: 12,
                marginBottom: 8,
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: text }}>{it.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => updateQty(it.id, it.qty - 1)}
                  style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: tile, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontSize: 18, fontWeight: '700', color: text }}>−</Text>
                </TouchableOpacity>
                <TextInput
                  style={{
                    width: 64,
                    borderWidth: 1,
                    borderColor: border,
                    borderRadius: 8,
                    textAlign: 'center',
                    paddingVertical: 6,
                    fontWeight: '700',
                    color: text,
                    backgroundColor: tile,
                  }}
                  keyboardType="decimal-pad"
                  value={String(it.qty)}
                  onChangeText={(v) => updateQty(it.id, parseFloat(v.replace(',', '.')) || 0)}
                />
                <TouchableOpacity
                  onPress={() => updateQty(it.id, it.qty + 1)}
                  style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: prem ? 'rgba(0,255,120,0.15)' : Colors.accentLight, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Plus size={16} color={accent} />
                </TouchableOpacity>
                <Text style={{ color: muted, fontWeight: '600' }}>{it.unit}</Text>
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={() => removeItem(it.id)} hitSlop={8}>
                  <Trash2 size={16} color={Colors.danger} />
                </TouchableOpacity>
              </View>
              {it.price != null && (
                <Text style={{ fontSize: 12, color: muted }}>
                  {formatPlnNumber(it.price)} zł / {it.unit}
                </Text>
              )}
            </View>
          ))}

          <Text style={{ fontSize: 13, fontWeight: '700', color: text, marginTop: 8, marginBottom: 8 }}>
            Dodaj produkt
          </Text>
          <TextInput
            style={{ borderWidth: 1, borderColor: border, borderRadius: 10, padding: 10, marginBottom: 8, backgroundColor: tile, color: text }}
            placeholder="Nazwa produktu"
            placeholderTextColor={muted}
            value={newName}
            onChangeText={setNewName}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <TextInput
              style={{ flex: 1, borderWidth: 1, borderColor: border, borderRadius: 10, padding: 10, backgroundColor: tile, color: text }}
              placeholder="Ilość"
              placeholderTextColor={muted}
              keyboardType="decimal-pad"
              value={newQty}
              onChangeText={setNewQty}
            />
            <TextInput
              style={{ width: 72, borderWidth: 1, borderColor: border, borderRadius: 10, padding: 10, backgroundColor: tile, color: text }}
              placeholder="j.m."
              placeholderTextColor={muted}
              value={newUnit}
              onChangeText={setNewUnit}
            />
            <TextInput
              style={{ flex: 1, borderWidth: 1, borderColor: border, borderRadius: 10, padding: 10, backgroundColor: tile, color: text }}
              placeholder="Cena"
              placeholderTextColor={muted}
              keyboardType="decimal-pad"
              value={newPrice}
              onChangeText={setNewPrice}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={addManual}
              style={{ flex: 1, backgroundColor: accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ color: prem ? '#0A0A0A' : '#fff', fontWeight: '800' }}>Dodaj ręcznie</Text>
            </TouchableOpacity>
            {!!draft.supplier_id && (
              <TouchableOpacity
                onPress={() => setCatalogOpen(true)}
                style={{ flex: 1, backgroundColor: prem ? 'rgba(0,255,120,0.12)' : Colors.accentLight, borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: accent }}
              >
                <Text style={{ color: accent, fontWeight: '800' }}>Z katalogu</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>

        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: border, backgroundColor: card }}>
          <TouchableOpacity
            onPress={() => void save()}
            disabled={saving}
            style={{ backgroundColor: accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
          >
            {saving ? (
              <ActivityIndicator color={prem ? '#0A0A0A' : '#fff'} />
            ) : (
              <Text style={{ color: prem ? '#0A0A0A' : '#fff', fontWeight: '800', fontSize: 15 }}>Zapisz zmiany</Text>
            )}
          </TouchableOpacity>
        </View>

        <Modal visible={catalogOpen} animationType="slide" onRequestClose={() => setCatalogOpen(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: bg }}>
            <View style={{ flexDirection: 'row', padding: 16, alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, fontSize: 16, fontWeight: '800', color: text }}>Katalog dostawcy</Text>
              <TouchableOpacity onPress={() => setCatalogOpen(false)}>
                <X size={22} color={muted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={{ marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderColor: border, borderRadius: 10, padding: 10, backgroundColor: tile, color: text }}
              placeholder="Szukaj…"
              placeholderTextColor={muted}
              value={catalogQ}
              onChangeText={setCatalogQ}
            />
            <ScrollView>
              {filteredCat.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => addFromCatalog(c)}
                  style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: border }}
                >
                  <Text style={{ fontWeight: '600', color: text }}>{c.name}</Text>
                  <Text style={{ fontSize: 12, color: muted }}>
                    {c.price_pln != null ? `${formatPlnNumber(c.price_pln)} zł` : 'b/d'} / {c.unit}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </View>
    </Modal>
  );
}

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
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const { alert } = usePremiumAlert();
  const [groups, setGroups] = useState<GlobalBasketGroup[]>([]);
  const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
  const [editingDraft, setEditingDraft] = useState<DraftOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [orderSupplierId, setOrderSupplierId] = useState<string | null>(null);
  const [orderSupplierName, setOrderSupplierName] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [emailDraft, setEmailDraft] = useState<OrderEmailDraft | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailDraftOrderId, setEmailDraftOrderId] = useState<string | null>(null);

  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const cardBg = prem ? DS.color.surfaceCard : Colors.card;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const bg = prem ? DS.color.bgPrimary : Colors.background;
  const headerTile = prem ? DS.color.bgTertiary : Colors.borderLight;

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    void (async () => {
      const { offerItems: offerData, drafts } = await supplierOrdersService.fetchGlobalBasket();

      const map = new Map<string, GlobalBasketGroup>();
      for (const row of offerData ?? []) {
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

      setDraftOrders(
        (drafts ?? []).map((d: any) => ({
          id: d.id,
          supplier_id: d.supplier_id ?? null,
          supplier_name: d.suppliers?.name ?? 'Dostawca',
          supplier_email: d.suppliers?.email ?? null,
          notes: d.notes ?? null,
          items: (d.supplier_order_items ?? []).map((it: any) => ({
            id: it.id || secureId('tmp'),
            name: it.raw_product_name,
            qty: Number(it.quantity_ordered) || 0,
            unit: it.unit || 'szt',
            price: it.price_net != null ? Number(it.price_net) : null,
          })),
        })),
      );
      setLoading(false);
    })();
  }, [visible, reloadKey]);

  const totalItems = groups.reduce((acc, g) => acc + g.items.length, 0);
  const isEmpty = totalItems === 0 && draftOrders.length === 0;

  const draftTotal = (d: DraftOrder) =>
    d.items.reduce((s, it) => s + (it.price != null ? it.price * it.qty : 0), 0);

  const groupTotal = (g: GlobalBasketGroup) =>
    g.items.reduce((s, it) => s + (it.price_net != null ? it.price_net : 0), 0);

  const buildOrderEmail = async (d: DraftOrder) => {
    const tpl = await fetchOrderEmailTemplate({
      supplierId: d.supplier_id,
      supplierName: d.supplier_name,
      supplierEmail: d.supplier_email,
      restaurantName: 'Nasza restauracja',
      notes: d.notes ?? undefined,
      items: d.items.map((it) => ({
        product_name: it.name,
        quantity: it.qty,
        unit: it.unit,
        line_total: it.price != null ? it.price * it.qty : 0,
      })),
    });
    return {
      subject: tpl.subject,
      body: tpl.body,
      email: tpl.supplierEmail || d.supplier_email || '',
    };
  };

  const markDraftSent = async (orderId: string) => {
    try {
      await supplierOrdersService.markDraftSent(orderId);
      setDraftOrders((prev) => prev.filter((x) => x.id !== orderId));
      setReloadKey((k) => k + 1);
    } catch {
      /* best-effort — koszyk i tak odświeżymy */
      setReloadKey((k) => k + 1);
    }
  };

  const openDraftEmailTemplate = (d: DraftOrder) => {
    void (async () => {
      setEmailBusy(true);
      try {
        const { subject, body, email } = await buildOrderEmail(d);
        setEmailDraftOrderId(d.id);
        setEmailDraft({
          supplierName: d.supplier_name,
          toEmail: email,
          fromEmail: ASSISTANT_FROM_EMAIL,
          subject,
          body,
        });
        setShowEmail(true);
      } catch (e: any) {
        alert('Błąd', e?.message || 'Nie udało się wygenerować szablonu e-mail.');
      } finally {
        setEmailBusy(false);
      }
    })();
  };

  const orderAllDrafts = () => {
    if (!draftOrders.length) {
      alert('Brak zamówień', 'W koszyku nie ma zapisanych zamówień do wysyłki.', [
        { text: 'OK', style: 'primary' },
      ]);
      return;
    }
    const preview = draftOrders
      .map((d, i) => `${i + 1}. ${d.supplier_name} — ${d.items.length} poz.${d.supplier_email ? ` (${d.supplier_email})` : ''}`)
      .join('\n');
    alert(
      `Zamów zbiorczo · ${draftOrders.length} maili`,
      `Przygotowano szablony e-mail (jak w Łowcy Okazji) do ${draftOrders.length} dostawców:\n\n${preview}\n\nOtworzymy kolejno edytor z gotową treścią — nadawca: asystent AI.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Otwórz szablony',
          style: 'primary',
          onPress: () => {
            void (async () => {
              setEmailBusy(true);
              try {
                // Wysyłamy kolejno; po każdym sukcesie koszyk draft znika (status=sent)
                for (const d of draftOrders) {
                  const { subject, body, email } = await buildOrderEmail(d);
                  setEmailDraftOrderId(d.id);
                  setEmailDraft({
                    supplierName: d.supplier_name,
                    toEmail: email,
                    fromEmail: ASSISTANT_FROM_EMAIL,
                    subject,
                    body,
                  });
                  setShowEmail(true);
                  await new Promise((r) => setTimeout(r, 600));
                }
              } catch (e: any) {
                alert('Błąd', e?.message || 'Nie udało się wygenerować szablonów.');
              } finally {
                setEmailBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const clearEntireBasket = () => {
    alert(
      'Wyczyść koszyk',
      'Usunąć wszystkie zapisane koszyki (draft) i pozycje z ofert w koszyku?',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wyczyść',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const draftIds = draftOrders.map((d) => d.id);
                await supplierOrdersService.deleteDrafts(draftIds);
                setGroups([]);
                setDraftOrders([]);
                setReloadKey((k) => k + 1);
              } catch (e: any) {
                alert('Błąd', e?.message || 'Nie udało się wyczyścić koszyka.');
              }
            })();
          },
        },
      ],
    );
  };

  const deleteOneDraft = (d: DraftOrder) => {
    alert(
      'Usuń koszyk',
      `Usunąć zamówienie dla „${d.supplier_name}” (${d.items.length} poz.)?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await supplierOrdersService.deleteOneDraft(d.id);
                setDraftOrders((prev) => prev.filter((x) => x.id !== d.id));
                setReloadKey((k) => k + 1);
              } catch (e: any) {
                alert('Błąd', e?.message || 'Nie udało się usunąć koszyka.');
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[gbStyles.container, { backgroundColor: bg }]}>
        <View style={[gbStyles.header, prem && { backgroundColor: bg, borderBottomColor: border }]}>
          <View style={gbStyles.headerLeft}>
            <ShoppingCart size={18} color={accent} strokeWidth={2} />
            <Text style={[gbStyles.title, { color: text }]}>Koszyk zamówień</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {emailBusy ? <ActivityIndicator size="small" color={accent} /> : null}
            {!isEmpty && draftOrders.length > 0 ? (
              <TouchableOpacity onPress={orderAllDrafts} hitSlop={8} disabled={emailBusy}>
                <Text style={{ color: accent, fontWeight: '800', fontSize: 12 }}>Zamów</Text>
              </TouchableOpacity>
            ) : null}
            {!isEmpty ? (
              <TouchableOpacity onPress={clearEntireBasket} hitSlop={8}>
                <Text style={{ color: Colors.danger, fontWeight: '700', fontSize: 12 }}>Wyczyść</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={22} color={muted} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View style={gbStyles.center}>
            <ActivityIndicator size="large" color={accent} />
          </View>
        ) : isEmpty ? (
          <View style={gbStyles.center}>
            <ShoppingCart size={48} color={muted} strokeWidth={1.5} />
            <Text style={[gbStyles.emptyTitle, { color: text }]}>Koszyk jest pusty</Text>
            <Text style={[gbStyles.emptySub, { color: muted }]}>
              Dodaj produkty do dostawców albo zapisz ofertę z Łowcy Okazji „na później”.
            </Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
            {draftOrders.length > 0 && (
              <>
                <Text style={[gbStyles.summary, { color: muted }]}>
                  Zapisane koszyki · {draftOrders.length}
                </Text>
                {draftOrders.map((d) => {
                  const sum = draftTotal(d);
                  return (
                    <View key={d.id} style={[gbStyles.group, prem && { backgroundColor: cardBg, borderColor: border }]}>
                      <View style={[gbStyles.groupHeader, { backgroundColor: headerTile, borderBottomColor: border }]}>
                        <TouchableOpacity
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                          activeOpacity={0.85}
                          onPress={() => setEditingDraft(d)}
                        >
                          <View style={[gbStyles.supplierIcon, { backgroundColor: prem ? 'rgba(0,255,120,0.12)' : Colors.accentLight }]}>
                            <ShoppingCart size={14} color={accent} strokeWidth={2} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[gbStyles.supplierName, { color: text }]}>{d.supplier_name}</Text>
                            {d.notes && !isInternalOrderNote(d.notes) ? (
                              <Text style={{ fontSize: 10, color: muted }} numberOfLines={1}>
                                {d.notes}
                              </Text>
                            ) : null}
                          </View>
                          <Text style={[gbStyles.itemCount, { color: muted }]}>{d.items.length} poz.</Text>
                          <ChevronRight size={16} color={muted} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => deleteOneDraft(d)}
                          hitSlop={8}
                          style={{ padding: 6, marginLeft: 4 }}
                          accessibilityLabel="Usuń koszyk"
                        >
                          <Trash2 size={16} color={Colors.danger} strokeWidth={2} />
                        </TouchableOpacity>
                      </View>
                      {d.items.slice(0, 4).map((item, idx) => (
                        <View key={`${d.id}-${idx}`} style={[gbStyles.itemRow, idx === Math.min(3, d.items.length - 1) && gbStyles.itemRowLast]}>
                          <Text style={[gbStyles.itemName, { color: text }]} numberOfLines={1}>
                            {item.name} · {item.qty} {item.unit}
                          </Text>
                          {item.price != null
                            ? <Text style={[gbStyles.itemPrice, { color: accent }]}>{formatPlnNumber(item.price * item.qty)} zł</Text>
                            : <Text style={gbStyles.itemPriceNone}>b/d</Text>}
                        </View>
                      ))}
                      {d.items.length > 4 && (
                        <Text style={{ padding: 10, fontSize: 11, color: muted }}>
                          +{d.items.length - 4} kolejnych
                        </Text>
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: text }}>
                          Suma: {formatPlnNumber(sum)} zł
                        </Text>
                        <TouchableOpacity
                          style={[gbStyles.orderBtn, prem && { backgroundColor: accent }]}
                          onPress={() => openDraftEmailTemplate(d)}
                          activeOpacity={0.85}
                        >
                          <Text style={[gbStyles.orderBtnText, prem && { color: '#0A0A0A' }]}>Zamów</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
            {totalItems > 0 && (
              <Text style={[gbStyles.summary, { color: muted }]}>{totalItems} produktów z ofert · {groups.length} dostawców</Text>
            )}
            {groups.map((group) => (
              <View key={group.supplier_id} style={[gbStyles.group, prem && { backgroundColor: cardBg, borderColor: border }]}>
                <View style={[gbStyles.groupHeader, { backgroundColor: headerTile, borderBottomColor: border }]}>
                  <View style={[gbStyles.supplierIcon, { backgroundColor: group.supplier_color + '18' }]}>
                    <Truck size={14} color={group.supplier_color} strokeWidth={2} />
                  </View>
                  <Text style={[gbStyles.supplierName, { color: text, flex: 1 }]}>{group.supplier_name}</Text>
                  <Text style={[gbStyles.itemCount, { color: muted }]}>{group.items.length} poz.</Text>
                  <TouchableOpacity
                    style={[gbStyles.orderBtn, prem && { backgroundColor: accent }]}
                    onPress={() => { setOrderSupplierId(group.supplier_id); setOrderSupplierName(group.supplier_name); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[gbStyles.orderBtnText, prem && { color: '#0A0A0A' }]}>Zamów</Text>
                  </TouchableOpacity>
                </View>
                {group.items.map((item, idx) => (
                  <View key={item.item_id} style={[gbStyles.itemRow, idx === group.items.length - 1 && gbStyles.itemRowLast]}>
                    <Text style={[gbStyles.itemName, { color: text }]} numberOfLines={1}>{item.raw_product_name}</Text>
                    {item.price_net != null
                      ? <Text style={[gbStyles.itemPrice, { color: accent }]}>{formatPlnNumber(item.price_net)} zł/{item.unit}</Text>
                      : <Text style={gbStyles.itemPriceNone}>b/d</Text>}
                  </View>
                ))}
                <View style={{ padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: text }}>
                    Suma pozycji: {formatPlnNumber(groupTotal(group))} zł
                  </Text>
                </View>
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
      <OrderEmailComposer
        visible={showEmail && !!emailDraft}
        draft={emailDraft}
        onClose={() => {
          setShowEmail(false);
          setEmailDraft(null);
          setEmailDraftOrderId(null);
        }}
        onSent={() => {
          const id = emailDraftOrderId;
          if (id) {
            void markDraftSent(id);
          }
          setEmailDraftOrderId(null);
        }}
      />
      {editingDraft && (
        <DraftCartEditor
          draft={editingDraft}
          onClose={() => setEditingDraft(null)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
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
  const theme = useAppTheme();
  const { openVoiceReport, documentScanRevision, notifyDocumentScanComplete } = useUiOverlay();
  const { ready: authReady, isAuthenticated, accountKey } = useAuth();
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
  const [formMinOrderOn, setFormMinOrderOn] = useState(false);
  const [formShipping, setFormShipping] = useState('');
  const [formFreeShipOn, setFormFreeShipOn] = useState(false);
  const [formFreeShipFrom, setFormFreeShipFrom] = useState('');
  const [formLeadTime, setFormLeadTime] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSuppliers = useCallback(async () => {
    if (!authReady || !isAuthenticated || !accountKey || accountKey === 'default') return;
    try {
      const ak = accountKey;
      const { rows, menuIngredients, totalAnalyses, orderTotals } = await suppliersService.fetchSuppliersData(ak);
      setSuppliers(rows.map((row) => mapDbRow(row, menuIngredients)));
      setTotalAnalyses(totalAnalyses);
      setError(null);
      setOrderTotals(orderTotals);
    } catch (e: any) {
      setError(e.message ?? 'Błąd ładowania dostawców');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authReady, isAuthenticated, accountKey]);

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchSuppliers();
  }, [fetchSuppliers, authReady, isAuthenticated, accountKey]);

  useEffect(() => {
    if (documentScanRevision > 0) void fetchSuppliers();
  }, [documentScanRevision, fetchSuppliers]);

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

    const inventoryItems = await suppliersService.fetchInventoryBrief();

    onStage('analyzing');

    const { data: fnData, error: fnError } = await suppliersService.invokeProcessOffer({
      supplier_id: supplierId,
      file_base64: base64Data,
      mime_type: asset.mimeType ?? 'application/pdf',
      file_name: asset.name,
      inventory_items: inventoryItems ?? [],
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
      await suppliersService.deleteSupplier(supplierId);
      setSuppliers((prev) => prev.filter((s) => s.id !== supplierId));
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się usunąć dostawcy.');
    }
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setFormName(''); setFormNip(''); setFormContact('');
    setFormPhone(''); setFormEmail('');
    setFormMinOrder(''); setFormMinOrderOn(false);
    setFormShipping(''); setFormFreeShipOn(false); setFormFreeShipFrom('');
    setFormLeadTime('');
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
    setFormMinOrderOn(s.min_order_value > 0);
    setFormMinOrder(s.min_order_value > 0 ? String(s.min_order_value) : '');
    setFormShipping(s.shipping_cost > 0 ? String(s.shipping_cost) : '');
    setFormFreeShipOn(s.free_shipping_threshold > 0);
    setFormFreeShipFrom(s.free_shipping_threshold > 0 ? String(s.free_shipping_threshold) : '');
    setFormLeadTime(
      s.lead_time_days != null && s.lead_time_days > 0 ? String(s.lead_time_days) : '',
    );
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
      const shipVal = parseFloat(formShipping.replace(',', '.'));
      const freeVal = parseFloat(formFreeShipFrom.replace(',', '.'));
      const leadVal = parseFloat(formLeadTime.replace(',', '.'));
      const ak = accountKey;
      if (!ak || ak === 'default') {
        Alert.alert('Konto', 'Brak konta użytkownika — wyloguj się i zaloguj ponownie.');
        return;
      }
      const payload: Record<string, unknown> = {
        name: formName.trim(),
        nip: formNip.trim() || null,
        contact_person: formContact.trim() || null,
        phone: formPhone.trim() || null,
        email: formEmail.trim() || null,
        category: formCategory,
        notes: formNotes.trim() || null,
        min_order_value: formMinOrderOn && isFinite(minVal) && minVal > 0 ? minVal : 0,
        shipping_cost: isFinite(shipVal) && shipVal > 0 ? shipVal : 0,
        free_shipping_threshold:
          formFreeShipOn && isFinite(freeVal) && freeVal > 0 ? freeVal : 0,
        lead_time_days: isFinite(leadVal) && leadVal > 0 ? leadVal : null,
        account_key: ak,
      };
      const { partials } = await suppliersService.saveSupplier({ payload, editingId, ak });
      if (partials.includes('lead')) {
        Alert.alert('Częściowy zapis', 'Zapisano bez lead time. Uruchom ADD_SUPPLIER_LEAD_TIME.sql w Supabase.');
      }
      if (partials.includes('shipping')) {
        Alert.alert('Częściowy zapis', 'Zapisano dane podstawowe. Uruchom ADD_SUPPLIER_SHIPPING.sql w Supabase, aby włączyć koszty dostawy.');
      }
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

  const prem = theme.isPremium;
  const premInput = prem
    ? {
        backgroundColor: DS.color.bgTertiary,
        borderColor: DS.color.borderSubtle,
        color: DS.color.heading,
      }
    : null;
  const premLabel = prem ? { color: DS.color.muted } : null;
  const premPh = prem ? DS.color.muted : Colors.textTertiary;
  const premTile = prem
    ? {
        backgroundColor: DS.color.bgTertiary,
        borderColor: DS.color.borderSubtle,
      }
    : null;
  const premSwitch = prem ? DS.color.greenEnd : Colors.accent;

  return (
    <SafeAreaView style={[mainStyles.container, { backgroundColor: theme.bg }]} edges={[]}>
      {theme.isPremium ? (
        <PremiumTabChrome
          title="Dostawcy"
          subtitle="Panel dostawców"
          meta={`${suppliers.length} dostawców${totalAnalyses > 0 ? ` · ${totalAnalyses} analiz AI` : ''}`}
          showFloats={false}
          headerVariant="centered"
          right={
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PremiumOutlineBtn label="Koszyk" onPress={() => setShowGlobalBasket(true)} tone="green" size="lg" />
              <PremiumOutlineBtn label="+ Dodaj" onPress={() => openAddSupplier()} tone="green" size="lg" />
            </View>
          }
        >
          <View style={{ flex: 1 }}>
            <ScrollView
              style={mainStyles.list}
              contentContainerStyle={[mainStyles.listContent, { paddingHorizontal: DS.space.screen }]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => { setRefreshing(true); fetchSuppliers(); }}
                  tintColor={DS.color.greenEnd}
                />
              }
            >
              <View style={{ marginBottom: DS.space[16] }}>
                <PremiumGlowCta
                  label="Zgłoś informację"
                  onPress={() => openVoiceReport()}
                  icon={<Sparkles size={16} color="#0A0A0A" strokeWidth={2.5} />}
                />
              </View>

              <View style={[mainStyles.searchWrap, {
                backgroundColor: DS.color.bgTertiary,
                borderColor: DS.color.borderSubtle,
                borderRadius: DS.radius.button,
                marginBottom: 12,
              }]}>
                <Search size={16} color={DS.color.muted} strokeWidth={2} />
                <TextInput
                  style={[mainStyles.searchInput, { color: DS.color.heading }]}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Szukaj dostawcy..."
                  placeholderTextColor={DS.color.muted}
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity
                style={[mainStyles.topScanBtn, {
                  marginBottom: 14,
                  borderRadius: DS.radius.card,
                  backgroundColor: DS.color.bgTertiary,
                  borderWidth: 1,
                  borderColor: 'rgba(0,255,136,0.35)',
                  ...DS.shadow.greenGlow,
                }]}
                onPress={() => setShowTopScan(true)}
                activeOpacity={0.9}
              >
                <View style={[mainStyles.topScanIcon, { backgroundColor: 'rgba(0,255,120,0.15)' }]}>
                  <ScanLine size={18} color={DS.color.greenEnd} strokeWidth={2.5} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[mainStyles.topScanTitle, { color: DS.color.heading, fontSize: 13 }]} numberOfLines={2} allowFontScaling={false}>
                    Wgraj ofertę, lub fakturę od Dostawcy
                  </Text>
                  <Text style={[mainStyles.topScanSub, { color: DS.color.muted, fontSize: 11 }]} numberOfLines={2} allowFontScaling={false}>
                    Jeśli to nowy dostawca, zostanie dodany do listy
                  </Text>
                </View>
              </TouchableOpacity>

              {filteredSuppliers.length === 0 ? (
                <View style={mainStyles.empty}>
                  <Truck size={40} color={DS.color.muted} strokeWidth={1.5} />
                  <Text style={[mainStyles.emptyTitle, { color: DS.color.heading }]}>
                    {search ? 'Brak wyników' : 'Brak dostawców'}
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
              <AdBannerFooter />
            </ScrollView>
          </View>
        </PremiumTabChrome>
      ) : (
      <>
      <View style={mainStyles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          <View style={{ flex: 1 }}>
            <Text style={[mainStyles.headerTitle, { color: Colors.textPrimary }]}>
              Dostawcy
            </Text>
            <Text style={[mainStyles.headerSub, { color: theme.textSecondary }]}>
              {suppliers.length} dostawców
              {totalAnalyses > 0 ? ` · ${totalAnalyses} analiz AI` : ''}
            </Text>
          </View>
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
          <Text style={mainStyles.topScanTitle}>Wgraj ofertę, lub fakturę od Dostawcy</Text>
          <Text style={mainStyles.topScanSub}>Jeśli to nowy dostawca, zostanie dodany do listy</Text>
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
        <AdBannerFooter />
      </ScrollView>
      </>
      )}

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
          <View style={[mainStyles.modalSheet, theme.isPremium && { backgroundColor: DS.color.surfaceCard }]}>
            <View style={[mainStyles.modalHeader, theme.isPremium && { borderBottomColor: DS.color.borderSubtle }]}>
              <Text style={[mainStyles.modalTitle, theme.isPremium && { color: DS.color.heading }]}>
                {editingId ? 'Edytuj dostawcę' : 'Nowy dostawca'}
              </Text>
              <TouchableOpacity onPress={() => { setShowAddModal(false); resetForm(); }}>
                <X size={22} color={theme.isPremium ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[mainStyles.fieldLabel, premLabel]}>Nazwa dostawcy *</Text>
              <TextInput
                style={[mainStyles.input, premInput]}
                value={formName}
                onChangeText={setFormName}
                placeholder="np. Makro Cash & Carry"
                placeholderTextColor={premPh}
              />

              <Text style={[mainStyles.fieldLabel, premLabel]}>Kategoria</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} keyboardShouldPersistTaps="handled">
                <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        mainStyles.catPill,
                        prem && { backgroundColor: DS.color.bgTertiary, borderColor: DS.color.borderSubtle },
                        formCategory === cat && (prem
                          ? { backgroundColor: 'rgba(0,255,120,0.18)', borderColor: DS.color.greenEnd }
                          : mainStyles.catPillActive),
                      ]}
                      onPress={() => setFormCategory(cat)}
                    >
                      <Text
                        style={[
                          mainStyles.catPillText,
                          prem && { color: DS.color.muted },
                          formCategory === cat && (prem
                            ? { color: DS.color.greenEnd, fontWeight: '800' }
                            : mainStyles.catPillTextActive),
                        ]}
                      >
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={[mainStyles.fieldLabel, premLabel]}>NIP</Text>
              <TextInput style={[mainStyles.input, premInput]} value={formNip} onChangeText={setFormNip} placeholder="000-000-00-00" placeholderTextColor={premPh} keyboardType="numeric" />

              <Text style={[mainStyles.fieldLabel, premLabel]}>Osoba kontaktowa</Text>
              <TextInput style={[mainStyles.input, premInput]} value={formContact} onChangeText={setFormContact} placeholder="Jan Kowalski" placeholderTextColor={premPh} />

              <Text style={[mainStyles.fieldLabel, premLabel]}>Telefon</Text>
              <TextInput style={[mainStyles.input, premInput]} value={formPhone} onChangeText={setFormPhone} placeholder="+48 500 000 000" placeholderTextColor={premPh} keyboardType="phone-pad" />

              <Text style={[mainStyles.fieldLabel, premLabel]}>Adres e-mail zamówień</Text>
              <TextInput style={[mainStyles.input, premInput]} value={formEmail} onChangeText={setFormEmail} placeholder="zamowienia@dostawca.pl" placeholderTextColor={premPh} keyboardType="email-address" autoCapitalize="none" testID="supplier-email-input" />

              <View style={[mainStyles.toggleBlock, premTile]}>
                <View style={mainStyles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[mainStyles.toggleTitle, prem && { color: DS.color.heading }]}>Limit minimalnego zamówienia</Text>
                    <Text style={[mainStyles.toggleHint, prem && { color: DS.color.muted }]}>Wyłącz, jeśli hurtownia nie wymaga minimum</Text>
                  </View>
                  <Switch
                    value={formMinOrderOn}
                    onValueChange={setFormMinOrderOn}
                    trackColor={{ true: premSwitch }}
                    testID="supplier-min-order-switch"
                  />
                </View>
                {formMinOrderOn && (
                  <TextInput
                    style={[mainStyles.input, premInput]}
                    value={formMinOrder}
                    onChangeText={setFormMinOrder}
                    placeholder="np. 300 zł"
                    placeholderTextColor={premPh}
                    keyboardType="decimal-pad"
                    testID="supplier-min-order-input"
                  />
                )}
              </View>

              <Text style={[mainStyles.fieldLabel, premLabel]}>Koszt dostawy (PLN)</Text>
              <TextInput
                style={[mainStyles.input, premInput]}
                value={formShipping}
                onChangeText={setFormShipping}
                placeholder="0 = darmowa / wliczona"
                placeholderTextColor={premPh}
                keyboardType="decimal-pad"
                testID="supplier-shipping-input"
              />

              <View style={[mainStyles.toggleBlock, premTile]}>
                <View style={mainStyles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[mainStyles.toggleTitle, prem && { color: DS.color.heading }]}>Darmowa dostawa od kwoty</Text>
                    <Text style={[mainStyles.toggleHint, prem && { color: DS.color.muted }]}>Włącz i podaj próg, od którego dostawa jest gratis</Text>
                  </View>
                  <Switch
                    value={formFreeShipOn}
                    onValueChange={setFormFreeShipOn}
                    trackColor={{ true: premSwitch }}
                    testID="supplier-free-ship-switch"
                  />
                </View>
                {formFreeShipOn && (
                  <TextInput
                    style={[mainStyles.input, premInput]}
                    value={formFreeShipFrom}
                    onChangeText={setFormFreeShipFrom}
                    placeholder="np. 500 zł"
                    placeholderTextColor={premPh}
                    keyboardType="decimal-pad"
                    testID="supplier-free-ship-input"
                  />
                )}
              </View>

              <Text style={[mainStyles.fieldLabel, premLabel]}>Czas dostawy (dni)</Text>
              <TextInput
                style={[mainStyles.input, premInput]}
                value={formLeadTime}
                onChangeText={setFormLeadTime}
                placeholder="np. 2"
                placeholderTextColor={premPh}
                keyboardType="decimal-pad"
                testID="supplier-lead-time-input"
              />
              <Text style={[mainStyles.toggleHint, prem && { color: DS.color.muted, marginBottom: 8 }]}>
                Łowca Okazji używa tej informacji do nadawania większego priorytetu tym dostawcom,
                którzy mają najkrótszy okres oczekiwania, w momencie gdy brakuje produktów krytycznych,
                a potrawy które wymagają ich użycia znajdują się w top 5 najlepiej sprzedających się
                potraw z ostatniego miesiąca.
              </Text>

              <Text style={[mainStyles.fieldLabel, premLabel]}>Notatki</Text>
              <TextInput style={[mainStyles.input, mainStyles.inputMultiline, premInput]} value={formNotes} onChangeText={setFormNotes} placeholder="Warunki współpracy..." placeholderTextColor={premPh} multiline numberOfLines={3} textAlignVertical="top" />

              <TouchableOpacity
                style={[
                  mainStyles.saveBtn,
                  prem && { backgroundColor: DS.color.greenEnd },
                  saving && mainStyles.saveBtnDisabled,
                ]}
                onPress={handleAddSupplier}
                disabled={saving}
                activeOpacity={0.85}
                testID="supplier-save-btn"
              >
                {saving
                  ? <ActivityIndicator size="small" color={prem ? '#0A0A0A' : Colors.white} />
                  : <Text style={[mainStyles.saveBtnText, prem && { color: '#0A0A0A' }]}>
                      {editingId ? 'Zapisz zmiany' : 'Dodaj dostawcę'}
                    </Text>}
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
        onConfirmed={() => {
          void fetchSuppliers();
          notifyDocumentScanComplete('offer');
        }}
        scanContext="supplier"
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
  searchInput: { flex: 1, fontSize: 13, color: Colors.textPrimary },
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
  toggleBlock: { marginBottom: 12, backgroundColor: Colors.borderLight, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  toggleTitle: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  toggleHint: { fontSize: 11, color: Colors.textTertiary, marginTop: 2, lineHeight: 15 },
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
