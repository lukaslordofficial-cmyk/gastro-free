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
  DeviceEventEmitter,
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
  Package,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as suppliersService from '@/services/suppliersService';
import * as supplierOrdersService from '@/services/supplierOrdersService';
import { SUPPLIER_BASKET_CHANGED } from '@/services/supplierOrdersService';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { OrderModal } from '@/components/OrderModal';
import { SupplierInvoicesModal } from '@/components/suppliers/SupplierInvoicesModal';
import {
  OrderEmailComposer,
  type OrderEmailDraft,
  ASSISTANT_FROM_EMAIL,
} from '@/components/OrderEmailComposer';
import {
  ManualBankPaymentSheet,
  type ManualPaymentOrder,
} from '@/components/dealHunter/ManualBankPaymentSheet';
import { CatalogScanModal } from '@/components/CatalogScanModal';
import { fetchOrderEmailTemplate, isInternalOrderNote } from '@/lib/orderEmailTemplate';
import { resolveOrderEmailFrom } from '@/services/restaurantProfileService';
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
import { SupplierOrdersModal } from '@/components/SupplierOrdersModal';
import { AdBannerFooter } from '@/components/ads/AdBannerFooter';
import { formatPln, formatPlnNumber } from '@/lib/format';
import {
  checkSupplierMinOrder,
  minOrderAlertCopy,
} from '@/lib/supplierMinOrder';
import type { SupplierOffer, SupplierOfferItem } from '@/lib/types';
import { matchesAnyMenuIngredient } from '@/lib/fuzzyProductMatch';
import { secureId } from '@/lib/secureId';

// ─── Types ────────────────────────────────────────────────────────────────────

import type { Supplier, UploadResult } from './types';
import { UNIT_OPTIONS } from './constants';
import { OfferStatusBadge } from './OfferStatusBadge';
import { AiProductRow } from './AiProductRow';
import { CatalogRow } from './CatalogRow';
import { DraftCartEditor } from './DraftCartEditor';

export function SupplierCard({
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
  const [seedCatalogProduct, setSeedCatalogProduct] = useState<{
    id: string;
    name: string;
    variant: string;
    unit: string;
    price_pln: number | null;
  } | null>(null);
  const [showInvoices, setShowInvoices] = useState(false);
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
                    ? { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: DS.color.borderSubtle }
                    : { backgroundColor: Colors.borderLight, borderWidth: 1, borderColor: Colors.border },
                ]}
                onPress={() => setShowInvoices(true)}
                activeOpacity={0.7}
                testID={`invoices-supplier-${supplier.id}`}
              >
                <FileText size={13} color={theme.isPremium ? DS.color.heading : Colors.textPrimary} strokeWidth={2.4} />
                <Text
                  style={[
                    cardStyles.managePanelBtnText,
                    { color: theme.isPremium ? DS.color.heading : Colors.textPrimary },
                  ]}
                >
                  Faktury
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
              {!!supplier.address && (
                <View style={cardStyles.dataRow} testID={`supplier-address-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Adres</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.address}
                  </Text>
                </View>
              )}
              {supplier.bank_account ? (
                <View style={cardStyles.dataRow} testID={`supplier-bank-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Konto</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.bank_account}
                  </Text>
                </View>
              ) : (
                <View style={cardStyles.dataRow} testID={`supplier-bank-missing-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Konto</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && { color: DS.color.muted }]}>
                    Uzupełnij numer konta (przelew z Łowcy)
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
                  onPress={(p) => {
                    setSeedCatalogProduct({
                      id: p.id,
                      name: p.name,
                      variant: p.variant || p.volume_label || '',
                      unit: p.unit || 'szt',
                      price_pln: Number.isFinite(p.price_pln) ? p.price_pln : null,
                    });
                    setShowOrderModal(true);
                  }}
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
                  onPress={(p) => {
                    setSeedCatalogProduct({
                      id: p.id,
                      name: p.name,
                      variant: p.variant || p.volume_label || '',
                      unit: p.unit || 'szt',
                      price_pln: Number.isFinite(p.price_pln) ? p.price_pln : null,
                    });
                    setShowOrderModal(true);
                  }}
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
        seedProduct={seedCatalogProduct}
        onSeedConsumed={() => setSeedCatalogProduct(null)}
        onClose={() => {
          setShowOrderModal(false);
          setSeedCatalogProduct(null);
        }}
      />

      <SupplierInvoicesModal
        visible={showInvoices}
        supplierId={supplier.id}
        supplierName={supplier.name}
        onClose={() => setShowInvoices(false)}
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

export const cardStyles = StyleSheet.create({
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
  managePanelBtnText: { fontSize: 11, fontWeight: '800' },
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
