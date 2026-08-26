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
import { namesMatch, ingredientDedupeKey } from '@/lib/fuzzyProductMatch';
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

import type { ComboIngredientDraft, MockInventoryItem, Unit } from './types';
import { ItemCard } from './ItemCard';

export function newComboIngredient(): ComboIngredientDraft {
  return {
    key: secureId('combo'),
    name: '',
    quantity: '',
    unit: 'g',
    warehouse_product_id: null,
  };
}

/** bakłażan === bakłażany (stem + fuzzy), z pominięciem edytowanego wiersza. */
export function findExistingWarehouseItem(
  inventory: MockInventoryItem[],
  name: string,
  editingId: string | null,
): MockInventoryItem | undefined {
  const key = ingredientDedupeKey(name);
  return inventory.find((i) => {
    if (editingId && i.id === editingId) return false;
    return ingredientDedupeKey(i.product_name) === key || namesMatch(i.product_name, name, 86);
  });
}

export function getStatus(item: MockInventoryItem): 'critical' | 'warning' | 'ok' {
  const bufferMult = 1 + (Math.max(10, item.safety_buffer_percent ?? 20) / 100);
  const effectiveWarn = item.critical_threshold * bufferMult;
  if (item.current_qty <= item.critical_threshold * 0.5) return 'critical';
  if (item.current_qty <= effectiveWarn) return 'warning';
  return 'ok';
}

export function formatQty(qty: number, unit: string): string {
  if ((unit === 'g' || unit === 'ml') && qty >= 1000) {
    const converted = qty / 1000;
    const label = unit === 'g' ? 'kg' : 'L';
    return `${converted % 1 === 0 ? converted.toFixed(0) : converted.toFixed(1)} ${label}`;
  }
  return `${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(1)} ${unit}`;
}

export function formatWasteDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function mapDbRow(row: any): MockInventoryItem {
  return {
    id: row.id,
    product_name: row.name,
    variant: row.variant ?? null,
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
