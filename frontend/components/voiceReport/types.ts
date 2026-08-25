import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Platform, ScrollView, TextInput,
} from 'react-native';
import { Mic, Square, X, Check, AlertTriangle, RefreshCw, Send, Info, Plus, Trash2, ShieldAlert } from 'lucide-react-native';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  getJarvisWakeWord,
  setJarvisWakeWord,
  setJarvisWakeListenEnabled,
  transcriptContainsWakeWord,
  stripWakeWord,
} from '@/lib/jarvisWakeWord';
import { DealHunterModal } from '../DealHunterModal';
import { ExpirationVoiceForm } from '../ExpirationVoiceForm';
import { PeriodPickerTree, labelForSelections, parsePeriodHintToSelection, type PeriodSelection } from '../PeriodPickerTree';
import {
  BulkPriceEditor,
  CriticalOrderEditor,
  DishPickEditor,
  IngredientNameSuggest,
  JarvisSuggestBox,
  MenuCategorySuggest,
  NavigateScreenEditor,
  OrderProductEditor,
  SupplierWithCatalogEditor,
} from '../JarvisFormExtras';
import { type OptimizeResult, normalizeOptimizeResult } from '@/lib/bargainHunter';
import {
  buildExpiryTipsForItem,
  EXPIRY_TIPS_LEGAL_DISCLAIMER,
} from '@/lib/expiryTipsCatalog';
import { fetchJson } from '@/lib/safeFetch';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  DEAL_HUNTER_GATE_MESSAGE,
  DEAL_HUNTER_GATE_TITLE,
  isDealHunterIntent,
} from '@/lib/dealHunterGate';
import { ProduceSizePicker } from '@/components/ProduceSizePicker';
import {
  findProduceConverter,
  piecesToKg,
  type ProduceSizeKey,
} from '@/lib/produceSizeConverter';
import { useAuth } from '@/contexts/AuthContext';

export type Stage =
  | 'idle' | 'recording' | 'transcribing' | 'interpreting'
  | 'review' | 'applying' | 'done' | 'error';

export type Intent =
  | 'waste' | 'add_revenue' | 'add_fixed_cost' | 'add_variable_cost'
  | 'add_inventory_item' | 'add_menu_item' | 'add_supplier'
  | 'add_supplier_product'
  // Voice CRUD (edycja parametrów istniejących obiektów)
  | 'edit_menu_item_price' | 'add_recipe_ingredient'
  | 'edit_recipe_ingredient_qty' | 'edit_inventory_item'
  | 'add_expiration_batch'
  // Dostawcy / zamówienia
  | 'order_product' | 'order_critical_items_by_category'
  | 'supplier_flip_order' | 'budget_cap_order'
  | 'compare_catalogs_top_savings' | 'predictive_weekend_restock'
  | 'check_minimum_order_value'
  // Masowe / destrukcyjne / dostępność / skalowanie / nawigacja (v2)
  | 'bulk_delete_menu' | 'bulk_delete_suppliers' | 'bulk_reset_inventory'
  | 'bulk_delete_inventory' | 'restore_last_deleted_menu' | 'restore_deleted_inventory'
  | 'delete_menu_item' | 'delete_supplier' | 'delete_inventory_item'
  | 'toggle_menu_item_availability'
  | 'bulk_edit_menu_prices_percentage' | 'bulk_edit_menu_prices_fixed'
  | 'bulk_edit_inventory_buffers'
  | 'edit_menu_item_category' | 'rename_menu_item' | 'scale_recipe'
  | 'navigate_screen' | 'filter_ui_inventory' | 'filter_ui_menu_blocked'
  | 'summarize_custom_period' | 'compare_two_periods'
  | 'rank_menu_sales' | 'rank_inventory_usage'
  | 'rank_waste_cost' | 'rank_dead_menu' | 'list_expiring_soon'
  | 'rank_supplier_spend' | 'manager_core_alerts' | 'haccp_tip'
  | 'upload_invoice' | 'upload_offer' | 'upload_document' | 'upload_menu'
  | 'unknown';

/** Intencje NIEODWRACALNE / masowe — wymagają czerwonego modalu z wpisaniem „POTWIERDZAM". */
export interface FuzzyMatch {
  field: string;
  matched_to: string;
  score: number;
  resolved_id: string;
}

export interface Interpretation {
  intent: Intent;
  confidence: number;
  reason?: string | null;
  payload: Record<string, any>;
  fuzzy_matches?: FuzzyMatch[];
  alternate_intents?: { intent: Intent; label: string }[];
  credits_deducted?: number;
  credits_remaining?: number | null;
}

export interface Props {
  visible: boolean;
  onClose: () => void;
  onApplied?: (intent: Intent) => void;
  contextHint?: string;
  /** Po otwarciu od razu start nagrywania (wake word / FAB). */
  autoStartRecording?: boolean;
  /** Po otwarciu od razu włącz nasłuch hasła w modalu. */
  autoStartWakeListen?: boolean;
}


export interface EditorProps {
  intent: Intent;
  edited: Record<string, any>;
  patch: (p: Record<string, any>) => void;
  categories: { id: string; name: string; color: string }[];
  menuCategories: string[];
}

export interface EditRowProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad' | 'email-address' | 'phone-pad';
  multiline?: boolean;
  testID?: string;
  hint?: string;
}
