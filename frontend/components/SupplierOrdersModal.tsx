/**
 * Panel Zamówienia (Dostawcy) — Przygotowywane / Zrealizowane.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { X, PackageCheck, Truck, ChevronDown, ChevronRight, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { formatPln } from '@/lib/format';
import {
  deletePreparingOrder,
  fetchOrdersByStatuses,
  orderLineTotal,
  receiveSupplierOrder,
  type InventoryAssignment,
  type SupplierOrderFull,
} from '@/services/supplierOrdersService';

type Tab = 'preparing' | 'done';

type Props = {
  visible: boolean;
  onClose: () => void;
};

function formatPlDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString('pl-PL');
  } catch {
    return iso.slice(0, 10);
  }
}

function formatAssignmentsMessage(assignments: InventoryAssignment[]): string {
  if (!assignments.length) {
    return 'Zamówienie oznaczone jako zrealizowane (bez zmian w magazynie).';
  }
  const lines = assignments.map((a) => {
    const verb = a.action === 'updated' ? 'dopisano do' : 'nowa pozycja w';
    return `• ${a.sourceName} → ${a.inventoryName} (${verb} „${a.categoryName}”, +${a.qty} ${a.unit})`;
  });
  return `Przypisanie do magazynu:\n${lines.join('\n')}`;
}

export function SupplierOrdersModal({ visible, onClose }: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const { alert } = usePremiumAlert();
  const [tab, setTab] = useState<Tab>('preparing');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<SupplierOrderFull[]>([]);
  const [done, setDone] = useState<SupplierOrderFull[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const bg = prem ? DS.color.bgPrimary : Colors.background;
  const card = prem ? DS.color.surfaceCard : Colors.card;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const accent = prem ? DS.color.greenEnd : Colors.accent;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [prep, rec] = await Promise.all([
        fetchOrdersByStatuses(['sent', 'confirmed']),
        fetchOrdersByStatuses(['received']),
      ]);
      setPreparing(prep);
      setDone(rec);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się wczytać zamówień.';
      alert('Zamówienia', msg);
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useEffect(() => {
    if (!visible) return;
    void reload();
  }, [visible, reload]);

  const list = tab === 'preparing' ? preparing : done;

  const onReceive = (order: SupplierOrderFull) => {
    alert(
      'Odebrałem dostawę',
      'Czy dodać produkty do magazynu i zwiększyć koszty zmienne?\n\n'
      + 'Jeśli klikniesz Tak, nie musisz już skanować faktury/rachunku za to zamówienie.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Tylko oznacz',
          onPress: () => void finishReceive(order, false, false),
        },
        {
          text: 'Tak, magazyn + koszty',
          style: 'primary',
          onPress: () => void finishReceive(order, true, true),
        },
      ],
    );
  };

  const finishReceive = async (
    order: SupplierOrderFull,
    applyInventory: boolean,
    applyVariableCost: boolean,
  ) => {
    setBusyId(order.id);
    try {
      const { assignments } = await receiveSupplierOrder(order, {
        applyInventory,
        applyVariableCost,
      });
      await reload();
      setTab('done');
      if (applyInventory) {
        alert(
          'Dodano do magazynu',
          `${formatAssignmentsMessage(assignments)}\n\n`
          + 'Nie musisz już skanować faktury za to zamówienie — magazyn i koszty zostały zaktualizowane.',
          [{ text: 'OK', style: 'primary' }],
        );
      } else {
        alert(
          'Gotowe',
          'Zamówienie przeniesione do „Zrealizowane”.',
          [{ text: 'OK', style: 'primary' }],
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się oznaczyć odbioru.';
      alert('Błąd', msg);
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = (order: SupplierOrderFull) => {
    alert(
      'Usuń zamówienie',
      `Usunąć przygotowywaną dostawę od „${order.suppliers?.name || 'dostawcy'}”?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusyId(order.id);
              try {
                await deletePreparingOrder(order.id);
                await reload();
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : 'Nie udało się usunąć.';
                alert('Błąd', msg);
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: bg }]}>
        <View style={[styles.header, { borderBottomColor: border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: text }]}>Zamówienia</Text>
            <Text style={[styles.sub, { color: muted }]}>Dostawy od dostawców</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} testID="supplier-orders-close">
            <X size={22} color={muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <View style={[styles.tabs, { borderColor: border }]}>
          <TouchableOpacity
            style={[styles.tab, tab === 'preparing' && { backgroundColor: accent }]}
            onPress={() => setTab('preparing')}
            testID="supplier-orders-tab-preparing"
          >
            <Text
              style={[
                styles.tabText,
                { color: tab === 'preparing' ? (prem ? '#0A0A0A' : '#fff') : muted },
              ]}
            >
              Przygotowywane ({preparing.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'done' && { backgroundColor: accent }]}
            onPress={() => setTab('done')}
            testID="supplier-orders-tab-done"
          >
            <Text
              style={[
                styles.tabText,
                { color: tab === 'done' ? (prem ? '#0A0A0A' : '#fff') : muted },
              ]}
            >
              Zrealizowane ({done.length})
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={accent} />
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {list.length === 0 ? (
              <View style={styles.empty}>
                <Truck size={36} color={muted} strokeWidth={1.6} />
                <Text style={[styles.emptyTitle, { color: text }]}>
                  {tab === 'preparing' ? 'Brak zamówień w drodze' : 'Brak zrealizowanych dostaw'}
                </Text>
                <Text style={[styles.emptySub, { color: muted }]}>
                  {tab === 'preparing'
                    ? 'Po wysłaniu zamówienia (e-mail/SMS) pojawi się tutaj.'
                    : 'Po „Odebrałem dostawę” zamówienia trafią do tej zakładki.'}
                </Text>
              </View>
            ) : (
              list.map((o) => (
                <OrderCard
                  key={o.id}
                  order={o}
                  colors={{ card, border, text, muted, accent, prem }}
                  showReceive={tab === 'preparing'}
                  showDelete={tab === 'preparing'}
                  expanded={expandedId === o.id}
                  onToggle={() => setExpandedId((id) => (id === o.id ? null : o.id))}
                  busy={busyId === o.id}
                  onReceive={() => onReceive(o)}
                  onDelete={() => onDelete(o)}
                />
              ))
            )}
            <View style={{ height: 36 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function OrderCard({
  order,
  colors: C,
  showReceive,
  showDelete,
  expanded,
  onToggle,
  busy,
  onReceive,
  onDelete,
}: {
  order: SupplierOrderFull;
  colors: {
    card: string;
    border: string;
    text: string;
    muted: string;
    accent: string;
    prem?: boolean;
  };
  showReceive: boolean;
  showDelete: boolean;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  onReceive: () => void;
  onDelete: () => void;
}) {
  const items = order.supplier_order_items || [];
  const total = useMemo(() => orderLineTotal(items), [items]);
  const supplier = order.suppliers;

  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.85} testID={`supplier-order-toggle-${order.id}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: C.text }]}>
              {supplier?.name || 'Dostawca'}
            </Text>
            <Text style={[styles.meta, { color: C.muted }]}>
              Data: {formatPlDate(order.received_at || order.created_at)} · {items.length} poz. · {formatPln(total)}
            </Text>
            {order.notes ? (
              <Text style={[styles.meta, { color: C.muted }]} numberOfLines={1}>
                {order.notes}
              </Text>
            ) : null}
          </View>
          {expanded ? (
            <ChevronDown size={20} color={C.muted} strokeWidth={2.2} />
          ) : (
            <ChevronRight size={20} color={C.muted} strokeWidth={2.2} />
          )}
        </View>
      </TouchableOpacity>

      {expanded ? (
        <View style={{ marginTop: 10 }}>
          {supplier?.email ? (
            <Text style={[styles.meta, { color: C.muted }]}>E-mail: {supplier.email}</Text>
          ) : null}
          {supplier?.phone ? (
            <Text style={[styles.meta, { color: C.muted }]}>Tel.: {supplier.phone}</Text>
          ) : null}

          <Text style={[styles.section, { color: C.text }]}>Pozycje</Text>
          {items.length === 0 ? (
            <Text style={[styles.meta, { color: C.muted }]}>Brak pozycji w zamówieniu.</Text>
          ) : (
            items.map((it) => {
              const line =
                it.price_net != null ? Number(it.price_net) * (Number(it.quantity_ordered) || 0) : null;
              return (
                <View key={it.id} style={styles.line}>
                  <Text style={[styles.lineName, { color: C.text }]} numberOfLines={2}>
                    {it.raw_product_name}
                  </Text>
                  <Text style={[styles.lineMeta, { color: C.muted }]}>
                    {it.quantity_ordered} {it.unit}
                    {it.price_net != null ? ` · ${formatPln(Number(it.price_net))}/${it.unit}` : ''}
                    {line != null ? ` · ${formatPln(line)}` : ''}
                  </Text>
                </View>
              );
            })
          )}
          <Text style={[styles.total, { color: C.text }]}>Suma: {formatPln(total)}</Text>

          {showReceive ? (
            <TouchableOpacity
              style={[styles.receiveBtn, { backgroundColor: C.accent, opacity: busy ? 0.6 : 1 }]}
              onPress={onReceive}
              disabled={busy}
              activeOpacity={0.85}
              testID={`supplier-order-receive-${order.id}`}
            >
              {busy ? (
                <ActivityIndicator color={C.prem ? '#0A0A0A' : '#fff'} />
              ) : (
                <>
                  <PackageCheck size={16} color={C.prem ? '#0A0A0A' : '#fff'} strokeWidth={2.4} />
                  <Text style={[styles.receiveText, { color: C.prem ? '#0A0A0A' : '#fff' }]}>
                    Odebrałem dostawę
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}

          {showDelete ? (
            <TouchableOpacity
              style={[styles.deleteBtn, { borderColor: C.border, opacity: busy ? 0.6 : 1 }]}
              onPress={onDelete}
              disabled={busy}
              activeOpacity={0.85}
              testID={`supplier-order-delete-${order.id}`}
            >
              <Trash2 size={15} color="#DC2626" strokeWidth={2.2} />
              <Text style={styles.deleteText}>Usuń z przygotowywanych</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 18 : 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  tabText: { fontSize: 13, fontWeight: '700' },
  body: { paddingHorizontal: 16, paddingTop: 8 },
  empty: { alignItems: 'center', paddingTop: 48, gap: 8, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 12, marginTop: 2 },
  section: { fontSize: 13, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  line: { marginBottom: 8 },
  lineName: { fontSize: 13, fontWeight: '600' },
  lineMeta: { fontSize: 12, marginTop: 2 },
  total: { fontSize: 14, fontWeight: '800', marginTop: 4, marginBottom: 8 },
  receiveBtn: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  receiveText: { fontSize: 14, fontWeight: '800' },
  deleteBtn: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },
});
