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

import type { CatalogProduct } from './types';
import { SupplierCard } from './SupplierCard';

export function CatalogRow({
  product,
  last,
  onDelete,
  onPress,
}: {
  product: CatalogProduct;
  last: boolean;
  onDelete?: (id: string) => void;
  onPress?: (product: CatalogProduct) => void;
}) {
  const theme = useAppTheme();
  const perLiter = product.liters_total > 0
    ? ` · ${formatPlnNumber(product.price_pln / product.liters_total)} zł/L`
    : '';
  return (
    <TouchableOpacity
      style={[
        catStyles.row,
        last && catStyles.rowLast,
        theme.isPremium && { borderBottomColor: theme.border },
      ]}
      onPress={onPress ? () => onPress(product) : undefined}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <View style={catStyles.info}>
        <Text style={[catStyles.name, { color: theme.text }]}>{product.name}</Text>
        <Text style={[catStyles.variant, { color: theme.textSecondary }]}>{product.variant}</Text>
      </View>
      <View style={catStyles.right}>
        <Text style={[catStyles.price, { color: theme.isPremium ? theme.accent : Colors.textPrimary }]}>
          {formatPln(product.price_pln)}
        </Text>
        {!!perLiter && (
          <Text style={[catStyles.perUnit, { color: theme.textMuted }]}>{perLiter}</Text>
        )}
      </View>
      {onDelete ? (
        <TouchableOpacity
          onPress={() => {
            Alert.alert('Usuń z katalogu', `Usunąć „${product.name}” z katalogu dostawcy?`, [
              { text: 'Anuluj', style: 'cancel' },
              {
                text: 'Usuń',
                style: 'destructive',
                onPress: () => onDelete(product.id),
              },
            ]);
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ padding: 4 }}
        >
          <Trash2 size={14} color={theme.danger} strokeWidth={2} />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

export const catStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 8 },
  rowLast: { borderBottomWidth: 0 },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  variant: { fontSize: 11, color: Colors.textSecondary },
  right: { alignItems: 'flex-end' },
  price: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  perUnit: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
});

// ─── SupplierCard ─────────────────────────────────────────────────────────────
