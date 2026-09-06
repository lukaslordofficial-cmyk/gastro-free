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

export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

/** Paleta UI — darmowa (Colors) albo Pro Dark. */
export function useDealColors() {
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

export type DealColors = ReturnType<typeof useDealColors>;

export function themedStyles(C: DealColors) {
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
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    metaLabel: { fontSize: 12, fontWeight: '600', color: C.textTertiary, flexShrink: 0 },
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
