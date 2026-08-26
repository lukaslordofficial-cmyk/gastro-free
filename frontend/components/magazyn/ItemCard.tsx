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
  DeviceEventEmitter,
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
import { getAccountKey } from '@/lib/accountKey';
import * as inventoryService from '@/services/inventoryService';
import { INVENTORY_CHANGED } from '@/services/supplierOrdersService';
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
import { useAuth } from '@/contexts/AuthContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { DEAL_HUNTER_GATE_MESSAGE, DEAL_HUNTER_GATE_TITLE } from '@/lib/dealHunterGate';
import { secureId } from '@/lib/secureId';

// ─── Types ───────────────────────────────────────────────────────────────────────────────

import type { MockInventoryItem } from './types';
import { formatQty, getStatus } from './helpers';
import { CategorySection } from './CategorySection';

export function ItemCard({ item, catColor, onDelete, onPress, onOrder, onEdit }: { item: MockInventoryItem; catColor: string; onDelete?: () => void; onPress?: () => void; onOrder?: () => void; onEdit?: () => void }) {
  const theme = useAppTheme();
  const status = getStatus(item);
  const ratio = item.current_qty / Math.max(item.critical_threshold, 0.001);
  const fillPercent = Math.min(100, Math.round(ratio * 100));
  const thumbSrc = useMemo(() => imageSourceForProduct(item.product_name), [item.product_name]);
  const isComboLow = item.is_combo_półprodukt && status !== 'ok';
  const lowStockActionLabel = isComboLow
    ? 'Dorób półprodukt'
    : 'Zamów u dostawcy';
  const lowStockHint = isComboLow
    ? (status === 'critical'
      ? 'Ilość półproduktu spadła poniżej poziomu krytycznego — trzeba dorobić'
      : 'Niski stan półproduktu — zaplanuj doróbkę')
    : (status === 'critical' ? 'Stan krytyczny — uzupełnij zapas' : 'Niski stan magazynowy');

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
              {item.variant ? (
                <View style={itemStyles.variantChip} testID={`inv-variant-${item.id}`}>
                  <Tag size={9} color={DS.color.greenEnd} strokeWidth={2.4} />
                  <Text style={itemStyles.variantChipText} numberOfLines={1}>Odmiana: {item.variant}</Text>
                </View>
              ) : null}
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 4 }}>
              {onEdit ? (
                <TouchableOpacity onPress={onEdit} hitSlop={10} style={{ padding: 4 }} testID={`edit-inv-${item.id}`}>
                  <PenLine size={14} color={DS.color.greenEnd} strokeWidth={2.4} />
                </TouchableOpacity>
              ) : null}
              {onDelete ? (
                <TouchableOpacity
                  onPress={onDelete}
                  hitSlop={10}
                  style={{ padding: 4 }}
                  testID={`delete-inv-${item.id}`}
                >
                  <Trash2 size={14} color={DS.color.danger} strokeWidth={2.2} />
                </TouchableOpacity>
              ) : null}
              {onOrder && !item.is_combo_półprodukt ? (
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
              ) : isComboLow && onEdit ? (
                <TouchableOpacity onPress={onEdit} hitSlop={10} style={{ padding: 4 }} testID={`remake-inv-${item.id}`}>
                  <FlaskConical size={16} color={DS.color.warning} strokeWidth={2.4} />
                </TouchableOpacity>
              ) : null}
            </View>
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
            {item.variant ? (
              <Text style={itemStyles.variantLine} numberOfLines={1} testID={`inv-variant-${item.id}`}>Odmiana: {item.variant}</Text>
            ) : null}
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
                testID={`delete-inv-${item.id}`}
              >
                <Trash2 size={13} color={Colors.danger} strokeWidth={2.2} />
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
            {lowStockHint}
          </Text>
        )}

        <View style={itemStyles.progressBg}>
          <View style={[itemStyles.progressFill, { width: `${fillPercent}%` as any, backgroundColor: palette.bar }]} />
        </View>

        {status !== 'ok' && (isComboLow ? onEdit : onOrder) && (
          <TouchableOpacity
            style={[itemStyles.orderBtn, { backgroundColor: palette.badgeText }]}
            onPress={isComboLow ? onEdit : onOrder}
            activeOpacity={0.85}
            testID={`order-btn-${item.id}`}
          >
            {isComboLow
              ? <FlaskConical size={13} color={Colors.white} strokeWidth={2.5} />
              : <ShoppingCart size={13} color={Colors.white} strokeWidth={2.5} />}
            <Text style={itemStyles.orderBtnText}>{lowStockActionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

export const itemStyles = StyleSheet.create({
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
  variantLine: { fontSize: 10, fontWeight: '600', color: Colors.accent, marginTop: 1 },
  variantChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  variantChipText: { fontSize: 10, fontWeight: '600', color: DS.color.greenEnd },
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
