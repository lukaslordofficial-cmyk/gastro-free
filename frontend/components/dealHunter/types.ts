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

export interface ProductLike {
  id: string;
  product_name: string;
  variant?: string | null;
  current_qty: number;
  critical_threshold: number;
  unit: string;
}

export interface Props {
  visible: boolean;
  product: ProductLike | null;
  restaurantName?: string;
  onClose: () => void;
  initialCompare?: OptimizeResult | null;
  bulkContextLabel?: string;
}

export type Step = 'qty' | 'compare' | 'contact' | 'preview';
export type SelectedOption = 'all_one' | 'optimized' | 'single' | 'split_max' | 'monolith' | 'smart_hybrid';

/** Wybór wariantu od razu przy otwarciu — bez czekania na klik w kafelek. */
export interface MessageCard {
  supplier_id: string | null;
  supplier_name: string;
  supplier_email: string | null;
  email_subject: string;
  email_html: string;
  email_text: string;
  email_body_text: string;
  sms_text: string;
  subtotal_pln: number;
}

export type CatalogRow = {
  id: string;
  name: string;
  variant: string | null;
  unit: string | null;
  price_pln: number;
  /** true = produkt z menu / widoczny w ofercie menu */
  in_menu: boolean;
};

export type InvStock = { id: string; name: string; quantity: number; unit: string; min_quantity: number };
export type CatalogBrowseRow = {
  id: string;
  supplier_id: string;
  name: string;
  variant: string | null;
  unit: string;
  price_pln: number;
  in_menu: boolean;
};
export type SupplierBrowse = {
  id: string;
  name: string;
  email: string | null;
  min_order_value: number;
  products: CatalogBrowseRow[];
};
