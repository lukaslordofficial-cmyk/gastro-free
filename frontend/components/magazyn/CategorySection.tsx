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

import type { CategorySectionProps } from './types';

export function CategorySection({
  category,
  itemCount,
  criticalCount,
  warningCount,
  isExpanded,
  onToggle,
  onDelete,
}: CategorySectionProps) {
  const theme = useAppTheme();

  if (theme.isPremium) {
    return (
      <View style={catStyles.premSection}>
        <View style={catStyles.premHeader}>
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}
            onPress={onToggle}
            activeOpacity={0.75}
          >
            <View style={[catStyles.premDot, { backgroundColor: category.color || DS.color.greenEnd }]} />
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <Text style={catStyles.premCatName} allowFontScaling={false}>
                {category.name}
              </Text>
              <View style={catStyles.countRow}>
                <Text style={catStyles.premCount} allowFontScaling={false}>
                  {itemCount} prod.
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
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={catStyles.deleteBtn}
            testID={`delete-cat-${category.id}`}
          >
            <Trash2 size={14} color={DS.color.danger} strokeWidth={2.2} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onToggle} hitSlop={10} style={{ padding: 4 }}>
            {isExpanded
              ? <ChevronDown size={16} color={DS.color.muted} strokeWidth={2} />
              : <ChevronRight size={16} color={DS.color.muted} strokeWidth={2} />}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={catStyles.section}>
      <View style={catStyles.header}>
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'stretch', minWidth: 0 }}
          onPress={onToggle}
          activeOpacity={0.75}
        >
          <View style={[catStyles.colorBar, { backgroundColor: category.color }]} />
          <View style={[catStyles.headerContent, { flex: 1 }]}>
            <View style={catStyles.headerLeft}>
              <Text style={catStyles.catName}>{category.name}</Text>
              <View style={catStyles.countRow}>
                <Text style={catStyles.totalCount}>{itemCount} produktów</Text>
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
          </View>
        </TouchableOpacity>
        <View style={[catStyles.headerRight, { paddingRight: 12 }]}>
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={catStyles.deleteBtn}
            testID={`delete-cat-${category.id}`}
          >
            <Trash2 size={13} color={Colors.danger} strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onToggle} hitSlop={10}>
            {isExpanded
              ? <ChevronDown size={18} color={Colors.textSecondary} strokeWidth={2} />
              : <ChevronRight size={18} color={Colors.textSecondary} strokeWidth={2} />}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export const catStyles = StyleSheet.create({
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
