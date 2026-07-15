import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Switch,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Search,
  Trash2,
  X,
  Plus,
  Mic,
  Camera,
  Package,
  FlaskConical,
  Check,
  ChevronDown,
  ChevronRight,
  Tag,
  ShoppingCart,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { Colors } from '@/constants/colors';
import { VoiceReportModal } from '@/components/VoiceReportModal';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { DealHunterModal } from '@/components/DealHunterModal';

// ─── Types ───────────────────────────────────────────────────────────────────────────────

type Unit = 'g' | 'ml' | 'szt' | 'opak' | 'L' | 'kg';

interface CategoryRow {
  id: string;
  name: string;
  color: string;
}

interface MockInventoryItem {
  id: string;
  product_name: string;
  category: string;
  current_qty: number;
  critical_threshold: number;
  unit: Unit;
  is_combo_półprodukt: boolean;
  portion_size: number | null;
  supplier?: string;
  safety_buffer_percent: number; // min 10, default 20
}

interface WasteLogRow {
  id: string;
  item_name: string;
  quantity: number;
  unit: string;
  reason: string | null;
  created_at: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────────────

const UNIT_OPTIONS: Unit[] = ['g', 'kg', 'ml', 'L', 'szt', 'opak'];
const FALLBACK_COLOR = '#64748B';

const CAT_AUTO_COLORS = [
  '#DC2626', '#0891B2', '#16A34A', '#D97706', '#7C3AED',
  '#3B82F6', '#EC4899', '#65A30D', '#F59E0B', '#06B6D4',
  '#EF4444', '#78716C', '#84CC16', '#8B5CF6', '#10B981',
];

// ─── Helpers ───────────────────────────────────────────────────────────────────────────

/**
 * Uwzględnia bufor bezpieczeństwa (+X% do progu krytycznego).
 * Warning zapala się wcześniej — na wysokości critical * (1 + buffer/100).
 */
function getStatus(item: MockInventoryItem): 'critical' | 'warning' | 'ok' {
  const bufferMult = 1 + (Math.max(10, item.safety_buffer_percent ?? 20) / 100);
  const effectiveWarn = item.critical_threshold * bufferMult;
  if (item.current_qty <= item.critical_threshold * 0.5) return 'critical';
  if (item.current_qty <= effectiveWarn) return 'warning';
  return 'ok';
}

function formatQty(qty: number, unit: string): string {
  if ((unit === 'g' || unit === 'ml') && qty >= 1000) {
    const converted = qty / 1000;
    const label = unit === 'g' ? 'kg' : 'L';
    return `${converted % 1 === 0 ? converted.toFixed(0) : converted.toFixed(1)} ${label}`;
  }
  return `${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(1)} ${unit}`;
}

function formatWasteDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

function mapDbRow(row: any): MockInventoryItem {
  return {
    id: row.id,
    product_name: row.name,
    category: row.inventory_categories?.name ?? 'Inne',
    current_qty: Number(row.quantity),
    critical_threshold: Number(row.min_quantity),
    unit: row.unit as Unit,
    is_combo_półprodukt: row.is_combo_polprodukt ?? false,
    portion_size: row.portion_size != null ? Number(row.portion_size) : null,
    supplier: row.suppliers?.name ?? undefined,
  };
}

// ─── ItemCard ─────────────────────────────────────────────────────────────────────────────

function ItemCard({ item, catColor, onDelete, onPress, onOrder }: { item: MockInventoryItem; catColor: string; onDelete?: () => void; onPress?: () => void; onOrder?: () => void }) {
  const status = getStatus(item);
  const ratio = item.current_qty / item.critical_threshold;
  const fillPercent = Math.min(100, Math.round(ratio * 100));

  const palette = {
    critical: {
      bg: '#FEF2F2', border: '#FECACA', accentText: '#DC2626',
      badge: '#FEE2E2', badgeText: '#DC2626', badgeLabel: 'Krytyczny', bar: '#DC2626',
    },
    warning: {
      bg: '#FFFBEB', border: '#FDE68A', accentText: '#D97706',
      badge: '#FEF3C7', badgeText: '#D97706', badgeLabel: 'Niski stan', bar: '#D97706',
    },
    ok: {
      bg: Colors.card, border: Colors.border, accentText: Colors.textPrimary,
      badge: Colors.successLight, badgeText: Colors.success, badgeLabel: 'OK', bar: Colors.success,
    },
  }[status];

  return (
    <TouchableOpacity activeOpacity={onPress ? 0.75 : 1} onPress={onPress} style={[itemStyles.card, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <View style={[itemStyles.accentBar, { backgroundColor: catColor }]} />
      <View style={itemStyles.body}>
        <View style={itemStyles.topRow}>
          <View style={itemStyles.nameRow}>
            {item.is_combo_półprodukt && (
              <View style={itemStyles.comboTag}>
                <FlaskConical size={10} color={Colors.accent} strokeWidth={2.5} />
                <Text style={itemStyles.comboText}>Polprodukt</Text>
              </View>
            )}
            <Text style={itemStyles.name} numberOfLines={1}>{item.product_name}</Text>
          </View>
          <View style={itemStyles.topRight}>
            <View style={[itemStyles.badge, { backgroundColor: palette.badge }]}>
              <Text style={[itemStyles.badgeText, { color: palette.badgeText }]}>{palette.badgeLabel}</Text>
            </View>
            {onDelete && (
              <TouchableOpacity
                onPress={onDelete}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={itemStyles.deleteBtn}
              >
                <X size={12} color={Colors.textTertiary} strokeWidth={2.5} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={itemStyles.qtyRow}>
          <Text style={[itemStyles.qty, { color: palette.accentText }]}>{formatQty(item.current_qty, item.unit)}</Text>
          <Text style={itemStyles.threshold}>{' '}/ min {formatQty(item.critical_threshold, item.unit)}</Text>
        </View>

        {status !== 'ok' && (
          <Text style={[itemStyles.portionAlert, { color: palette.badgeText }]}>
            {status === 'critical' ? 'Stan krytyczny — uzupełnij zapas' : 'Niski stan magazynowy'}
          </Text>
        )}

        <View style={itemStyles.progressBg}>
          <View style={[itemStyles.progressFill, { width: `${fillPercent}%` as any, backgroundColor: palette.bar }]} />
        </View>

        {status !== 'ok' && onOrder && (
          <TouchableOpacity
            style={[itemStyles.orderBtn, { backgroundColor: palette.badgeText }]}
            onPress={onOrder}
            activeOpacity={0.85}
            testID={`order-btn-${item.id}`}
          >
            <ShoppingCart size={13} color={Colors.white} strokeWidth={2.5} />
            <Text style={itemStyles.orderBtnText}>Zamów u dostawcy</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const itemStyles = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: 10, borderWidth: 1.5, marginBottom: 8, overflow: 'hidden' },
  accentBar: { width: 4 },
  body: { flex: 1, padding: 10, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  nameRow: { flex: 1, gap: 3 },
  name: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, lineHeight: 18 },
  comboTag: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', backgroundColor: Colors.accentLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  comboText: { fontSize: 9, fontWeight: '700', color: Colors.accent, letterSpacing: 0.3 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  deleteBtn: { padding: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'baseline' },
  qty: { fontSize: 18, fontWeight: '800', letterSpacing: -0.5 },
  threshold: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  portionAlert: { fontSize: 10, fontWeight: '700', letterSpacing: 0.1 },
  portionOk: { fontSize: 10, color: Colors.textSecondary },
  progressBg: { height: 3, backgroundColor: Colors.borderLight, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, minWidth: 4 },
  orderBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 8, paddingVertical: 8, marginTop: 8 },
  orderBtnText: { fontSize: 12, fontWeight: '700', color: Colors.white, letterSpacing: 0.2 },
});

// ─── CategorySection ─────────────────────────────────────────────────────────────────────────

interface CategorySectionProps {
  category: CategoryRow;
  items: MockInventoryItem[];
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onDeleteItem: (item: MockInventoryItem) => void;
  onPressItem: (item: MockInventoryItem) => void;
  onOrderItem: (item: MockInventoryItem) => void;
}

function CategorySection({ category, items, isExpanded, onToggle, onDelete, onDeleteItem, onPressItem, onOrderItem }: CategorySectionProps) {
  const criticalCount = items.filter((i) => getStatus(i) === 'critical').length;
  const warningCount = items.filter((i) => getStatus(i) === 'warning').length;

  return (
    <View style={catStyles.section}>
      <TouchableOpacity style={catStyles.header} onPress={onToggle} activeOpacity={0.75}>
        <View style={[catStyles.colorBar, { backgroundColor: category.color }]} />
        <View style={catStyles.headerContent}>
          <View style={catStyles.headerLeft}>
            <Text style={catStyles.catName}>{category.name}</Text>
            <View style={catStyles.countRow}>
              <Text style={catStyles.totalCount}>{items.length} produktów</Text>
              {criticalCount > 0 && (
                <View style={catStyles.alertBadge}>
                  <Text style={catStyles.alertBadgeText}>{criticalCount} kryty.</Text>
                </View>
              )}
              {warningCount > 0 && (
                <View style={[catStyles.alertBadge, catStyles.warnBadge]}>
                  <Text style={[catStyles.alertBadgeText, catStyles.warnBadgeText]}>{warningCount} niski</Text>
                </View>
              )}
            </View>
          </View>
          <View style={catStyles.headerRight}>
            <TouchableOpacity
              onPress={onDelete}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={catStyles.deleteBtn}
            >
              <Trash2 size={13} color={Colors.danger} strokeWidth={2} />
            </TouchableOpacity>
            {isExpanded
              ? <ChevronDown size={18} color={Colors.textSecondary} strokeWidth={2} />
              : <ChevronRight size={18} color={Colors.textSecondary} strokeWidth={2} />}
          </View>
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <View style={catStyles.body}>
          {items.length === 0 ? (
            <View style={catStyles.emptyBody}>
              <Text style={catStyles.emptyBodyText}>Brak produktów w tej kategorii</Text>
            </View>
          ) : (
            items
              .slice()
              .sort((a, b) => {
                const ORDER = { critical: 0, warning: 1, ok: 2 } as const;
                return ORDER[getStatus(a)] - ORDER[getStatus(b)];
              })
              .map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  catColor={category.color}
                  onDelete={() => onDeleteItem(item)}
                  onPress={() => onPressItem(item)}
                  onOrder={() => onOrderItem(item)}
                />
              ))
          )}
        </View>
      )}
    </View>
  );
}

const catStyles = StyleSheet.create({
  section: { marginBottom: 8, borderRadius: 14, overflow: 'hidden', backgroundColor: Colors.card, shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  header: { flexDirection: 'row', alignItems: 'stretch' },
  colorBar: { width: 5, minHeight: 52 },
  headerContent: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  headerLeft: { flex: 1, gap: 3 },
  catName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  totalCount: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  alertBadge: { backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  alertBadgeText: { fontSize: 10, fontWeight: '700', color: '#DC2626' },
  warnBadge: { backgroundColor: '#FEF3C7' },
  warnBadgeText: { color: '#D97706' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deleteBtn: { padding: 4 },
  body: { paddingHorizontal: 10, paddingBottom: 10, paddingTop: 4, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  emptyBody: { alignItems: 'center', paddingVertical: 14 },
  emptyBodyText: { fontSize: 12, color: Colors.textTertiary },
});

// ─── Form helpers ────────────────────────────────────────────────────────────────────────

const formStyles = StyleSheet.create({
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  input: { backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: Colors.textPrimary },
});

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text style={formStyles.fieldLabel}>
      {text}{required && <Text style={{ color: Colors.danger }}> *</Text>}
    </Text>
  );
}

function NumericInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <TextInput
      style={formStyles.input}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder ?? '0'}
      placeholderTextColor={Colors.textTertiary}
      keyboardType="decimal-pad"
      returnKeyType="next"
    />
  );
}

const BLANK_FORM = {
  name: '',
  category: '',
  currentQty: '',
  criticalThreshold: '',
  unit: 'g' as Unit,
  isCombo: false,
  portionSize: '',
  safetyBuffer: '20', // % — min 10
  unitWeightVolume: '', // waga/objętość 1 szt/op
  weightVolumeUnit: 'g' as 'g' | 'ml',
};

// ─── Main Screen ─────────────────────────────────────────────────────────────────────────────

export default function MagazynScreen() {
  const router = useRouter();
  const [inventory, setInventory] = useState<MockInventoryItem[]>([]);
  const [wasteLogs, setWasteLogs] = useState<WasteLogRow[]>([]);
  const [dbCategories, setDbCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showWasteLogs, setShowWasteLogs] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);

  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [savingCat, setSavingCat] = useState(false);
  const savingCatRef = useRef(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [orderProduct, setOrderProduct] = useState<MockInventoryItem | null>(null);

  const fabAnim = useRef(new Animated.Value(0)).current;

  // ── Data fetching ────────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [itemsRes, catsRes, wasteRes] = await Promise.all([
        supabase
          .from('inventory_items')
          .select('id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, safety_buffer_percent, inventory_categories(name), suppliers(name)')
          .order('name')
          .then(async (res) => {
            // Graceful fallback if the safety_buffer_percent migration is not yet applied.
            if (res.error && /safety_buffer_percent/.test(res.error.message ?? '')) {
              return supabase
                .from('inventory_items')
                .select('id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)')
                .order('name');
            }
            return res;
          }),
        supabase
          .from('inventory_categories')
          .select('id, name, color')
          .order('sort_order'),
        supabase
          .from('waste_logs')
          .select('id, item_name, quantity, unit, reason, created_at')
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      if (catsRes.error) throw catsRes.error;
      if (wasteRes.error) throw wasteRes.error;
      setInventory((itemsRes.data ?? []).map(mapDbRow));
      setDbCategories(catsRes.data ?? []);
      setWasteLogs(wasteRes.data ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Nieznany błąd');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const onRefresh = () => { setRefreshing(true); fetchData(); };

  // ── Category derived data ───────────────────────────────────────────────────────────────

  const categoryColorMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    dbCategories.forEach((c) => { map[c.name] = c.color; });
    return map;
  }, [dbCategories]);

  const categoryIdMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    dbCategories.forEach((c) => { map[c.name] = c.id; });
    return map;
  }, [dbCategories]);

  const categoryProductCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    inventory.forEach((item) => { counts[item.category] = (counts[item.category] ?? 0) + 1; });
    return counts;
  }, [inventory]);

  const categorySections = useMemo(() => {
    return [...dbCategories]
      .sort((a, b) => (categoryProductCounts[b.name] ?? 0) - (categoryProductCounts[a.name] ?? 0))
      .map((c) => (
        {
          cat: c,
          items: inventory.filter((item) => item.category === c.name),
        }
      ));
  }, [dbCategories, inventory, categoryProductCounts]);

  const formCategories = useMemo<string[]>(() => {
    return [...dbCategories]
      .sort((a, b) => {
        const diff = (categoryProductCounts[b.name] ?? 0) - (categoryProductCounts[a.name] ?? 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'pl');
      })
      .map((c) => c.name);
  }, [dbCategories, categoryProductCounts]);

  useEffect(() => {
    if (formCategories.length > 0 && !form.category) {
      setForm((f) => ({ ...f, category: formCategories[0] }));
    }
  }, [formCategories]);

  // ── Search filtered data ───────────────────────────────────────────────────────────────

  const searchResults = useMemo<MockInventoryItem[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return inventory
      .filter((item) => item.product_name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q))
      .sort((a, b) => {
        const ORDER = { critical: 0, warning: 1, ok: 2 } as const;
        return ORDER[getStatus(a)] - ORDER[getStatus(b)];
      });
  }, [inventory, search]);

  const totalCritical = useMemo(() => inventory.filter((i) => getStatus(i) === 'critical').length, [inventory]);

  // ── Category management ───────────────────────────────────────────────────────────────

  const handleAddCategory = async () => {
    if (savingCatRef.current) return;
    const name = newCatName.trim();
    if (!name) return;
    savingCatRef.current = true;
    setSavingCat(true);
    const usedColors = dbCategories.map((c) => c.color);
    const color = CAT_AUTO_COLORS.find((c) => !usedColors.includes(c))
      ?? CAT_AUTO_COLORS[dbCategories.length % CAT_AUTO_COLORS.length];
    const maxOrder = dbCategories.reduce((m, c) => Math.max(m, (c as any).sort_order ?? 0), 0);
    const { data: newCat, error } = await supabase.from('inventory_categories').insert({
      name, color, icon_name: 'box', sort_order: maxOrder + 10,
    }).select('id, name, color').single();
    savingCatRef.current = false;
    setSavingCat(false);
    if (error) { Alert.alert('Błąd', error.message); return; }
    setNewCatName('');
    setAddingCat(false);
    if (newCat) {
      setDbCategories((prev) => [...prev, newCat as CategoryRow]);
      setExpandedCategories((prev) => new Set([...prev, name]));
      setForm((f) => ({ ...f, category: name }));
    } else {
      fetchData();
    }
  };

  const handleDeleteCategory = (cat: CategoryRow) => {
    const count = categoryProductCounts[cat.name] ?? 0;
    const msg = count > 0
      ? `Ta kategoria zawiera ${count} ${count === 1 ? 'produkt' : 'produktów'}. Po usunięciu produkty pozostaną bez kategorii.`
      : 'Czy na pewno chcesz usunąć tę kategorię?';
    Alert.alert('Usuń kategorię', msg, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('inventory_categories').delete().eq('id', cat.id);
          if (error) Alert.alert('Błąd', error.message);
          else fetchData();
        },
      },
    ]);
  };

  const handlePressItem = (item: MockInventoryItem) => {
    router.push({ pathname: '/product-suppliers', params: { productId: item.id, productName: item.product_name } });
  };

  const handleOrderItem = (item: MockInventoryItem) => {
    setOrderProduct(item);
  };

  const handleDeleteItem = (item: MockInventoryItem) => {
    Alert.alert(
      'Usuń produkt',
      `Czy na pewno chcesz usunąć "${item.product_name}"?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('inventory_items').delete().eq('id', item.id);
            if (error) { Alert.alert('Błąd', error.message); return; }
            setInventory((prev) => prev.filter((i) => i.id !== item.id));
          },
        },
      ]
    );
  };

  function toggleCategory(catName: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catName)) next.delete(catName);
      else next.add(catName);
      return next;
    });
  }

  // ── FAB ───────────────────────────────────────────────────────────────────────────────

  function toggleFab() {
    Animated.spring(fabAnim, { toValue: fabOpen ? 0 : 1, useNativeDriver: true, friction: 7, tension: 80 }).start();
    setFabOpen((prev) => !prev);
  }
  function closeFab() {
    Animated.spring(fabAnim, { toValue: 0, useNativeDriver: true, friction: 7, tension: 80 }).start();
    setFabOpen(false);
  }
  function handleAddProductPress() { closeFab(); setShowAddModal(true); }
  function handleMicPress() { closeFab(); setShowVoiceModal(true); }
  function handleCameraPress() { closeFab(); Alert.alert('Skanowanie dostawy', 'Scanner triggered.', [{ text: 'OK' }]); }

  const addTranslateY = fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -192] });
  const micTranslateY = fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -132] });
  const cameraTranslateY = fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -72] });
  const miniOpacity = fabAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const fabRotate = fabAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  // ── Auto-unlock offer items ────────────────────────────────────────────────────────────

  async function autoUnlockOfferItems(newItemId: string, newItemName: string) {
    try {
      const { data: sleeping } = await supabase.from('supplier_offer_items').select('id, raw_product_name').is('warehouse_product_id', null);
      if (!sleeping || sleeping.length === 0) return;
      const newWords = newItemName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const toUnlock = sleeping
        .filter((item: any) => {
          const offerWords = item.raw_product_name.toLowerCase().split(/\s+/);
          return newWords.some((w) => offerWords.some((ow: string) => ow.includes(w) || w.includes(ow)));
        })
        .map((item: any) => item.id);
      if (toUnlock.length > 0) {
        await supabase.from('supplier_offer_items').update({ warehouse_product_id: newItemId }).in('id', toUnlock);
      }
    } catch { /* non-critical */ }
  }

  // ── Save product ───────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) { Alert.alert('Wymagane pole', 'Podaj nazwę produktu.'); return; }
    const currentQty = parseFloat(form.currentQty);
    const criticalThreshold = parseFloat(form.criticalThreshold);
    if (isNaN(currentQty) || currentQty < 0) { Alert.alert('Błąd', 'Aktualna ilość musi być liczbą nieujemną.'); return; }
    if (isNaN(criticalThreshold) || criticalThreshold <= 0) { Alert.alert('Błąd', 'Stan krytyczny musi być liczbą > 0.'); return; }
    let safetyBuffer = parseFloat(form.safetyBuffer);
    if (isNaN(safetyBuffer)) safetyBuffer = 20;
    if (safetyBuffer < 10) safetyBuffer = 10;
    if (safetyBuffer > 200) safetyBuffer = 200;
    setSaving(true);
    try {
      const isPiece = form.unit === 'szt' || form.unit === 'opak';
      const uwv = isPiece && form.unitWeightVolume.trim() ? parseFloat(form.unitWeightVolume) : null;
      const insertPayload: any = {
        name: form.name.trim(),
        category_id: categoryIdMap[form.category] ?? null,
        quantity: currentQty,
        unit: form.unit,
        min_quantity: criticalThreshold,
        is_combo_polprodukt: form.isCombo,
        safety_buffer_percent: safetyBuffer,
        unit_cost: 0,
        unit_weight_volume: uwv && !isNaN(uwv) ? uwv : null,
        weight_volume_unit: uwv && !isNaN(uwv) ? form.weightVolumeUnit : null,
      };
      let insertRes = await supabase
        .from('inventory_items')
        .insert(insertPayload)
        .select('id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, safety_buffer_percent, inventory_categories(name), suppliers(name)')
        .single();
      // Retry stripping optional columns if migrations not yet applied
      if (insertRes.error && /safety_buffer_percent|unit_weight_volume|weight_volume_unit/.test(insertRes.error.message ?? '')) {
        const { safety_buffer_percent, unit_weight_volume, weight_volume_unit, ...fallback } = insertPayload;
        insertRes = await supabase
          .from('inventory_items')
          .insert(fallback)
          .select('id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)')
          .single();
      }
      const { data: newRow, error: insertError } = insertRes;
      if (insertError) throw insertError;
      setInventory((prev) => [...prev, mapDbRow(newRow)]);
      await autoUnlockOfferItems(newRow.id, newRow.name);
      if (form.category) {
        setExpandedCategories((prev) => new Set([...prev, form.category]));
      }
      setForm({ ...BLANK_FORM, category: formCategories[0] ?? '' });
      setShowAddModal(false);
    } catch (e: any) {
      Alert.alert('Błąd zapisu', e.message ?? 'Nieznany błąd');
    } finally {
      setSaving(false);
    }
  }

  function handleCloseAddModal() {
    setForm({ ...BLANK_FORM, category: formCategories[0] ?? '' });
    setShowAddModal(false);
  }

  // Portion size hint
  const isSearching = search.trim().length > 0;

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Magazyn</Text>
          <Text style={styles.subtitle}>
            {inventory.length} produktów
            {totalCritical > 0 ? ` · ${totalCritical} alarmów` : ' · Stan OK'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.addHeaderBtn} onPress={() => setShowAddModal(true)} activeOpacity={0.8}>
            <Plus size={14} color={Colors.accent} strokeWidth={2.5} />
            <Text style={styles.addHeaderBtnText}>Dodaj</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.wasteBtn} onPress={() => setShowWasteLogs(true)} activeOpacity={0.75}>
            <Trash2 size={15} color={Colors.danger} strokeWidth={2} />
            <Text style={styles.wasteBtnText}>Straty</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, marginTop: 6, marginBottom: 12 }}>
        <ReportInfoButton contextHint="Magazyn" onApplied={fetchData} testID="magazyn-report-info" />
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={16} color={Colors.textSecondary} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          placeholder="Szukaj produktu lub kategorii..."
          placeholderTextColor={Colors.textTertiary}
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={14} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </View>

      {/* Main content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        keyboardShouldPersistTaps="handled"
      >
        {isSearching ? (
          <>
            <Text style={styles.searchResultLabel}>
              {searchResults.length} wyników dla "{search.trim()}
            </Text>
            {searchResults.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Package size={36} color={Colors.textTertiary} strokeWidth={1.5} />
                <Text style={styles.emptyTitle}>Brak wyników</Text>
                <Text style={styles.emptyText}>Brak produktów pasujących do "{search.trim()}„</Text>
              </View>
            ) : (
              searchResults.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  catColor={categoryColorMap[item.category] ?? FALLBACK_COLOR}
                  onDelete={() => handleDeleteItem(item)}
                  onPress={() => handlePressItem(item)}
                  onOrder={() => handleOrderItem(item)}
                />
              ))
            )}
          </>
        ) : (
          <>
            <View style={styles.catSectionHeader}>
              <Tag size={14} color={Colors.textSecondary} strokeWidth={2} />
              <Text style={styles.catSectionTitle}>Kategorie produktów</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={styles.addCatBtn}
                onPress={() => setAddingCat(true)}
                activeOpacity={0.8}
              >
                <Plus size={13} color={Colors.accent} strokeWidth={2.5} />
                <Text style={styles.addCatBtnText}>Dodaj kategorię</Text>
              </TouchableOpacity>
            </View>

            {dbCategories.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Package size={40} color={Colors.textTertiary} strokeWidth={1.5} />
                <Text style={styles.emptyTitle}>Magazyn jest pusty</Text>
                <Text style={styles.emptyText}>
                  Dodaj pierwszą kategorię, a następnie produkty.
                </Text>
              </View>
            ) : (
              categorySections.map((section) => (
                <CategorySection
                  key={section.cat.id}
                  category={section.cat}
                  items={section.items}
                  isExpanded={expandedCategories.has(section.cat.name)}
                  onToggle={() => toggleCategory(section.cat.name)}
                  onDelete={() => handleDeleteCategory(section.cat)}
                  onDeleteItem={handleDeleteItem}
                  onPressItem={handlePressItem}
                  onOrderItem={handleOrderItem}
                />
              ))
            )}

            {(() => {
              const uncategorized = inventory.filter(
                (item) => !dbCategories.some((c) => c.name === item.category)
              );
              if (uncategorized.length === 0) return null;
              return (
                <View style={catStyles.section}>
                  <TouchableOpacity
                    style={catStyles.header}
                    onPress={() => toggleCategory('__uncategorized__')}
                    activeOpacity={0.75}
                  >
                    <View style={[catStyles.colorBar, { backgroundColor: FALLBACK_COLOR }]} />
                    <View style={catStyles.headerContent}>
                      <View style={catStyles.headerLeft}>
                        <Text style={catStyles.catName}>Bez kategorii</Text>
                        <Text style={catStyles.totalCount}>{uncategorized.length} produktów</Text>
                      </View>
                      <View style={catStyles.headerRight}>
                        {expandedCategories.has('__uncategorized__')
                          ? <ChevronDown size={18} color={Colors.textSecondary} strokeWidth={2} />
                          : <ChevronRight size={18} color={Colors.textSecondary} strokeWidth={2} />}
                      </View>
                    </View>
                  </TouchableOpacity>
                  {expandedCategories.has('__uncategorized__') && (
                    <View style={catStyles.body}>
                      {uncategorized.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          catColor={FALLBACK_COLOR}
                          onDelete={() => handleDeleteItem(item)}
                          onPress={() => handlePressItem(item)}
                          onOrder={() => handleOrderItem(item)}
                        />
                      ))}
                    </View>
                  )}
                </View>
              );
            })()}
          </>
        )}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* FAB stack */}
      <View style={styles.fabContainer} pointerEvents="box-none">
        <Animated.View style={[styles.fabMini, { transform: [{ translateY: addTranslateY }], opacity: miniOpacity }]} pointerEvents={fabOpen ? 'auto' : 'none'}>
          <View style={styles.fabMiniLabel}><Text style={styles.fabMiniLabelText}>Dodaj Produkt</Text></View>
          <TouchableOpacity style={[styles.fabMiniBtn, { backgroundColor: Colors.accent }]} onPress={handleAddProductPress} activeOpacity={0.85}>
            <Package size={20} color={Colors.white} strokeWidth={2} />
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={[styles.fabMini, { transform: [{ translateY: micTranslateY }], opacity: miniOpacity }]} pointerEvents={fabOpen ? 'auto' : 'none'}>
          <View style={styles.fabMiniLabel}><Text style={styles.fabMiniLabelText}>AI Głos</Text></View>
          <TouchableOpacity style={[styles.fabMiniBtn, { backgroundColor: '#8B5CF6' }]} onPress={handleMicPress} activeOpacity={0.85}>
            <Mic size={20} color={Colors.white} strokeWidth={2} />
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={[styles.fabMini, { transform: [{ translateY: cameraTranslateY }], opacity: miniOpacity }]} pointerEvents={fabOpen ? 'auto' : 'none'}>
          <View style={styles.fabMiniLabel}><Text style={styles.fabMiniLabelText}>Skanuj dostawę</Text></View>
          <TouchableOpacity style={[styles.fabMiniBtn, { backgroundColor: Colors.success }]} onPress={handleCameraPress} activeOpacity={0.85}>
            <Camera size={20} color={Colors.white} strokeWidth={2} />
          </TouchableOpacity>
        </Animated.View>
        <TouchableOpacity style={styles.fab} onPress={toggleFab} activeOpacity={0.85}>
          <Animated.View style={{ transform: [{ rotate: fabRotate }] }}>
            <Plus size={26} color={Colors.white} strokeWidth={2.5} />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* Add Product Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCloseAddModal}>
        <SafeAreaView style={styles.modalSafe} edges={['top']}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Nowy Produkt</Text>
              <Text style={styles.modalSubtitle}>Uzupełnij dane magazynowe</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={handleCloseAddModal}>
              <X size={20} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.formScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.formSection}>Podstawowe dane</Text>
              <View style={styles.fieldWrap}>
                <FieldLabel text="Nazwa produktu" required />
                <TextInput
                  style={formStyles.input}
                  placeholder="np. Kurczak filet"
                  placeholderTextColor={Colors.textTertiary}
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  returnKeyType="next"
                />
              </View>
              <View style={styles.fieldWrap}>
                <FieldLabel text="Kategoria" required />
                {formCategories.length === 0 ? (
                  <Text style={styles.fieldHint}>Brak kategorii — dodaj je przyciskiem "Dodaj kategorię"</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
                    {formCategories.map((cat) => {
                      const active = form.category === cat;
                      const color = categoryColorMap[cat] ?? FALLBACK_COLOR;
                      const count = categoryProductCounts[cat] ?? 0;
                      const catRow = dbCategories.find((c) => c.name === cat);
                      return (
                        <View
                          key={cat}
                          style={[styles.formPill, active && { backgroundColor: color, borderColor: color }]}
                        >
                          <TouchableOpacity
                            style={styles.formPillMain}
                            onPress={() => setForm((f) => ({ ...f, category: cat }))}
                            activeOpacity={0.7}
                          >
                            {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                            <Text style={[styles.formPillText, active && { color: Colors.white, fontWeight: '700' }]}>{cat}</Text>
                            {count > 0 && (
                              <Text style={[styles.formPillCount, active && { color: Colors.white }]}>{count}</Text>
                            )}
                          </TouchableOpacity>
                          {catRow && (
                            <TouchableOpacity
                              onPress={() => handleDeleteCategory(catRow)}
                              hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                              style={styles.formPillDelete}
                            >
                              <X size={10} color={active ? 'rgba(255,255,255,0.75)' : Colors.textTertiary} strokeWidth={2.5} />
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
              <Text style={styles.formSection}>Stan magazynowy</Text>
              <View style={styles.fieldRow}>
                <View style={[styles.fieldWrap, { flex: 1 }]}>
                  <FieldLabel text="Aktualna ilość" required />
                  <NumericInput value={form.currentQty} onChange={(v) => setForm((f) => ({ ...f, currentQty: v }))} placeholder="np. 1500" />
                </View>
                <View style={[styles.fieldWrap, { flex: 1 }]}>
                  <FieldLabel text="Stan krytyczny" required />
                  <NumericInput value={form.criticalThreshold} onChange={(v) => setForm((f) => ({ ...f, criticalThreshold: v }))} placeholder="np. 2000" />
                </View>
              </View>
              <View style={styles.fieldWrap}>
                <FieldLabel text="Jednostka" required />
                <View style={styles.unitRow}>
                  {UNIT_OPTIONS.map((u) => {
                    const active = form.unit === u;
                    return (
                      <TouchableOpacity key={u} style={[styles.unitBtn, active && styles.unitBtnActive]} onPress={() => setForm((f) => ({ ...f, unit: u }))} activeOpacity={0.7}>
                        <Text style={[styles.unitBtnText, active && styles.unitBtnTextActive]}>{u}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              {(form.unit === 'szt' || form.unit === 'opak') && (
                <View style={styles.fieldWrap}>
                  <FieldLabel text={`Waga/objętość jednej ${form.unit === 'opak' ? 'op.' : 'szt.'}`} />
                  <View style={styles.wvRow}>
                    <TextInput
                      style={[formStyles.input, { flex: 1 }]}
                      value={form.unitWeightVolume}
                      onChangeText={(v) => setForm((f) => ({ ...f, unitWeightVolume: v.replace(',', '.') }))}
                      placeholder="np. 400"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="decimal-pad"
                      testID="add-product-unit-weight"
                    />
                    <View style={styles.wvToggle}>
                      {(['g', 'ml'] as const).map((u) => {
                        const active = form.weightVolumeUnit === u;
                        return (
                          <TouchableOpacity
                            key={u}
                            style={[styles.wvToggleBtn, active && styles.wvToggleBtnActive]}
                            onPress={() => setForm((f) => ({ ...f, weightVolumeUnit: u }))}
                            activeOpacity={0.7}
                            testID={`add-product-wv-unit-${u}`}
                          >
                            <Text style={[styles.wvToggleText, active && styles.wvToggleTextActive]}>{u}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <Text style={styles.fieldHint}>
                    Pozwala przeliczać zapas na porcje potraw liczonych w {form.weightVolumeUnit} (np. 1 szt. = 400 g).
                  </Text>
                </View>
              )}
              <View style={styles.portionInfoBox}>
                <Text style={styles.portionInfoText}>
                  💡 Porcje wyliczane są <Text style={{ fontWeight: '700', color: Colors.textPrimary }}>automatycznie</Text> na
                  podstawie receptur z Menu. Otwórz produkt → „Dostępność w menu", aby zobaczyć na ile porcji każdej potrawy wystarczy zapas.
                </Text>
              </View>
              <Text style={styles.formSection}>Typ produktu</Text>
              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <FlaskConical size={16} color={Colors.accent} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchLabel}>Półprodukt / Combo</Text>
                    <Text style={styles.switchHint}>Przygotowywany wewnętrznie z innych składników</Text>
                  </View>
                </View>
                <Switch
                  value={form.isCombo}
                  onValueChange={(v) => setForm((f) => ({ ...f, isCombo: v }))}
                  trackColor={{ false: Colors.borderLight, true: Colors.accentLight }}
                  thumbColor={form.isCombo ? Colors.accent : Colors.textTertiary}
                />
              </View>

              <View style={styles.fieldWrap}>
                <FieldLabel text={`Bufor bezpieczeństwa (%) — min 10, domyślnie 20`} />
                <NumericInput
                  value={form.safetyBuffer}
                  onChange={(v) => setForm((f) => ({ ...f, safetyBuffer: v }))}
                  placeholder="20"
                />
                <Text style={styles.fieldHint}>
                  Ostrzeżenie o niskim stanie włączone wcześniej o {form.safetyBuffer || 20}% jako
                  bufor na ubytki naturalne i straty (min. 10%).
                </Text>
              </View>
              {form.name.trim() !== '' && form.currentQty !== '' && form.criticalThreshold !== '' && (
                <View style={styles.previewWrap}>
                  <Text style={styles.previewLabel}>Pogląd karty produktu</Text>
                  <ItemCard
                    item={{
                      id: '__preview__',
                      product_name: form.name.trim(),
                      category: form.category,
                      current_qty: parseFloat(form.currentQty) || 0,
                      critical_threshold: parseFloat(form.criticalThreshold) || 1,
                      unit: form.unit,
                      is_combo_półprodukt: form.isCombo,
                      portion_size: null,
                      safety_buffer_percent: parseFloat(form.safetyBuffer) || 20,
                    }}
                    catColor={categoryColorMap[form.category] ?? FALLBACK_COLOR}
                  />
                </View>
              )}
              <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
                <Check size={18} color={Colors.white} strokeWidth={2.5} />
                <Text style={styles.saveBtnText}>{saving ? 'Zapisywanie...' : 'Zapisz Produkt'}</Text>
              </TouchableOpacity>
              <View style={{ height: 32 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Waste Logs Modal */}
      <Modal visible={showWasteLogs} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowWasteLogs(false)}>
        <SafeAreaView style={styles.modalSafe} edges={['top']}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Logi Strat</Text>
              <Text style={styles.modalSubtitle}>{wasteLogs.length} wpisów</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowWasteLogs(false)}>
              <X size={20} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            {wasteLogs.length === 0 && (
              <View style={styles.emptyWrap}>
                <Trash2 size={32} color={Colors.textTertiary} strokeWidth={1.5} />
                <Text style={styles.emptyTitle}>Brak logów strat</Text>
              </View>
            )}
            {wasteLogs.map((log) => (
              <View key={log.id} style={styles.wasteRow}>
                <View style={styles.wasteLeft}>
                  <Text style={styles.wasteName}>{log.item_name}</Text>
                  <Text style={styles.wasteReason}>{log.reason ?? ''}</Text>
                  <Text style={styles.wasteDate}>{formatWasteDate(log.created_at)}</Text>
                </View>
                <View style={styles.wasteRight}>
                  <Text style={styles.wasteQty}>-{log.quantity % 1 === 0 ? log.quantity : Number(log.quantity).toFixed(1)} {log.unit}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Voice Report Modal */}
      {showVoiceModal ? (
        <VoiceReportModal
          visible={showVoiceModal}
          onClose={() => setShowVoiceModal(false)}
          onApplied={fetchData}
          contextHint="Magazyn"
        />
      ) : null}

      {/* Deal Hunter (Łowca Okazji) — porównanie ofert i zamówienie */}
      <DealHunterModal
        visible={orderProduct !== null}
        product={orderProduct}
        restaurantName="Gastro Manager"
        onClose={() => setOrderProduct(null)}
      />

      {/* Add Category Modal */}
      <Modal visible={addingCat} transparent animationType="fade" onRequestClose={() => setAddingCat(false)}>
        <View style={styles.catOverlay}>
          <View style={styles.catModal}>
            <View style={styles.catModalHeader}>
              <Text style={styles.catModalTitle}>Nowa kategoria</Text>
              <TouchableOpacity onPress={() => { setAddingCat(false); setNewCatName(''); }}>
                <X size={20} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.catInput}
              value={newCatName}
              onChangeText={setNewCatName}
              placeholder="np. Owoce morza"
              placeholderTextColor={Colors.textTertiary}
              autoFocus
              onSubmitEditing={handleAddCategory}
              returnKeyType="done"
            />
            <View style={styles.catModalBtns}>
              <TouchableOpacity style={styles.catCancelBtn} onPress={() => { setAddingCat(false); setNewCatName(''); }}>
                <Text style={styles.catCancelText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.catSaveBtn, (!newCatName.trim() || savingCat) && { opacity: 0.5 }]}
                onPress={handleAddCategory}
                disabled={!newCatName.trim() || savingCat}
                activeOpacity={0.85}
              >
                {savingCat
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.catSaveText}>Dodaj kategorię</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, fontWeight: '500' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: Colors.accentLight, borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE' },
  addHeaderBtnText: { fontSize: 12, fontWeight: '600', color: Colors.accent },
  wasteBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: Colors.dangerLight, borderRadius: 8, borderWidth: 1, borderColor: '#FECACA' },
  wasteBtnText: { fontSize: 12, fontWeight: '600', color: Colors.danger },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 10, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, fontSize: 14, color: Colors.textPrimary, padding: 0 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14 },
  catSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, paddingHorizontal: 2 },
  catSectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  addCatBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: Colors.accentLight, borderRadius: 8 },
  addCatBtnText: { fontSize: 11, fontWeight: '600', color: Colors.accent },
  searchResultLabel: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary, letterSpacing: 0.4, marginBottom: 10, paddingHorizontal: 2 },
  emptyWrap: { alignItems: 'center', paddingVertical: 56, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', maxWidth: 280 },
  fabContainer: { position: 'absolute', bottom: 24, right: 20, alignItems: 'flex-end' },
  fab: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center', shadowColor: Colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.45, shadowRadius: 10, elevation: 10 },
  fabMini: { position: 'absolute', bottom: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fabMiniBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 5, elevation: 5 },
  fabMiniLabel: { backgroundColor: Colors.textPrimary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  fabMiniLabelText: { color: Colors.white, fontSize: 12, fontWeight: '600' },
  modalSafe: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.card },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  modalSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.borderLight, alignItems: 'center', justifyContent: 'center' },
  modalContent: { padding: 16 },
  formScroll: { padding: 20 },
  formSection: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5, marginBottom: 12, marginTop: 20 },
  fieldWrap: { marginBottom: 14 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldHint: { fontSize: 11, color: Colors.textTertiary, marginTop: 5 },
  pillRow: { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  formPill: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, overflow: 'hidden' },
  formPillMain: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8 },
  formPillDelete: { paddingRight: 10, paddingLeft: 2, paddingVertical: 8 },
  formPillText: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary },
  formPillCount: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  unitBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', minWidth: 48 },
  unitBtnActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  unitBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  unitBtnTextActive: { color: Colors.white },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 14 },
  portionInfoBox: { marginBottom: 14, backgroundColor: Colors.accentLight, borderRadius: 10, padding: 12, borderLeftWidth: 3, borderLeftColor: Colors.accent },
  portionInfoText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  wvRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wvToggle: { flexDirection: 'row', backgroundColor: Colors.borderLight, borderRadius: 10, padding: 3, borderWidth: 1.5, borderColor: Colors.border },
  wvToggleBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8 },
  wvToggleBtnActive: { backgroundColor: Colors.accent },
  wvToggleText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  wvToggleTextActive: { color: Colors.white },
  switchInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  switchLabel: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  switchHint: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, lineHeight: 15 },
  previewWrap: { marginTop: 8, marginBottom: 4 },
  previewLabel: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, letterSpacing: 0.4, marginBottom: 8 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.accent, paddingVertical: 15, borderRadius: 12, marginTop: 8, shadowColor: Colors.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 5 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: Colors.white },
  wasteRow: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: Colors.card, borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: Colors.border, gap: 12 },
  wasteLeft: { flex: 1, gap: 3 },
  wasteName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  wasteReason: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  wasteDate: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  wasteRight: { alignItems: 'flex-end', justifyContent: 'center' },
  wasteQty: { fontSize: 15, fontWeight: '700', color: Colors.danger },
  catOverlay: { flex: 1, backgroundColor: Colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  catModal: { backgroundColor: Colors.card, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360, gap: 16 },
  catModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catModalTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  catInput: { backgroundColor: Colors.borderLight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 10, fontSize: 15, color: Colors.textPrimary, borderWidth: 1.5, borderColor: Colors.border },
  catModalBtns: { flexDirection: 'row', gap: 10 },
  catCancelBtn: { flex: 1, backgroundColor: Colors.borderLight, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  catCancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  catSaveBtn: { flex: 2, backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  catSaveText: { fontSize: 14, fontWeight: '700', color: Colors.white },
});