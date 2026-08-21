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
import { X, PackageCheck, Truck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { formatPln } from '@/lib/format';
import {
  fetchOrdersByStatuses,
  orderLineTotal,
  receiveSupplierOrder,
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

export function SupplierOrdersModal({ visible, onClose }: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const { alert } = usePremiumAlert();
  const [tab, setTab] = useState<Tab>('preparing');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<SupplierOrderFull[]>([]);
  const [done, setDone] = useState<SupplierOrderFull[]>([]);

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
      'Czy przenieść produkty z zamówienia do magazynu i wpisać koszty zmienne (suma pozycji)?',
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
      await receiveSupplierOrder(order, { applyInventory, applyVariableCost });
      await reload();
      setTab('done');
      alert(
        'Gotowe',
        applyInventory || applyVariableCost
          ? 'Zamówienie w „Zrealizowane”. Magazyn/koszty zaktualizowane zgodnie z wyborem.'
          : 'Zamówienie przeniesione do „Zrealizowane”.',
        [{ text: 'OK', style: 'primary' }],
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się oznaczyć odbioru.';
      alert('Błąd', msg);
    } finally {
      setBusyId(null);
    }
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
                    ? 'Po „Złóż zamówienie” i przejściu do maila zamówienie pojawi się tutaj.'
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
                  busy={busyId === o.id}
                  onReceive={() => onReceive(o)}
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
  busy,
  onReceive,
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
  busy: boolean;
  onReceive: () => void;
}) {
  const items = order.supplier_order_items || [];
  const total = useMemo(() => orderLineTotal(items), [items]);
  const supplier = order.suppliers;

  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <Text style={[styles.cardTitle, { color: C.text }]}>
        {supplier?.name || 'Dostawca'}
      </Text>
      <Text style={[styles.meta, { color: C.muted }]}>
        Data: {formatPlDate(order.created_at)} · status: {order.status}
      </Text>
      {supplier?.email ? (
        <Text style={[styles.meta, { color: C.muted }]}>E-mail: {supplier.email}</Text>
      ) : null}
      {supplier?.phone ? (
        <Text style={[styles.meta, { color: C.muted }]}>Tel.: {supplier.phone}</Text>
      ) : null}
      {supplier?.address ? (
        <Text style={[styles.meta, { color: C.muted }]}>Adres: {supplier.address}</Text>
      ) : null}
      {supplier?.nip ? (
        <Text style={[styles.meta, { color: C.muted }]}>NIP: {supplier.nip}</Text>
      ) : null}
      {supplier?.bank_account ? (
        <Text style={[styles.meta, { color: C.muted }]}>Konto: {supplier.bank_account}</Text>
      ) : null}
      {order.notes ? (
        <Text style={[styles.meta, { color: C.muted }]}>Uwagi: {order.notes}</Text>
      ) : null}

      <Text style={[styles.section, { color: C.text }]}>Pozycje</Text>
      {items.map((it) => {
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
      })}
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
  tabText: { fontSize: 12, fontWeight: '800' },
  body: { padding: 16, paddingBottom: 40, gap: 12 },
  empty: { alignItems: 'center', paddingTop: 48, gap: 10, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  emptySub: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  cardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  meta: { fontSize: 12, lineHeight: 17 },
  section: { marginTop: 10, marginBottom: 4, fontSize: 12, fontWeight: '800' },
  line: { marginBottom: 6 },
  lineName: { fontSize: 13, fontWeight: '600' },
  lineMeta: { fontSize: 11, marginTop: 2 },
  total: { marginTop: 8, fontSize: 14, fontWeight: '800' },
  receiveBtn: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  receiveText: { fontSize: 14, fontWeight: '800' },
});
