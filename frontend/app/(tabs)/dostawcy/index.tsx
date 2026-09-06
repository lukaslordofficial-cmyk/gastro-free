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
import { SUPPLIER_ORDERS_CHANGED } from '@/lib/appRefresh';
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
import { useAds } from '@/contexts/AdsProvider';
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

import type { Supplier, UploadResult } from '../../../components/dostawcy/types';
import { ACCEPTED_MIME_TYPES, CATEGORY_OPTIONS } from '../../../components/dostawcy/constants';
import { mapDbRow } from '../../../components/dostawcy/helpers';
import { SupplierCard } from '../../../components/dostawcy/SupplierCard';
import { GlobalBasketModal } from '../../../components/dostawcy/GlobalBasketModal';

export default function DostawcyScreen() {
  const theme = useAppTheme();
  const { openVoiceReport, documentScanRevision, notifyDocumentScanComplete } = useUiOverlay();
  const { ready: authReady, isAuthenticated, accountKey } = useAuth();
  const { showInterstitialAfterAction } = useAds();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGlobalBasket, setShowGlobalBasket] = useState(false);
  const [showSupplierOrders, setShowSupplierOrders] = useState(false);
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
  const [formAddress, setFormAddress] = useState('');
  const [formBankAccount, setFormBankAccount] = useState('');
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

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(SUPPLIER_ORDERS_CHANGED, () => {
      void fetchSuppliers();
    });
    return () => sub.remove();
  }, [fetchSuppliers]);

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
    setFormAddress(''); setFormBankAccount('');
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
    setFormAddress(s.address ?? '');
    setFormBankAccount(s.bank_account ?? '');
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
        address: formAddress.trim() || null,
        bank_account: formBankAccount.trim() || null,
        min_order_value: formMinOrderOn && isFinite(minVal) && minVal > 0 ? minVal : 0,
        shipping_cost: isFinite(shipVal) && shipVal > 0 ? shipVal : 0,
        free_shipping_threshold:
          formFreeShipOn && isFinite(freeVal) && freeVal > 0 ? freeVal : 0,
        lead_time_days: isFinite(leadVal) && leadVal > 0 ? leadVal : null,
        account_key: ak,
      };
      const { partials } = await suppliersService.saveSupplier({ payload, editingId, ak });
      if (partials.includes('lead')) {
        Alert.alert('Częściowy zapis', 'Zapisano bez czasu realizacji. Spróbuj ponownie później albo skontaktuj się z supportem.');
      }
      if (partials.includes('shipping')) {
        Alert.alert('Częściowy zapis', 'Zapisano dane podstawowe. Koszty dostawy będą dostępne po aktualizacji serwera.');
      }
      setShowAddModal(false);
      resetForm();
      await fetchSuppliers();
      void showInterstitialAfterAction();
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
              <View style={{ marginBottom: DS.space[16], gap: 10 }}>
                <PremiumGlowCta
                  label="Sterowanie głosem"
                  onPress={() => openVoiceReport()}
                  icon={<Sparkles size={16} color="#0A0A0A" strokeWidth={2.5} />}
                />
                <PremiumGlowCta
                  label="Zamówienia"
                  onPress={() => setShowSupplierOrders(true)}
                  icon={<Package size={16} color="#0A0A0A" strokeWidth={2.5} />}
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
                    orderTotal={orderTotals[(supplier.id || '').toLowerCase()] ?? 0}
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

      <View style={{ paddingHorizontal: 20, marginBottom: 12, gap: 10 }}>
        <ReportInfoButton contextHint="Dostawcy" onApplied={fetchSuppliers} testID="dostawcy-report-info" />
        <TouchableOpacity
          style={mainStyles.ordersCta}
          onPress={() => setShowSupplierOrders(true)}
          activeOpacity={0.85}
          testID="dostawcy-orders-btn"
        >
          <View style={mainStyles.ordersCtaIcon}>
            <Package size={14} color={Colors.white} strokeWidth={2.5} />
          </View>
          <Text style={mainStyles.ordersCtaText}>Zamówienia</Text>
        </TouchableOpacity>
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
              orderTotal={orderTotals[(supplier.id || '').toLowerCase()] ?? 0}
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

              <Text style={[mainStyles.fieldLabel, premLabel]}>Adres dostawcy</Text>
              <TextInput
                style={[mainStyles.input, premInput]}
                value={formAddress}
                onChangeText={setFormAddress}
                placeholder="ul. Przykładowa 1, 00-001 Warszawa"
                placeholderTextColor={premPh}
                testID="supplier-address-input"
              />
              <Text style={[mainStyles.toggleHint, prem && { color: DS.color.muted, marginBottom: 10 }]}>
                Opcjonalnie — używane przy przelewie ręcznym z Łowcy okazji.
              </Text>

              <Text style={[mainStyles.fieldLabel, premLabel]}>Numer konta bankowego</Text>
              <TextInput
                style={[mainStyles.input, premInput]}
                value={formBankAccount}
                onChangeText={setFormBankAccount}
                placeholder="PL00 0000 0000 0000 0000 0000 0000"
                placeholderTextColor={premPh}
                autoCapitalize="characters"
                testID="supplier-bank-account-input"
              />
              <Text style={[mainStyles.toggleHint, prem && { color: DS.color.muted, marginBottom: 10 }]}>
                Możesz wpisać ręcznie nawet po skanie faktury bez numeru konta. Potrzebne do „Opłać zamówienie”.
              </Text>

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

      <SupplierOrdersModal
        visible={showSupplierOrders}
        onClose={() => setShowSupplierOrders(false)}
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
  ordersCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    backgroundColor: '#8B5CF6',
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  ordersCtaIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ordersCtaText: { color: Colors.white, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
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
