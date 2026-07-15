import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Animated,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Switch,
  RefreshControl,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChefHat, Search, ChevronDown, Mic, Camera, Ruler, Leaf, X, UtensilsCrossed, Plus, Trash2, Check, CreditCard as Edit, FlaskConical } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { Colors } from '@/constants/colors';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { MenuScanModal } from '@/components/MenuScanModal';
import { formatPln } from '@/lib/format';

// ─── Types ────────────────────────────────────────────────────────────────────

type Unit = 'g' | 'ml' | 'szt' | 'opak' | 'L' | 'kg';

interface RecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
}

interface Dish {
  id: string;
  name: string;
  category: string;
  price_pln: number;
  pos_id: string;
  recipe: RecipeIngredient[];
}

interface KitchenUtensil {
  id: string;
  name: string;
  utensil_type: string;
  capacity_value: number | null;
  capacity_unit: string | null;
}

interface IngredientDraft {
  key: string;
  name: string;
  quantity: string;
  unit: string;
}

// Inventory item shape mirrored from magazyn.tsx
interface InventoryItem {
  id: string;
  product_name: string;
  category: string;
  current_qty: number;
  critical_threshold: number;
  unit: Unit;
  is_combo_półprodukt: boolean;
  portion_size: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FORM_CATEGORIES = ['Burgery', 'Dania główne', 'Sałatki', 'Makarony', 'Zupy'];

const CATEGORY_COLORS: Record<string, string> = {
  Burgery: '#D97706',
  'Dania główne': '#2563EB',
  Sałatki: '#16A34A',
  Makarony: '#7C3AED',
  Zupy: '#DC2626',
};

const INV_CATEGORY_COLORS: Record<string, string> = {
  'Napoje/Alkohole': '#2563EB',
  Mięso: '#DC2626',
  Warzywa: '#16A34A',
  Przyprawy: '#D97706',
  'Środki czystości': '#7C3AED',
  'Przybory kuchenne': '#475569',
  Nabiał: '#0891B2',
  Pieczywo: '#78716C',
  Inne: '#64748B',
};

const UNIT_OPTIONS = ['g', 'ml', 'szt', 'kg', 'L'];
const INV_UNIT_OPTIONS: Unit[] = ['g', 'ml', 'szt', 'opak', 'L', 'kg'];
const INV_PRESET_CATEGORIES = [
  'Mięso', 'Warzywa', 'Przyprawy', 'Napoje/Alkohole',
  'Środki czystości', 'Przybory kuchenne', 'Nabiał', 'Pieczywo', 'Inne',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePosId(category: string, total: number): string {
  const prefix: Record<string, string> = { Burgery: 'BRG', 'Dania główne': 'DAN', Sałatki: 'SAL', Makarony: 'MAK', Zupy: 'ZUP' };
  return `${prefix[category] ?? 'DAN'}-${String(total).padStart(3, '0')}`;
}

function newDraftIngredient(): IngredientDraft {
  return { key: String(Date.now() + Math.random()), name: '', quantity: '', unit: 'g' };
}

function mapDbToDish(row: any): Dish {
  const ingredients = (row.recipe_ingredients ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price_pln: Number(row.price_pln),
    pos_id: row.pos_id ?? '',
    recipe: ingredients.map((i: any) => ({
      name: i.ingredient_name,
      quantity: Number(i.quantity),
      unit: i.unit,
    })),
  };
}

function mapInvDbRow(row: any): InventoryItem {
  return {
    id: row.id,
    product_name: row.name,
    category: row.inventory_categories?.name ?? 'Inne',
    current_qty: Number(row.quantity),
    critical_threshold: Number(row.min_quantity),
    unit: row.unit as Unit,
    is_combo_półprodukt: row.is_combo_polprodukt ?? false,
    portion_size: row.portion_size != null ? Number(row.portion_size) : null,
  };
}

// ─── DishCard ─────────────────────────────────────────────────────────────────

function DishCard({
  dish,
  onEdit,
  onDelete,
}: {
  dish: Dish;
  onEdit: (dish: Dish) => void;
  onDelete: (dish: Dish) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const catColor = CATEGORY_COLORS[dish.category] ?? Colors.textSecondary;

  const toggle = () => {
    const toValue = expanded ? 0 : 1;
    Animated.spring(anim, { toValue, useNativeDriver: true, tension: 60, friction: 9 }).start();
    setExpanded(!expanded);
  };

  const rotateIcon = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={dishStyles.container}>
      <TouchableOpacity style={dishStyles.header} onPress={toggle} activeOpacity={0.7}>
        <View style={[dishStyles.catDot, { backgroundColor: catColor }]} />
        <View style={dishStyles.headerText}>
          <Text style={dishStyles.name}>{dish.name}</Text>
          <View style={dishStyles.meta}>
            <Text style={[dishStyles.category, { color: catColor }]}>{dish.category}</Text>
            {!!dish.pos_id && (
              <>
                <Text style={dishStyles.sep}>·</Text>
                <Text style={dishStyles.posId}>POS: {dish.pos_id}</Text>
              </>
            )}
          </View>
        </View>
        <View style={dishStyles.right}>
          <Text style={dishStyles.price}>{formatPln(dish.price_pln)}</Text>
          <Animated.View style={{ transform: [{ rotate: rotateIcon }] }}>
            <ChevronDown size={16} color={Colors.textSecondary} strokeWidth={2} />
          </Animated.View>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={dishStyles.body}>
          <Text style={dishStyles.recipeLabel}>Receptura — skład porcji</Text>
          {dish.recipe.length === 0 ? (
            <Text style={dishStyles.noRecipe}>Brak zdefiniowanych składników</Text>
          ) : (
            dish.recipe.map((ing, idx) => (
              <View key={idx} style={[dishStyles.ingRow, idx === dish.recipe.length - 1 && dishStyles.ingRowLast]}>
                <View style={dishStyles.bullet} />
                <Text style={dishStyles.ingName}>{ing.name}</Text>
                <Text style={dishStyles.ingQty}>
                  {ing.quantity % 1 === 0 ? ing.quantity.toFixed(0) : ing.quantity.toFixed(1)} {ing.unit}
                </Text>
              </View>
            ))
          )}
          <View style={dishStyles.costRow}>
            <Text style={dishStyles.costLabel}>Składniki: {dish.recipe.length} pozycji</Text>
            <View style={[dishStyles.priceBadge, { backgroundColor: Colors.accentLight }]}>
              <Text style={[dishStyles.priceBadgeText, { color: Colors.accent }]}>{formatPln(dish.price_pln)}</Text>
            </View>
          </View>

          {/* Action row */}
          <View style={dishStyles.actionRow}>
            <TouchableOpacity style={dishStyles.editBtn} onPress={() => onEdit(dish)} activeOpacity={0.8}>
              <Edit size={14} color={Colors.accent} strokeWidth={2} />
              <Text style={dishStyles.editBtnText}>Edytuj</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dishStyles.deleteBtn} onPress={() => onDelete(dish)} activeOpacity={0.8}>
              <Trash2 size={14} color={Colors.danger} strokeWidth={2} />
              <Text style={dishStyles.deleteBtnText}>Usuń</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const dishStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  headerText: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  category: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  sep: { fontSize: 11, color: Colors.textTertiary },
  posId: { fontSize: 11, color: Colors.textTertiary },
  right: { alignItems: 'flex-end', gap: 4 },
  price: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  body: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 10,
  },
  recipeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  noRecipe: { fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic', paddingVertical: 8 },
  ingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 10,
  },
  ingRowLast: { borderBottomWidth: 0 },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.accent },
  ingName: { flex: 1, fontSize: 13, color: Colors.textPrimary },
  ingQty: { fontSize: 13, fontWeight: '600', color: Colors.accent },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 12,
  },
  costLabel: { fontSize: 11, color: Colors.textSecondary },
  priceBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  priceBadgeText: { fontSize: 12, fontWeight: '700' },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: 12,
  },
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  editBtnText: { fontSize: 13, fontWeight: '600', color: Colors.accent },
  deleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: Colors.dangerLight,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  deleteBtnText: { fontSize: 13, fontWeight: '600', color: Colors.danger },
});

// ─── IngredientStockBadge ─────────────────────────────────────────────────

interface StockStatus {
  found: boolean;
  qty: number;
  unit: string;
}

function IngredientStockBadge({ status }: { status: StockStatus | null }) {
  const [showTip, setShowTip] = useState(false);
  if (!status) return <View style={ingStyles.statusPlaceholder} />;

  const label = status.found
    ? `Na stanie: ${status.qty % 1 === 0 ? status.qty.toFixed(0) : status.qty.toFixed(2)} ${status.unit}`
    : 'Brak produktu w magazynie';

  return (
    <View style={ingStyles.statusWrap}>
      <Pressable
        onPress={() => setShowTip((s) => !s)}
        onHoverIn={() => setShowTip(true)}
        onHoverOut={() => setShowTip(false)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[ingStyles.statusIcon, status.found ? ingStyles.statusOk : ingStyles.statusBad]}
        testID={`ingredient-status-${status.found ? 'ok' : 'missing'}`}
      >
        {status.found ? (
          <Check size={13} color={Colors.white} strokeWidth={3} />
        ) : (
          <X size={13} color={Colors.white} strokeWidth={3} />
        )}
      </Pressable>
      {showTip && (
        <View style={ingStyles.tooltip} testID="ingredient-status-tooltip">
          <Text style={ingStyles.tooltipText}>{label}</Text>
        </View>
      )}
    </View>
  );
}

// ─── IngredientRow ────────────────────────────────────────────────────────

function IngredientRow({
  draft,
  index,
  suggestions,
  stock,
  onChange,
  onRemove,
  onSelectSuggestion,
}: {
  draft: IngredientDraft;
  index: number;
  suggestions: string[];
  stock: StockStatus | null;
  onChange: (key: string, field: keyof IngredientDraft, value: string) => void;
  onRemove: (key: string) => void;
  onSelectSuggestion: (key: string, name: string) => void;
}) {
  const showSuggestions = draft.name.length >= 2 && suggestions.length > 0;

  return (
    <View style={ingStyles.outerWrap}>
      <View style={ingStyles.wrap}>
        <View style={ingStyles.indexWrap}>
          <Text style={ingStyles.index}>{index + 1}</Text>
        </View>
        <View style={ingStyles.fields}>
          <View>
            <View style={ingStyles.nameRow}>
              <TextInput
                style={[ingStyles.input, ingStyles.nameInput]}
                placeholder="Nazwa składnika"
                placeholderTextColor={Colors.textTertiary}
                value={draft.name}
                onChangeText={(v) => onChange(draft.key, 'name', v)}
                returnKeyType="next"
                autoCorrect={false}
              />
              <IngredientStockBadge status={stock} />
            </View>
            {showSuggestions && (
              <View style={ingStyles.suggestionsBox}>
                {suggestions.slice(0, 5).map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={ingStyles.suggestionRow}
                    onPress={() => onSelectSuggestion(draft.key, s)}
                    activeOpacity={0.7}
                  >
                    <Check size={11} color={Colors.success} strokeWidth={3} />
                    <Text style={ingStyles.suggestionText}>{s}</Text>
                    <Text style={ingStyles.suggestionHint}>w magazynie</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          <View style={ingStyles.qtyRow}>
            <TextInput
              style={[ingStyles.input, ingStyles.qtyInput]}
              placeholder="Ilość"
              placeholderTextColor={Colors.textTertiary}
              value={draft.quantity}
              onChangeText={(v) => onChange(draft.key, 'quantity', v)}
              keyboardType="decimal-pad"
              returnKeyType="done"
            />
            <View style={ingStyles.unitWrap}>
              {UNIT_OPTIONS.map((u) => {
                const active = draft.unit === u;
                return (
                  <TouchableOpacity
                    key={u}
                    style={[ingStyles.unitBtn, active && ingStyles.unitBtnActive]}
                    onPress={() => onChange(draft.key, 'unit', u)}
                    activeOpacity={0.7}
                  >
                    <Text style={[ingStyles.unitText, active && ingStyles.unitTextActive]}>{u}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
        <TouchableOpacity
          style={ingStyles.removeBtn}
          onPress={() => onRemove(draft.key)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Trash2 size={15} color={Colors.danger} strokeWidth={2} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const ingStyles = StyleSheet.create({
  outerWrap: { marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  indexWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  index: { fontSize: 10, fontWeight: '700', color: Colors.accent },
  fields: { flex: 1, gap: 6 },
  nameInput: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusPlaceholder: { width: 26, height: 26 },
  statusWrap: { position: 'relative' },
  statusIcon: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
  },
  statusOk: { backgroundColor: Colors.success },
  statusBad: { backgroundColor: Colors.danger },
  tooltip: {
    position: 'absolute', top: 32, right: 0, backgroundColor: Colors.textPrimary,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, minWidth: 150, zIndex: 50,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 6,
  },
  tooltipText: { fontSize: 12, color: Colors.white, fontWeight: '600' },
  qtyRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  qtyInput: { width: 72 },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  unitWrap: { flex: 1, flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  unitBtn: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  unitBtnActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  unitText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  unitTextActive: { color: Colors.white },
  removeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  suggestionsBox: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 8,
    marginTop: 3,
    overflow: 'hidden',
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 6,
  },
  suggestionText: { flex: 1, fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  suggestionHint: { fontSize: 11, color: Colors.success, fontWeight: '600' },
});

// ─── Blank forms ──────────────────────────────────────────────────────────────

const BLANK_DISH_FORM = { name: '', category: FORM_CATEGORIES[0], price: '' };

const BLANK_INV_FORM = {
  name: '',
  category: INV_PRESET_CATEGORIES[0],
  currentQty: '',
  criticalThreshold: '',
  unit: 'g' as Unit,
  isCombo: false,
  portionSize: '',
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MenuScreen() {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [utensils, setUtensils] = useState<KitchenUtensil[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('Wszystkie');
  const [showAddModal, setShowAddModal] = useState(false);

  // Edit mode
  const [editingDish, setEditingDish] = useState<Dish | null>(null);

  // Main dish form
  const [form, setForm] = useState(BLANK_DISH_FORM);
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([newDraftIngredient()]);

  // Quick-add inventory sub-modal
  const [showInvModal, setShowInvModal] = useState(false);
  const [pendingIngKey, setPendingIngKey] = useState<string | null>(null);
  const [invForm, setInvForm] = useState(BLANK_INV_FORM);
  const [invSaving, setInvSaving] = useState(false);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [dishesRes, utensilsRes, invRes, catsRes] = await Promise.all([
        supabase
          .from('menu_items')
          .select('id, name, category, price_pln, pos_id, recipe_ingredients(id, ingredient_name, quantity, unit, sort_order)')
          .eq('is_active', true)
          .order('category')
          .order('name'),
        supabase
          .from('kitchen_utensils')
          .select('id, name, utensil_type, capacity_value, capacity_unit')
          .order('name'),
        supabase
          .from('inventory_items')
          .select('id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)')
          .order('name'),
        supabase
          .from('inventory_categories')
          .select('id, name')
          .order('sort_order'),
      ]);

      if (dishesRes.error) throw dishesRes.error;
      if (utensilsRes.error) throw utensilsRes.error;
      if (invRes.error) throw invRes.error;
      if (catsRes.error) throw catsRes.error;

      setDishes((dishesRes.data ?? []).map(mapDbToDish));
      setUtensils(utensilsRes.data ?? []);
      setInventory((invRes.data ?? []).map(mapInvDbRow));

      const map: Record<string, string> = {};
      (catsRes.data ?? []).forEach((c: any) => { map[c.name] = c.id; });
      setCategoryMap(map);

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

  // ── Derived / filtered data ───────────────────────────────────────────────

  const allCategories = useMemo(() => {
    const seen = new Set<string>();
    dishes.forEach((d) => seen.add(d.category));
    return ['Wszystkie', ...Array.from(seen)];
  }, [dishes]);

  const filtered = useMemo(() => {
    let list = dishes;
    if (selectedCat !== 'Wszystkie') list = list.filter((d) => d.category === selectedCat);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(q));
    }
    return list;
  }, [dishes, search, selectedCat]);

  const grouped = useMemo(() => {
    const map: Record<string, Dish[]> = {};
    filtered.forEach((d) => {
      if (!map[d.category]) map[d.category] = [];
      map[d.category].push(d);
    });
    return map;
  }, [filtered]);

  // ── Ingredient autocomplete ───────────────────────────────────────────────

  function getSuggestions(draftName: string): string[] {
    if (draftName.trim().length < 2) return [];
    const q = draftName.trim().toLowerCase();
    return inventory
      .filter((i) => i.product_name.toLowerCase().includes(q))
      .map((i) => i.product_name)
      .slice(0, 6);
  }

  // Status składnika względem magazynu (zielony ptaszek / czerwony X + dymek)
  function getStockStatus(name: string): StockStatus | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const match = inventory.find((i) => i.product_name.toLowerCase() === trimmed.toLowerCase());
    if (match) return { found: true, qty: match.current_qty, unit: match.unit };
    return { found: false, qty: 0, unit: '' };
  }

  // ── Ingredient form helpers ───────────────────────────────────────────────

  function handleIngredientChange(key: string, field: keyof IngredientDraft, value: string) {
    setIngredients((prev) => prev.map((ing) => (ing.key === key ? { ...ing, [field]: value } : ing)));
  }

  function handleIngredientRemove(key: string) {
    setIngredients((prev) => (prev.length === 1 ? prev : prev.filter((ing) => ing.key !== key)));
  }

  function handleSelectSuggestion(key: string, name: string) {
    setIngredients((prev) => prev.map((ing) => (ing.key === key ? { ...ing, name } : ing)));
  }

  // ── Open / close modals ───────────────────────────────────────────────────

  function handleOpenAdd() {
    setEditingDish(null);
    setForm(BLANK_DISH_FORM);
    setIngredients([newDraftIngredient()]);
    setShowAddModal(true);
  }

  function handleOpenEdit(dish: Dish) {
    setEditingDish(dish);
    setForm({ name: dish.name, category: dish.category, price: String(dish.price_pln) });
    setIngredients(
      dish.recipe.length > 0
        ? dish.recipe.map((r) => ({
            key: String(Date.now() + Math.random()),
            name: r.name,
            quantity: String(r.quantity),
            unit: r.unit,
          }))
        : [newDraftIngredient()]
    );
    setShowAddModal(true);
  }

  function handleCloseAddModal() {
    setForm(BLANK_DISH_FORM);
    setIngredients([newDraftIngredient()]);
    setEditingDish(null);
    setShowAddModal(false);
  }

  // ── Delete dish ───────────────────────────────────────────────────────────

  function handleDeleteDish(dish: Dish) {
    Alert.alert(
      'Usuń danie',
      `Czy na pewno chcesz usunąć "${dish.name}" z menu?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('recipe_ingredients').delete().eq('menu_item_id', dish.id);
              const { error: delError } = await supabase
                .from('menu_items')
                .delete()
                .eq('id', dish.id);
              if (delError) throw delError;
              setDishes((prev) => prev.filter((d) => d.id !== dish.id));
            } catch (e: any) {
              Alert.alert('Błąd', e.message ?? 'Nie udało się usunąć dania.');
            }
          },
        },
      ]
    );
  }

  // ── Save / update dish ────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) { Alert.alert('Wymagane pole', 'Podaj nazwę dania.'); return; }
    const price = parseFloat(form.price);
    if (isNaN(price) || price <= 0) { Alert.alert('Błąd', 'Cena sprzedaży musi być liczbą większą od zera.'); return; }

    // Uwaga: zapis jest możliwy nawet gdy składnik nie znajduje się w magazynie.
    // Status magazynowy (zielony ptaszek / czerwony X) jest tylko informacyjny.

    setSaving(true);
    try {
      const validIngredients = ingredients.filter((i) => i.name.trim());

      if (editingDish) {
        // ── Update existing dish ──
        const { error: updateError } = await supabase
          .from('menu_items')
          .update({ name: form.name.trim(), category: form.category, price_pln: price })
          .eq('id', editingDish.id);
        if (updateError) throw updateError;

        // Replace recipe ingredients
        await supabase.from('recipe_ingredients').delete().eq('menu_item_id', editingDish.id);
        if (validIngredients.length > 0) {
          const { error: ingError } = await supabase.from('recipe_ingredients').insert(
            validIngredients.map((ing, idx) => ({
              menu_item_id: editingDish.id,
              ingredient_name: ing.name.trim(),
              quantity: parseFloat(ing.quantity) || 0,
              unit: ing.unit,
              sort_order: idx + 1,
            }))
          );
          if (ingError) throw ingError;
        }

        const updatedDish: Dish = {
          ...editingDish,
          name: form.name.trim(),
          category: form.category,
          price_pln: price,
          recipe: validIngredients.map((ing) => ({
            name: ing.name.trim(),
            quantity: parseFloat(ing.quantity) || 0,
            unit: ing.unit,
          })),
        };
        setDishes((prev) => prev.map((d) => (d.id === editingDish.id ? updatedDish : d)));
        setSelectedCat(form.category);
        handleCloseAddModal();
      } else {
        // ── Insert new dish ──
        const posId = makePosId(form.category, dishes.length + 1);

        const { data: newItem, error: itemError } = await supabase
          .from('menu_items')
          .insert({ name: form.name.trim(), category: form.category, price_pln: price, pos_id: posId, is_active: true })
          .select('id')
          .single();
        if (itemError) throw itemError;

        if (validIngredients.length > 0) {
          const { error: ingError } = await supabase.from('recipe_ingredients').insert(
            validIngredients.map((ing, idx) => ({
              menu_item_id: newItem.id,
              ingredient_name: ing.name.trim(),
              quantity: parseFloat(ing.quantity) || 0,
              unit: ing.unit,
              sort_order: idx + 1,
            }))
          );
          if (ingError) throw ingError;
        }

        const newDish: Dish = {
          id: newItem.id,
          name: form.name.trim(),
          category: form.category,
          price_pln: price,
          pos_id: posId,
          recipe: validIngredients.map((ing) => ({
            name: ing.name.trim(),
            quantity: parseFloat(ing.quantity) || 0,
            unit: ing.unit,
          })),
        };
        setDishes((prev) => [...prev, newDish]);
        setSelectedCat(form.category);
        handleCloseAddModal();
      }
    } catch (e: any) {
      Alert.alert('Błąd zapisu', e.message ?? 'Nieznany błąd');
    } finally {
      setSaving(false);
    }
  }

  // ── Quick-add inventory item ───────────────────────────────────────────────

  async function handleSaveInventoryItem() {
    if (!invForm.name.trim()) { Alert.alert('Wymagane pole', 'Podaj nazwę produktu.'); return; }
    const currentQty = parseFloat(invForm.currentQty);
    const criticalThreshold = parseFloat(invForm.criticalThreshold);
    if (isNaN(currentQty) || currentQty < 0) { Alert.alert('Błąd', 'Aktualna ilość musi być liczbą nieujemną.'); return; }
    if (isNaN(criticalThreshold) || criticalThreshold <= 0) { Alert.alert('Błąd', 'Stan krytyczny musi być liczbą większą od zera.'); return; }

    setInvSaving(true);
    try {
      const { data: newRow, error: insertError } = await supabase
        .from('inventory_items')
        .insert({
          name: invForm.name.trim(),
          category_id: categoryMap[invForm.category] ?? null,
          quantity: currentQty,
          unit: invForm.unit,
          min_quantity: criticalThreshold,
          portion_size: invForm.portionSize.trim() ? (parseFloat(invForm.portionSize) || null) : null,
          is_combo_polprodukt: invForm.isCombo,
          unit_cost: 0,
        })
        .select('id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)')
        .single();

      if (insertError) throw insertError;

      const newInvItem = mapInvDbRow(newRow);
      setInventory((prev) => [...prev, newInvItem]);

      // Auto-fill the ingredient row that triggered this flow
      if (pendingIngKey) {
        setIngredients((prev) =>
          prev.map((ing) =>
            ing.key === pendingIngKey ? { ...ing, name: newInvItem.product_name } : ing
          )
        );
      }

      setInvForm(BLANK_INV_FORM);
      setPendingIngKey(null);
      setShowInvModal(false);
    } catch (e: any) {
      Alert.alert('Błąd zapisu', e.message ?? 'Nieznany błąd');
    } finally {
      setInvSaving(false);
    }
  }

  function handleCloseInvModal() {
    setInvForm(BLANK_INV_FORM);
    setPendingIngKey(null);
    setShowInvModal(false);
  }

  const [showScanModal, setShowScanModal] = useState(false);

  const handleMic = () => Alert.alert('Kreator Receptur AI — Głos', 'Funkcja rejestracji głosowej jest w trakcie implementacji.', [{ text: 'Rozumiem' }]);
  const handleScanMenu = () => setShowScanModal(true);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  const isEditing = editingDish !== null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Menu & Receptury</Text>
            <Text style={styles.subtitle}>{dishes.length} aktywnych dań · {utensils.length} narzędzi</Text>
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={handleOpenAdd} activeOpacity={0.8}>
            <Plus size={14} color={Colors.accent} strokeWidth={2.5} />
            <Text style={styles.addBtnText}>Dodaj Danie</Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginBottom: 14 }}>
          <ReportInfoButton contextHint="Menu" onApplied={fetchData} testID="menu-report-info" />
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <View style={styles.searchIcon}>
            <Search size={16} color={Colors.textTertiary} strokeWidth={2} />
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Szukaj dania..."
            placeholderTextColor={Colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
              <X size={14} color={Colors.textTertiary} strokeWidth={2.5} />
            </TouchableOpacity>
          )}
        </View>

        {/* Category pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catBar}>
          {allCategories.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.catPill, selectedCat === cat && styles.catPillActive]}
              onPress={() => setSelectedCat(cat)}
              activeOpacity={0.7}
            >
              {cat !== 'Wszystkie' && (
                <View
                  style={[
                    styles.catDot,
                    { backgroundColor: selectedCat === cat ? Colors.white : (CATEGORY_COLORS[cat] ?? Colors.textSecondary) },
                  ]}
                />
              )}
              <Text style={[styles.catPillText, selectedCat === cat && styles.catPillTextActive]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Stats strip */}
        <View style={styles.statsStrip}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{filtered.length}</Text>
            <Text style={styles.statLabel}>dań</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{Object.keys(grouped).length}</Text>
            <Text style={styles.statLabel}>kategorii</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{filtered.reduce((s, d) => s + d.recipe.length, 0)}</Text>
            <Text style={styles.statLabel}>składników</Text>
          </View>
        </View>

        {/* Dish list grouped by category */}
        {Object.entries(grouped).map(([category, items]) => (
          <View key={category} style={styles.categorySection}>
            <View style={styles.categoryHeaderRow}>
              <View style={[styles.categoryHeaderDot, { backgroundColor: CATEGORY_COLORS[category] ?? Colors.textSecondary }]} />
              <Text style={styles.categoryHeader}>{category}</Text>
              <Text style={styles.categoryCount}>{items.length}</Text>
            </View>
            {items.map((dish) => (
              <DishCard key={dish.id} dish={dish} onEdit={handleOpenEdit} onDelete={handleDeleteDish} />
            ))}
          </View>
        ))}

        {filtered.length === 0 && (
          <View style={styles.empty}>
            <UtensilsCrossed size={32} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Brak dań pasujących do filtrów</Text>
            <Text style={styles.emptySub}>Zmień kategorię lub wyszukiwaną frazę</Text>
          </View>
        )}

        {/* Kitchen Utensils */}
        <View style={styles.sectionHeaderRow}>
          <Ruler size={16} color={Colors.textSecondary} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Definicje Naczyń Kuchennych</Text>
            <Text style={styles.sectionSubtitle}>Standardowe pojemności i porcje</Text>
          </View>
        </View>

        {utensils.length > 0 && (
          <View style={styles.utensilsCard}>
            <View style={styles.zeroWasteBanner}>
              <Leaf size={14} color="#16A34A" strokeWidth={2} />
              <Text style={styles.zeroWasteText}>
                Zasada Zero Waste: Używaj wskazanych naczyń, aby zachować idealne proporcje i eliminować straty.
              </Text>
            </View>
            {utensils.map((u, idx) => (
              <View key={u.id} style={[styles.utensilRow, idx === utensils.length - 1 && styles.utensilRowLast]}>
                <View style={[styles.utensilIcon, { backgroundColor: Colors.accentLight }]}>
                  <Ruler size={16} color={Colors.accent} strokeWidth={2} />
                </View>
                <View style={styles.utensilInfo}>
                  <Text style={styles.utensilName}>{u.name}</Text>
                  <Text style={[styles.utensilType, { color: Colors.accent }]}>{u.utensil_type}</Text>
                </View>
                {u.capacity_value != null && (
                  <View style={styles.utensilCap}>
                    <Text style={styles.utensilCapValue}>{u.capacity_value}</Text>
                    <Text style={styles.utensilCapUnit}>{u.capacity_unit}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* AI Creator */}
        <View style={styles.aiSection}>
          <View style={styles.aiHeader}>
            <ChefHat size={20} color={Colors.accent} strokeWidth={2} />
            <Text style={styles.aiTitle}>Kreator Receptur AI</Text>
          </View>
          <Text style={styles.aiSub}>Wgraj menu (PDF lub zdjęcie) — AI odczyta potrawy, ceny i składniki. Możesz też rejestrować dania głosowo.</Text>
          <View style={styles.aiButtons}>
            <TouchableOpacity style={[styles.aiBtn, { backgroundColor: Colors.success }]} onPress={handleScanMenu} activeOpacity={0.85} testID="menu-scan-open">
              <Camera size={18} color={Colors.white} strokeWidth={2} />
              <Text style={styles.aiBtnText}>Skanuj menu</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.aiBtn, { backgroundColor: Colors.accent }]} onPress={handleMic} activeOpacity={0.85}>
              <Mic size={18} color={Colors.white} strokeWidth={2} />
              <Text style={styles.aiBtnText}>Rejestruj głosem</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Add / Edit Dish Modal ───────────────────────────────────────────── */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCloseAddModal}>
        <SafeAreaView style={styles.modalSafe} edges={['top']}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>{isEditing ? 'Edytuj Danie' : 'Nowe Danie'}</Text>
              <Text style={styles.modalSubtitle}>{isEditing ? `Zmiana: ${editingDish?.name}` : 'Uzupełnij dane i recepturę'}</Text>
            </View>
            <TouchableOpacity onPress={handleCloseAddModal} style={styles.closeBtn}>
              <X size={20} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.formScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.formSection}>Podstawowe dane</Text>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>
                  Nazwa dania <Text style={{ color: Colors.danger }}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="np. Burger Podwójny"
                  placeholderTextColor={Colors.textTertiary}
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  returnKeyType="next"
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>
                  Cena sprzedaży (PLN) <Text style={{ color: Colors.danger }}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="np. 36"
                  placeholderTextColor={Colors.textTertiary}
                  value={form.price}
                  onChangeText={(v) => setForm((f) => ({ ...f, price: v }))}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>
                  Kategoria <Text style={{ color: Colors.danger }}>*</Text>
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.formCatBar}>
                  {FORM_CATEGORIES.map((cat) => {
                    const active = form.category === cat;
                    const color = CATEGORY_COLORS[cat] ?? Colors.textSecondary;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.formCatPill, active && { backgroundColor: color, borderColor: color }]}
                        onPress={() => setForm((f) => ({ ...f, category: cat }))}
                        activeOpacity={0.7}
                      >
                        {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                        <View style={[styles.catDotSmall, { backgroundColor: active ? Colors.white : color }]} />
                        <Text style={[styles.formCatText, active && { color: Colors.white, fontWeight: '700' }]}>{cat}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <Text style={styles.formSection}>Receptura — składniki</Text>

              <View style={styles.invHintRow}>
                <Check size={12} color={Colors.success} strokeWidth={3} />
                <Text style={styles.invHintText}>
                  Podpowiedzi pobierane z magazynu ({inventory.length} produktów). Nieznane składniki będziesz mógł dodać na bieżąco.
                </Text>
              </View>

              {ingredients.map((ing, idx) => (
                <IngredientRow
                  key={ing.key}
                  draft={ing}
                  index={idx}
                  suggestions={getSuggestions(ing.name)}
                  stock={getStockStatus(ing.name)}
                  onChange={handleIngredientChange}
                  onRemove={handleIngredientRemove}
                  onSelectSuggestion={handleSelectSuggestion}
                />
              ))}

              <TouchableOpacity
                style={styles.addIngBtn}
                onPress={() => setIngredients((prev) => [...prev, newDraftIngredient()])}
                activeOpacity={0.8}
              >
                <Plus size={15} color={Colors.accent} strokeWidth={2.5} />
                <Text style={styles.addIngBtnText}>Dodaj składnik</Text>
              </TouchableOpacity>

              {form.name.trim() !== '' && form.price !== '' && (
                <View style={styles.previewCard}>
                  <Text style={styles.previewLabel}>Podgląd</Text>
                  <View style={styles.previewRow}>
                    <View style={[styles.catDotSmall, { backgroundColor: CATEGORY_COLORS[form.category] ?? Colors.textSecondary }]} />
                    <Text style={styles.previewName}>{form.name.trim()}</Text>
                    <Text style={styles.previewPrice}>{form.price} PLN</Text>
                  </View>
                  <Text style={styles.previewMeta}>
                    {form.category} · {ingredients.filter((i) => i.name.trim()).length} składnik(ów)
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, isEditing && styles.saveBtnEdit, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Check size={18} color={Colors.white} strokeWidth={2.5} />
                <Text style={styles.saveBtnText}>
                  {saving ? 'Zapisywanie...' : isEditing ? 'Aktualizuj Danie' : 'Zapisz Danie'}
                </Text>
              </TouchableOpacity>

              <View style={{ height: 32 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Quick-add Inventory Sub-Modal ──────────────────────────────────── */}
      <Modal visible={showInvModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCloseInvModal}>
        <SafeAreaView style={styles.modalSafe} edges={['top']}>
          <View style={[styles.modalHeader, styles.invModalHeader]}>
            <View style={styles.invModalTitleWrap}>
              <View style={styles.invModalBadge}>
                <FlaskConical size={13} color={Colors.white} strokeWidth={2.5} />
                <Text style={styles.invModalBadgeText}>Nowy produkt</Text>
              </View>
              <Text style={styles.modalTitle}>Dodaj do Magazynu</Text>
              <Text style={styles.modalSubtitle}>Produkt zostanie automatycznie dodany do receptury</Text>
            </View>
            <TouchableOpacity onPress={handleCloseInvModal} style={styles.closeBtn}>
              <X size={20} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.formScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>
                  Nazwa produktu <Text style={{ color: Colors.danger }}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="np. Kurczak filet"
                  placeholderTextColor={Colors.textTertiary}
                  value={invForm.name}
                  onChangeText={(v) => setInvForm((f) => ({ ...f, name: v }))}
                  returnKeyType="next"
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Kategoria</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.formCatBar}>
                  {INV_PRESET_CATEGORIES.map((cat) => {
                    const active = invForm.category === cat;
                    const color = INV_CATEGORY_COLORS[cat] ?? Colors.textSecondary;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.formCatPill, active && { backgroundColor: color, borderColor: color }]}
                        onPress={() => setInvForm((f) => ({ ...f, category: cat }))}
                        activeOpacity={0.7}
                      >
                        {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                        <Text style={[styles.formCatText, active && { color: Colors.white, fontWeight: '700' }]}>{cat}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.fieldRow}>
                <View style={[styles.fieldWrap, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>
                    Aktualna ilość <Text style={{ color: Colors.danger }}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="np. 1500"
                    placeholderTextColor={Colors.textTertiary}
                    value={invForm.currentQty}
                    onChangeText={(v) => setInvForm((f) => ({ ...f, currentQty: v }))}
                    keyboardType="decimal-pad"
                    returnKeyType="next"
                  />
                </View>
                <View style={[styles.fieldWrap, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>
                    Stan krytyczny <Text style={{ color: Colors.danger }}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="np. 500"
                    placeholderTextColor={Colors.textTertiary}
                    value={invForm.criticalThreshold}
                    onChangeText={(v) => setInvForm((f) => ({ ...f, criticalThreshold: v }))}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                </View>
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Jednostka</Text>
                <View style={styles.unitRow}>
                  {INV_UNIT_OPTIONS.map((u) => {
                    const active = invForm.unit === u;
                    return (
                      <TouchableOpacity
                        key={u}
                        style={[styles.unitBtn, active && styles.unitBtnActive]}
                        onPress={() => setInvForm((f) => ({ ...f, unit: u }))}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.unitBtnText, active && styles.unitBtnTextActive]}>{u}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Wielkość porcji w Menu ({invForm.unit})</Text>
                <TextInput
                  style={styles.input}
                  placeholder="np. 200 (opcjonalne)"
                  placeholderTextColor={Colors.textTertiary}
                  value={invForm.portionSize}
                  onChangeText={(v) => setInvForm((f) => ({ ...f, portionSize: v }))}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <FlaskConical size={16} color={Colors.accent} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchLabel}>Półprodukt / Combo</Text>
                    <Text style={styles.switchHint}>Produkt przygotowywany wewnętrznie z innych składników</Text>
                  </View>
                </View>
                <Switch
                  value={invForm.isCombo}
                  onValueChange={(v) => setInvForm((f) => ({ ...f, isCombo: v }))}
                  trackColor={{ false: Colors.borderLight, true: Colors.accentLight }}
                  thumbColor={invForm.isCombo ? Colors.accent : Colors.textTertiary}
                />
              </View>

              <TouchableOpacity
                style={[styles.saveBtn, invSaving && { opacity: 0.6 }]}
                onPress={handleSaveInventoryItem}
                disabled={invSaving}
                activeOpacity={0.85}
              >
                <Check size={18} color={Colors.white} strokeWidth={2.5} />
                <Text style={styles.saveBtnText}>{invSaving ? 'Zapisywanie...' : 'Zapisz i Dodaj do Receptury'}</Text>
              </TouchableOpacity>

              <View style={{ height: 32 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Menu Scan Modal ─────────────────────────────────────────────────── */}
      <MenuScanModal
        visible={showScanModal}
        onClose={() => setShowScanModal(false)}
        onConfirmed={() => { setShowScanModal(false); fetchData(); }}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingTop: 4,
  },
  title: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, fontWeight: '500' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.accentLight,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
  },
  addBtnText: { fontSize: 13, fontWeight: '600', color: Colors.accent },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    marginBottom: 12,
    height: 44,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.textPrimary, paddingVertical: 0 },
  clearBtn: { padding: 4, marginLeft: 4 },

  catBar: { flexDirection: 'row', gap: 8, paddingBottom: 12 },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  catPillActive: { backgroundColor: Colors.textPrimary, borderColor: Colors.textPrimary },
  catDot: { width: 7, height: 7, borderRadius: 4 },
  catPillText: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  catPillTextActive: { color: Colors.white, fontWeight: '600' },

  statsStrip: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
    overflow: 'hidden',
  },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  statValue: { fontSize: 18, fontWeight: '800', color: Colors.textPrimary },
  statLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 1,
  },
  statDivider: { width: 1, backgroundColor: Colors.borderLight, marginVertical: 8 },

  categorySection: { marginBottom: 8 },
  categoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
    marginTop: 8,
  },
  categoryHeaderDot: { width: 8, height: 8, borderRadius: 4 },
  categoryHeader: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryCount: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    backgroundColor: Colors.borderLight,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },

  empty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  emptySub: { fontSize: 13, color: Colors.textTertiary },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginBottom: 2 },
  sectionSubtitle: { fontSize: 12, color: Colors.textSecondary },

  utensilsCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  zeroWasteBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.successLight,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#BBF7D0',
  },
  zeroWasteText: { flex: 1, fontSize: 12, color: '#166534', lineHeight: 17, fontWeight: '500' },
  utensilRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  utensilRowLast: { borderBottomWidth: 0 },
  utensilIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  utensilInfo: { flex: 1, gap: 2 },
  utensilName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  utensilType: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  utensilCap: { alignItems: 'flex-end' },
  utensilCapValue: { fontSize: 18, fontWeight: '800', color: Colors.textPrimary },
  utensilCapUnit: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },

  aiSection: {
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  aiTitle: { fontSize: 16, fontWeight: '700', color: Colors.accent },
  aiSub: { fontSize: 13, color: Colors.textSecondary, marginBottom: 16, lineHeight: 18 },
  aiButtons: { flexDirection: 'row', gap: 10 },
  aiBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
  },
  aiBtnText: { fontSize: 13, fontWeight: '700', color: Colors.white },

  modalSafe: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  invModalHeader: { alignItems: 'flex-start' },
  invModalTitleWrap: { flex: 1, gap: 4 },
  invModalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  invModalBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.white, textTransform: 'uppercase', letterSpacing: 0.3 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  modalSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  formScroll: { padding: 20 },
  formSection: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginTop: 20,
  },
  fieldWrap: { marginBottom: 14 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.textPrimary,
  },

  formCatBar: { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  formCatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  formCatText: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  catDotSmall: { width: 7, height: 7, borderRadius: 4 },

  invHintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    backgroundColor: Colors.successLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  invHintText: { flex: 1, fontSize: 12, color: '#166534', lineHeight: 17, fontWeight: '500' },

  addIngBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    borderStyle: 'dashed',
    backgroundColor: Colors.accentLight,
    marginBottom: 16,
  },
  addIngBtnText: { fontSize: 14, fontWeight: '600', color: Colors.accent },

  previewCard: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
    gap: 4,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewName: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  previewPrice: { fontSize: 15, fontWeight: '800', color: Colors.accent },
  previewMeta: { fontSize: 12, color: Colors.textSecondary },

  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    paddingVertical: 15,
    borderRadius: 12,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 5,
  },
  saveBtnEdit: {
    backgroundColor: Colors.success,
    shadowColor: Colors.success,
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: Colors.white },

  unitRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  unitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    alignItems: 'center',
    minWidth: 48,
  },
  unitBtnActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  unitBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  unitBtnTextActive: { color: Colors.white },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  switchInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  switchLabel: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  switchHint: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, lineHeight: 15 },
});