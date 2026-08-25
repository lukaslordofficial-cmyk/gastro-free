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

import type { DraftItem, DraftOrder } from './types';
import { GlobalBasketModal } from './GlobalBasketModal';

export function DraftCartEditor({
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
