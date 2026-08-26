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

import type { Unit } from './types';

export const COMBO_UNIT_OPTIONS = ['porcja', 'g', 'ml', 'szt', 'kg', 'L'] as const;

export const UNIT_OPTIONS: Unit[] = ['g', 'kg', 'ml', 'L', 'szt', 'opak', 'porcja'];
export const FALLBACK_COLOR = '#64748B';

export const CAT_AUTO_COLORS = [
  '#DC2626', '#0891B2', '#16A34A', '#D97706', '#7C3AED',
  '#3B82F6', '#EC4899', '#65A30D', '#F59E0B', '#06B6D4',
  '#EF4444', '#78716C', '#84CC16', '#8B5CF6', '#10B981',
];

// ─── Helpers ───────────────────────────────────────────────────────────────────────────

/**
 * Uwzględnia bufor bezpieczeństwa (+X% do progu krytycznego).
 * Warning zapala się wcześniej — na wysokości critical * (1 + buffer/100).
 */
export const BLANK_FORM = {
  name: '',
  variant: '',
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
