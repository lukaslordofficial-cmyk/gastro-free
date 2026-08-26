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

export type Unit = 'g' | 'ml' | 'szt' | 'opak' | 'L' | 'kg' | 'porcja';

export interface CategoryRow {
  id: string;
  name: string;
  color: string;
}

export interface MockInventoryItem {
  id: string;
  product_name: string;
  /** Odmiana / wariant (opcjonalnie) — np. Irys, Jonagold, BIO. */
  variant?: string | null;
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

export type ComboIngredientDraft = {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  warehouse_product_id: string | null;
};

export type MagListRow =
  | { type: 'search_meta'; count: number; q: string }
  | { type: 'search_empty'; q: string }
  | { type: 'search_item'; item: MockInventoryItem }
  | { type: 'cat_toolbar' }
  | { type: 'mag_empty' }
  | {
      type: 'cat_header';
      cat: CategoryRow;
      itemCount: number;
      criticalCount: number;
      warningCount: number;
    }
  | { type: 'cat_item'; item: MockInventoryItem; catColor: string }
  | { type: 'cat_empty'; catId: string }
  | { type: 'uncat_header'; itemCount: number }
  | { type: 'uncat_item'; item: MockInventoryItem };

export interface WasteLogRow {
  id: string;
  item_name: string;
  quantity: number;
  unit: string;
  reason: string | null;
  created_at: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────────────

export interface CategorySectionProps {
  category: CategoryRow;
  itemCount: number;
  criticalCount: number;
  warningCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}
