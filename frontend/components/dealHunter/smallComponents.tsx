import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  X,
  Sparkles,
  Truck,
  Mail,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  Store,
  Phone,
  Send,
  CircleAlert,
  Minus,
  Plus,
  Trash2,
  Search,
  ShoppingCart,
  Package,
  CreditCard,
  Landmark,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { DEAL_HUNTER_GATE_MESSAGE, DEAL_HUNTER_GATE_TITLE } from '@/lib/dealHunterGate';
import { rankProductMatches } from '@/lib/fuzzyProductMatch';
import { formatPln } from '@/lib/format';
import {
  checkSupplierMinOrder,
  minOrderAlertCopy,
} from '@/lib/supplierMinOrder';
import { ASSISTANT_FROM_EMAIL } from '@/components/OrderEmailComposer';
import { stripAssistantOrderFooter } from '@/lib/orderEmailFooter';
import { openMailInBrowser } from '@/lib/openMailCompose';
import * as supplierOrdersService from '@/services/supplierOrdersService';
import {
  type OptimizeResult,
  type OfferItem,
  type SupplierGroup,
  initQuantities,
  normalizeOptimizeResult,
  recalcFromMatrix,
  recalcLineTotal,
  toSupplierGroups,
} from '@/lib/bargainHunter';
import { supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import { apiJsonHeaders } from '@/lib/apiHeaders';
import {
  type DealHunterSearchScope,
  DEAL_HUNTER_SEARCH_SCOPE_OPTIONS,
  DEFAULT_DEAL_HUNTER_SEARCH_SCOPE,
} from '@/lib/dealHunterSearchScope';
import { LocalProducerCheckoutSheet } from '@/components/dealHunter/LocalProducerCheckoutSheet';
import {
  ManualBankPaymentSheet,
  type ManualPaymentOrder,
} from '@/components/dealHunter/ManualBankPaymentSheet';

import { themedStyles, useDealColors } from './theme';

export function QtyStepper({
  value,
  unit,
  onChange,
  testID,
}: {
  value: number;
  unit: string;
  onChange: (v: number) => void;
  testID?: string;
}) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const step = value >= 10 ? 1 : value >= 1 ? 0.5 : 0.1;
  const dec = () => onChange(Math.max(step, Math.round((value - step) * 100) / 100));
  const inc = () => onChange(Math.round((value + step) * 100) / 100);

  const commitDraft = () => {
    const n = Number(String(draft).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setDraft(String(value));
      return;
    }
    const rounded = Math.round(n * 100) / 100;
    onChange(rounded);
    setDraft(String(rounded));
  };

  return (
    <View style={styles.qtyStepper} testID={testID}>
      <TouchableOpacity onPress={dec} style={styles.qtyStepBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Minus size={14} color={C.textSecondary} strokeWidth={2.5} />
      </TouchableOpacity>
      <View style={styles.qtyStepInputWrap}>
        <TextInput
          style={styles.qtyStepInput}
          value={draft}
          onChangeText={setDraft}
          onBlur={commitDraft}
          onSubmitEditing={commitDraft}
          keyboardType="decimal-pad"
          selectTextOnFocus
          testID={testID ? `${testID}-input` : undefined}
        />
        <Text style={styles.qtyStepUnit}>{unit}</Text>
      </View>
      <TouchableOpacity onPress={inc} style={styles.qtyStepBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Plus size={14} color={C.accent} strokeWidth={2.5} />
      </TouchableOpacity>
    </View>
  );
}

export function OfferLine({
  item,
  productKey,
  onQtyChange,
  onRemove,
  editable,
}: {
  item: OfferItem;
  productKey: string;
  onQtyChange: (key: string, qty: number) => void;
  onRemove?: () => void;
  editable?: boolean;
}) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  return (
    <View style={styles.optLine}>
      <View style={styles.optLineLeft}>
        <Text style={styles.optLineName} numberOfLines={2}>
          {item.matched_name}
        </Text>
        <Text style={styles.optLineMeta} numberOfLines={1}>
          {formatPln(item.unit_price_base)} / {item.unit}
          {item.base_dim && item.base_dim !== item.unit ? ` · baza: ${item.base_dim}` : ''}
        </Text>
        <QtyStepper
          value={item.quantity}
          unit={item.unit}
          onChange={(q) => onQtyChange(productKey, q)}
          testID={`deal-hunter-qty-${productKey}`}
        />
      </View>
      <View style={styles.optLineRight}>
        <Text style={styles.optLinePrice}>{formatPln(item.line_total)}</Text>
        {editable && onRemove ? (
          <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID={`deal-hunter-remove-${productKey}`}>
            <Trash2 size={14} color={C.danger} strokeWidth={2} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function MinOrderBadge({ meets, minVal }: { meets?: boolean; minVal?: number }) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  if (!minVal || minVal <= 0 || meets) return null;
  return (
    <View style={styles.minOrderBadge}>
      <Text style={styles.minOrderText}>Min. zamówienie: {formatPln(minVal)}</Text>
    </View>
  );
}
