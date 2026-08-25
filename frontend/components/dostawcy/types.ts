import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Switch,
  Image,
  DeviceEventEmitter,
} from 'react-native';
import * as Linking from 'expo-linking';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Truck,
  Sparkles,
  X,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Plus,
  Check,
  FileText,
  Upload,
  CircleAlert,
  Tag,
  Search,
  Eye,
  EyeOff,
  Info,
  Zap,
  Trash2,
  ShoppingCart,
  PenLine,
  ScanLine,
  TrendingUp,
  Package,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as suppliersService from '@/services/suppliersService';
import * as supplierOrdersService from '@/services/supplierOrdersService';
import { SUPPLIER_BASKET_CHANGED } from '@/services/supplierOrdersService';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { OrderModal } from '@/components/OrderModal';
import { SupplierInvoicesModal } from '@/components/suppliers/SupplierInvoicesModal';
import {
  OrderEmailComposer,
  type OrderEmailDraft,
  ASSISTANT_FROM_EMAIL,
} from '@/components/OrderEmailComposer';
import {
  ManualBankPaymentSheet,
  type ManualPaymentOrder,
} from '@/components/dealHunter/ManualBankPaymentSheet';
import { CatalogScanModal } from '@/components/CatalogScanModal';
import { fetchOrderEmailTemplate, isInternalOrderNote } from '@/lib/orderEmailTemplate';
import { resolveOrderEmailFrom } from '@/services/restaurantProfileService';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PremiumTabChrome } from '@/components/premium/PremiumTabChrome';
import {
  PremiumGlowCta,
  PremiumOutlineBtn,
} from '@/components/premium/PremiumUI';
import { DS } from '@/constants/premiumTheme';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { SupplierOrdersModal } from '@/components/SupplierOrdersModal';
import { AdBannerFooter } from '@/components/ads/AdBannerFooter';
import { formatPln, formatPlnNumber } from '@/lib/format';
import {
  checkSupplierMinOrder,
  minOrderAlertCopy,
} from '@/lib/supplierMinOrder';
import type { SupplierOffer, SupplierOfferItem } from '@/lib/types';
import { matchesAnyMenuIngredient } from '@/lib/fuzzyProductMatch';
import { secureId } from '@/lib/secureId';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CatalogProduct {
  id: string;
  name: string;
  variant: string;
  volume_label: string;
  unit: string;
  unit_count: number;
  price_pln: number;
  liters_total: number;
  /** true = występuje w menu/magazynie; false = dodatkowy z oferty */
  in_menu: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  nip: string;
  category: string;
  contact_person: string;
  phone: string;
  email: string;
  notes: string;
  icon_color: string;
  min_order_value: number;
  shipping_cost: number;
  free_shipping_threshold: number;
  lead_time_days: number | null;
  address: string;
  bank_account: string;
  catalog: CatalogProduct[];
}

export type UploadResult = { product_count: number; matched_count: number } | null;

// ─── Constants ────────────────────────────────────────────────────────────────

export type DraftItem = {
  id: string;
  name: string;
  qty: number;
  unit: string;
  price: number | null;
};

export type DraftOrder = {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  supplier_email: string | null;
  notes: string | null;
  items: DraftItem[];
};

export interface GlobalBasketItem {
  supplier_id: string;
  supplier_name: string;
  supplier_color: string;
  item_id: string;
  raw_product_name: string;
  price_net: number | null;
  unit: string;
}

export interface GlobalBasketGroup {
  supplier_id: string;
  supplier_name: string;
  supplier_color: string;
  items: GlobalBasketItem[];
}
