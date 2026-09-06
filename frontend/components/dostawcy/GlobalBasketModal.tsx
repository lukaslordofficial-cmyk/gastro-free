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

import type { DraftOrder, GlobalBasketGroup } from './types';
import { DraftCartEditor } from './DraftCartEditor';
import { DealHunterModal } from '@/components/DealHunterModal';
import type { OptimizeResult, OfferItem, SupplierGroup } from '@/lib/bargainHunter';

function draftsToOptimizeResult(drafts: DraftOrder[]): OptimizeResult {
  const suppliers: SupplierGroup[] = drafts
    .filter((d) => d.supplier_id && d.items.length > 0)
    .map((d) => {
      const items: OfferItem[] = d.items.map((it) => {
        const price = it.price != null ? Number(it.price) : 0;
        const qty = Number(it.qty) || 0;
        return {
          product_name: it.name,
          quantity: qty,
          unit: it.unit || 'szt',
          base_dim: it.unit || 'szt',
          unit_price_base: price,
          matched_name: it.name,
          line_total: Math.round(price * qty * 100) / 100,
        };
      });
      const subtotal = Math.round(items.reduce((s, it) => s + it.line_total, 0) * 100) / 100;
      return {
        supplier_id: d.supplier_id,
        supplier_name: d.supplier_name,
        supplier_email: d.supplier_email,
        items,
        subtotal_pln: subtotal,
        total_pln: subtotal,
        meets_minimum_order: true,
      };
    });
  const total = Math.round(suppliers.reduce((s, g) => s + g.subtotal_pln, 0) * 100) / 100;
  const itemsRequested = suppliers.flatMap((g) =>
    g.items.map((it) => ({
      product_name: it.product_name,
      quantity: it.quantity,
      unit: it.unit,
      found: true,
      supplier_id: g.supplier_id,
      supplier_name: g.supplier_name,
      matched_name: it.matched_name,
    })),
  );
  return {
    is_optimized: true,
    is_multivariable: true,
    items_requested: itemsRequested,
    best_option: {
      type: 'optimized',
      suppliers,
      subtotal_pln: total,
      total_pln: total,
      missing: [],
    },
    tied_suppliers: [],
    variant_monolith: null,
    variant_split: { type: 'optimized', suppliers, total_pln: total, missing: [] },
    savings_pln: 0,
    cheaper_variant: 'split',
    pricing_matrix: [],
    assistant_speech: 'Wznowiono zapisane koszyki z panelu Dostawcy.',
    option_all_one: null,
    option_optimized: { type: 'optimized', suppliers, total_pln: total, missing: [] },
    scenario_split_max: {
      id: 'split_max',
      label: 'Zapisane koszyki',
      description: 'Kontynuacja zamówienia z koszyka',
      suppliers,
      products_pln: total,
      shipping_pln: 0,
      total_pln: total,
      supplier_count: suppliers.length,
      meets_all_minimums: true,
      missing: [],
      viable: true,
    },
    recommended_scenario_id: 'split_max',
  };
}

export function GlobalBasketModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const { alert } = usePremiumAlert();
  const { user, profile } = useAuth();
  const accountMail = user?.email || profile?.email || null;
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
  const [manualPayOrder, setManualPayOrder] = useState<ManualPaymentOrder | null>(null);
  const [showDealHunter, setShowDealHunter] = useState(false);
  const [dealHunterCompare, setDealHunterCompare] = useState<OptimizeResult | null>(null);
  const [dealHunterDraftIds, setDealHunterDraftIds] = useState<string[]>([]);

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

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(SUPPLIER_BASKET_CHANGED, () => {
      setReloadKey((k) => k + 1);
    });
    return () => sub.remove();
  }, []);

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

  const openDraftEmailTemplate = (d: DraftOrder) => {
    void (async () => {
      setEmailBusy(true);
      try {
        if (d.supplier_id) {
          const check = await checkSupplierMinOrder({
            supplierId: d.supplier_id,
            subtotalPln: draftTotal(d),
            supplierName: d.supplier_name,
          });
          if (!check.ok) {
            const copy = minOrderAlertCopy(check);
            alert(copy.title, copy.message, [{ text: 'OK', style: 'primary' }]);
            return;
          }
        }
        const { subject, body, email } = await buildOrderEmail(d);
        const resolved = await resolveOrderEmailFrom(body, ASSISTANT_FROM_EMAIL, accountMail);
        setEmailDraftOrderId(d.id);
        setEmailDraft({
          supplierName: d.supplier_name,
          toEmail: email,
          fromEmail: resolved.fromEmail,
          subject,
          body: resolved.body,
          supplierId: d.supplier_id,
          totalPln: draftTotal(d),
        });
        setShowEmail(true);
      } catch (e: any) {
        alert('Błąd', e?.message || 'Nie udało się wygenerować szablonu e-mail.');
      } finally {
        setEmailBusy(false);
      }
    })();
  };

  const openDealHunterFromDrafts = (drafts: DraftOrder[]) => {
    const usable = drafts.filter((d) => d.supplier_id && d.items.length > 0);
    if (!usable.length) {
      alert('Brak zamówień', 'W koszyku nie ma zapisanych zamówień do wysyłki.', [
        { text: 'OK', style: 'primary' },
      ]);
      return;
    }
    setDealHunterDraftIds(usable.map((d) => d.id).filter(Boolean));
    setDealHunterCompare(draftsToOptimizeResult(usable));
    setShowDealHunter(true);
  };

  const orderAllDrafts = () => {
    openDealHunterFromDrafts(draftOrders);
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
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={gbStyles.headerClose}
          >
            <X size={22} color={muted} strokeWidth={2} />
          </TouchableOpacity>
          <View style={gbStyles.headerCenter}>
            <View style={gbStyles.headerTitleRow}>
              <ShoppingCart size={18} color={accent} strokeWidth={2} />
              <Text style={[gbStyles.title, { color: text }]}>Koszyk zamówień</Text>
            </View>
            {!isEmpty ? (
              <View style={gbStyles.headerActions}>
                {emailBusy ? <ActivityIndicator size="small" color={accent} /> : null}
                {draftOrders.length > 0 ? (
                  <TouchableOpacity
                    style={[gbStyles.headerActionBtn, { backgroundColor: accent }]}
                    onPress={orderAllDrafts}
                    disabled={emailBusy}
                    activeOpacity={0.85}
                  >
                    <Text style={[gbStyles.headerActionBtnText, prem && { color: '#0A0A0A' }]}>Zamów</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[gbStyles.headerActionBtn, gbStyles.headerClearBtn]}
                  onPress={clearEntireBasket}
                  activeOpacity={0.85}
                >
                  <Text style={gbStyles.headerClearBtnText}>Wyczyść</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
          <View style={gbStyles.headerCloseSpacer} />
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
                          onPress={() => openDealHunterFromDrafts([d])}
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
          setReloadKey((k) => k + 1);
        }}
        onSent={() => {
          const id = emailDraftOrderId;
          if (id) void supplierOrdersService.markDraftSent(id).then(() => setReloadKey((k) => k + 1));
        }}
        onMailClientOpened={() => {
          const id = emailDraftOrderId;
          if (id) void supplierOrdersService.markDraftSent(id).then(() => setReloadKey((k) => k + 1));
        }}
        onPayPress={
          emailDraft
            ? () =>
                setManualPayOrder({
                  supplierId: emailDraft.supplierId ?? null,
                  supplierName: emailDraft.supplierName,
                  orderTitle: emailDraft.subject || `Zamówienie — ${emailDraft.supplierName}`,
                  totalPln: emailDraft.totalPln ?? 0,
                })
            : undefined
        }
      />
      <ManualBankPaymentSheet
        visible={!!manualPayOrder}
        order={manualPayOrder}
        onClose={() => setManualPayOrder(null)}
        colors={{
          card: cardBg,
          text,
          textSecondary: muted,
          textTertiary: muted,
          border,
          accent,
          background: bg,
          isPremium: prem,
        }}
      />
      {editingDraft && (
        <DraftCartEditor
          draft={editingDraft}
          onClose={() => setEditingDraft(null)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
      <DealHunterModal
        visible={showDealHunter && !!dealHunterCompare}
        product={null}
        restaurantName={undefined}
        initialCompare={dealHunterCompare}
        sourceDraftIds={dealHunterDraftIds}
        bulkContextLabel="Koszyk zamówień"
        onClose={() => {
          setShowDealHunter(false);
          setDealHunterCompare(null);
          setDealHunterDraftIds([]);
          setReloadKey((k) => k + 1);
        }}
      />
    </Modal>
  );
}

export const gbStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  headerClose: { width: 36, paddingTop: 2, alignItems: 'flex-start' },
  headerCloseSpacer: { width: 36 },
  headerCenter: { flex: 1, alignItems: 'center', gap: 12 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  headerActionBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 9,
    minWidth: 96,
    alignItems: 'center',
  },
  headerActionBtnText: { fontSize: 13, fontWeight: '800', color: Colors.white },
  headerClearBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  headerClearBtnText: { fontSize: 13, fontWeight: '700', color: Colors.danger },
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
