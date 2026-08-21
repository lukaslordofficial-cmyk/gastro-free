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
import * as Linking from 'expo-linking';
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
import { DEAL_HUNTER_GATE_MESSAGE, DEAL_HUNTER_GATE_TITLE } from '@/lib/dealHunterGate';
import { rankProductMatches } from '@/lib/fuzzyProductMatch';
import { formatPln } from '@/lib/format';
import { ASSISTANT_FROM_EMAIL } from '@/components/OrderEmailComposer';
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

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

/** Paleta UI — darmowa (Colors) albo Pro Dark. */
function useDealColors() {
  const t = useAppTheme();
  return useMemo(() => {
    if (!t.isPremium) {
      return { ...Colors, isPremium: false as const, cardActive: '#FBFDFF', chipBorder: '#BFDBFE' };
    }
    return {
      ...Colors,
      isPremium: true as const,
      background: t.bg,
      card: t.card,
      textPrimary: t.text,
      textSecondary: t.textSecondary,
      textTertiary: t.textMuted,
      accent: t.accent,
      accentLight: t.accentSoft,
      accentDark: t.accent,
      success: t.success,
      successLight: t.accentSoft,
      danger: t.danger,
      dangerLight: 'rgba(255,61,0,0.15)',
      warning: t.warning,
      warningLight: 'rgba(251,191,36,0.12)',
      border: t.border,
      borderLight: 'rgba(255,255,255,0.04)',
      shadow: '#000000',
      overlay: 'rgba(0,0,0,0.72)',
      cardActive: t.accentSoft,
      chipBorder: t.border,
    };
  }, [t]);
}

type DealColors = ReturnType<typeof useDealColors>;

function themedStyles(C: DealColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: Platform.OS === 'ios' ? 56 : 18,
      paddingBottom: 12,
      backgroundColor: C.card,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
      gap: 12,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    headerIcon: {
      width: 34, height: 34, borderRadius: 10, backgroundColor: C.accentLight,
      alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { fontSize: 16, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.3 },
    headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
    steps: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      backgroundColor: C.card,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: C.borderLight,
    },
    stepItem: { alignItems: 'center', gap: 4 },
    stepDot: {
      width: 24, height: 24, borderRadius: 12, backgroundColor: C.borderLight,
      alignItems: 'center', justifyContent: 'center',
    },
    stepDotActive: { backgroundColor: C.accent },
    stepDotDone: { backgroundColor: C.success },
    stepNum: { fontSize: 12, fontWeight: '700', color: C.textTertiary },
    stepNumActive: { color: C.white },
    stepLabel: { fontSize: 11, fontWeight: '600', color: C.textTertiary },
    stepLabelActive: { color: C.textPrimary },
    errorBanner: {
      backgroundColor: C.dangerLight, marginHorizontal: 16, marginTop: 12,
      borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.danger,
    },
    errorText: { fontSize: 13, color: C.danger, fontWeight: '500' },
    body: { padding: 16, gap: 12 },
    centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
    loadingText: { fontSize: 14, color: C.textSecondary },
    stockCard: {
      backgroundColor: C.card, borderRadius: 12, padding: 14, gap: 8,
      borderWidth: 1, borderColor: C.border,
    },
    stockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    stockLabel: { fontSize: 13, color: C.textSecondary },
    stockValue: { fontSize: 15, fontWeight: '700', color: C.danger },
    stockValueMuted: { fontSize: 14, fontWeight: '600', color: C.textSecondary },
    qtyHint: { fontSize: 12, color: C.textTertiary, lineHeight: 17 },
    fieldLabel: { fontSize: 12, fontWeight: '700', color: C.textSecondary, letterSpacing: 0.3 },
    qtyInputRow: { flexDirection: 'row', gap: 10 },
    qtyInput: {
      flex: 1, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 16,
      paddingVertical: 16, fontSize: 24, fontWeight: '800', color: C.textPrimary,
      textAlign: 'center', borderWidth: 2, borderColor: C.accent,
    },
    qtyUnit: {
      width: 72, backgroundColor: C.borderLight, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border,
    },
    qtyUnitText: { fontSize: 16, fontWeight: '700', color: C.textSecondary },
    footer: {
      padding: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border,
    },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: C.accent, borderRadius: 12, paddingVertical: 15,
    },
    primaryBtnDisabled: { opacity: 0.55 },
    primaryBtnText: { fontSize: 15, fontWeight: '700', color: C.white },
    speechCard: {
      flexDirection: 'row', gap: 10, backgroundColor: C.accentLight,
      borderRadius: 12, padding: 12, alignItems: 'flex-start',
    },
    speechText: { flex: 1, fontSize: 13, color: C.accentDark, lineHeight: 19, fontWeight: '500' },
    suggestionsCard: {
      backgroundColor: C.isPremium ? DS.color.surfaceCard : C.card,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: C.isPremium ? DS.color.borderSubtle : C.border,
      gap: 10,
    },
    suggestionsHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    suggestionsTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: C.textPrimary,
      flex: 1,
      letterSpacing: -0.2,
    },
    suggestionRow: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: C.isPremium ? 'rgba(255,255,255,0.06)' : C.border,
      paddingTop: 10,
      gap: 4,
    },
    suggestionType: {
      fontSize: 10,
      fontWeight: '800',
      color: C.accent,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    suggestionMsg: {
      fontSize: 12,
      color: C.textSecondary,
      lineHeight: 18,
      fontWeight: '500',
    },
    creditsNotice: {
      backgroundColor: C.accentLight, borderRadius: 10, padding: 10,
    },
    creditsNoticeText: { fontSize: 12, fontWeight: '600', color: C.accentDark, textAlign: 'center' },
    savingsBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: C.successLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    },
    savingsText: { fontSize: 13, fontWeight: '700', color: C.success },
    optCardSelected: {
      borderWidth: 2, borderColor: C.accent,
    },
    optCard: {
      backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 8,
      borderWidth: 2, borderColor: C.border,
    },
    optCardActive: { borderColor: C.accent, backgroundColor: C.cardActive },
    optCardCheaper: { borderColor: C.success },
    optHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
    optBadge: {
      flex: 1,
      flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accentLight,
      borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, minWidth: 0,
    },
    optBadgeGreen: { backgroundColor: C.successLight },
    optBadgeText: { flex: 1, flexShrink: 1, fontSize: 11, fontWeight: '700', color: C.accent },
    radio: {
      width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
    },
    radioActive: { backgroundColor: C.accent, borderColor: C.accent },
    optSupplier: { fontSize: 15, fontWeight: '700', color: C.textPrimary },
    scenarioDesc: { fontSize: 12, color: C.textSecondary, lineHeight: 17, marginBottom: 6 },
    altScenarioPreview: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
    foundInOffers: {
      fontSize: 11, color: C.textSecondary, marginTop: 6,
    },
    shipHint: { fontSize: 11, color: C.textTertiary, marginLeft: 18, marginBottom: 4 },
    tiedHint: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
    tiedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tiedChip: {
      borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
      borderWidth: 1.5, borderColor: C.border, backgroundColor: C.borderLight,
    },
    tiedChipActive: { borderColor: C.accent, backgroundColor: C.accentLight },
    tiedChipText: { fontSize: 13, fontWeight: '700', color: C.textPrimary },
    tiedChipTextActive: { color: C.accentDark },
    tiedChipSub: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
    optLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    optLineLeft: { flex: 1, gap: 4, minWidth: 0 },
    optLineRight: { alignItems: 'flex-end', gap: 6 },
    optLineName: { fontSize: 13, color: C.textSecondary },
    optLineMeta: { fontSize: 11, fontWeight: '600', color: C.textTertiary },
    optLinePrice: { fontSize: 13, fontWeight: '600', color: C.textPrimary, marginTop: 2 },
    editCart: {
      backgroundColor: C.card, borderWidth: 1.5, borderColor: C.accent + '40',
      borderRadius: 14, padding: 14, gap: 10, marginTop: 4,
    },
    editCartTitle: { fontSize: 14, fontWeight: '800', color: C.textPrimary },
    editCartHint: { fontSize: 12, color: C.textSecondary, lineHeight: 17, marginBottom: 4 },
    missingBox: {
      marginTop: 6,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.danger + '55',
      backgroundColor: C.dangerLight,
      gap: 6,
    },
    missingTitle: { fontSize: 12, fontWeight: '800', color: C.danger, marginBottom: 2 },
    missingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    missingName: { flex: 1, fontSize: 13, fontWeight: '600', color: C.danger },
    missingBadge: {
      fontSize: 11,
      fontWeight: '900',
      color: C.white,
      backgroundColor: C.danger,
      overflow: 'hidden',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      textTransform: 'uppercase',
    },
    addFromCatalogBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
      backgroundColor: C.accentLight, borderWidth: 1, borderColor: C.chipBorder,
      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 4,
    },
    addFromCatalogText: { fontSize: 12, fontWeight: '700', color: C.accent },
    supplierOrderCard: {
      borderRadius: 12, padding: 12, gap: 8,
      backgroundColor: C.background,
      borderWidth: 1,
      borderColor: C.border,
    },
    prepareSupplierBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: C.accent,
      borderRadius: 10, paddingVertical: 11, marginTop: 4,
    },
    prepareSupplierBtnText: { color: C.white, fontWeight: '800', fontSize: 13.5 },
    saveDraftBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 12, paddingVertical: 12, marginTop: 4,
      borderWidth: 1.5, borderColor: C.success, backgroundColor: C.successLight,
    },
    saveDraftBtnText: { fontSize: 14, fontWeight: '800', color: C.success },
    newOrderBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12,
      borderWidth: 1.5,
      borderColor: C.accent,
      backgroundColor: C.accentLight,
    },
    newOrderBtnText: {
      flexShrink: 1, fontSize: 13, fontWeight: '800', color: C.accent, textAlign: 'center',
    },
    newOrderHint: {
      fontSize: 11, color: C.textTertiary, textAlign: 'center', lineHeight: 15, marginTop: 6,
    },
    newOrderIntro: {
      fontSize: 12, color: C.textSecondary, paddingHorizontal: 18, marginBottom: 8, lineHeight: 17,
    },
    browseSupplier: { borderBottomWidth: 1, borderBottomColor: C.borderLight },
    browseSupplierHead: {
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14,
    },
    browseSupplierName: { fontSize: 14, fontWeight: '700', color: C.textPrimary },
    browseSupplierMeta: { fontSize: 11, color: C.textTertiary, marginTop: 1 },
    browseProduct: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 16, paddingVertical: 12, paddingLeft: 42,
      borderTopWidth: 1, borderTopColor: C.borderLight,
    },
    browseProductActive: { backgroundColor: C.accentLight },
    stockLine: { fontSize: 11, color: C.textTertiary, marginTop: 2 },
    addBar: {
      borderTopWidth: 1, borderTopColor: C.border, padding: 14, gap: 6,
      backgroundColor: C.card,
    },
    addBarTitle: { fontSize: 14, fontWeight: '800', color: C.textPrimary },
    addBarStock: { fontSize: 12, color: C.textSecondary },
    addBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    addQtyInput: {
      width: 64, borderWidth: 1, borderColor: C.border, borderRadius: 8,
      paddingHorizontal: 8, paddingVertical: 8, fontSize: 14, color: C.textPrimary,
      backgroundColor: C.background, textAlign: 'center',
    },
    addQtyUnit: { fontSize: 12, color: C.textSecondary, fontWeight: '600' },
    addBarBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: C.accent, borderRadius: 10, paddingVertical: 11,
    },
    addBarBtnText: { color: C.white, fontWeight: '800', fontSize: 13 },
    pickerOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: C.overlay,
      justifyContent: 'flex-end',
      zIndex: 50,
      elevation: 50,
    },
    pickerSheet: {
      backgroundColor: C.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      maxHeight: '85%', paddingBottom: 8,
    },
    pickerHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10,
    },
    pickerTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: C.textPrimary, marginRight: 12 },
    pickerSearch: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8,
      backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border,
      paddingHorizontal: 12, paddingVertical: 10,
    },
    pickerSearchInput: { flex: 1, fontSize: 14, color: C.textPrimary },
    pickerEmpty: { textAlign: 'center', color: C.textTertiary, padding: 24, fontSize: 13 },
    pickerSection: {
      fontSize: 11, fontWeight: '800', color: C.textTertiary, letterSpacing: 0.5,
      paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6,
    },
    pickerRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: C.borderLight,
    },
    pickerName: { fontSize: 14, fontWeight: '600', color: C.textPrimary },
    pickerVariant: { fontSize: 11, color: C.textTertiary, marginTop: 2 },
    pickerPrice: { fontSize: 13, fontWeight: '700', color: C.textPrimary },
    menuTag: {
      alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 6, paddingVertical: 2,
      borderRadius: 4, backgroundColor: C.successLight,
    },
    menuTagText: { fontSize: 10, fontWeight: '700', color: C.success },
    extraTag: {
      alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 6, paddingVertical: 2,
      borderRadius: 4, backgroundColor: C.borderLight,
    },
    extraTagText: { fontSize: 10, fontWeight: '700', color: C.textTertiary },
    qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    qtyStepBtn: {
      width: 28, height: 28, borderRadius: 8, backgroundColor: C.borderLight,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border,
    },
    qtyStepInputWrap: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      minWidth: 72, borderWidth: 1, borderColor: C.border, borderRadius: 8,
      backgroundColor: C.borderLight, paddingHorizontal: 6, paddingVertical: 2,
    },
    qtyStepInput: {
      minWidth: 36, maxWidth: 64, fontSize: 12, fontWeight: '700',
      color: C.textPrimary, paddingVertical: 2, paddingHorizontal: 2,
      textAlign: 'center',
    },
    qtyStepUnit: { fontSize: 11, fontWeight: '600', color: C.textSecondary },
    minOrderBadge: {
      backgroundColor: C.warningLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
      alignSelf: 'flex-start',
    },
    minOrderText: { fontSize: 11, fontWeight: '600', color: C.warning },
    groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    groupName: { flex: 1, fontSize: 13, fontWeight: '700', color: C.textPrimary },
    groupSub: { fontSize: 12, fontWeight: '600', color: C.textSecondary },
    optTotalRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderTopWidth: 1, borderTopColor: C.borderLight, paddingTop: 8, marginTop: 4,
    },
    optTotalLabel: { flex: 1, flexShrink: 1, fontSize: 13, fontWeight: '600', color: C.textSecondary },
    optTotalValue: { fontSize: 17, fontWeight: '800', color: C.textPrimary, flexShrink: 0 },
    infoCard: {
      backgroundColor: C.accentLight, borderRadius: 12, padding: 14, gap: 6,
    },
    infoTitle: { fontSize: 14, fontWeight: '800', color: C.textPrimary },
    infoText: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
    inputRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
      paddingHorizontal: 12, paddingVertical: 4,
    },
    textInput: { flex: 1, fontSize: 14, color: C.textPrimary, paddingVertical: 12 },
    msgIntro: { fontSize: 13, color: C.textSecondary, lineHeight: 18, marginBottom: 4 },
    msgCard: {
      backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 10,
      borderWidth: 1, borderColor: C.border,
    },
    msgHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    msgSupplier: { flex: 1, fontSize: 14, fontWeight: '800', color: C.textPrimary },
    msgTotal: { fontSize: 13, fontWeight: '700', color: C.accent },
    metaRow: { flexDirection: 'row', gap: 6 },
    metaLabel: { fontSize: 12, fontWeight: '600', color: C.textTertiary, width: 48 },
    metaValue: { flex: 1, fontSize: 12, color: C.textSecondary },
    msgSectionLabel: { fontSize: 11, fontWeight: '700', color: C.textSecondary, letterSpacing: 0.3 },
    bodyInput: {
      minHeight: 120, borderWidth: 1, borderColor: C.border, borderRadius: 10,
      padding: 10, fontSize: 13, color: C.textPrimary, backgroundColor: C.background,
    },
    successBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: C.successLight, borderRadius: 10, padding: 12,
    },
    successText: { flex: 1, fontSize: 13, fontWeight: '600', color: C.success },
    sendBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13,
    },
    sendBtnText: { fontSize: 14, fontWeight: '700', color: C.white },
    btnDisabled: { opacity: 0.5 },
    smsBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 12, paddingVertical: 12, borderWidth: 1.5, borderColor: C.accent,
      backgroundColor: C.accentLight,
    },
    smsBtnText: { fontSize: 13, fontWeight: '700', color: C.accent },
    payBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 12, paddingVertical: 13, marginTop: 10,
      backgroundColor: C.isPremium ? 'rgba(92,255,176,0.14)' : C.accentLight,
      borderWidth: 1.5, borderColor: C.accent,
    },
    payBtnText: { fontSize: 14, fontWeight: '800', color: C.accent },
    errRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    emailError: { flex: 1, fontSize: 12, color: C.danger, lineHeight: 16 },
    doneBtn: {
      backgroundColor: C.borderLight, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
      marginTop: 8,
    },
    doneBtnText: { fontSize: 15, fontWeight: '700', color: C.textPrimary },
    singleCard: {
      backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 8,
      borderWidth: 1, borderColor: C.border,
    },
  });
}

interface ProductLike {
  id: string;
  product_name: string;
  current_qty: number;
  critical_threshold: number;
  unit: string;
}

interface Props {
  visible: boolean;
  product: ProductLike | null;
  restaurantName?: string;
  onClose: () => void;
  initialCompare?: OptimizeResult | null;
  bulkContextLabel?: string;
}

type Step = 'qty' | 'compare' | 'contact' | 'preview';
type SelectedOption = 'all_one' | 'optimized' | 'single' | 'split_max' | 'monolith' | 'smart_hybrid';

/** Wybór wariantu od razu przy otwarciu — bez czekania na klik w kafelek. */
function resolveSelectionFromCompare(compare: OptimizeResult): {
  option: SelectedOption;
  tiedId: string | null;
} {
  const rec = String(compare.recommended_scenario_id || '').trim();
  if (compare.is_multivariable) {
    const scenarios = (compare.scenarios?.length
      ? compare.scenarios
      : [compare.scenario_split_max, compare.scenario_monolith].filter(Boolean)
    ) as NonNullable<OptimizeResult['scenarios']>;
    const withBaskets = (id: string) => {
      const sc = scenarios.find((s) => s.id === id)
        ?? (id === 'split_max' ? compare.scenario_split_max : null)
        ?? (id === 'monolith' ? compare.scenario_monolith : null);
      return (sc?.suppliers ?? []).filter((g) => (g.items?.length ?? 0) > 0).length;
    };
    // smart_hybrid pomijamy — zostają tylko najniższa cena vs wygoda
    let recNorm = rec === 'smart_hybrid' ? 'split_max' : rec;
    if (
      (recNorm === 'monolith')
      && withBaskets('split_max') > withBaskets(recNorm)
      && withBaskets('split_max') >= 2
    ) {
      return { option: 'split_max', tiedId: null };
    }
    if (recNorm === 'split_max' || recNorm === 'monolith') {
      return { option: recNorm, tiedId: null };
    }
    if (recNorm && recNorm !== 'smart_hybrid') {
      return { option: recNorm as SelectedOption, tiedId: null };
    }
    const first =
      scenarios.find((s) => s.id !== 'smart_hybrid' && ((s.suppliers?.length ?? 0) > 0 || (s.missing?.length ?? 0) > 0))
      ?? scenarios.find((s) => s.id !== 'smart_hybrid')
      ?? scenarios[0];
    if (first?.id && first.id !== 'smart_hybrid') {
      return { option: first.id as SelectedOption, tiedId: null };
    }
    if (withBaskets('split_max') > 0) return { option: 'split_max', tiedId: null };
    if (withBaskets('monolith') > 0) return { option: 'monolith', tiedId: null };
  }
  if (compare.is_optimized) {
    // Preferuj rozbicie gdy ma ≥2 koszyki — inaczej giną zamówienia u drugiego dostawcy
    const splitN = (compare.variant_split?.suppliers ?? []).filter((g) => g.items?.length).length;
    if (splitN >= 2) return { option: 'optimized', tiedId: null };
    return {
      option: compare.cheaper_variant === 'split' ? 'optimized' : 'all_one',
      tiedId: null,
    };
  }
  const tied = compare.tied_suppliers ?? [];
  const tiedId =
    tied.length > 0
      ? tied[0].supplier_id
      : (compare.best_option?.supplier_id ?? null);
  return { option: 'single', tiedId };
}

interface MessageCard {
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

function suggestQty(p: ProductLike): number {
  const base = p.current_qty > 0 ? p.current_qty * 1.5 : Math.max(p.critical_threshold, 1);
  const rounded = Math.round(base * 100) / 100;
  return rounded > 0 ? rounded : 1;
}

function QtyStepper({
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

function OfferLine({
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

function MinOrderBadge({ meets, minVal }: { meets?: boolean; minVal?: number }) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  if (!minVal || minVal <= 0 || meets) return null;
  return (
    <View style={styles.minOrderBadge}>
      <Text style={styles.minOrderText}>Min. zamówienie: {formatPln(minVal)}</Text>
    </View>
  );
}

function recalcGroup(g: SupplierGroup): SupplierGroup {
  const items = g.items.map((it) => ({
    ...it,
    line_total: recalcLineTotal(it.unit_price_base, it.quantity, it.unit),
  }));
  const subtotal = Math.round(items.reduce((s, it) => s + it.line_total, 0) * 100) / 100;
  const minVal = g.min_order_value ?? 0;
  return {
    ...g,
    items,
    subtotal_pln: subtotal,
    meets_minimum_order: !minVal || minVal <= 0 || subtotal >= minVal,
  };
}

type CatalogRow = {
  id: string;
  name: string;
  variant: string | null;
  unit: string | null;
  price_pln: number;
  /** true = produkt z menu / widoczny w ofercie menu */
  in_menu: boolean;
};

function sortCatalogMenuFirst<T extends { in_menu: boolean; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.in_menu !== b.in_menu) return a.in_menu ? -1 : 1;
    return a.name.localeCompare(b.name, 'pl');
  });
}

function SupplierCatalogPicker({
  visible,
  supplierId,
  supplierName,
  onClose,
  onPick,
  onResolvedSupplier,
}: {
  visible: boolean;
  supplierId: string;
  supplierName: string;
  onClose: () => void;
  onPick: (row: CatalogRow) => void;
  /** Gdy API zwróci prawdziwą nazwę / e-mail — uaktualnij koszyk. */
  onResolvedSupplier?: (info: { id: string; name: string; email?: string | null }) => void;
}) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState(supplierName);

  useEffect(() => {
    if (!visible || !supplierId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setRows([]);
      setResolvedName(supplierName);
      try {
        // 1) Backend (service role) — pełny katalog, bez problemów zagnieżdżonych Modal/RLS
        if (BACKEND_URL) {
          const headers = await apiJsonHeaders();
          const res = await fetch(
            `${BACKEND_URL}/api/suppliers/${encodeURIComponent(supplierId)}/catalog`,
            { headers },
          );
          if (res.ok) {
            const data = await res.json();
            if (cancelled) return;
            const name = String(data.supplier_name || supplierName || 'Dostawca').trim();
            setResolvedName(name);
            onResolvedSupplier?.({
              id: supplierId,
              name,
              email: data.supplier_email ?? null,
            });
            const products = Array.isArray(data.products) ? data.products : [];
            setRows(
              sortCatalogMenuFirst(
                products.map((r: any) => ({
                  id: String(r.id),
                  name: String(r.name || ''),
                  variant: r.variant ?? null,
                  unit: r.unit || 'szt',
                  price_pln: Number(r.price_pln) || 0,
                  in_menu: r.in_menu !== false,
                })).filter((r: CatalogRow) => !!r.name),
              ),
            );
            setLoading(false);
            return;
          }
        }
        // 2) Fallback: Supabase bezpośrednio
        const { data, error } = await supabase
          .from('supplier_catalog')
          .select('id,name,variant,unit,price_pln,is_visible')
          .eq('supplier_id', supplierId)
          .order('name')
          .limit(2000);
        if (cancelled) return;
        if (error) throw error;
        // Nazwa dostawcy z tabeli suppliers
        const { data: supRow } = await supabase
          .from('suppliers')
          .select('id,name,email')
          .eq('id', supplierId)
          .maybeSingle();
        if (!cancelled && supRow?.name) {
          const name = String(supRow.name).trim();
          setResolvedName(name);
          onResolvedSupplier?.({ id: supplierId, name, email: supRow.email ?? null });
        }
        setRows(
          sortCatalogMenuFirst(
            (data ?? []).map((r: any) => ({
              id: r.id,
              name: r.name,
              variant: r.variant,
              unit: r.unit || 'szt',
              price_pln: Number(r.price_pln) || 0,
              in_menu: r.is_visible !== false,
            })).filter((r: CatalogRow) => !!r.name),
          ),
        );
      } catch (e: unknown) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Nie udało się wczytać katalogu.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, supplierId, supplierName, onResolvedSupplier]);

  useEffect(() => {
    if (visible) setQ('');
  }, [visible]);

  const filtered = useMemo(() => {
    const s = q.trim();
    const list = !s
      ? rows
      : rankProductMatches(s, rows, (r) => `${r.name} ${r.variant ?? ''}`, {
          threshold: 52,
          limit: 200,
        }).map((x) => x.item);
    return sortCatalogMenuFirst(list).slice(0, 200);
  }, [rows, q]);

  const inMenu = filtered.filter((r) => r.in_menu);
  const extra = filtered.filter((r) => !r.in_menu);

  if (!visible) return null;

  const renderRow = (r: CatalogRow) => (
    <TouchableOpacity
      key={r.id}
      style={[styles.pickerRow, r.price_pln <= 0 && { opacity: 0.55 }]}
      onPress={() => {
        if (r.price_pln <= 0) {
          Alert.alert('Brak ceny', 'Ta pozycja nie ma ceny w katalogu — uzupełnij cenę u Dostawców.');
          return;
        }
        onPick(r);
      }}
      activeOpacity={0.75}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.pickerName}>{r.name}</Text>
        {!!r.variant && <Text style={styles.pickerVariant}>{r.variant}</Text>}
        {r.in_menu ? (
          <View style={styles.menuTag}>
            <Text style={styles.menuTagText}>W recepturach menu</Text>
          </View>
        ) : (
          <View style={styles.extraTag}>
            <Text style={styles.extraTagText}>Dodatkowa oferta (też do zamówienia)</Text>
          </View>
        )}
      </View>
      <Text style={styles.pickerPrice}>
        {r.price_pln > 0 ? formatPln(r.price_pln) : 'brak ceny'}
      </Text>
    </TouchableOpacity>
  );

  // Overlay WEWNĄTRZ modala Łowcy (nie drugi Modal — na web/RN zagnieżdżenie nic nie pokazywało)
  return (
    <View style={[styles.pickerOverlay, { zIndex: 50 }]} testID="deal-hunter-catalog-picker">
      <View style={styles.pickerSheet}>
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle} numberOfLines={1}>
            Katalog: {resolvedName || supplierName || 'Dostawca'}
          </Text>
          <TouchableOpacity onPress={onClose} testID="deal-hunter-catalog-close">
            <X size={22} color={C.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={styles.pickerSearch}>
          <Search size={16} color={C.textTertiary} />
          <TextInput
            style={styles.pickerSearchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Szukaj produktu…"
            placeholderTextColor={C.textTertiary}
            autoFocus
          />
        </View>
        {loading ? (
          <ActivityIndicator style={{ margin: 24 }} color={C.accent} />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled">
            {loadError ? (
              <Text style={[styles.pickerEmpty, { color: C.danger }]}>{loadError}</Text>
            ) : null}
            {filtered.length === 0 && !loadError ? (
              <Text style={styles.pickerEmpty}>Brak produktów w katalogu tego dostawcy.</Text>
            ) : (
              <>
                {inMenu.length > 0 ? (
                  <>
                    <Text style={styles.pickerSection}>W RECEPTURACH MENU ({inMenu.length})</Text>
                    {inMenu.map(renderRow)}
                  </>
                ) : null}
                {extra.length > 0 ? (
                  <>
                    <Text style={styles.pickerSection}>
                      DODATKOWA OFERTA — TEŻ DO ZAMÓWIENIA ({extra.length})
                    </Text>
                    {extra.map(renderRow)}
                  </>
                ) : null}
                {inMenu.length === 0 && extra.length === 0 && filtered.length > 0 ? (
                  filtered.map(renderRow)
                ) : null}
              </>
            )}
            <View style={{ height: 28 }} />
          </ScrollView>
        )}
      </View>
    </View>
  );
}

type InvStock = { id: string; name: string; quantity: number; unit: string; min_quantity: number };
type CatalogBrowseRow = {
  id: string;
  supplier_id: string;
  name: string;
  variant: string | null;
  unit: string;
  price_pln: number;
  in_menu: boolean;
};
type SupplierBrowse = {
  id: string;
  name: string;
  email: string | null;
  min_order_value: number;
  products: CatalogBrowseRow[];
};

function findWarehouseStock(inv: InvStock[], productName: string): InvStock | null {
  const n = (productName || '').toLowerCase().trim();
  if (!n) return null;
  let best: InvStock | null = null;
  let bestScore = 0;
  for (const i of inv) {
    const iname = (i.name || '').toLowerCase().trim();
    if (!iname) continue;
    if (iname === n) return i;
    let score = 0;
    if (iname.includes(n) || n.includes(iname)) {
      score = Math.min(iname.length, n.length) / Math.max(iname.length, n.length);
    } else {
      const at = new Set(iname.split(/\s+/).filter(Boolean));
      const bt = n.split(/\s+/).filter(Boolean);
      const hit = bt.filter((t) => at.has(t) || [...at].some((a) => a.includes(t) || t.includes(a))).length;
      if (bt.length) score = hit / bt.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 0.45 ? best : null;
}

function NewOrderBrowser({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (opts: {
    supplierId: string;
    supplierName: string;
    supplierEmail: string | null;
    productName: string;
    unit: string;
    unitPrice: number;
    quantity?: number;
    minOrder?: number;
  }) => void;
}) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [inventory, setInventory] = useState<InvStock[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierBrowse[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<{
    supplier: SupplierBrowse;
    product: CatalogBrowseRow;
  } | null>(null);
  const [addQty, setAddQty] = useState('1');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setQ('');
      setExpandedId(null);
      setSelectedProduct(null);
      const [invRes, supRes, catRes] = await Promise.all([
        supabase.from('inventory_items').select('id,name,quantity,unit,min_quantity').eq('account_key', getAccountKey()).limit(3000),
        supabase.from('suppliers').select('id,name,email,min_order_value').eq('account_key', getAccountKey()).order('name').limit(500),
        supabase.from('supplier_catalog').select('id,supplier_id,name,variant,unit,price_pln,is_visible').limit(5000),
      ]);
      if (cancelled) return;
      setInventory(
        (invRes.data ?? []).map((r: any) => ({
          id: r.id,
          name: r.name,
          quantity: Number(r.quantity ?? 0),
          unit: r.unit || 'szt',
          min_quantity: Number(r.min_quantity ?? 0),
        })),
      );
      let cats = catRes.data ?? [];
      if (catRes.error && /is_visible/.test(catRes.error.message ?? '')) {
        const retry = await supabase
          .from('supplier_catalog')
          .select('id,supplier_id,name,variant,unit,price_pln')
          .limit(5000);
        cats = retry.data ?? [];
      }
      const bySup: Record<string, CatalogBrowseRow[]> = {};
      for (const c of cats as any[]) {
        if (!(Number(c.price_pln) > 0)) continue;
        const sid = c.supplier_id;
        if (!sid) continue;
        (bySup[sid] ||= []).push({
          id: c.id,
          supplier_id: sid,
          name: c.name,
          variant: c.variant,
          unit: c.unit || 'szt',
          price_pln: Number(c.price_pln),
          in_menu: c.is_visible !== false,
        });
      }
      setSuppliers(
        (supRes.data ?? [])
          .map((s: any) => ({
            id: s.id,
            name: s.name,
            email: s.email ?? null,
            min_order_value: Number(s.min_order_value ?? 0),
            products: sortCatalogMenuFirst(bySup[s.id] ?? []),
          }))
          .filter((s) => s.products.length > 0),
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const filteredSuppliers = useMemo(() => {
    const s = q.trim();
    if (!s) return suppliers;
    const sLower = s.toLowerCase();
    return suppliers
      .map((sup) => {
        const nameHit = sup.name.toLowerCase().includes(sLower);
        const matchedProducts = sortCatalogMenuFirst(
          rankProductMatches(s, sup.products, (p) => `${p.name} ${p.variant ?? ''}`, {
            threshold: 52,
            limit: 80,
          }).map((x) => x.item),
        );
        return {
          ...sup,
          products: nameHit && matchedProducts.length === 0 ? sup.products : matchedProducts,
        };
      })
      .filter((sup) => sup.products.length > 0 || sup.name.toLowerCase().includes(sLower));
  }, [suppliers, q]);

  const stockForSelected = selectedProduct
    ? findWarehouseStock(inventory, selectedProduct.product.name)
    : null;

  if (!visible) return null;

  // Overlay wewnątrz Łowcy — nie osobny Modal (zagnieżdżenie z Jarvisem nic nie pokazywało)
  return (
      <View style={styles.pickerOverlay} testID="deal-hunter-new-order">
        <View style={[styles.pickerSheet, { maxHeight: '92%' }]}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Nowe zamówienie</Text>
            <TouchableOpacity onPress={onClose} testID="deal-hunter-new-order-close">
              <X size={22} color={C.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.newOrderIntro}>
            Wybierz dostawcę i produkt. Pozycje z receptur menu są na górze; dodatkowa oferta też jest do zamówienia.
          </Text>
          <View style={styles.pickerSearch}>
            <Search size={16} color={C.textTertiary} />
            <TextInput
              style={styles.pickerSearchInput}
              value={q}
              onChangeText={setQ}
              placeholder="Szukaj dostawcy lub produktu…"
              placeholderTextColor={C.textTertiary}
            />
          </View>
          {loading ? (
            <ActivityIndicator style={{ margin: 28 }} color={C.accent} />
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              {filteredSuppliers.map((sup) => {
                const open = expandedId === sup.id;
                const products = open ? sortCatalogMenuFirst(sup.products).slice(0, 200) : [];
                const inMenu = products.filter((p) => p.in_menu);
                const extra = products.filter((p) => !p.in_menu);
                const renderProduct = (p: CatalogBrowseRow) => {
                  const stock = findWarehouseStock(inventory, p.name);
                  const active = selectedProduct?.product.id === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.browseProduct, active && styles.browseProductActive]}
                      onPress={() => {
                        setSelectedProduct({ supplier: sup, product: p });
                        setAddQty('1');
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.pickerName}>{p.name}</Text>
                        {!!p.variant && <Text style={styles.pickerVariant}>{p.variant}</Text>}
                        <Text style={styles.stockLine}>
                          {stock
                            ? `Magazyn: ${stock.quantity} ${stock.unit}`
                              + (stock.min_quantity > 0 && stock.quantity <= stock.min_quantity
                                ? ' · stan krytyczny'
                                : '')
                            : 'Brak w magazynie (lub inna nazwa)'}
                        </Text>
                        {p.in_menu ? (
                          <View style={styles.menuTag}>
                            <Text style={styles.menuTagText}>W recepturach menu</Text>
                          </View>
                        ) : (
                          <View style={styles.extraTag}>
                            <Text style={styles.extraTagText}>Dodatkowa oferta (też do zamówienia)</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.pickerPrice}>{formatPln(p.price_pln)}</Text>
                    </TouchableOpacity>
                  );
                };
                return (
                  <View key={sup.id} style={styles.browseSupplier}>
                    <TouchableOpacity
                      style={styles.browseSupplierHead}
                      onPress={() => setExpandedId(open ? null : sup.id)}
                      activeOpacity={0.8}
                    >
                      <Truck size={15} color={C.accent} strokeWidth={2} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.browseSupplierName}>{sup.name}</Text>
                        <Text style={styles.browseSupplierMeta}>{sup.products.length} produktów w katalogu</Text>
                      </View>
                      {open
                        ? <ChevronDown size={18} color={C.textTertiary} />
                        : <ChevronRight size={18} color={C.textTertiary} />}
                    </TouchableOpacity>
                    {open && inMenu.length > 0 ? (
                      <Text style={styles.pickerSection}>W RECEPTURACH MENU</Text>
                    ) : null}
                    {inMenu.map(renderProduct)}
                    {open && extra.length > 0 ? (
                      <Text style={styles.pickerSection}>DODATKOWA OFERTA (też do zamówienia)</Text>
                    ) : null}
                    {extra.map(renderProduct)}
                  </View>
                );
              })}
              <View style={{ height: 120 }} />
            </ScrollView>
          )}

          {selectedProduct && (
            <View style={styles.addBar}>
              <Text style={styles.addBarTitle} numberOfLines={1}>
                {selectedProduct.product.name}
              </Text>
              <Text style={styles.addBarStock}>
                {stockForSelected
                  ? `Na stanie: ${stockForSelected.quantity} ${stockForSelected.unit}`
                  : 'Brak dopasowania w magazynie'}
                {' · '}{selectedProduct.supplier.name}
              </Text>
              <View style={styles.addBarRow}>
                <TextInput
                  style={styles.addQtyInput}
                  value={addQty}
                  onChangeText={setAddQty}
                  keyboardType="decimal-pad"
                  placeholder="ilość"
                  placeholderTextColor={C.textTertiary}
                />
                <Text style={styles.addQtyUnit}>{selectedProduct.product.unit}</Text>
                <TouchableOpacity
                  style={styles.addBarBtn}
                  onPress={() => {
                    const n = parseFloat(addQty.replace(',', '.'));
                    if (!isFinite(n) || n <= 0) return;
                    onAdd({
                      supplierId: selectedProduct.supplier.id,
                      supplierName: selectedProduct.supplier.name,
                      supplierEmail: selectedProduct.supplier.email,
                      productName: selectedProduct.product.name,
                      unit: selectedProduct.product.unit,
                      unitPrice: selectedProduct.product.price_pln,
                      quantity: n,
                      minOrder: selectedProduct.supplier.min_order_value,
                    });
                    setSelectedProduct(null);
                  }}
                  activeOpacity={0.85}
                >
                  <Plus size={16} color={C.white} strokeWidth={2.5} />
                  <Text style={styles.addBarBtnText}>Dodaj do zamówienia</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
  );
}

export function DealHunterModal({
  visible,
  product,
  restaurantName,
  onClose,
  initialCompare,
  bulkContextLabel,
}: Props) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  const { alert: premiumAlert } = usePremiumAlert();
  const { dealHunterUnlocked } = useSubscription();
  const lastDraftFpRef = useRef<string | null>(null);
  const compareScrollRef = useRef<ScrollView>(null);
  const [draftSavedInfo, setDraftSavedInfo] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('qty');
  const [qty, setQty] = useState('1');
  const [searchScope, setSearchScope] = useState<DealHunterSearchScope>(
    DEFAULT_DEAL_HUNTER_SEARCH_SCOPE,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<OptimizeResult | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedOption, setSelectedOption] = useState<SelectedOption | null>(null);
  const [tiedSupplierId, setTiedSupplierId] = useState<string | null>(null);
  const [creditsNotice, setCreditsNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageCard[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});
  const [bodyText, setBodyText] = useState<Record<string, string>>({});
  const [subjectText, setSubjectText] = useState<Record<string, string>>({});
  const [fromEmails, setFromEmails] = useState<Record<string, string>>({});
  const [toEmails, setToEmails] = useState<Record<string, string>>({});
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [manualCart, setManualCart] = useState<SupplierGroup[] | null>(null);
  const [catalogPicker, setCatalogPicker] = useState<{ id: string; name: string } | null>(null);
  const [pendingGroups, setPendingGroups] = useState<SupplierGroup[] | null>(null);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [lpPayGroup, setLpPayGroup] = useState<SupplierGroup | null>(null);
  const [manualPayOrder, setManualPayOrder] = useState<ManualPaymentOrder | null>(null);

  const isBulkMode = !!initialCompare;

  const patchSupplierNamesInResult = useCallback(async (normalized: OptimizeResult) => {
    const ids = new Set<string>();
    const collect = (groups?: SupplierGroup[] | null) => {
      (groups ?? []).forEach((g) => {
        if (g.supplier_id && !g.is_local_producer) ids.add(g.supplier_id);
      });
    };
    collect(normalized.scenario_split_max?.suppliers);
    collect(normalized.scenario_monolith?.suppliers);
    collect(normalized.scenario_smart_hybrid?.suppliers);
    (normalized.scenarios ?? []).forEach((sc) => collect(sc.suppliers));
    collect(normalized.variant_split?.suppliers);
    if (normalized.variant_monolith?.supplier_id) ids.add(normalized.variant_monolith.supplier_id);
    if (normalized.best_option?.supplier_id) ids.add(normalized.best_option.supplier_id);
    (normalized.best_option?.suppliers ?? []).forEach((g) => {
      if (g.supplier_id) ids.add(g.supplier_id);
    });
    if (!ids.size) return normalized;

    const { data } = await supabase
      .from('suppliers')
      .select('id,name,email')
      .in('id', [...ids]);
    const byId: Record<string, { name: string; email: string | null }> = {};
    (data ?? []).forEach((r: any) => {
      const n = String(r.name || '').trim();
      if (r.id && n) byId[r.id] = { name: n, email: r.email ?? null };
    });
    if (!Object.keys(byId).length) return normalized;

    const fixGroup = (g: SupplierGroup): SupplierGroup => {
      if (g.is_local_producer) return g;
      const hit = g.supplier_id ? byId[g.supplier_id] : null;
      if (!hit) return g;
      const cur = (g.supplier_name || '').trim();
      if (cur && cur !== 'Dostawca' && g.supplier_email) return g;
      return {
        ...g,
        supplier_name: hit.name,
        supplier_email: g.supplier_email || hit.email,
      };
    };
    const fixGroups = (groups?: SupplierGroup[]) => (groups ?? []).map(fixGroup);
    const fixScenario = <T extends { suppliers?: SupplierGroup[] }>(sc?: T | null): T | null | undefined => {
      if (!sc) return sc;
      return { ...sc, suppliers: fixGroups(sc.suppliers) };
    };

    return {
      ...normalized,
      scenario_split_max: fixScenario(normalized.scenario_split_max) ?? normalized.scenario_split_max,
      scenario_monolith: fixScenario(normalized.scenario_monolith) ?? normalized.scenario_monolith,
      scenario_smart_hybrid: fixScenario(normalized.scenario_smart_hybrid) ?? normalized.scenario_smart_hybrid,
      scenarios: (normalized.scenarios ?? []).map((sc) => ({
        ...sc,
        suppliers: fixGroups(sc.suppliers),
      })),
      variant_split: normalized.variant_split
        ? { ...normalized.variant_split, suppliers: fixGroups(normalized.variant_split.suppliers) }
        : normalized.variant_split,
      variant_monolith: normalized.variant_monolith?.supplier_id && byId[normalized.variant_monolith.supplier_id]
        ? {
            ...normalized.variant_monolith,
            supplier_name: byId[normalized.variant_monolith.supplier_id].name,
            supplier_email:
              normalized.variant_monolith.supplier_email
              || byId[normalized.variant_monolith.supplier_id].email,
          }
        : normalized.variant_monolith,
      best_option: normalized.best_option
        ? {
            ...normalized.best_option,
            ...(normalized.best_option.supplier_id && byId[normalized.best_option.supplier_id]
              ? {
                  supplier_name: byId[normalized.best_option.supplier_id].name,
                  supplier_email:
                    normalized.best_option.supplier_email
                    || byId[normalized.best_option.supplier_id].email,
                }
              : {}),
            suppliers: fixGroups(normalized.best_option.suppliers),
          }
        : normalized.best_option,
    };
  }, []);

  const applyCompareResult = useCallback((raw: unknown) => {
    const normalized = normalizeOptimizeResult(raw as OptimizeResult);
    const sel = resolveSelectionFromCompare(normalized);
    setCompare(normalized);
    setQuantities(initQuantities(normalized));
    setSelectedOption(sel.option);
    setTiedSupplierId(sel.tiedId);
    setManualCart(null);
    if (normalized.credits_deducted && normalized.credits_deducted > 0) {
      const rem = normalized.credits_remaining ?? '—';
      setCreditsNotice(
        `Ta akcja kosztowała: ${normalized.credits_deducted} kredytów. Pozostałe saldo: ${rem}.`,
      );
    } else {
      setCreditsNotice(null);
    }
    // Uzupełnij nazwy dostawców z Supabase (gdy API zwróciło null / „Dostawca”)
    void patchSupplierNamesInResult(normalized).then((patched) => {
      if (patched !== normalized) setCompare(patched);
    });
    return normalized;
  }, [patchSupplierNamesInResult]);

  useEffect(() => {
    if (visible) {
      // Free / tier 1 bez trialu — zamknij modal i pokaż bramkę (nie uruchamiaj compare)
      if (!dealHunterUnlocked) {
        premiumAlert(DEAL_HUNTER_GATE_TITLE, DEAL_HUNTER_GATE_MESSAGE);
        onClose();
        return;
      }
      setError(null);
      setManualCart(null);
      setCatalogPicker(null);
      setPendingGroups(null);
      setShowNewOrder(false);
      setMessages([]);
      setCopiedId(null);
      setSendStatus({});
      setBodyText({});
      setSubjectText({});
      setFromEmails({});
      setToEmails({});
      setDraftSavedInfo(null);
      if (initialCompare) {
        setStep('compare');
        setQty('1');
        // Selection + compare w jednym kroku — edytowalny koszyk od razu, bez klikania kafelka.
        applyCompareResult(initialCompare);
      } else if (product) {
        setStep('qty');
        setQty(String(suggestQty(product)));
        setCompare(null);
        setQuantities({});
        setSelectedOption(null);
        setTiedSupplierId(null);
        setCreditsNotice(null);
      }
    }
  }, [visible, product, initialCompare, applyCompareResult, dealHunterUnlocked, premiumAlert, onClose]);

  const liveResult = useMemo(() => {
    if (!compare) return null;
    if (!compare.pricing_matrix?.length) return compare;
    return recalcFromMatrix(compare, quantities);
  }, [compare, quantities]);

  /** Gdy state chwilowo null — i tak pokaż koszyk rekomendowanego wariantu. */
  const effectiveSelectedOption = useMemo((): SelectedOption | null => {
    if (selectedOption) return selectedOption;
    if (!liveResult) return null;
    return resolveSelectionFromCompare(liveResult).option;
  }, [selectedOption, liveResult]);

  const baseSelectedSuppliers = useCallback((): SupplierGroup[] => {
    if (!liveResult || !effectiveSelectedOption) return [];
    if (
      effectiveSelectedOption === 'split_max'
      || effectiveSelectedOption === 'monolith'
      || effectiveSelectedOption === 'smart_hybrid'
    ) {
      return toSupplierGroups(liveResult, effectiveSelectedOption, tiedSupplierId);
    }
    const variant = liveResult.is_optimized
      ? effectiveSelectedOption === 'optimized'
        ? 'optimized'
        : 'all_one'
      : 'single';
    return toSupplierGroups(liveResult, variant, tiedSupplierId);
  }, [liveResult, effectiveSelectedOption, tiedSupplierId]);

  const updateQty = useCallback((key: string, value: number) => {
    setQuantities((prev) => ({ ...prev, [key]: value }));
    setManualCart((prev) => {
      const base = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      if (!base.length) return prev;
      return base.map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) =>
          it.product_name === key ? { ...it, quantity: value } : it,
        ),
      }));
    });
  }, [baseSelectedSuppliers]);

  const ensureManualCart = useCallback((): SupplierGroup[] => {
    if (manualCart) return manualCart;
    const seeded = baseSelectedSuppliers().map((g) => recalcGroup({
      ...g,
      items: g.items.map((it) => ({ ...it })),
    }));
    setManualCart(seeded);
    return seeded;
  }, [manualCart, baseSelectedSuppliers]);

  const removeCartItem = useCallback((supplierId: string | null, productName: string) => {
    setManualCart((prev) => {
      const cart = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      return cart
        .map((g) => {
          if (g.supplier_id !== supplierId) return g;
          return recalcGroup({
            ...g,
            items: g.items.filter((it) => it.product_name !== productName),
          });
        })
        .filter((g) => g.items.length > 0);
    });
  }, [baseSelectedSuppliers]);

  const addCatalogProduct = useCallback((row: CatalogRow) => {
    if (!catalogPicker) return;
    setManualCart((prev) => {
      const cart = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      const unit = row.unit || 'szt';
      const qty = 1;
      const newItem: OfferItem = {
        product_name: row.name,
        quantity: qty,
        unit,
        base_dim: unit,
        unit_price_base: row.price_pln,
        matched_name: row.variant ? `${row.name} (${row.variant})` : row.name,
        line_total: recalcLineTotal(row.price_pln, qty, unit),
      };
      return cart.map((g) => {
        if (g.supplier_id !== catalogPicker.id) return g;
        const without = g.items.filter((it) => it.product_name !== row.name);
        return recalcGroup({
          ...g,
          supplier_name: catalogPicker.name || g.supplier_name,
          items: [...without, newItem],
        });
      });
    });
    setQuantities((prev) => ({ ...prev, [row.name]: 1 }));
    setCatalogPicker(null);
  }, [catalogPicker, baseSelectedSuppliers]);

  const resolveSupplierInCart = useCallback((info: {
    id: string;
    name: string;
    email?: string | null;
  }) => {
    const name = (info.name || '').trim();
    if (!name) return;
    setCatalogPicker((prev) => (prev && prev.id === info.id ? { ...prev, name } : prev));
    setManualCart((prev) => {
      const cart = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      let changed = false;
      const next = cart.map((g) => {
        if (g.supplier_id !== info.id) return g;
        const cur = (g.supplier_name || '').trim();
        if (cur && cur !== 'Dostawca' && cur === name && (!info.email || g.supplier_email)) {
          return g;
        }
        changed = true;
        return {
          ...g,
          supplier_name: name,
          supplier_email: info.email ?? g.supplier_email,
        };
      });
      return changed ? next : prev;
    });
  }, [baseSelectedSuppliers]);

  const selectedSuppliers = useCallback((): SupplierGroup[] => {
    if (manualCart !== null) return manualCart;
    return baseSelectedSuppliers();
  }, [manualCart, baseSelectedSuppliers]);

  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    if (!visible) lastDraftFpRef.current = null;
  }, [visible]);

  const draftFingerprint = useCallback((groups: SupplierGroup[]) => {
    return groups
      .map((g) => {
        const items = g.items
          .map((it) => `${it.product_name}:${it.quantity}:${it.unit_price_base ?? 0}`)
          .sort()
          .join(',');
        return `${g.supplier_id}|${items}`;
      })
      .sort()
      .join('||');
  }, []);

  const saveDraftCart = useCallback(async () => {
    const MAX_GAP = 150;
    const allGroups = selectedSuppliers().filter((g) => g.items.length > 0 && g.supplier_id);
    const groups = allGroups.filter((g) => {
      const minV = Number(g.min_order_value ?? 0);
      if (minV <= 0) return true;
      const gap = minV - Number(g.subtotal_pln ?? 0);
      return gap <= MAX_GAP;
    });
    const skipped = allGroups.filter((g) => !groups.includes(g));
    if (groups.length === 0) {
      premiumAlert(
        'Za daleko do minimum',
        skipped.length
          ? `Nie zapisano koszyka — do minimum brakuje ponad ${MAX_GAP} zł (${skipped.map((g) => g.supplier_name).join(', ')}). `
            + 'Dorzuć produkty albo wybierz dostawcę bez tak wysokiego limitu.'
          : 'Brak pozycji do zapisania.',
      );
      return;
    }
    if (skipped.length) {
      Alert.alert(
        'Pominięto koszyki',
        `Nie zapisano: ${skipped.map((g) => g.supplier_name).join(', ')} — do minimum brakuje ponad ${MAX_GAP} zł.`,
      );
    }
    const fp = draftFingerprint(groups);
    if (lastDraftFpRef.current === fp) {
      premiumAlert('Już w koszyku', 'Już dodałeś to zamówienie do koszyka.');
      return;
    }
    setSavingDraft(true);
    try {
      let saved = 0;
      let savedLocal = 0;
      const { data: authData } = await supabase.auth.getUser();
      const restaurantId = authData?.user?.id ?? null;
      const accountKey = getAccountKey() || null;

      for (const g of groups) {
        if (g.is_local_producer) {
          if (!restaurantId || !accountKey || !g.supplier_id) {
            continue;
          }
          const { data: order, error: orderErr } = await supabase
            .from('producer_orders')
            .insert({
              producer_id: g.supplier_id,
              restaurant_id: restaurantId,
              restaurant_account_key: accountKey,
              total_price: Number(g.subtotal_pln) || 0,
              shipping_cost: Number(g.shipping_pln) || 0,
              payment_status: 'pending',
              shipment_status: 'draft',
              notes: 'Szkic z Łowcy Okazji',
            })
            .select('id')
            .single();
          if (orderErr || !order) throw orderErr ?? new Error('Nie utworzono zamówienia lokalnego');
          const rows = g.items
            .map((it) => {
              const productId = (it as { catalog_product_id?: string }).catalog_product_id;
              if (!productId) return null;
              return {
                order_id: order.id,
                product_id: productId,
                quantity: Number(it.quantity) || 0,
                unit_price: Number(it.unit_price_base) || 0,
              };
            })
            .filter(Boolean);
          if (rows.length) {
            const { error: itemsErr } = await supabase.from('producer_order_items').insert(rows);
            if (itemsErr) throw itemsErr;
          }
          savedLocal += 1;
          continue;
        }

        const { data: order, error: orderErr } = await supabase
          .from('supplier_orders')
          .insert({
            supplier_id: g.supplier_id,
            status: 'draft',
            notes: null,
          })
          .select('id')
          .single();
        if (orderErr || !order) throw orderErr ?? new Error('Nie utworzono koszyka');
        const rows = g.items.map((it) => ({
          order_id: order.id,
          raw_product_name: it.matched_name || it.product_name,
          price_net: it.unit_price_base ?? null,
          unit: it.unit || 'szt',
          quantity_ordered: Number(it.quantity) || 0,
          warehouse_product_id: null,
        }));
        const { error: itemsErr } = await supabase.from('supplier_order_items').insert(rows);
        if (itemsErr) throw itemsErr;
        saved += 1;
      }
      lastDraftFpRef.current = fp;
      const parts: string[] = [];
      if (saved) parts.push(`${saved} szkic(ów) u hurtowników (Dostawcy → Koszyk)`);
      if (savedLocal) parts.push(`${savedLocal} szkic(ów) u lokalnych przetwórców`);
      setDraftSavedInfo(
        parts.length
          ? `Utworzono: ${parts.join(' · ')}.`
          : 'Brak koszyków do zapisania.',
      );
    } catch (e: any) {
      premiumAlert('Błąd', e?.message ?? 'Nie udało się zapisać koszyka.');
    } finally {
      setSavingDraft(false);
    }
  }, [selectedSuppliers, draftFingerprint, premiumAlert]);

  // When user taps another scenario — drop edits and show that full cart at top
  const selectOption = useCallback((opt: SelectedOption) => {
    setSelectedOption(opt);
    if (liveResult) {
      const groups = toSupplierGroups(liveResult, opt, tiedSupplierId)
        .filter((g) => (g.items?.length ?? 0) > 0)
        .map((g) => recalcGroup({
          ...g,
          items: g.items.map((it) => ({ ...it })),
        }));
      setManualCart(groups.length ? groups : null);
    } else {
      setManualCart(null);
    }
    requestAnimationFrame(() => {
      compareScrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [liveResult, tiedSupplierId]);

  const runCompare = useCallback(async () => {
    if (!product) return;
    if (!dealHunterUnlocked) {
      premiumAlert(DEAL_HUNTER_GATE_TITLE, DEAL_HUNTER_GATE_MESSAGE);
      onClose();
      return;
    }
    const q = parseFloat(qty.replace(',', '.'));
    if (isNaN(q) || q <= 0) {
      setError('Podaj poprawną ilość (liczba > 0).');
      return;
    }
    setError(null);
    setLoading(true);
    setStep('compare');
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/compare-offers`, {
        method: 'POST',
        headers: await apiJsonHeaders(),
        body: JSON.stringify({
          restaurant_name: restaurantName ?? 'Nasza restauracja',
          search_scope: searchScope,
          items: [{ product_name_or_id: product.product_name, quantity: q, unit: product.unit }],
        }),
      });
      if (!res.ok) throw new Error(`Błąd serwera (${res.status})`);
      const data = await res.json();
      const normalized = applyCompareResult(data);
      if (!normalized.best_option && !normalized.option_optimized?.suppliers?.length) {
        setError(
          searchScope === 'local_producers_only'
            ? 'Nie znaleziono tego produktu u lokalnych dostawców.'
            : searchScope === 'both'
              ? 'Nie znaleziono tego produktu u hurtowników ani lokalnych dostawców.'
              : 'Nie znaleziono tego produktu w katalogu dostawców.',
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się pobrać ofert.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [product, qty, restaurantName, searchScope, applyCompareResult, dealHunterUnlocked, premiumAlert, onClose]);

  const generateMessages = useCallback(async (groups?: SupplierGroup[]) => {
    const suppliers = groups ?? pendingGroups ?? selectedSuppliers();
    if (suppliers.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/generate-messages`, {
        method: 'POST',
        headers: await apiJsonHeaders(),
        body: JSON.stringify({ restaurant_name: restaurantName ?? 'Nasza restauracja', suppliers }),
      });
      if (!res.ok) throw new Error(`Błąd serwera (${res.status})`);
      const data = await res.json();
      const msgs: MessageCard[] = data.messages ?? [];
      setMessages(msgs);
      const initial: Record<string, string> = {};
      const subjectInit: Record<string, string> = {};
      const fromInit: Record<string, string> = {};
      const toInit: Record<string, string> = {};
      msgs.forEach((m) => {
        const key = m.supplier_id ?? m.supplier_name;
        initial[key] = m.email_body_text ?? m.email_text ?? '';
        subjectInit[key] = m.email_subject ?? '';
        fromInit[key] = ASSISTANT_FROM_EMAIL;
        toInit[key] = m.supplier_email ?? '';
      });
      setBodyText(initial);
      setSubjectText(subjectInit);
      setFromEmails(fromInit);
      setToEmails(toInit);
      setPendingGroups(null);
      setStep('preview');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się wygenerować wiadomości.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedSuppliers, restaurantName, pendingGroups]);

  const prepareEmailForGroups = useCallback(async (groups: SupplierGroup[]) => {
    if (!groups.length) return;
    // Lokalni → Stripe Checkout (jak w Lokalni Przetwórcy), nie e-mail/SMS
    const localGroups = groups.filter((g) => g.is_local_producer && g.items.length > 0);
    const wholesalerGroups = groups.filter((g) => !g.is_local_producer && g.items.length > 0);
    if (localGroups.length === 1 && wholesalerGroups.length === 0) {
      setLpPayGroup(localGroups[0]);
      return;
    }
    if (localGroups.length > 0 && wholesalerGroups.length === 0) {
      // Kilka lokalnych naraz — po kolei (pierwszy sheet)
      setLpPayGroup(localGroups[0]);
      if (localGroups.length > 1) {
        Alert.alert(
          'Lokalni dystrybutorzy',
          `Masz ${localGroups.length} koszyków lokalnych. Opłać pierwszy w Stripe, potem wróć i zamów kolejne.`,
        );
      }
      return;
    }
    if (localGroups.length > 0 && wholesalerGroups.length > 0) {
      Alert.alert(
        'Mieszane zamówienie',
        'Lokalnych dystrybutorów opłacisz przez Stripe (przycisk „Zamów i zapłać” przy ich koszyku). '
        + 'Teraz przygotujemy e-mail/SMS tylko do hurtowników.',
      );
    }
    const withItems = wholesalerGroups.length ? wholesalerGroups : groups.filter((g) => g.items.length > 0);
    if (!withItems.length) {
      setError('Brak pozycji do zamówienia u tego dostawcy.');
      return;
    }
    const underMin = withItems.filter(
      (g) => (g.min_order_value ?? 0) > 0 && !g.meets_minimum_order,
    );
    // Twardy próg: luka > 150 zł → nie buduj / nie wysyłaj koszyka
    const MAX_GAP = 150;
    const gapTooBig = withItems.filter((g) => {
      const minV = Number(g.min_order_value ?? 0);
      if (minV <= 0) return false;
      const gap = minV - Number(g.subtotal_pln ?? 0);
      return gap > MAX_GAP;
    });
    const cleaned = withItems.filter(
      (g) => {
        const minV = Number(g.min_order_value ?? 0);
        if (minV <= 0) return true;
        if (g.meets_minimum_order === false) return false;
        return (minV - Number(g.subtotal_pln ?? 0)) <= MAX_GAP;
      },
    );
    if (gapTooBig.length) {
      const names = gapTooBig.map((g) => g.supplier_name).join(', ');
      Alert.alert(
        'Za daleko do minimum',
        `Pominięto koszyki, w których do minimum brakuje ponad ${MAX_GAP} zł: ${names}. `
        + 'Dorzuć produkty do większego zamówienia albo wybierz inny wariant.',
      );
    } else if (underMin.length) {
      const names = underMin.map((g) => g.supplier_name).join(', ');
      Alert.alert(
        'Poniżej minimum zamówienia',
        `Pominięto koszyki poniżej min. logistycznego: ${names}. `
        + 'Dorzuć produkty lub wybierz inny wariant.',
      );
    }
    if (!cleaned.length) {
      setError('Żaden koszyk nie spełnia minimum zamówienia u dostawcy.');
      return;
    }
    setPendingGroups(cleaned);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/restaurant/profile`);
      const data = await res.json();
      setContactEmail(data.contact_email ?? '');
      setContactPhone(data.contact_phone ?? '');
      if (data.complete) {
        await generateMessages(cleaned);
      } else {
        setStep('contact');
        setLoading(false);
      }
    } catch {
      setStep('contact');
      setLoading(false);
    }
  }, [generateMessages]);

  const saveProfile = useCallback(async () => {
    const email = contactEmail.trim();
    const phone = contactPhone.trim();
    if (!email || !phone) {
      setError('Uzupełnij e-mail i telefon kontaktowy.');
      return;
    }
    if (!email.includes('@') || !email.includes('.')) {
      setError('Podaj poprawny adres e-mail.');
      return;
    }
    setSavingProfile(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/restaurant/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_email: email, contact_phone: phone }),
      });
      if (!res.ok) throw new Error('Nie udało się zapisać danych.');
      await generateMessages(pendingGroups ?? undefined);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się zapisać danych.';
      setError(msg);
    } finally {
      setSavingProfile(false);
    }
  }, [contactEmail, contactPhone, generateMessages, pendingGroups]);

  const addProductToOrder = useCallback((opts: {
    supplierId: string;
    supplierName: string;
    supplierEmail: string | null;
    productName: string;
    unit: string;
    unitPrice: number;
    quantity?: number;
    minOrder?: number;
  }) => {
    const qty = opts.quantity ?? 1;
    const newItem: OfferItem = {
      product_name: opts.productName,
      quantity: qty,
      unit: opts.unit || 'szt',
      base_dim: opts.unit || 'szt',
      unit_price_base: opts.unitPrice,
      matched_name: opts.productName,
      line_total: recalcLineTotal(opts.unitPrice, qty, opts.unit || 'szt'),
    };
    setManualCart((prev) => {
      const base = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      const idx = base.findIndex((g) => g.supplier_id === opts.supplierId);
      if (idx >= 0) {
        const g = base[idx];
        const without = g.items.filter((it) => it.product_name !== opts.productName);
        const next = [...base];
        next[idx] = recalcGroup({ ...g, items: [...without, newItem] });
        return next;
      }
      return [
        ...base,
        recalcGroup({
          supplier_id: opts.supplierId,
          supplier_name: opts.supplierName,
          supplier_email: opts.supplierEmail,
          items: [newItem],
          subtotal_pln: 0,
          min_order_value: opts.minOrder ?? 0,
        }),
      ];
    });
    setQuantities((q) => ({ ...q, [opts.productName]: qty }));
    if (!selectedOption) setSelectedOption('single');
    setShowNewOrder(false);
  }, [baseSelectedSuppliers, selectedOption]);

  async function copySms(m: MessageCard) {
    await Clipboard.setStringAsync(m.sms_text);
    setCopiedId(m.supplier_id ?? m.supplier_name);
    setTimeout(() => setCopiedId(null), 1800);
  }

  const sendEmail = useCallback(async (m: MessageCard) => {
    const key = m.supplier_id ?? m.supplier_name;
    const to = (toEmails[key] ?? m.supplier_email ?? '').trim();
    const from = (fromEmails[key] ?? ASSISTANT_FROM_EMAIL).trim() || ASSISTANT_FROM_EMAIL;
    const subject = (subjectText[key] ?? m.email_subject ?? '').trim() || m.email_subject;
    const body = bodyText[key] ?? m.email_body_text;
    if (!to) {
      Alert.alert('Brak odbiorcy', 'Podaj adres e-mail dostawcy.');
      return;
    }
    const clearDraftsForSupplier = async () => {
      if (!m.supplier_id) return;
      try {
        const { data } = await supabase
          .from('supplier_orders')
          .select('id')
          .eq('supplier_id', m.supplier_id)
          .eq('status', 'draft');
        const ids = (data || []).map((r: { id: string }) => r.id);
        if (ids.length) {
          await supabase.from('supplier_orders').update({ status: 'sent' }).in('id', ids);
        }
      } catch {
        /* best-effort */
      }
    };
    const usesAssistant = from.toLowerCase() === ASSISTANT_FROM_EMAIL.toLowerCase();
    if (!usesAssistant) {
      try {
        await Linking.openURL(
          `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
        );
        setSendStatus((s) => ({ ...s, [key]: 'sent' }));
        await clearDraftsForSupplier();
      } catch {
        setSendStatus((s) => ({ ...s, [key]: 'error' }));
      }
      return;
    }
    setSendStatus((s) => ({ ...s, [key]: 'sending' }));
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject,
          body_text: body,
          from_email: ASSISTANT_FROM_EMAIL,
          supplier_name: m.supplier_name,
        }),
      });
      if (!res.ok) throw new Error();
      setSendStatus((s) => ({ ...s, [key]: 'sent' }));
      await clearDraftsForSupplier();
    } catch {
      setSendStatus((s) => ({ ...s, [key]: 'error' }));
    }
  }, [toEmails, fromEmails, bodyText, subjectText]);

  const sendAllEmails = useCallback(async () => {
    if (!messages.length) return;
    const pending = messages.filter((m) => {
      const key = m.supplier_id ?? m.supplier_name;
      return sendStatus[key] !== 'sent';
    });
    if (!pending.length) {
      Alert.alert('Gotowe', 'Wszystkie zamówienia zostały już wysłane.');
      return;
    }
    const allAssistant = pending.every((m) => {
      const key = m.supplier_id ?? m.supplier_name;
      const from = (fromEmails[key] ?? ASSISTANT_FROM_EMAIL).trim().toLowerCase();
      return from === ASSISTANT_FROM_EMAIL.toLowerCase();
    });
    if (!allAssistant) {
      Alert.alert(
        'Wysyłka po kolei',
        'Przy prywatnym nadawcy otwieramy skrzynkę osobno dla każdego dostawcy. '
        + 'Ustaw nadawcę na asystent.dostaw@gastromanager.org, aby wysłać wszystko naraz z poziomu aplikacji.',
      );
    }
    for (const m of pending) {
      // eslint-disable-next-line no-await-in-loop
      await sendEmail(m);
    }
  }, [messages, sendStatus, fromEmails, sendEmail]);

  const result = liveResult;
  const stepIndex = step === 'qty' ? 0 : step === 'compare' ? 1 : 2;
  const stepLabels = isBulkMode ? ['Oferty', 'Kontakt', 'Wyślij'] : ['Ilość', 'Oferty', 'Wyślij'];
  const bulkStepIndex = isBulkMode
    ? step === 'compare'
      ? 0
      : step === 'contact'
        ? 1
        : step === 'preview'
          ? 2
          : 0
    : stepIndex;

  const renderEditableCart = () => {
    if (!effectiveSelectedOption) return null;
    const groups = selectedSuppliers().filter((g) => g.items.length > 0);
    const orderable = groups.filter(
      (g) => (g.min_order_value ?? 0) <= 0 || g.meets_minimum_order !== false,
    );
    const grand = Math.round(groups.reduce((s, g) => s + g.subtotal_pln, 0) * 100) / 100;
    const ctaBg = C.isPremium ? '#5CFFB0' : C.accent;
    const ctaFg = C.isPremium ? '#0A0A0A' : C.white;

    // Notka „brak” — TYLKO produkty, których NIE MA w ofercie żadnego dostawcy
    // (found=false). Nie pokazuj produktów odrzuconych przez reguły min. zamówienia.
    const missingNotes: string[] = (() => {
      if (!result) return [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const r of result.items_requested ?? []) {
        if (r.found) continue;
        const name = String(r.product_name || '').trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
      }
      return out;
    })();
    const packNotes: string[] = Array.isArray((result as any)?.pack_adjustment_notes)
      ? ((result as any).pack_adjustment_notes as string[]).filter((n) => !!String(n || '').trim())
      : [];

    return (
      <View style={styles.editCart} testID="deal-hunter-edit-cart">
        <Text style={styles.editCartTitle}>
          {effectiveSelectedOption === 'split_max' || effectiveSelectedOption === 'optimized'
            ? 'Zamówienie · Najniższa cena'
            : effectiveSelectedOption === 'monolith' || effectiveSelectedOption === 'all_one'
              ? 'Zamówienie · Wygoda (mało dostaw)'
              : 'Zamówienia u dostawców'}
        </Text>
        {groups.length > 0 ? (
          <Text style={[styles.speechText, { fontWeight: '700', marginBottom: 4 }]} testID="deal-hunter-suppliers-summary">
            Od: {groups.map((g) => {
              const name = (g.supplier_name || '').trim() || 'Dostawca';
              return g.is_local_producer ? `${name}` : name;
            }).join(' · ')}
          </Text>
        ) : null}
        <Text style={styles.editCartHint}>
          Edytuj pozycje. Dorzuć z katalogu tego dostawcy albo „Nowe zamówienie” (inni dostawcy).
        </Text>
        <TouchableOpacity
          style={[styles.newOrderBtn, { marginBottom: 8 }]}
          onPress={() => setShowNewOrder(true)}
          activeOpacity={0.85}
          testID="deal-hunter-new-order-btn-top"
        >
          <Package size={16} color={C.accent} strokeWidth={2.2} />
          <Text style={styles.newOrderBtnText} numberOfLines={2}>
            Dodaj z katalogów
          </Text>
        </TouchableOpacity>
        {groups.length === 0 ? (
          <Text style={styles.newOrderHint}>
            Brak pozycji w koszyku. Skorzystaj z przycisku powyżej, aby dodać produkty.
          </Text>
        ) : (
          groups.map((g, gi) => {
            const blocked = (g.min_order_value ?? 0) > 0 && g.meets_minimum_order === false;
            return (
            <View key={`${g.supplier_id}-${gi}`} style={styles.supplierOrderCard}>
              <View style={styles.groupHeader}>
                <Truck size={16} color={C.accent} strokeWidth={2.2} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.editCartHint, { marginBottom: 0 }]}>
                    {g.is_local_producer ? 'Lokalny przetwórca' : 'Zamówienie od'}
                  </Text>
                  <Text style={styles.groupName} numberOfLines={2}>
                    {(g.supplier_name || '').trim() || 'Dostawca (uzupełnij nazwę)'}
                  </Text>
                  {g.is_local_producer && g.local_producer_city ? (
                    <Text style={[styles.editCartHint, { marginBottom: 0 }]}>
                      {g.local_producer_city}
                      {g.local_producer_voivodeship ? ` · ${g.local_producer_voivodeship}` : ''}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.groupSub}>{formatPln(g.subtotal_pln)}</Text>
              </View>
              <Text style={[styles.editCartHint, { marginBottom: 6 }]}>
                {g.is_local_producer
                  ? 'Płatność Stripe (produkty + kurier + 5% serwisu) — bez e-maila do dystrybutora.'
                  : g.supplier_email
                    ? `E-mail: ${g.supplier_email}`
                    : 'Brak e-maila dostawcy — uzupełnij w module Dostawcy.'}
              </Text>
              <MinOrderBadge meets={g.meets_minimum_order} minVal={g.min_order_value} />
              {g.items.map((it, idx) => (
                <OfferLine
                  key={`edit-${g.supplier_id}-${it.product_name}-${idx}`}
                  item={it}
                  productKey={it.product_name}
                  onQtyChange={updateQty}
                  editable
                  onRemove={() => removeCartItem(g.supplier_id, it.product_name)}
                />
              ))}
              // „Dodaj z katalogu” tylko dla hurtowników — lokalni mają produkty marketplace
              {!g.is_local_producer ? (
              <TouchableOpacity
                style={styles.addFromCatalogBtn}
                onPress={() => {
                  if (g.supplier_id) {
                    setCatalogPicker({
                      id: g.supplier_id,
                      name: (g.supplier_name || '').trim() || 'Dostawca',
                    });
                  } else {
                    setShowNewOrder(true);
                  }
                }}
                activeOpacity={0.8}
                testID={`deal-hunter-add-catalog-${g.supplier_id ?? gi}`}
              >
                <Plus size={14} color={C.accent} strokeWidth={2.5} />
                <Text style={styles.addFromCatalogText}>
                  {g.supplier_id
                    ? 'Dodaj z katalogu tego dostawcy'
                    : 'Dodaj produkt z katalogów dostawców'}
                </Text>
              </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.prepareSupplierBtn,
                  { backgroundColor: blocked ? C.dangerLight : ctaBg },
                  (loading || blocked) && styles.primaryBtnDisabled,
                ]}
                onPress={() => {
                  if (g.is_local_producer) setLpPayGroup(g);
                  else void prepareEmailForGroups([g]);
                }}
                disabled={loading || blocked}
                activeOpacity={0.85}
                testID={`deal-hunter-prepare-${g.supplier_id ?? gi}`}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={ctaFg} />
                ) : (
                  <>
                    {g.is_local_producer && !blocked ? (
                      <CreditCard size={15} color={ctaFg} strokeWidth={2.2} />
                    ) : (
                      <Mail size={15} color={blocked ? C.danger : ctaFg} strokeWidth={2.2} />
                    )}
                    <Text style={[styles.prepareSupplierBtnText, { color: blocked ? C.danger : ctaFg }]}>
                      {blocked
                        ? 'Poniżej minimum — uzupełnij koszyk'
                        : g.is_local_producer
                          ? 'Zamów i zapłać'
                          : 'Przygotuj e-mail/SMS'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
            );
          })
        )}

        {packNotes.length > 0 ? (
          <View style={[styles.missingBox, { borderColor: C.accent, backgroundColor: C.isPremium ? 'rgba(92,255,176,0.08)' : 'rgba(0,0,0,0.04)' }]} testID="deal-hunter-pack-notes">
            <Text style={[styles.missingTitle, { color: C.accentDark || C.accent }]}>Dopasowanie opakowań</Text>
            {packNotes.map((note, i) => (
              <Text key={`pack-note-${i}`} style={[styles.missingName, { color: C.text, marginBottom: 6 }]}>
                {note}
              </Text>
            ))}
          </View>
        ) : null}
        {missingNotes.length > 0 ? (
          <View style={styles.missingBox} testID="deal-hunter-missing-notes">
            <Text style={[styles.editCartHint, { color: C.danger, marginBottom: 4 }]}>
              Tych produktów nie ma w kategoriach twoich dostawców.
            </Text>
            {missingNotes.map((name) => (
              <Text key={name} style={styles.missingName} numberOfLines={2}>
                • {name}
              </Text>
            ))}
          </View>
        ) : null}

        {groups.length > 0 && (
          <View style={styles.optTotalRow}>
            <Text style={styles.optTotalLabel}>Suma wszystkich zamówień</Text>
            <Text style={styles.optTotalValue}>{formatPln(grand)}</Text>
          </View>
        )}

        {orderable.length > 1 && (
          <TouchableOpacity
            style={[styles.prepareSupplierBtn, { backgroundColor: ctaBg }, loading && styles.primaryBtnDisabled]}
            onPress={() => prepareEmailForGroups(orderable)}
            disabled={loading}
            activeOpacity={0.85}
            testID="deal-hunter-order-all"
          >
            {loading ? (
              <ActivityIndicator size="small" color={ctaFg} />
            ) : (
              <>
                {orderable.every((g) => g.is_local_producer) ? (
                  <CreditCard size={15} color={ctaFg} strokeWidth={2.2} />
                ) : (
                  <Send size={15} color={ctaFg} strokeWidth={2.2} />
                )}
                <Text style={[styles.prepareSupplierBtnText, { color: ctaFg }]}>
                  {orderable.every((g) => g.is_local_producer)
                    ? `Zamów i zapłać (${orderable.length})`
                    : orderable.some((g) => g.is_local_producer)
                      ? `Zamów hurtowników · lokalni osobno (${orderable.length})`
                      : `Zamów wszystkie (${orderable.length})`}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {groups.length > 0 && (
          <TouchableOpacity
            style={[styles.saveDraftBtn, savingDraft && { opacity: 0.6 }]}
            onPress={() => void saveDraftCart()}
            disabled={savingDraft}
            activeOpacity={0.85}
            testID="deal-hunter-save-draft"
          >
            {savingDraft ? (
              <ActivityIndicator size="small" color={C.accent} />
            ) : (
              <>
                <ShoppingCart size={16} color={C.accent} strokeWidth={2.2} />
                <Text style={styles.saveDraftBtnText}>Dodaj do koszyka (na później)</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.newOrderBtn}
          onPress={() => setShowNewOrder(true)}
          activeOpacity={0.85}
          testID="deal-hunter-new-order-btn"
        >
          <Package size={16} color={C.accent} strokeWidth={2.2} />
          <Text style={styles.newOrderBtnText}>Nowe zamówienie</Text>
        </TouchableOpacity>
        <Text style={styles.newOrderHint}>
          Przeszukaj katalogi dostawców i ręcznie dodaj produkty (także od innych hurtowników).
        </Text>
      </View>
    );
  };

  const renderSingleMode = () => {
    if (!result) return null;
    const best = result.best_option;
    const tied = result.tied_suppliers ?? [];
    const showTied = tied.length > 1;

    return (
      <>
        {renderEditableCart()}
        <View style={styles.singleCard} testID="deal-hunter-single-option">
          <View style={styles.optHeader}>
            <View style={styles.optBadge}>
              <Store size={13} color={C.accent} strokeWidth={2.2} />
              <Text style={styles.optBadgeText}>Najlepsza oferta</Text>
            </View>
          </View>

          {showTied ? (
            <>
              <Text style={styles.tiedHint}>
                Ten sam koszyk u {tied.length} dostawców — wybierz, u kogo zamawiasz:
              </Text>
              <View style={styles.tiedRow}>
                {tied.map((t) => {
                  const active = tiedSupplierId === t.supplier_id;
                  return (
                    <TouchableOpacity
                      key={t.supplier_id}
                      style={[styles.tiedChip, active && styles.tiedChipActive]}
                      onPress={() => { setTiedSupplierId(t.supplier_id); setManualCart(null); }}
                      testID={`deal-hunter-tied-${t.supplier_id}`}
                    >
                      <Text style={[styles.tiedChipText, active && styles.tiedChipTextActive]}>
                        {t.supplier_name}
                      </Text>
                      <Text style={[styles.tiedChipSub, active && styles.tiedChipTextActive]}>
                        {formatPln(t.total_pln)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : (
            <Text style={styles.optSupplier}>{best?.supplier_name ?? '—'}</Text>
          )}

          {!!best?.supplier_email && (
            <Text style={styles.editCartHint}>E-mail: {best.supplier_email}</Text>
          )}
          <MinOrderBadge meets={best?.meets_minimum_order} minVal={best?.min_order_value} />
          <View style={styles.optTotalRow}>
            <Text style={styles.optTotalLabel}>Propozycja AI</Text>
            <Text style={styles.optTotalValue}>{formatPln(best?.total_pln ?? 0)}</Text>
          </View>
        </View>
      </>
    );
  };

  const renderCompareMode = () => {
    // Tylko wybrany koszyk — bez alternatywnych wariantów (oszczędność kredytów / mniej szumu).
    return renderEditableCart();
  };

  return (
    <>
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container} testID="deal-hunter-modal">
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <Sparkles size={16} color={C.accent} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Łowca Okazji</Text>
              <Text style={styles.headerSub} numberOfLines={1}>
                {bulkContextLabel ?? product?.product_name ?? ''}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} testID="deal-hunter-close" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={22} color={C.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <View style={styles.steps}>
          {stepLabels.map((label, i) => {
            const active = bulkStepIndex === i;
            const done = bulkStepIndex > i;
            return (
              <View key={label} style={styles.stepItem}>
                <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
                  {done ? (
                    <Check size={11} color={C.white} strokeWidth={3} />
                  ) : (
                    <Text style={[styles.stepNum, active && styles.stepNumActive]}>{i + 1}</Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
              </View>
            );
          })}
        </View>

        {error && (
          <View style={styles.errorBanner} testID="deal-hunter-error">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {step === 'qty' && product && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.stockCard}>
                <View style={styles.stockRow}>
                  <Text style={styles.stockLabel}>Stan aktualny</Text>
                  <Text style={styles.stockValue}>
                    {product.current_qty} {product.unit}
                  </Text>
                </View>
                <View style={styles.stockRow}>
                  <Text style={styles.stockLabel}>Próg krytyczny</Text>
                  <Text style={styles.stockValueMuted}>
                    {product.critical_threshold} {product.unit}
                  </Text>
                </View>
              </View>
              <Text style={styles.qtyHint}>
                Zaproponowaliśmy ilość o połowę większą niż aktualny stan. Możesz ją zmienić przed
                porównaniem ofert.
              </Text>
              <Text style={styles.fieldLabel}>Gdzie szukać ofert?</Text>
              <View style={{ gap: 8, marginBottom: 14 }}>
                {DEAL_HUNTER_SEARCH_SCOPE_OPTIONS.map((opt) => {
                  const on = searchScope === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setSearchScope(opt.key)}
                      activeOpacity={0.85}
                      testID={`deal-hunter-scope-${opt.key}`}
                      style={{
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: on ? C.accent : C.border,
                        backgroundColor: on ? C.accentLight : C.card,
                        borderRadius: 12,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                      }}
                    >
                      <Text style={{ color: C.textPrimary, fontWeight: '800', fontSize: 14 }}>
                        {opt.label}
                      </Text>
                      <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 2 }}>
                        {opt.hint}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.fieldLabel}>Ilość do zamówienia</Text>
              <View style={styles.qtyInputRow}>
                <TextInput
                  style={styles.qtyInput}
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  placeholder="0"
                  placeholderTextColor={C.textTertiary}
                  testID="deal-hunter-qty-input"
                />
                <View style={styles.qtyUnit}>
                  <Text style={styles.qtyUnitText}>{product.unit}</Text>
                </View>
              </View>
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity style={styles.primaryBtn} onPress={runCompare} activeOpacity={0.85} testID="deal-hunter-compare-btn">
                <Sparkles size={17} color={C.white} strokeWidth={2.2} />
                <Text style={styles.primaryBtnText}>Porównaj oferty dostawców</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

        {step === 'compare' && (
          loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={C.accent} />
              <Text style={styles.loadingText}>Analizuję oferty dostawców…</Text>
            </View>
          ) : result ? (
            <>
              <ScrollView
                ref={compareScrollRef}
                contentContainerStyle={styles.body}
                showsVerticalScrollIndicator={false}
              >
                {bulkContextLabel ? (
                  <Text style={[styles.editCartHint, { marginBottom: 8 }]} testID="deal-hunter-bulk-label">
                    {bulkContextLabel}
                  </Text>
                ) : null}
                {(result.is_optimized || result.is_multivariable) ? renderCompareMode() : renderSingleMode()}
                {creditsNotice ? (
                  <View style={styles.creditsNotice} testID="deal-hunter-credits-notice">
                    <Text style={styles.creditsNoticeText}>{creditsNotice}</Text>
                  </View>
                ) : null}
                {!effectiveSelectedOption && (
                  <TouchableOpacity
                    style={[styles.newOrderBtn, { marginTop: 12 }]}
                    onPress={() => { setSelectedOption('single'); setShowNewOrder(true); }}
                    activeOpacity={0.85}
                  >
                    <Package size={16} color={C.accent} strokeWidth={2.2} />
                    <Text style={styles.newOrderBtnText} numberOfLines={2}>Nowe zamówienie</Text>
                  </TouchableOpacity>
                )}
                <View style={{ height: 16 }} />
              </ScrollView>
            </>
          ) : (
            <View style={styles.centerBox}>
              <Text style={styles.loadingText}>Brak danych.</Text>
            </View>
          )
        )}

        {step === 'contact' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>Dane kontaktowe dla dostawców</Text>
                <Text style={styles.infoText}>
                  Wpisz dane, na które hurtownia ma się z Tobą kontaktować w sprawie tego zamówienia.
                </Text>
              </View>
              <Text style={styles.fieldLabel}>Twój e-mail kontaktowy</Text>
              <View style={styles.inputRow}>
                <Mail size={16} color={C.textSecondary} strokeWidth={2} />
                <TextInput
                  style={styles.textInput}
                  value={contactEmail}
                  onChangeText={setContactEmail}
                  placeholder="np. kontakt@twojarestauracja.pl"
                  placeholderTextColor={C.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="deal-hunter-contact-email"
                />
              </View>
              <Text style={styles.fieldLabel}>Twój telefon</Text>
              <View style={styles.inputRow}>
                <Phone size={16} color={C.textSecondary} strokeWidth={2} />
                <TextInput
                  style={styles.textInput}
                  value={contactPhone}
                  onChangeText={setContactPhone}
                  placeholder="np. +48 600 100 200"
                  placeholderTextColor={C.textTertiary}
                  keyboardType="phone-pad"
                  testID="deal-hunter-contact-phone"
                />
              </View>
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.primaryBtn, savingProfile && styles.primaryBtnDisabled]}
                onPress={saveProfile}
                disabled={savingProfile}
                activeOpacity={0.85}
                testID="deal-hunter-save-profile-btn"
              >
                {savingProfile ? (
                  <ActivityIndicator size="small" color={C.white} />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Zapisz i przejdź do podglądu</Text>
                    <ChevronRight size={17} color={C.white} strokeWidth={2.2} />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

        {step === 'preview' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.msgIntro}>
                Sprawdź treści zamówień. Wysyłaj pojedynczo albo wszystkie naraz (gdy nadawca to asystent dostaw).
              </Text>
              {messages.length > 1 && (
                <TouchableOpacity
                  style={[
                    styles.sendBtn,
                    C.isPremium && { backgroundColor: '#5CFFB0' },
                    messages.every((m) => sendStatus[m.supplier_id ?? m.supplier_name] === 'sent') && styles.btnDisabled,
                  ]}
                  onPress={() => void sendAllEmails()}
                  activeOpacity={0.85}
                  testID="deal-hunter-send-all"
                >
                  <Send size={16} color={C.isPremium ? '#0A0A0A' : C.white} strokeWidth={2.2} />
                  <Text style={[styles.sendBtnText, C.isPremium && { color: '#0A0A0A' }]}>
                    Wyślij wszystkie ({messages.length})
                  </Text>
                </TouchableOpacity>
              )}
              {messages.map((m) => {
                const key = m.supplier_id ?? m.supplier_name;
                const st = sendStatus[key];
                return (
                  <View key={key} style={styles.msgCard} testID={`deal-hunter-message-${m.supplier_name}`}>
                    <View style={styles.msgHeader}>
                      <Truck size={14} color={C.accent} strokeWidth={2.2} />
                      <Text style={styles.msgSupplier}>{m.supplier_name}</Text>
                      <Text style={styles.msgTotal}>{formatPln(m.subtotal_pln)}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Nadawca:</Text>
                    </View>
                    <TextInput
                      style={[styles.bodyInput, { minHeight: 44, marginBottom: 8 }]}
                      value={fromEmails[key] ?? ASSISTANT_FROM_EMAIL}
                      onChangeText={(t) => setFromEmails((b) => ({ ...b, [key]: t }))}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      placeholder={ASSISTANT_FROM_EMAIL}
                      testID={`deal-hunter-from-${m.supplier_name}`}
                    />
                    <Text style={{ fontSize: 11, color: C.textTertiary, marginBottom: 8 }}>
                      {(fromEmails[key] ?? ASSISTANT_FROM_EMAIL).trim().toLowerCase() ===
                      ASSISTANT_FROM_EMAIL.toLowerCase()
                        ? 'Wysyłka przez asystenta dostaw (skrypt).'
                        : 'Otworzymy Twoją aplikację pocztową z gotową treścią.'}
                    </Text>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Odbiorca:</Text>
                    </View>
                    <TextInput
                      style={[styles.bodyInput, { minHeight: 44, marginBottom: 8 }]}
                      value={toEmails[key] ?? m.supplier_email ?? ''}
                      onChangeText={(t) => setToEmails((b) => ({ ...b, [key]: t }))}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      placeholder="zamowienia@dostawca.pl"
                      testID={`deal-hunter-to-${m.supplier_name}`}
                    />
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Temat:</Text>
                    </View>
                    <TextInput
                      style={[styles.bodyInput, { minHeight: 44, marginBottom: 8 }]}
                      value={subjectText[key] ?? m.email_subject ?? ''}
                      onChangeText={(t) => setSubjectText((b) => ({ ...b, [key]: t }))}
                      placeholder="Temat wiadomości"
                      placeholderTextColor={C.textTertiary}
                      testID={`deal-hunter-subject-${m.supplier_name}`}
                    />
                    <Text style={styles.msgSectionLabel}>Treść wiadomości (edytowalna)</Text>
                    <TextInput
                      style={styles.bodyInput}
                      value={bodyText[key] ?? ''}
                      onChangeText={(t) => setBodyText((b) => ({ ...b, [key]: t }))}
                      multiline
                      textAlignVertical="top"
                      testID={`deal-hunter-body-input-${m.supplier_name}`}
                    />
                    {st === 'sent' ? (
                      <View style={styles.successBox} testID={`deal-hunter-sent-${m.supplier_name}`}>
                        <Check size={16} color={C.success} strokeWidth={2.5} />
                        <Text style={styles.successText}>Zamówienie zostało wysłane pomyślnie!</Text>
                      </View>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.sendBtn,
                            C.isPremium && { backgroundColor: '#5CFFB0' },
                            (!(toEmails[key] ?? m.supplier_email) || st === 'sending') && styles.btnDisabled,
                          ]}
                          onPress={() => sendEmail(m)}
                          disabled={!(toEmails[key] ?? m.supplier_email) || st === 'sending'}
                          activeOpacity={0.85}
                          testID={`deal-hunter-send-email-${m.supplier_name}`}
                        >
                          {st === 'sending' ? (
                            <ActivityIndicator size="small" color={C.isPremium ? '#0A0A0A' : C.white} />
                          ) : (
                            <>
                              <Send size={16} color={C.isPremium ? '#0A0A0A' : C.white} strokeWidth={2.2} />
                              <Text style={[styles.sendBtnText, C.isPremium && { color: '#0A0A0A' }]}>Wyślij maila</Text>
                            </>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.smsBtn}
                          onPress={() => copySms(m)}
                          activeOpacity={0.85}
                          testID={`deal-hunter-copy-sms-${m.supplier_name}`}
                        >
                          {copiedId === key ? (
                            <>
                              <Check size={14} color={C.accent} strokeWidth={2.4} />
                              <Text style={styles.smsBtnText}>Skopiowano SMS</Text>
                            </>
                          ) : (
                            <>
                              <Copy size={14} color={C.accent} strokeWidth={2.2} />
                              <Text style={styles.smsBtnText}>Kopiuj do SMS</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </>
                    )}
                    <TouchableOpacity
                      style={styles.payBtn}
                      onPress={() =>
                        setManualPayOrder({
                          supplierId: m.supplier_id,
                          supplierName: m.supplier_name,
                          orderTitle:
                            (subjectText[key] ?? m.email_subject ?? '').trim()
                            || `Zamówienie — ${m.supplier_name}`,
                          totalPln: m.subtotal_pln,
                        })
                      }
                      activeOpacity={0.85}
                      testID={`deal-hunter-manual-pay-${m.supplier_name}`}
                    >
                      <Landmark size={16} color={C.accent} strokeWidth={2.2} />
                      <Text style={styles.payBtnText}>Opłać zamówienie</Text>
                    </TouchableOpacity>
                    {st === 'error' && (
                      <View style={styles.errRow}>
                        <CircleAlert size={13} color={C.danger} strokeWidth={2.2} />
                        <Text style={styles.emailError}>
                          Nie udało się wysłać. Sprawdź weryfikację domeny w Resend i spróbuj ponownie.
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
              <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.85} testID="deal-hunter-done-btn">
                <Text style={styles.doneBtnText}>Zakończ</Text>
              </TouchableOpacity>
              <View style={{ height: 24 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        )}
        {catalogPicker ? (
          <SupplierCatalogPicker
            visible
            supplierId={catalogPicker.id}
            supplierName={catalogPicker.name}
            onClose={() => setCatalogPicker(null)}
            onPick={addCatalogProduct}
            onResolvedSupplier={resolveSupplierInCart}
          />
        ) : null}
        {showNewOrder ? (
          <NewOrderBrowser
            visible
            onClose={() => setShowNewOrder(false)}
            onAdd={addProductToOrder}
          />
        ) : null}
      </View>
    </Modal>
    <Modal
      visible={!!draftSavedInfo}
      transparent
      animationType="fade"
      onRequestClose={() => setDraftSavedInfo(null)}
    >
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.78)',
        justifyContent: 'center',
        paddingHorizontal: 28,
      }}>
        <View style={{
          backgroundColor: DS.color.surfaceCard,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: DS.color.borderSubtle,
          padding: 20,
          gap: 14,
        }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: DS.color.heading }}>
            Zapisano w koszyku
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: DS.color.muted }}>
            {draftSavedInfo}
          </Text>
          <TouchableOpacity
            onPress={() => setDraftSavedInfo(null)}
            activeOpacity={0.85}
            style={{
              marginTop: 4,
              minHeight: 44,
              borderRadius: 10,
              backgroundColor: DS.color.greenEnd,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#0A0A0A' }}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    <LocalProducerCheckoutSheet
      visible={!!lpPayGroup}
      group={lpPayGroup}
      colors={C}
      onClose={() => setLpPayGroup(null)}
    />
    <ManualBankPaymentSheet
      visible={!!manualPayOrder}
      order={manualPayOrder}
      onClose={() => setManualPayOrder(null)}
      colors={{
        card: C.card,
        text: C.textPrimary,
        textSecondary: C.textSecondary,
        textTertiary: C.textTertiary,
        border: C.border,
        accent: C.accent,
        background: C.background,
        isPremium: C.isPremium,
      }}
    />
    </>
  );
}

