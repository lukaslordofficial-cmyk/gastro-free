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

import type { CatalogProduct, Supplier } from './types';
import { OfferStatusBadge } from './OfferStatusBadge';

export function mapDbRow(row: any, menuIngredientNames: string[] = []): Supplier {
  return {
    id: row.id,
    name: row.name,
    nip: row.nip ?? '',
    category: row.category ?? '',
    contact_person: row.contact_person ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    notes: row.notes ?? '',
    icon_color: row.icon_color ?? Colors.textSecondary,
    min_order_value: Number(row.min_order_value ?? 0),
    shipping_cost: Number(row.shipping_cost ?? 0),
    free_shipping_threshold: Number(row.free_shipping_threshold ?? 0),
    lead_time_days:
      row.lead_time_days != null && row.lead_time_days !== ''
        ? Number(row.lead_time_days)
        : null,
    address: row.address ?? '',
    bank_account: row.bank_account ?? '',
    catalog: (row.supplier_catalog ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((c: any): CatalogProduct => {
        const fromDb = c.is_visible !== false;
        const fromFuzzy =
          !fromDb &&
          menuIngredientNames.length > 0 &&
          matchesAnyMenuIngredient(c.name, menuIngredientNames, 72);
        return {
          id: c.id,
          name: c.name,
          variant: c.variant,
          volume_label: c.volume_label ?? '',
          unit: (c.unit || 'szt').trim() || 'szt',
          unit_count: Number(c.unit_count),
          price_pln: Number(c.price_pln),
          liters_total: Number(c.liters_total),
          in_menu: fromDb || fromFuzzy,
        };
      }),
  };
}

// ─── OfferStatusBadge ─────────────────────────────────────────────────────────
