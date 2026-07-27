import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
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
import { LinearGradient } from 'expo-linear-gradient';
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
  PenLine,
  ChevronRight,
  Tag,
  ShoppingCart,
  FileUp,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { supabase } from '@/lib/supabase';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { VoiceReportModal } from '@/components/VoiceReportModal';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { WasteReportModal } from '@/components/WasteReportModal';
import { DealHunterModal } from '@/components/DealHunterModal';
import { AdBannerFooter } from '@/components/ads/AdBannerFooter';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { PremiumTabChrome, premiumSurface } from '@/components/premium/PremiumTabChrome';
import {
  PremiumBadge,
  PremiumGlowCta,
  PremiumOutlineBtn,
} from '@/components/premium/PremiumUI';
import { DS } from '@/constants/premiumTheme';
import { imageSourceForProduct } from '@/lib/productImages';
import { namesMatch } from '@/lib/fuzzyProductMatch';
import {
  dedupeWarehouseCategories,
  ensureDefaultWarehouseCategories,
  normCategoryName,
} from '@/lib/warehouseCategories';
import { ensureDefaultKitchenUtensils } from '@/lib/kitchenUtensils';
import { KitchenUtensilsSection } from '@/components/KitchenUtensilsSection';
import { useAuth } from '@/contexts/AuthContext';
import { usePremiumAlert } from '@/components/PremiumAlert';

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
  category_id: string | null;
  current_qty: number;
  critical_threshold: number;
  /** Docelowy zapas — Łowca dobija do tej wartości (±10%). 0 = wylicz z progu krytycznego + bufor. */
  optimal_threshold: number;
  unit: Unit;
  is_combo_półprodukt: boolean;
  portion_size: number | null;
  supplier?: string;
  safety_buffer_percent: number; // min 10, default 20
  shelf_life_days?: number | null;
}

type ComboIngredientDraft = {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  warehouse_product_id: string | null;
};

const COMBO_UNIT_OPTIONS = ['g', 'ml', 'szt', 'kg', 'L'] as const;

function newComboIngredient(): ComboIngredientDraft {
  return {
    key: `combo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    quantity: '',
    unit: 'g',
    warehouse_product_id: null,
  };
}

type MagListRow =
  | { type: 'search_meta'; count: number; q: string }
  | { type: 'search_empty'; q: string }
  | { type: 'search_item'; item: MockInventoryItem }
  | { type: 'cat_toolbar' }
  | { type: 'mag_empty' }
  | { type: 'cat_section'; cat: CategoryRow; items: MockInventoryItem[] }
  | { type: 'uncat_section'; items: MockInventoryItem[] };

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
    category_id: row.category_id ?? null,
    current_qty: Number(row.quantity),
    critical_threshold: Number(row.min_quantity),
    optimal_threshold: row.optimal_quantity != null ? Number(row.optimal_quantity) : 0,
    unit: row.unit as Unit,
    is_combo_półprodukt: row.is_combo_polprodukt ?? false,
    portion_size: row.portion_size != null ? Number(row.portion_size) : null,
    supplier: row.suppliers?.name ?? undefined,
    safety_buffer_percent: Number(row.safety_buffer_percent ?? 20),
    shelf_life_days: row.shelf_life_days != null ? Number(row.shelf_life_days) : null,
  };
}

// ─── ItemCard ─────────────────────────────────────────────────────────────────────────────

function ItemCard({ item, catColor, onDelete, onPress, onOrder, onEdit }: { item: MockInventoryItem; catColor: string; onDelete?: () => void; onPress?: () => void; onOrder?: () => void; onEdit?: () => void }) {
  const theme = useAppTheme();
  const status = getStatus(item);
  const ratio = item.current_qty / Math.max(item.critical_threshold, 0.001);
  const fillPercent = Math.min(100, Math.round(ratio * 100));
  const thumbSrc = useMemo(() => imageSourceForProduct(item.product_name), [item.product_name]);

  if (theme.isPremium) {
    const edge =
      status === 'critical'
        ? DS.color.danger
        : status === 'warning'
          ? DS.color.warning
          : DS.color.greenEnd;
    const qtyColor =
      status === 'critical' ? DS.color.danger : status === 'warning' ? DS.color.warning : DS.color.heading;
    return (
      <TouchableOpacity
        activeOpacity={onPress ? 0.8 : 1}
        onPress={onPress}
        onLongPress={onEdit}
        style={[itemStyles.premCard, status === 'critical' && DS.shadow.redGlow]}
      >
        <View style={[itemStyles.premEdge, { backgroundColor: edge }]} />
        <View style={itemStyles.premBody}>
          <View style={itemStyles.premTop}>
            <Image
              source={thumbSrc}
              style={itemStyles.premThumb}
              contentFit="contain"
              cachePolicy="disk"
              transition={200}
              recyclingKey={item.id}
            />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={itemStyles.premName} numberOfLines={1} allowFontScaling={false}>
                  {item.product_name}
                </Text>
                <PremiumBadge
                  label={status === 'critical' ? 'Krytyczny' : status === 'warning' ? 'Niski' : 'OK'}
                  tone={status === 'critical' ? 'critical' : status === 'warning' ? 'warn' : 'ok'}
                />
              </View>
              <View style={itemStyles.qtyRow}>
                <Text style={[itemStyles.premQty, { color: qtyColor }]} allowFontScaling={false}>
                  {formatQty(item.current_qty, item.unit)}
                </Text>
                <Text style={itemStyles.premMin} allowFontScaling={false}>
                  {' '}akt.
                  {item.optimal_threshold > 0
                    ? ` · opt ${formatQty(item.optimal_threshold, item.unit)}`
                    : ''}
                  {' · kryt '}
                  {formatQty(item.critical_threshold, item.unit)}
                </Text>
              </View>
              <View style={itemStyles.premProgressBg}>
                <View style={[itemStyles.premProgressFill, { width: `${fillPercent}%` as any, backgroundColor: edge }]} />
              </View>
            </View>
            {onEdit ? (
              <TouchableOpacity onPress={onEdit} hitSlop={10} style={{ padding: 4 }} testID={`edit-inv-${item.id}`}>
                <PenLine size={14} color={DS.color.greenEnd} strokeWidth={2.4} />
              </TouchableOpacity>
            ) : null}
            {onOrder ? (
              <TouchableOpacity
                onPress={onOrder}
                activeOpacity={0.85}
                style={[itemStyles.premOrderFabWrap, DS.shadow.greenGlow]}
                hitSlop={8}
              >
                <LinearGradient
                  colors={status === 'critical' || status === 'warning' ? [...DS.gradient.red] : [...DS.gradient.green]}
                  start={{ x: 0, y: 0.2 }}
                  end={{ x: 1, y: 0.8 }}
                  style={itemStyles.premOrderFab}
                >
                  <Plus size={18} color="#0A0A0A" strokeWidth={2.5} />
                </LinearGradient>
              </TouchableOpacity>
            ) : onDelete ? (
              <TouchableOpacity onPress={onDelete} hitSlop={10} style={{ padding: 4 }}>
                <X size={14} color={DS.color.muted} strokeWidth={2} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

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
          <Image
            source={thumbSrc}
            style={itemStyles.thumb}
            contentFit="contain"
            cachePolicy="disk"
            transition={200}
            recyclingKey={item.id}
          />
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
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: Colors.border,
  },
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
  /* Premium glass cards */
  premCard: {
    flexDirection: 'row',
    backgroundColor: DS.color.surfaceCard,
    borderRadius: DS.radius.card,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
    ...DS.shadow.card,
  },
  premEdge: { width: 3 },
  premBody: { flex: 1, padding: 12 },
  premTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  premThumb: {
    width: 40,
    height: 40,
    borderRadius: DS.radius.image,
    backgroundColor: DS.color.bgTertiary,
  },
  premName: {
    color: DS.color.heading,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  premQty: { fontSize: 18, fontWeight: '700', letterSpacing: -0.4 },
  premMin: { fontSize: 11, color: DS.color.muted, fontWeight: '500' },
  premOrderFabWrap: {
    marginTop: 4,
    borderRadius: 18,
  },
  premOrderFab: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premProgressBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  premProgressFill: { height: 3, borderRadius: 2, minWidth: 4 },
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
  onEditItem: (item: MockInventoryItem) => void;
}

function CategorySection({ category, items, isExpanded, onToggle, onDelete, onDeleteItem, onPressItem, onOrderItem, onEditItem }: CategorySectionProps) {
  const theme = useAppTheme();
  const criticalCount = items.filter((i) => getStatus(i) === 'critical').length;
  const warningCount = items.filter((i) => getStatus(i) === 'warning').length;

  if (theme.isPremium) {
    return (
      <View style={catStyles.premSection}>
        <TouchableOpacity style={catStyles.premHeader} onPress={onToggle} activeOpacity={0.75}>
          <View style={[catStyles.premDot, { backgroundColor: category.color || DS.color.greenEnd }]} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={catStyles.premCatName} allowFontScaling={false}>
              {category.name}
            </Text>
            <View style={catStyles.countRow}>
              <Text style={catStyles.premCount} allowFontScaling={false}>
                {items.length} prod.
              </Text>
              {criticalCount > 0 && (
                <View style={[catStyles.alertBadge, catStyles.premAlertBadge]}>
                  <Text style={[catStyles.alertBadgeText, catStyles.premAlertText]}>{criticalCount} kryty.</Text>
                </View>
              )}
              {warningCount > 0 && (
                <View style={[catStyles.alertBadge, catStyles.warnBadge, catStyles.premWarnBadge]}>
                  <Text style={[catStyles.alertBadgeText, catStyles.warnBadgeText, catStyles.premWarnText]}>
                    {warningCount} niski
                  </Text>
                </View>
              )}
            </View>
          </View>
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={catStyles.deleteBtn}
          >
            <Trash2 size={12} color={DS.color.muted} strokeWidth={2} />
          </TouchableOpacity>
          {isExpanded
            ? <ChevronDown size={16} color={DS.color.muted} strokeWidth={2} />
            : <ChevronRight size={16} color={DS.color.muted} strokeWidth={2} />}
        </TouchableOpacity>

        {isExpanded && (
          <View style={catStyles.premBody}>
            {items.length === 0 ? (
              <View style={catStyles.emptyBody}>
                <Text style={[catStyles.emptyBodyText, { color: DS.color.muted }]}>Brak produktów w tej kategorii</Text>
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
                    onEdit={() => onEditItem(item)}
                  />
                ))
            )}
          </View>
        )}
      </View>
    );
  }

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
                  onEdit={() => onEditItem(item)}
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
  /** Premium — styl jak nagłówki kategorii w Menu */
  premSection: {
    marginBottom: 10,
    borderRadius: DS.radius.card,
    backgroundColor: DS.color.bgTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
    overflow: 'hidden',
  },
  premHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  premDot: { width: 7, height: 7, borderRadius: 3.5 },
  premCatName: {
    color: DS.color.heading,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  premCount: { color: DS.color.muted, fontSize: 11, fontWeight: '600' },
  premAlertBadge: { backgroundColor: 'rgba(255,82,82,0.15)' },
  premAlertText: { color: '#FF6B6B', fontSize: 9 },
  premWarnBadge: { backgroundColor: 'rgba(255,193,7,0.12)' },
  premWarnText: { color: '#E6B800', fontSize: 9 },
  premBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DS.color.borderSubtle,
    paddingTop: 6,
    paddingHorizontal: 6,
    paddingBottom: 4,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deleteBtn: { padding: 4 },
  body: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 4 },
  emptyBody: { paddingVertical: 16, paddingHorizontal: 14 },
  emptyBodyText: { fontSize: 13, color: Colors.textTertiary },
});

// ─── Form helpers ────────────────────────────────────────────────────────────────────────

const formStyles = StyleSheet.create({
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  input: { backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: Colors.textPrimary },
});

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  const theme = useAppTheme();
  return (
    <Text style={[formStyles.fieldLabel, theme.isPremium && { color: DS.color.muted }]}>
      {text}{required && <Text style={{ color: Colors.danger }}> *</Text>}
    </Text>
  );
}

function NumericInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const theme = useAppTheme();
  return (
    <TextInput
      style={[
        formStyles.input,
        theme.isPremium && {
          backgroundColor: DS.color.bgTertiary,
          borderColor: DS.color.borderSubtle,
          color: DS.color.heading,
        },
      ]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder ?? '0'}
      placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
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
  optimalThreshold: '',
  unit: 'g' as Unit,
  isCombo: false,
  portionSize: '',
  safetyBuffer: '20', // % — min 10
  unitWeightVolume: '', // waga/objętość 1 szt/op
  weightVolumeUnit: 'g' as 'g' | 'ml',
  shelfLifeDays: '',
};

// ─── Main Screen ─────────────────────────────────────────────────────────────────────────────

export default function MagazynScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { alert: premiumAlert } = usePremiumAlert();
  const { ready: authReady, isAuthenticated, accountKey } = useAuth();
  const focusParams = useLocalSearchParams<{
    focusProductId?: string | string[];
    focusProductName?: string | string[];
  }>();
  const focusHandledRef = useRef<string | null>(null);
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
  const [comboIngredients, setComboIngredients] = useState<ComboIngredientDraft[]>([newComboIngredient()]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [savingCat, setSavingCat] = useState(false);
  const savingCatRef = useRef(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const { setVoiceOverlay, openDocumentScan, documentScanRevision } = useUiOverlay();

  useEffect(() => {
    setVoiceOverlay(showVoiceModal);
    return () => setVoiceOverlay(false);
  }, [showVoiceModal, setVoiceOverlay]);

  const [orderProduct, setOrderProduct] = useState<MockInventoryItem | null>(null);

  const fabAnim = useRef(new Animated.Value(0)).current;

  // ── Data fetching ────────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    // Czekaj na sesję — inaczej pierwsze query idzie na account_key=default (całe demo, 20–30s).
    if (!authReady || !isAuthenticated || !accountKey || accountKey === 'default') {
      return;
    }
    const ak = accountKey;
    try {
      // Uzupełnij brakujące kategorie systemowe (nie kasuje własnych użytkownika).
      await ensureDefaultWarehouseCategories(supabase, ak);
      // Soft-dedupe: ta sama nazwa → jeden category_id (produkty przenoszone, puste dupy usuwane).
      await dedupeWarehouseCategories(supabase, ak);
      await ensureDefaultKitchenUtensils(supabase, ak);

      const [itemsRes, catsRes, wasteRes] = await Promise.all([
        supabase
          .from('inventory_items')
          .select(
            'id, name, category_id, quantity, unit, min_quantity, optimal_quantity, portion_size, is_combo_polprodukt, safety_buffer_percent, shelf_life_days, inventory_categories(name), suppliers(name)',
          )
          .eq('account_key', ak)
          .eq('is_active', true)
          .order('name')
          .limit(2000),
        supabase
          .from('inventory_categories')
          .select('id, name, color')
          .eq('account_key', ak)
          .order('sort_order')
          .limit(200),
        supabase
          .from('waste_logs')
          .select('id, item_name, quantity, unit, reason, created_at')
          .eq('account_key', ak)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      let itemsData = itemsRes.data;
      let itemsErr = itemsRes.error;
      // Jedna szybka ścieżka awaryjna (bez łańcucha 4× requestów)
      if (itemsErr && /is_active|optimal_quantity|safety_buffer_percent|shelf_life_days/.test(itemsErr.message ?? '')) {
        const slim = await supabase
          .from('inventory_items')
          .select(
            'id, name, category_id, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)',
          )
          .eq('account_key', ak)
          .order('name')
          .limit(2000);
        itemsData = slim.data;
        itemsErr = slim.error;
      }
      if (itemsErr) throw itemsErr;
      if (catsRes.error) throw catsRes.error;
      // waste_logs opcjonalne — nie blokuj magazynu
      if (wasteRes.error && !/account_key|waste_logs/.test(wasteRes.error.message ?? '')) {
        if (__DEV__) console.warn('[Magazyn] waste_logs:', wasteRes.error.message);
      }

      setInventory((itemsData ?? []).map(mapDbRow));
      setDbCategories(catsRes.data ?? []);
      setWasteLogs(wasteRes.error ? [] : (wasteRes.data ?? []));
      setExpandedCategories(new Set((catsRes.data ?? []).map((c: CategoryRow) => c.name)));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Nieznany błąd');
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
    void fetchData();
  }, [fetchData, authReady, isAuthenticated, accountKey]);

  useEffect(() => {
    if (documentScanRevision > 0) void fetchData();
  }, [documentScanRevision, fetchData]);

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  // ── Category derived data ───────────────────────────────────────────────────────────────

  const categoryColorMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    dbCategories.forEach((c) => { map[c.name] = c.color; });
    return map;
  }, [dbCategories]);

  const categoryIdMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    // Pierwszy wpis wygrywa — po dedupe nazwy są unikalne; przy race bierzemy stabilnie pierwsze id.
    dbCategories.forEach((c) => {
      if (!map[c.name]) map[c.name] = c.id;
    });
    return map;
  }, [dbCategories]);

  const uniqueCategories = useMemo<CategoryRow[]>(() => {
    const seen = new Set<string>();
    const out: CategoryRow[] = [];
    for (const c of dbCategories) {
      const key = normCategoryName(c.name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }, [dbCategories]);

  const categoryProductCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    inventory.forEach((item) => {
      const key = item.category_id
        ? (uniqueCategories.find((c) => c.id === item.category_id)?.name ?? item.category)
        : item.category;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [inventory, uniqueCategories]);

  const categorySections = useMemo(() => {
    return [...uniqueCategories]
      .sort((a, b) => (categoryProductCounts[b.name] ?? 0) - (categoryProductCounts[a.name] ?? 0))
      .map((c) => ({
        cat: c,
        items: inventory.filter((item) =>
          item.category_id ? item.category_id === c.id : item.category === c.name,
        ),
      }));
  }, [uniqueCategories, inventory, categoryProductCounts]);

  const formCategories = useMemo<string[]>(() => {
    return [...uniqueCategories]
      .sort((a, b) => {
        const diff = (categoryProductCounts[b.name] ?? 0) - (categoryProductCounts[a.name] ?? 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'pl');
      })
      .map((c) => c.name);
  }, [uniqueCategories, categoryProductCounts]);

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

  const uncategorizedItems = useMemo(
    () =>
      inventory.filter((item) => {
        if (item.category_id) {
          return !uniqueCategories.some((c) => c.id === item.category_id);
        }
        return !uniqueCategories.some((c) => c.name === item.category);
      }),
    [inventory, uniqueCategories],
  );

  const magRows = useMemo((): MagListRow[] => {
    const searching = search.trim().length > 0;
    if (searching) {
      const q = search.trim();
      if (searchResults.length === 0) return [{ type: 'search_empty', q }];
      return [
        { type: 'search_meta', count: searchResults.length, q },
        ...searchResults.map((item): MagListRow => ({ type: 'search_item', item })),
      ];
    }
    const rows: MagListRow[] = [{ type: 'cat_toolbar' }];
    if (dbCategories.length === 0) {
      rows.push({ type: 'mag_empty' });
    } else {
      for (const section of categorySections) {
        rows.push({ type: 'cat_section', cat: section.cat, items: section.items });
      }
    }
    if (uncategorizedItems.length > 0) {
      rows.push({ type: 'uncat_section', items: uncategorizedItems });
    }
    return rows;
  }, [search, searchResults, dbCategories.length, categorySections, uncategorizedItems]);

  const totalCritical = useMemo(() => inventory.filter((i) => getStatus(i) === 'critical').length, [inventory]);

  // ── Category management ───────────────────────────────────────────────────────────────

  const handleAddCategory = async () => {
    if (savingCatRef.current) return;
    const name = newCatName.trim();
    if (!name) return;
    const dup = uniqueCategories.find((c) => normCategoryName(c.name) === normCategoryName(name));
    if (dup) {
      premiumAlert('Kategoria istnieje', `Masz już kategorię „${dup.name}". Wybierz ją z listy zamiast tworzyć duplikat.`);
      setForm((f) => ({ ...f, category: dup.name }));
      setNewCatName('');
      setAddingCat(false);
      return;
    }
    savingCatRef.current = true;
    setSavingCat(true);
    const usedColors = dbCategories.map((c) => c.color);
    const color = CAT_AUTO_COLORS.find((c) => !usedColors.includes(c))
      ?? CAT_AUTO_COLORS[dbCategories.length % CAT_AUTO_COLORS.length];
    const maxOrder = dbCategories.reduce((m, c) => Math.max(m, (c as any).sort_order ?? 0), 0);
    if (!accountKey || accountKey === 'default') {
      premiumAlert('Konto', 'Brak konta użytkownika — wyloguj się i zaloguj ponownie.');
      savingCatRef.current = false;
      setSavingCat(false);
      return;
    }
    const { data: newCat, error } = await supabase.from('inventory_categories').insert({
      name, color, icon_name: 'box', sort_order: maxOrder + 10, account_key: accountKey,
    }).select('id, name, color').single();
    savingCatRef.current = false;
    setSavingCat(false);
    if (error) {
      const msg = error.message || '';
      if (/duplicate|unique|23505/i.test(msg)) {
        premiumAlert('Kategoria istnieje', 'Kategoria o tej nazwie już jest na koncie.');
        fetchData();
        return;
      }
      premiumAlert(
        'Błąd',
        /row-level security|RLS/i.test(msg)
          ? 'Brak uprawnień do kategorii (RLS). Uruchom w Supabase FIX_TENANT_RLS.sql, potem wyloguj i zaloguj ponownie.'
          : msg,
      );
      return;
    }
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
    premiumAlert('Usuń kategorię', msg, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('inventory_categories').delete().eq('id', cat.id);
          if (error) premiumAlert('Błąd', error.message);
          else fetchData();
        },
      },
    ]);
  };

  const handlePressItem = (item: MockInventoryItem) => {
    router.push({ pathname: '/product-suppliers', params: { productId: item.id, productName: item.product_name } });
  };

  // Deep-link z alertów Premium (Finanse → Magazyn → szczegóły produktu)
  useEffect(() => {
    const rawId = focusParams.focusProductId;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id || loading) return;
    if (focusHandledRef.current === id) return;

    const rawName = focusParams.focusProductName;
    const nameParam = Array.isArray(rawName) ? rawName[0] : rawName;
    const fromList = inventory.find((i) => i.id === id);
    focusHandledRef.current = id;

    if (fromList) {
      handlePressItem(fromList);
      return;
    }
    if (nameParam) {
      router.push({
        pathname: '/product-suppliers',
        params: { productId: id, productName: nameParam },
      });
    }
  }, [focusParams.focusProductId, focusParams.focusProductName, loading, inventory]);

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
            // Soft-delete (is_active=false) — zgodne z ADD_SOFT_DELETE.sql i „przywróć magazyn”
            const { error } = await supabase
              .from('inventory_items')
              .update({ is_active: false })
              .eq('id', item.id);
            if (error && /is_active/.test(error.message ?? '')) {
              const hard = await supabase.from('inventory_items').delete().eq('id', item.id);
              if (hard.error) { Alert.alert('Błąd', hard.error.message); return; }
            } else if (error) {
              Alert.alert('Błąd', error.message);
              return;
            }
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

  const renderMagRow = useCallback(
    ({ item }: { item: MagListRow }) => {
      switch (item.type) {
        case 'search_meta':
          return (
            <Text style={[styles.searchResultLabel, theme.isPremium && { color: theme.textMuted }]}>
              {item.count} wyników dla "{item.q}"
            </Text>
          );
        case 'search_empty':
          return (
            <View style={styles.emptyWrap}>
              <Package size={36} color={theme.isPremium ? theme.textMuted : Colors.textTertiary} strokeWidth={1.5} />
              <Text style={[styles.emptyTitle, theme.isPremium && { color: theme.text }]}>Brak wyników</Text>
              <Text style={[styles.emptyText, theme.isPremium && { color: theme.textSecondary }]}>
                Brak produktów pasujących do "{item.q}"
              </Text>
            </View>
          );
        case 'search_item':
          return (
            <ItemCard
              item={item.item}
              catColor={categoryColorMap[item.item.category] ?? FALLBACK_COLOR}
              onDelete={() => handleDeleteItem(item.item)}
              onPress={() => handlePressItem(item.item)}
              onOrder={() => handleOrderItem(item.item)}
              onEdit={() => openEditItem(item.item)}
            />
          );
        case 'cat_toolbar':
          return (
            <View style={styles.catSectionHeader}>
              <Tag size={12} color={theme.isPremium ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
              <Text
                style={[
                  styles.catSectionTitle,
                  theme.isPremium && {
                    color: DS.color.muted,
                    fontSize: 11,
                    letterSpacing: 0.7,
                    textTransform: 'uppercase',
                  },
                ]}
                allowFontScaling={false}
              >
                Kategorie produktów
              </Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={[styles.addCatBtnWrap, theme.isPremium && DS.shadow.greenGlow]}
                onPress={() => setAddingCat(true)}
                activeOpacity={0.8}
              >
                {theme.isPremium ? (
                  <LinearGradient
                    colors={[...DS.gradient.green]}
                    start={{ x: 0, y: 0.2 }}
                    end={{ x: 1, y: 0.8 }}
                    style={styles.addCatBtn}
                  >
                    <Plus size={12} color="#0A0A0A" strokeWidth={2.5} />
                    <Text style={styles.addCatBtnTextPrem} allowFontScaling={false}>Dodaj kategorię</Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.addCatBtn, { backgroundColor: Colors.accentLight }]}>
                    <Plus size={13} color={Colors.accent} strokeWidth={2.5} />
                    <Text style={styles.addCatBtnText}>Dodaj kategorię</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          );
        case 'mag_empty':
          return (
            <View style={styles.emptyWrap}>
              <Package size={40} color={theme.isPremium ? theme.textMuted : Colors.textTertiary} strokeWidth={1.5} />
              <Text style={[styles.emptyTitle, theme.isPremium && { color: theme.text }]}>Magazyn jest pusty</Text>
              <Text style={styles.emptyText}>Dodaj pierwszą kategorię, a następnie produkty.</Text>
            </View>
          );
        case 'cat_section':
          return (
            <CategorySection
              category={item.cat}
              items={item.items}
              isExpanded={expandedCategories.has(item.cat.name)}
              onToggle={() => toggleCategory(item.cat.name)}
              onDelete={() => handleDeleteCategory(item.cat)}
              onDeleteItem={handleDeleteItem}
              onPressItem={handlePressItem}
              onOrderItem={handleOrderItem}
              onEditItem={openEditItem}
            />
          );
        case 'uncat_section':
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
                    <Text style={catStyles.totalCount}>{item.items.length} produktów</Text>
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
                  {item.items.map((inv) => (
                    <ItemCard
                      key={inv.id}
                      item={inv}
                      catColor={FALLBACK_COLOR}
                      onDelete={() => handleDeleteItem(inv)}
                      onPress={() => handlePressItem(inv)}
                      onOrder={() => handleOrderItem(inv)}
                      onEdit={() => openEditItem(inv)}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        default:
          return null;
      }
    },
    [theme, categoryColorMap, expandedCategories],
  );

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
  function handleCameraPress() {
    closeFab();
    Alert.alert(
      'Daty ważności — bez Vision AI',
      'Przy dużej dostawie:\n\n'
      + '1) Dostawcy → skan faktury → formularz partii (daty + ilości + przypomnienia 7/3/1).\n'
      + '2) Albo głosem: „Dodaj do twarogu datę ważności 20.08.2026, 4 sztuki”.\n\n'
      + 'To tańsze i szybsze niż skanowanie każdego produktu kamerą.',
      [{ text: 'OK' }],
    );
  }

  const addTranslateY = fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -192] });
  const micTranslateY = fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -132] });
  const cameraTranslateY = fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -72] });
  const miniOpacity = fabAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const fabRotate = fabAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  // ── Auto-unlock offer items ────────────────────────────────────────────────────────────

  async function autoUnlockOfferItems(newItemId: string, newItemName: string) {
    try {
      // Tylko oferty własnych dostawców — bez wycieku z innych tenantów
      let sleepingQuery = supabase
        .from('supplier_offer_items')
        .select('id, raw_product_name, supplier_id')
        .is('warehouse_product_id', null);
      if (accountKey && accountKey !== 'default') {
        const { data: mySuppliers } = await supabase
          .from('suppliers')
          .select('id')
          .eq('account_key', accountKey);
        const ids = (mySuppliers ?? []).map((s: any) => s.id as string);
        if (ids.length === 0) return;
        sleepingQuery = sleepingQuery.in('supplier_id', ids);
      }
      const { data: sleeping } = await sleepingQuery;
      if (!sleeping || sleeping.length === 0) return;
      const toUnlock = sleeping
        .filter((item: any) => namesMatch(newItemName, item.raw_product_name || '', 72))
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
    let optimalThreshold: number | null = null;
    if (form.optimalThreshold.trim()) {
      const o = parseFloat(form.optimalThreshold);
      if (isNaN(o) || o < 0) { Alert.alert('Błąd', 'Próg optymalny musi być liczbą ≥ 0.'); return; }
      if (o > 0 && o < criticalThreshold) {
        Alert.alert('Błąd', 'Próg optymalny powinien być ≥ stanu krytycznego (albo pusty).');
        return;
      }
      optimalThreshold = o > 0 ? o : null;
    }
    setSaving(true);
    try {
      const nameTrim = form.name.trim();
      const nameKey = nameTrim
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const dup = inventory.find((i) => {
        if (editingId && i.id === editingId) return false;
        const k = (i.product_name || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        return k === nameKey;
      });
      if (dup) {
        Alert.alert(
          'Produkt już istnieje',
          `W magazynie jest już „${dup.product_name}”. Edytuj istniejący wpis zamiast tworzyć duplikat (Łowca Okazji scala oferty po nazwie).`,
        );
        setSaving(false);
        return;
      }

      const isPiece = form.unit === 'szt' || form.unit === 'opak';
      const uwv = isPiece && form.unitWeightVolume.trim() ? parseFloat(form.unitWeightVolume) : null;
      let shelfLifeDays: number | null = null;
      if (form.isCombo && form.shelfLifeDays.trim()) {
        const d = parseInt(form.shelfLifeDays, 10);
        if (!isNaN(d) && d > 0) shelfLifeDays = d;
      }
      const { getAccountKey } = await import('@/lib/accountKey');
      const ak = getAccountKey();
      const payload: any = {
        name: nameTrim,
        category_id: categoryIdMap[form.category] ?? null,
        quantity: currentQty,
        unit: form.unit,
        min_quantity: criticalThreshold,
        optimal_quantity: optimalThreshold,
        is_combo_polprodukt: form.isCombo,
        safety_buffer_percent: safetyBuffer,
        shelf_life_days: form.isCombo ? shelfLifeDays : null,
        unit_cost: 0,
        unit_weight_volume: uwv && !isNaN(uwv) ? uwv : null,
        weight_volume_unit: uwv && !isNaN(uwv) ? form.weightVolumeUnit : null,
        account_key: ak,
      };
      const selectCols = 'id, name, category_id, quantity, unit, min_quantity, optimal_quantity, portion_size, is_combo_polprodukt, safety_buffer_percent, shelf_life_days, inventory_categories(name), suppliers(name)';
      let row: any = null;
      let saveError: any = null;
      if (editingId) {
        const { optimal_quantity, unit_weight_volume, weight_volume_unit, safety_buffer_percent, shelf_life_days, account_key: _ak, ...core } = payload;
        let upd = await supabase.from('inventory_items').update(payload).eq('id', editingId).eq('account_key', ak).select(selectCols).single();
        if (upd.error && /optimal_quantity|shelf_life_days/.test(upd.error.message ?? '')) {
          const soft = { ...core, safety_buffer_percent, unit_weight_volume, weight_volume_unit };
          if (!/shelf_life/.test(upd.error.message ?? '')) {
            (soft as any).shelf_life_days = shelf_life_days;
          }
          if (!/optimal_quantity/.test(upd.error.message ?? '')) {
            (soft as any).optimal_quantity = optimal_quantity;
          }
          upd = await supabase.from('inventory_items').update(soft).eq('id', editingId).eq('account_key', ak).select('id, name, category_id, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, safety_buffer_percent, inventory_categories(name), suppliers(name)').single();
        }
        row = upd.data;
        saveError = upd.error;
      } else {
        let insertRes = await supabase.from('inventory_items').insert(payload).select(selectCols).single();
        if (insertRes.error && /optimal_quantity|safety_buffer_percent|unit_weight_volume|weight_volume_unit|shelf_life_days/.test(insertRes.error.message ?? '')) {
          const { optimal_quantity, safety_buffer_percent, unit_weight_volume, weight_volume_unit, shelf_life_days, ...fallback } = payload;
          insertRes = await supabase
            .from('inventory_items')
            .insert(fallback)
            .select('id, name, category_id, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)')
            .single();
        }
        row = insertRes.data;
        saveError = insertRes.error;
      }
      if (saveError) throw saveError;

      // Persist combo recipe (best-effort if tabela jeszcze nie zmigrowana)
      const itemId = row.id as string;
      try {
        await supabase.from('inventory_combo_ingredients').delete().eq('inventory_item_id', itemId);
        if (form.isCombo) {
          const rows = comboIngredients
            .filter((i) => i.name.trim())
            .map((ing, idx) => {
              const matchId =
                ing.warehouse_product_id ||
                inventory.find(
                  (p) =>
                    p.id !== itemId &&
                    normCategoryName(p.product_name) === normCategoryName(ing.name),
                )?.id ||
                null;
              return {
                inventory_item_id: itemId,
                ingredient_name: ing.name.trim(),
                quantity: parseFloat(ing.quantity) || 0,
                unit: ing.unit || 'g',
                warehouse_product_id: matchId,
                sort_order: idx,
                account_key: ak,
              };
            });
          if (rows.length) {
            const { error: comboErr } = await supabase.from('inventory_combo_ingredients').insert(rows);
            if (comboErr && !/does not exist|schema cache|relation/i.test(comboErr.message ?? '')) {
              throw comboErr;
            }
          }
        }
      } catch (comboEx: any) {
        if (!/does not exist|schema cache|relation/i.test(comboEx?.message ?? '')) {
          throw comboEx;
        }
      }

      const mapped = mapDbRow(row);
      if (editingId) {
        setInventory((prev) => prev.map((i) => (i.id === editingId ? mapped : i)));
      } else {
        setInventory((prev) => [...prev, mapped]);
        await autoUnlockOfferItems(row.id, row.name);
      }
      if (form.category) {
        setExpandedCategories((prev) => new Set([...prev, form.category]));
      }
      setForm({ ...BLANK_FORM, category: formCategories[0] ?? '' });
      setComboIngredients([newComboIngredient()]);
      setEditingId(null);
      setShowAddModal(false);
    } catch (e: any) {
      Alert.alert('Błąd zapisu', e.message ?? 'Nieznany błąd');
    } finally {
      setSaving(false);
    }
  }

  function handleCloseAddModal() {
    setForm({ ...BLANK_FORM, category: formCategories[0] ?? '' });
    setComboIngredients([newComboIngredient()]);
    setEditingId(null);
    setShowAddModal(false);
  }

  async function openEditItem(item: MockInventoryItem) {
    setEditingId(item.id);
    setForm({
      ...BLANK_FORM,
      name: item.product_name,
      category: item.category || (formCategories[0] ?? ''),
      currentQty: String(item.current_qty),
      criticalThreshold: String(item.critical_threshold),
      optimalThreshold: item.optimal_threshold > 0 ? String(item.optimal_threshold) : '',
      unit: item.unit,
      isCombo: item.is_combo_półprodukt,
      safetyBuffer: String(item.safety_buffer_percent ?? 20),
      shelfLifeDays: item.shelf_life_days != null && item.shelf_life_days > 0 ? String(item.shelf_life_days) : '',
    });
    setComboIngredients([newComboIngredient()]);
    setShowAddModal(true);
    if (item.is_combo_półprodukt) {
      try {
        const { data } = await supabase
          .from('inventory_combo_ingredients')
          .select('id, ingredient_name, quantity, unit, warehouse_product_id, sort_order')
          .eq('inventory_item_id', item.id)
          .order('sort_order');
        if (data?.length) {
          setComboIngredients(
            data.map((r: any) => ({
              key: r.id,
              name: r.ingredient_name ?? '',
              quantity: r.quantity != null ? String(r.quantity) : '',
              unit: r.unit || 'g',
              warehouse_product_id: r.warehouse_product_id ?? null,
            })),
          );
        }
      } catch {
        /* tabela może jeszcze nie istnieć */
      }
    }
  }

  // Portion size hint
  const surf = premiumSurface(theme);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  const headerActions = (
    <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
      <View style={{ flex: 1 }}>
        <PremiumOutlineBtn
          label="+ Dodaj produkt"
          onPress={() => setShowAddModal(true)}
          tone="green"
          size="lg"
          fullWidth
        />
      </View>
      <View style={{ flex: 1 }}>
        <PremiumOutlineBtn
          label="Zgłoś stratę"
          onPress={() => setShowWasteLogs(true)}
          tone="red"
          size="lg"
          fullWidth
          icon={<Trash2 size={14} color="#0A0A0A" strokeWidth={2} />}
        />
      </View>
    </View>
  );

  const actionButtons = theme.isPremium ? (
    <View style={styles.actionBtnsWrap}>
      <PremiumGlowCta
        label="Zgłoś informację"
        onPress={() => setShowVoiceModal(true)}
        icon={<Mic size={16} color="#0A0A0A" strokeWidth={2.5} />}
      />
      <View style={{ height: 12 }} />
      <PremiumOutlineBtn
        label="Wgraj fakturę"
        onPress={() => openDocumentScan('invoice')}
        tone="green"
        fullWidth
        icon={<FileUp size={13} color={DS.color.greenEnd} strokeWidth={2} />}
      />
    </View>
  ) : (
    <View style={styles.actionBtnsWrap}>
      <View style={styles.actionBtnsRow}>
        <TouchableOpacity
          style={[styles.magPillBtn, { backgroundColor: '#8B5CF6', shadowColor: '#8B5CF6' }]}
          onPress={() => setShowAddModal(true)}
          activeOpacity={0.85}
        >
          <View style={styles.magPillIcon}>
            <Plus size={14} color={Colors.white} strokeWidth={2.5} />
          </View>
          <Text style={[styles.magPillText, { color: Colors.white }]}>Dodaj produkt</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.magPillBtn, { backgroundColor: '#8B5CF6', shadowColor: '#8B5CF6' }]}
          onPress={() => setShowWasteLogs(true)}
          activeOpacity={0.85}
        >
          <View style={styles.magPillIcon}>
            <Trash2 size={14} color={Colors.white} strokeWidth={2.5} />
          </View>
          <Text style={[styles.magPillText, { color: Colors.white }]}>Zgłoś straty</Text>
        </TouchableOpacity>
        <ReportInfoButton contextHint="Magazyn" onApplied={fetchData} testID="magazyn-report-info" />
        <TouchableOpacity
          style={[styles.magPillBtn, { backgroundColor: Colors.success, shadowColor: Colors.success }]}
          onPress={() => openDocumentScan('invoice')}
          activeOpacity={0.85}
        >
          <View style={styles.magPillIcon}>
            <FileUp size={14} color={Colors.white} strokeWidth={2.5} />
          </View>
          <Text style={[styles.magPillText, { color: Colors.white }]}>Wgraj fakturę</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const searchBar = (
    <View style={[styles.searchWrap, surf.search, theme.isPremium && { marginBottom: 8 }]}>
      <Search size={16} color={theme.isPremium ? theme.textSecondary : Colors.textSecondary} strokeWidth={2} />
      <TextInput
        style={[styles.searchInput, theme.isPremium && { color: theme.text }]}
        placeholder="Szukaj produktu lub kategorii..."
        placeholderTextColor={theme.isPremium ? theme.textMuted : Colors.textTertiary}
        value={search}
        onChangeText={setSearch}
        clearButtonMode="while-editing"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {search.length > 0 && (
        <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={14} color={theme.isPremium ? theme.textSecondary : Colors.textSecondary} strokeWidth={2} />
        </TouchableOpacity>
      )}
    </View>
  );

  const body = (
    <>
      {!theme.isPremium ? (
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: Colors.textPrimary }]}>Magazyn</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {inventory.length} produktów
              {totalCritical > 0 ? ` · ${totalCritical} alarmów` : ' · Stan OK'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Free: kafle akcji + search nad listą (bez sticky chrome) */}
      {!theme.isPremium ? (
        <>
          {actionButtons}
          {searchBar}
        </>
      ) : null}

      {/* Main content — FlashList recycles rows + images stay on disk cache */}
      <FlashList
        data={magRows}
        extraData={expandedCategories}
        keyExtractor={(row, index) => {
          switch (row.type) {
            case 'search_item': return `si-${row.item.id}`;
            case 'cat_section': return `cs-${row.cat.id}`;
            case 'uncat_section': return 'uncat';
            case 'search_meta': return 'search-meta';
            case 'search_empty': return 'search-empty';
            case 'cat_toolbar': return 'cat-toolbar';
            case 'mag_empty': return 'mag-empty';
            default: return `row-${index}`;
          }
        }}
        renderItem={renderMagRow}
        getItemType={(row) => row.type}
        drawDistance={280}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.isPremium ? theme.accent : Colors.accent} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          theme.isPremium ? (
            <>
              {actionButtons}
              {searchBar}
            </>
          ) : null
        }
        ListFooterComponent={
          <>
            {theme.isPremium && accountKey && accountKey !== 'default' ? (
              <KitchenUtensilsSection accountKey={accountKey} />
            ) : null}
            <View style={{ height: 120 }} />
            <AdBannerFooter />
          </>
        }
      />

      {/* FAB stack — ukryty w premium (dodawanie z nagłówka) */}
      {!theme.isPremium && (
      <View style={styles.fabContainer} pointerEvents="box-none">
        <Animated.View style={[styles.fabMini, { transform: [{ translateY: addTranslateY }], opacity: miniOpacity }]} pointerEvents={fabOpen ? 'auto' : 'none'}>
          <View style={styles.fabMiniLabel}>
            <Text style={styles.fabMiniLabelText}>Dodaj Produkt</Text>
          </View>
          <TouchableOpacity style={[styles.fabMiniBtn, { backgroundColor: Colors.accent }]} onPress={handleAddProductPress} activeOpacity={0.85}>
            <Package size={20} color={Colors.white} strokeWidth={2} />
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={[styles.fabMini, { transform: [{ translateY: micTranslateY }], opacity: miniOpacity }]} pointerEvents={fabOpen ? 'auto' : 'none'}>
          <View style={styles.fabMiniLabel}>
            <Text style={styles.fabMiniLabelText}>AI Głos</Text>
          </View>
          <TouchableOpacity style={[styles.fabMiniBtn, { backgroundColor: '#8B5CF6' }]} onPress={handleMicPress} activeOpacity={0.85}>
            <Mic size={20} color={Colors.white} strokeWidth={2} />
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={[styles.fabMini, { transform: [{ translateY: cameraTranslateY }], opacity: miniOpacity }]} pointerEvents={fabOpen ? 'auto' : 'none'}>
          <View style={styles.fabMiniLabel}>
            <Text style={styles.fabMiniLabelText}>Jak dodać daty?</Text>
          </View>
          <TouchableOpacity style={[styles.fabMiniBtn, { backgroundColor: Colors.success }]} onPress={handleCameraPress} activeOpacity={0.85}>
            <Camera size={20} color={Colors.white} strokeWidth={2} />
          </TouchableOpacity>
        </Animated.View>
        <TouchableOpacity
          style={styles.fabWrap}
          onPress={toggleFab}
          activeOpacity={0.85}
        >
          <View style={[styles.fab, { backgroundColor: Colors.accent }]}>
            <Animated.View style={{ transform: [{ rotate: fabRotate }] }}>
              <Plus size={26} color={Colors.white} strokeWidth={2.5} />
            </Animated.View>
          </View>
        </TouchableOpacity>
      </View>
      )}

      {/* Add Product Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCloseAddModal}>
        <SafeAreaView
          style={[
            styles.modalSafe,
            theme.isPremium && { backgroundColor: DS.color.bgPrimary },
          ]}
          edges={['top']}
        >
          <View
            style={[
              styles.modalHeader,
              theme.isPremium && {
                backgroundColor: DS.color.bgPrimary,
                borderBottomColor: DS.color.borderSubtle,
              },
            ]}
          >
            <View>
              <Text style={[styles.modalTitle, theme.isPremium && { color: DS.color.heading }]}>
                {editingId ? 'Edytuj produkt' : 'Nowy Produkt'}
              </Text>
              <Text style={[styles.modalSubtitle, theme.isPremium && { color: DS.color.muted }]}>
                {editingId ? 'Zmień progi i stan magazynowy' : 'Uzupełnij dane magazynowe'}
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.closeBtn,
                theme.isPremium && { backgroundColor: DS.color.bgTertiary },
              ]}
              onPress={handleCloseAddModal}
            >
              <X size={20} color={theme.isPremium ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.formScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.formSection, theme.isPremium && { color: DS.color.heading }]}>Podstawowe dane</Text>
              <View style={styles.fieldWrap}>
                <FieldLabel text="Nazwa produktu" required />
                <TextInput
                  style={[
                    formStyles.input,
                    theme.isPremium && {
                      backgroundColor: DS.color.bgTertiary,
                      borderColor: DS.color.borderSubtle,
                      color: DS.color.heading,
                    },
                  ]}
                  placeholder="np. Kurczak filet"
                  placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  returnKeyType="next"
                />
              </View>
              <View style={styles.fieldWrap}>
                <FieldLabel text="Kategoria" required />
                {formCategories.length === 0 ? (
                  <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                    Brak kategorii — dodaj je przyciskiem "Dodaj kategorię"
                  </Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
                    {formCategories.map((cat) => {
                      const active = form.category === cat;
                      const color = categoryColorMap[cat] ?? FALLBACK_COLOR;
                      const count = categoryProductCounts[cat] ?? 0;
                      const catRow = uniqueCategories.find((c) => c.name === cat);
                      return (
                        <View
                          key={cat}
                          style={[
                            styles.formPill,
                            theme.isPremium && !active && {
                              backgroundColor: DS.color.bgTertiary,
                              borderColor: DS.color.borderSubtle,
                            },
                            active && { backgroundColor: color, borderColor: color },
                          ]}
                        >
                          <TouchableOpacity
                            style={styles.formPillMain}
                            onPress={() => setForm((f) => ({ ...f, category: cat }))}
                            activeOpacity={0.7}
                          >
                            {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                            <Text
                              style={[
                                styles.formPillText,
                                theme.isPremium && !active && { color: DS.color.muted },
                                active && { color: Colors.white, fontWeight: '700' },
                              ]}
                            >
                              {cat}
                            </Text>
                            {count > 0 && (
                              <Text
                                style={[
                                  styles.formPillCount,
                                  theme.isPremium && !active && { color: DS.color.muted },
                                  active && { color: Colors.white },
                                ]}
                              >
                                {count}
                              </Text>
                            )}
                          </TouchableOpacity>
                          {catRow && (
                            <TouchableOpacity
                              onPress={() => handleDeleteCategory(catRow)}
                              hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                              style={styles.formPillDelete}
                            >
                              <X
                                size={10}
                                color={
                                  active
                                    ? 'rgba(255,255,255,0.75)'
                                    : theme.isPremium
                                      ? DS.color.muted
                                      : Colors.textTertiary
                                }
                                strokeWidth={2.5}
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
              <Text style={[styles.formSection, theme.isPremium && { color: DS.color.heading }]}>Stan magazynowy</Text>
              <View style={styles.fieldRow}>
                <View style={[styles.fieldWrap, { flex: 1 }]}>
                  <FieldLabel text="Aktualna ilość" required />
                  <NumericInput value={form.currentQty} onChange={(v) => setForm((f) => ({ ...f, currentQty: v }))} placeholder="np. 1500" />
                  <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                    Ile jest teraz w magazynie
                  </Text>
                </View>
                <View style={[styles.fieldWrap, { flex: 1 }]}>
                  <FieldLabel text="Próg krytyczny" required />
                  <NumericInput value={form.criticalThreshold} onChange={(v) => setForm((f) => ({ ...f, criticalThreshold: v }))} placeholder="np. 2000" />
                  <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                    Poniżej → trzeba zamówić
                  </Text>
                </View>
              </View>
              <View style={styles.fieldWrap}>
                <FieldLabel text="Próg optymalny" />
                <NumericInput
                  value={form.optimalThreshold}
                  onChange={(v) => setForm((f) => ({ ...f, optimalThreshold: v }))}
                  placeholder="np. 5000 (docelowy zapas)"
                />
                <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                  Docelowa ilość, do której Łowca okazji będzie robił zakupy, gdy produkt spadnie poniżej stanu krytycznego.
                </Text>
              </View>
              <View style={styles.fieldWrap}>
                <FieldLabel text="Jednostka" required />
                <View style={styles.unitRow}>
                  {UNIT_OPTIONS.map((u) => {
                    const active = form.unit === u;
                    return (
                      <TouchableOpacity
                        key={u}
                        style={[
                          styles.unitBtn,
                          theme.isPremium && {
                            backgroundColor: DS.color.bgTertiary,
                            borderColor: DS.color.borderSubtle,
                          },
                          active && (theme.isPremium
                            ? { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }
                            : styles.unitBtnActive),
                        ]}
                        onPress={() => setForm((f) => ({ ...f, unit: u }))}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.unitBtnText,
                            theme.isPremium && { color: DS.color.muted },
                            active && (theme.isPremium
                              ? { color: '#0A0A0A', fontWeight: '800' }
                              : styles.unitBtnTextActive),
                          ]}
                        >
                          {u}
                        </Text>
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
                      style={[
                        formStyles.input,
                        { flex: 1 },
                        theme.isPremium && {
                          backgroundColor: DS.color.bgTertiary,
                          borderColor: DS.color.borderSubtle,
                          color: DS.color.heading,
                        },
                      ]}
                      value={form.unitWeightVolume}
                      onChangeText={(v) => setForm((f) => ({ ...f, unitWeightVolume: v.replace(',', '.') }))}
                      placeholder="np. 400"
                      placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                      keyboardType="decimal-pad"
                      testID="add-product-unit-weight"
                    />
                    <View
                      style={[
                        styles.wvToggle,
                        theme.isPremium && {
                          backgroundColor: DS.color.bgSecondary,
                          borderColor: DS.color.borderSubtle,
                        },
                      ]}
                    >
                      {(['g', 'ml'] as const).map((u) => {
                        const active = form.weightVolumeUnit === u;
                        return (
                          <TouchableOpacity
                            key={u}
                            style={[
                              styles.wvToggleBtn,
                              active && (theme.isPremium
                                ? { backgroundColor: DS.color.greenEnd }
                                : styles.wvToggleBtnActive),
                            ]}
                            onPress={() => setForm((f) => ({ ...f, weightVolumeUnit: u }))}
                            activeOpacity={0.7}
                            testID={`add-product-wv-unit-${u}`}
                          >
                            <Text
                              style={[
                                styles.wvToggleText,
                                theme.isPremium && !active && { color: DS.color.muted },
                                active && (theme.isPremium
                                  ? { color: '#0A0A0A', fontWeight: '800' }
                                  : styles.wvToggleTextActive),
                              ]}
                            >
                              {u}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                    Pozwala przeliczać zapas na porcje potraw liczonych w {form.weightVolumeUnit} (np. 1 szt. = 400 g).
                  </Text>
                </View>
              )}
              <View
                style={[
                  styles.portionInfoBox,
                  theme.isPremium && {
                    backgroundColor: 'rgba(0,230,118,0.08)',
                    borderLeftColor: DS.color.greenEnd,
                  },
                ]}
              >
                <Text style={[styles.portionInfoText, theme.isPremium && { color: DS.color.body }]}>
                  Porcje wyliczane są{' '}
                  <Text style={{ fontWeight: '700', color: theme.isPremium ? DS.color.heading : Colors.textPrimary }}>
                    automatycznie
                  </Text>{' '}
                  na podstawie receptur z Menu. Otwórz produkt → „Dostępność w menu", aby zobaczyć na ile porcji każdej potrawy wystarczy zapas.
                </Text>
              </View>
              <Text style={[styles.formSection, theme.isPremium && { color: DS.color.heading }]}>Typ produktu</Text>
              <View
                style={[
                  styles.switchRow,
                  theme.isPremium && {
                    backgroundColor: DS.color.bgTertiary,
                    borderColor: DS.color.borderSubtle,
                  },
                ]}
              >
                <View style={styles.switchInfo}>
                  <FlaskConical size={16} color={theme.isPremium ? DS.color.greenEnd : Colors.accent} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.switchLabel, theme.isPremium && { color: DS.color.heading }]}>
                      Półprodukt / Combo
                    </Text>
                    <Text style={[styles.switchHint, theme.isPremium && { color: DS.color.muted }]}>
                      Przygotowywany wewnętrznie z innych produktów z magazynu np. Sos kurkowy do Penne z kurkami i kozim serem.
                    </Text>
                  </View>
                </View>
                <Switch
                  value={form.isCombo}
                  onValueChange={(v) => {
                    setForm((f) => ({ ...f, isCombo: v }));
                    if (v && comboIngredients.length === 0) {
                      setComboIngredients([newComboIngredient()]);
                    }
                  }}
                  trackColor={{
                    false: theme.isPremium ? DS.color.borderSubtle : Colors.borderLight,
                    true: theme.isPremium ? 'rgba(0,230,118,0.45)' : Colors.accentLight,
                  }}
                  thumbColor={
                    form.isCombo
                      ? theme.isPremium
                        ? DS.color.greenEnd
                        : Colors.accent
                      : theme.isPremium
                        ? DS.color.muted
                        : Colors.textTertiary
                  }
                />
              </View>

              {form.isCombo && (
                <View style={{ gap: 10, marginBottom: 8 }}>
                  <Text style={[styles.formSection, theme.isPremium && { color: DS.color.heading }]}>
                    Receptura półproduktu
                  </Text>
                  {comboIngredients.map((ing, idx) => {
                    const q = ing.name.trim().toLowerCase();
                    const suggestions =
                      q.length >= 2
                        ? inventory
                            .filter((p) => p.id !== editingId && p.product_name.toLowerCase().includes(q))
                            .slice(0, 5)
                        : [];
                    return (
                      <View
                        key={ing.key}
                        style={[
                          styles.comboIngCard,
                          theme.isPremium && {
                            backgroundColor: DS.color.surfaceCard,
                            borderColor: DS.color.borderSubtle,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.comboIngIndex,
                            theme.isPremium && { color: DS.color.greenEnd },
                          ]}
                        >
                          {idx + 1}
                        </Text>
                        <View style={{ flex: 1, gap: 8 }}>
                          <TextInput
                            style={[
                              formStyles.input,
                              { marginBottom: 0 },
                              theme.isPremium && {
                                backgroundColor: DS.color.bgTertiary,
                                borderColor: DS.color.borderSubtle,
                                color: DS.color.heading,
                              },
                            ]}
                            value={ing.name}
                            onChangeText={(v) =>
                              setComboIngredients((prev) =>
                                prev.map((x) =>
                                  x.key === ing.key
                                    ? { ...x, name: v, warehouse_product_id: null }
                                    : x,
                                ),
                              )
                            }
                            placeholder="Nazwa składnika"
                            placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                          />
                          {suggestions.length > 0 && (
                            <View
                              style={[
                                styles.comboSuggestBox,
                                theme.isPremium && {
                                  backgroundColor: DS.color.bgTertiary,
                                  borderColor: DS.color.borderSubtle,
                                },
                              ]}
                            >
                              {suggestions.map((s) => (
                                <TouchableOpacity
                                  key={s.id}
                                  onPress={() =>
                                    setComboIngredients((prev) =>
                                      prev.map((x) =>
                                        x.key === ing.key
                                          ? {
                                              ...x,
                                              name: s.product_name,
                                              unit: s.unit === 'opak' ? 'szt' : s.unit,
                                              warehouse_product_id: s.id,
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                  style={styles.comboSuggestRow}
                                >
                                  <Text
                                    style={[
                                      styles.comboSuggestText,
                                      theme.isPremium && { color: DS.color.heading },
                                    ]}
                                  >
                                    {s.product_name}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                            <TextInput
                              style={[
                                formStyles.input,
                                { flex: 1, marginBottom: 0 },
                                theme.isPremium && {
                                  backgroundColor: DS.color.bgTertiary,
                                  borderColor: DS.color.borderSubtle,
                                  color: DS.color.heading,
                                },
                              ]}
                              value={ing.quantity}
                              onChangeText={(v) =>
                                setComboIngredients((prev) =>
                                  prev.map((x) =>
                                    x.key === ing.key ? { ...x, quantity: v.replace(',', '.') } : x,
                                  ),
                                )
                              }
                              placeholder="Ilość"
                              placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                              keyboardType="decimal-pad"
                            />
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1.4 }}>
                              {COMBO_UNIT_OPTIONS.map((u) => {
                                const active = ing.unit === u;
                                return (
                                  <TouchableOpacity
                                    key={u}
                                    style={[
                                      styles.unitBtn,
                                      { paddingHorizontal: 8, paddingVertical: 6 },
                                      theme.isPremium && {
                                        backgroundColor: DS.color.bgTertiary,
                                        borderColor: DS.color.borderSubtle,
                                      },
                                      active &&
                                        (theme.isPremium
                                          ? {
                                              backgroundColor: DS.color.greenEnd,
                                              borderColor: DS.color.greenEnd,
                                            }
                                          : styles.unitBtnActive),
                                    ]}
                                    onPress={() =>
                                      setComboIngredients((prev) =>
                                        prev.map((x) =>
                                          x.key === ing.key ? { ...x, unit: u } : x,
                                        ),
                                      )
                                    }
                                  >
                                    <Text
                                      style={[
                                        styles.unitBtnText,
                                        theme.isPremium && !active && { color: DS.color.muted },
                                        active &&
                                          (theme.isPremium
                                            ? { color: '#0A0A0A', fontWeight: '800' }
                                            : styles.unitBtnTextActive),
                                      ]}
                                    >
                                      {u}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                            <TouchableOpacity
                              onPress={() =>
                                setComboIngredients((prev) =>
                                  prev.length <= 1
                                    ? [newComboIngredient()]
                                    : prev.filter((x) => x.key !== ing.key),
                                )
                              }
                              hitSlop={8}
                            >
                              <Trash2 size={14} color={Colors.danger} strokeWidth={2} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  <TouchableOpacity
                    style={[
                      styles.addIngBtn,
                      theme.isPremium && {
                        borderColor: DS.color.greenEnd,
                        backgroundColor: 'rgba(0,255,120,0.1)',
                      },
                    ]}
                    onPress={() => setComboIngredients((prev) => [...prev, newComboIngredient()])}
                    activeOpacity={0.8}
                  >
                    <Plus size={15} color={theme.isPremium ? DS.color.greenEnd : Colors.accent} strokeWidth={2.5} />
                    <Text style={[styles.addIngBtnText, theme.isPremium && { color: DS.color.greenEnd }]}>
                      Dodaj składnik
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.fieldWrap}>
                    <FieldLabel text="Trwałość (dni w chłodni)" />
                    <NumericInput
                      value={form.shelfLifeDays}
                      onChange={(v) => setForm((f) => ({ ...f, shelfLifeDays: v }))}
                      placeholder="np. 3"
                    />
                    <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                      Ile dni półprodukt utrzymuje jakość w idealnych warunkach chłodniczych.
                    </Text>
                  </View>
                </View>
              )}

              <View style={styles.fieldWrap}>
                <FieldLabel text={`Bufor bezpieczeństwa (%) — min 10, domyślnie 20`} />
                <NumericInput
                  value={form.safetyBuffer}
                  onChange={(v) => setForm((f) => ({ ...f, safetyBuffer: v }))}
                  placeholder="20"
                />
                <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                  Ostrzeżenie o niskim stanie włączone wcześniej o {form.safetyBuffer || 20}% jako
                  bufor na ubytki naturalne i straty (min. 10%).
                </Text>
              </View>
              {form.name.trim() !== '' && form.currentQty !== '' && form.criticalThreshold !== '' && (
                <View style={styles.previewWrap}>
                  <Text style={[styles.previewLabel, theme.isPremium && { color: DS.color.muted }]}>
                    Pogląd karty produktu
                  </Text>
                  <ItemCard
                    item={{
                      id: '__preview__',
                      product_name: form.name.trim(),
                      category: form.category,
                      category_id: categoryIdMap[form.category] ?? null,
                      current_qty: parseFloat(form.currentQty) || 0,
                      critical_threshold: parseFloat(form.criticalThreshold) || 1,
                      optimal_threshold: parseFloat(form.optimalThreshold) || 0,
                      unit: form.unit,
                      is_combo_półprodukt: form.isCombo,
                      portion_size: null,
                      safety_buffer_percent: parseFloat(form.safetyBuffer) || 20,
                      shelf_life_days: form.shelfLifeDays ? parseInt(form.shelfLifeDays, 10) : null,
                    }}
                    catColor={categoryColorMap[form.category] ?? FALLBACK_COLOR}
                  />
                </View>
              )}
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  theme.isPremium && { backgroundColor: DS.color.greenEnd, shadowColor: DS.color.greenEnd },
                  saving && { opacity: 0.6 },
                ]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Check size={18} color={theme.isPremium ? '#0A0A0A' : Colors.white} strokeWidth={2.5} />
                <Text style={[styles.saveBtnText, theme.isPremium && { color: '#0A0A0A' }]}>
                  {saving ? 'Zapisywanie...' : (editingId ? 'Zapisz zmiany' : 'Zapisz Produkt')}
                </Text>
              </TouchableOpacity>
              <View style={{ height: 32 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Waste Report Modal — ręczne zgłaszanie + logi okresowe */}
      <WasteReportModal
        visible={showWasteLogs}
        onClose={() => setShowWasteLogs(false)}
        onSaved={fetchData}
      />

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
    </>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {theme.isPremium ? (
        <PremiumTabChrome
          title="Magazyn"
          subtitle="Panel magazynowy"
          meta={`${inventory.length} produktów${totalCritical > 0 ? ` · ${totalCritical} alertów` : ' · Stan OK'}`}
          showFloats={false}
          headerVariant="centered"
          belowHeader={
            <View style={styles.actionBtnsWrap}>{headerActions}</View>
          }
        >
          {body}
        </PremiumTabChrome>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, fontWeight: '500' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'flex-end' },
  actionBtnsWrap: {
    paddingHorizontal: DS.space.screen,
    marginBottom: 14,
    alignItems: 'stretch',
  },
  actionBtnsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  magPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: 22,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  magPillIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  magPillText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  addHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: Colors.accentLight, borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE' },
  addHeaderBtnText: { fontSize: 12, fontWeight: '600', color: Colors.accent },
  wasteBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: Colors.dangerLight, borderRadius: 8, borderWidth: 1, borderColor: '#FECACA' },
  wasteBtnText: { fontSize: 12, fontWeight: '600', color: Colors.danger },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 10, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, fontSize: 13, color: Colors.textPrimary, padding: 0 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  catSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, paddingHorizontal: 2 },
  catSectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  addCatBtnWrap: { borderRadius: 8 },
  addCatBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  addCatBtnText: { fontSize: 11, fontWeight: '600', color: Colors.accent },
  addCatBtnTextPrem: { fontSize: 11, fontWeight: '800', color: '#0A0A0A' },
  searchResultLabel: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary, letterSpacing: 0.4, marginBottom: 10, paddingHorizontal: 2 },
  emptyWrap: { alignItems: 'center', paddingVertical: 56, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', maxWidth: 280 },
  fabContainer: { position: 'absolute', bottom: 24, right: 20, alignItems: 'flex-end' },
  fabWrap: { borderRadius: 28 },
  fab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
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
  comboIngCard: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: Colors.card,
  },
  comboIngIndex: { fontSize: 13, fontWeight: '800', color: Colors.accent, marginTop: 10 },
  comboSuggestBox: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  comboSuggestRow: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight },
  comboSuggestText: { fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  addIngBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: Colors.accentLight,
  },
  addIngBtnText: { fontSize: 13, fontWeight: '700', color: Colors.accent },
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