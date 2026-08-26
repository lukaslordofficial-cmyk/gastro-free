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
import { cardStyles } from './supplierCardStyles';
export { cardStyles } from './supplierCardStyles';
import { SupplierCardHeader } from './SupplierCardHeader';
import { SupplierCardDetails } from './SupplierCardDetails';
import { SupplierCardOfferSection } from './SupplierCardOfferSection';

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
      <SupplierCardHeader
        supplier={supplier}
        expanded={expanded}
        displayCategory={displayCategory}
        orderTotal={orderTotal}
        iconBg={iconBg}
        onToggleExpanded={() => setExpanded(!expanded)}
        onOpenOrder={() => setShowOrderModal(true)}
      />


      {expanded && (
        <>
          <SupplierCardDetails
            supplier={supplier}
            displayCategory={displayCategory}
            onEdit={() => onEdit(supplier)}
            onInvoices={() => setShowInvoices(true)}
            onDelete={handleDelete}
            onOrder={() => setShowOrderModal(true)}
          />


          <SupplierCardOfferSection
            offer={offer}
            visibleItems={visibleItems}
            hiddenItems={hiddenItems}
            totalAnalysesUsed={totalAnalysesUsed}
          />


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

// ─── DraftCartEditor — edycja zapisanego koszyka Łowcy ───────────────────────
