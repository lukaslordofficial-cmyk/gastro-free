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

export const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: DS.color.bgSecondary,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: DS.color.borderSubtle,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBadge: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: DS.color.greenEnd,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: DS.color.greenEnd, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 4,
  },
  title: { fontSize: 17, fontWeight: '800', color: DS.color.heading, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: DS.color.muted, marginTop: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },

  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },

  idleWrap: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  idleHint: { fontSize: 12, color: DS.color.muted, textAlign: 'left', lineHeight: 18, marginBottom: 6, alignSelf: 'stretch' },
  commandsToggle: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.35)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
    backgroundColor: 'rgba(0,255,120,0.08)',
  },
  commandsToggleText: { fontSize: 13, fontWeight: '700', color: DS.color.greenEnd, textAlign: 'center' },
  commandsList: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    backgroundColor: 'rgba(22,22,22,0.92)',
    marginBottom: 12,
    maxHeight: 220,
    overflow: 'hidden',
  },
  commandRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  commandIcon: { fontSize: 16, marginTop: 2 },
  commandLabel: { fontSize: 13, fontWeight: '700', color: '#F8F8F8' },
  commandExample: { fontSize: 11.5, color: '#A0A0A0', marginTop: 2, lineHeight: 16 },
  wakeBox: {
    alignSelf: 'stretch',
    backgroundColor: DS.color.bgTertiary,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
  },
  wakeTitle: { fontSize: 13, fontWeight: '800', color: DS.color.heading },
  wakeHint: { fontSize: 11, color: DS.color.muted, lineHeight: 16 },
  wakeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  wakeInput: {
    flex: 1, borderWidth: 1, borderColor: DS.color.borderSubtle, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: DS.color.heading,
    backgroundColor: DS.color.bgPrimary,
  },
  wakeSave: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: DS.color.greenEnd },
  wakeSaveText: { color: '#0A0A0A', fontWeight: '800', fontSize: 12 },
  wakeListenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(92,255,176,0.45)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 10,
    backgroundColor: DS.color.greenEnd,
  },
  wakeListenText: { fontSize: 12, fontWeight: '800', color: '#0A0A0A', flexShrink: 1, textAlign: 'center' },
  compareTile: {
    backgroundColor: DS.color.bgPrimary,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
  },
  compareTileLabel: { fontSize: 11, fontWeight: '700', color: DS.color.muted, marginBottom: 4, textTransform: 'uppercase' },
  compareTileValue: { fontSize: 15, fontWeight: '800', color: DS.color.heading },
  altIntentsBox: {
    gap: 8,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,255,120,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(92,255,176,0.25)',
  },
  altIntentBtn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: DS.color.bgTertiary,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
  },
  altIntentBtnOn: {
    backgroundColor: DS.color.greenEnd,
    borderColor: DS.color.greenEnd,
  },
  altIntentText: { fontSize: 13, fontWeight: '700', color: DS.color.heading },
  clarifyHint: {
    fontSize: 12,
    fontWeight: '600',
    color: DS.color.muted,
    marginTop: 4,
  },
  wakeStatus: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center' },
  recBtn: {
    width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  recBtnStart: { backgroundColor: '#8B5CF6', shadowColor: '#8B5CF6' },
  recBtnStop: { backgroundColor: Colors.danger, shadowColor: Colors.danger },
  recBtnLabel: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.2 },
  pulseRing: {
    padding: 12, borderRadius: 60,
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
    borderWidth: 2, borderColor: 'rgba(220, 38, 38, 0.35)',
  },

  workingWrap: { alignItems: 'center', gap: 14, paddingVertical: 24 },
  workingText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500', textAlign: 'center' },

  transcriptBox: {
    backgroundColor: DS.color.bgTertiary, borderRadius: 12, padding: 12,
    borderLeftWidth: 3, borderLeftColor: DS.color.greenEnd, marginBottom: 14,
  },
  transcriptLabel: { fontSize: 10, fontWeight: '800', color: DS.color.muted, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
  transcriptText: { fontSize: 14, color: DS.color.heading, lineHeight: 20, fontStyle: 'italic' },

  doneMessage: { fontSize: 14, color: DS.color.body, lineHeight: 20, fontWeight: '600', marginBottom: 12 },

  dangerBox: {
    backgroundColor: '#7F1D1D', borderRadius: 16, padding: 16, marginBottom: 16,
    borderWidth: 2, borderColor: '#DC2626',
  },
  dangerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  dangerTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.2 },
  dangerText: { fontSize: 13, color: '#FEE2E2', lineHeight: 19, marginBottom: 12 },
  dangerWord: { fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  dangerInput: {
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontWeight: '800', color: '#FFFFFF', letterSpacing: 2, textAlign: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  dangerBtn: { backgroundColor: '#B91C1C' },


  sectionLabel: { fontSize: 11, fontWeight: '800', color: DS.color.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10, marginTop: 6 },

  intentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, alignSelf: 'flex-start', marginBottom: 8,
  },
  intentBadgeIcon: { fontSize: 16 },
  intentBadgeText: { fontSize: 13, fontWeight: '800' },
  intentBadgeConf: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, marginLeft: 4 },
  intentReason: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic', marginBottom: 8, lineHeight: 17 },
  editHint: { fontSize: 12, color: DS.color.muted, marginBottom: 10, lineHeight: 17 },

  reviewCard: {
    backgroundColor: DS.color.bgTertiary, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: DS.color.borderSubtle, marginBottom: 14,
  },

  editRow: { marginBottom: 12 },
  editLabel: { fontSize: 12, color: DS.color.muted, fontWeight: '600', marginBottom: 6 },
  editInput: {
    backgroundColor: DS.color.bgPrimary, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 9, fontSize: 14, color: DS.color.heading,
    borderWidth: 1.5, borderColor: DS.color.borderSubtle,
  },
  editInputMulti: { minHeight: 60, textAlignVertical: 'top' },
  editHint2: { fontSize: 11, color: DS.color.muted, marginTop: 4 },
  editHelper: { fontSize: 12, color: DS.color.muted, marginTop: 4 },
  suggestBox: {
    marginTop: 6, marginBottom: 8, borderRadius: 10, borderWidth: 1,
    borderColor: DS.color.borderSubtle, backgroundColor: DS.color.bgPrimary, overflow: 'hidden',
  },
  suggestRow: {
    paddingHorizontal: 12, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: DS.color.borderSubtle,
  },
  suggestText: { fontSize: 14, fontWeight: '600', color: DS.color.heading },
  acceptedDishBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(0,255,120,0.1)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 10, borderWidth: 1, borderColor: 'rgba(92,255,176,0.45)',
  },
  acceptedDishText: { fontSize: 13, fontWeight: '700', color: DS.color.greenEnd, flex: 1 },
  acceptedDishChange: { fontSize: 12, fontWeight: '700', color: DS.color.greenEnd },
  scaleNeedPick: { fontSize: 12, color: DS.color.muted, marginBottom: 8, fontStyle: 'italic' },
  portionStepper: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
  },
  portionBtn: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: DS.color.greenEnd,
    borderWidth: 1.5, borderColor: DS.color.greenEnd, alignItems: 'center', justifyContent: 'center',
  },
  portionBtnText: { fontSize: 22, fontWeight: '800', color: '#0A0A0A', lineHeight: 24 },
  portionInput: {
    minWidth: 64, textAlign: 'center', fontSize: 20, fontWeight: '800', color: DS.color.heading,
    backgroundColor: DS.color.bgPrimary, borderRadius: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: DS.color.borderSubtle,
  },
  portionLabel: { fontSize: 14, fontWeight: '700', color: DS.color.muted },

  twoCol: { flexDirection: 'row', gap: 10 },

  pillRow: { flexDirection: 'row', gap: 8, paddingRight: 8, flexWrap: 'wrap' },
  pill: {
    flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1.5, borderColor: DS.color.borderSubtle, backgroundColor: DS.color.bgPrimary,
  },
  pillText: { fontSize: 12, fontWeight: '600', color: DS.color.muted },

  unitPill: {
    flexShrink: 0, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1.5, borderColor: DS.color.borderSubtle, backgroundColor: DS.color.bgPrimary, minWidth: 44, alignItems: 'center',
  },
  unitPillActive: { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd },
  unitPillText: { fontSize: 13, fontWeight: '600', color: DS.color.muted },
  unitPillTextActive: { color: '#0A0A0A', fontWeight: '800' },

  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1.5, borderColor: DS.color.borderSubtle, backgroundColor: DS.color.bgPrimary, alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd },
  segmentText: { fontSize: 12, fontWeight: '600', color: DS.color.muted },
  segmentTextActive: { color: '#0A0A0A', fontWeight: '800' },

  bufferInfoBox: {
    flexDirection: 'row', gap: 6, backgroundColor: DS.color.bgPrimary,
    borderRadius: 10, padding: 10, marginTop: -6, marginBottom: 2,
    borderLeftWidth: 3, borderLeftColor: DS.color.greenEnd,
  },
  bufferInfoText: { flex: 1, fontSize: 11, color: DS.color.muted, lineHeight: 16 },
  bufferInfoBold: { fontWeight: '700', color: DS.color.heading },

  ingLine: { fontSize: 12, color: DS.color.muted, marginTop: 4, marginLeft: 4 },

  ingHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8, marginBottom: 8,
  },
  ingAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: DS.color.greenEnd, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  ingAddText: { fontSize: 12, fontWeight: '800', color: '#0A0A0A' },
  ingEmpty: {
    fontSize: 12, color: DS.color.muted, fontStyle: 'italic',
    textAlign: 'center', paddingVertical: 12,
  },
  ingCard: {
    backgroundColor: DS.color.bgPrimary, borderRadius: 10, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: DS.color.borderSubtle,
  },
  ingCardHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6,
  },
  ingCardIdx: { fontSize: 11, fontWeight: '700', color: DS.color.muted, letterSpacing: 0.5 },
  ingRemoveBtn: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(248,113,113,0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)',
  },
  unitPillSm: {
    flexShrink: 0, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1.5, borderColor: DS.color.borderSubtle, backgroundColor: DS.color.bgTertiary,
    minWidth: 38, alignItems: 'center',
  },
  unitPillTextSm: { fontSize: 12, fontWeight: '600', color: DS.color.muted },

  creditsNotice: {
    marginHorizontal: 16, marginTop: 10, marginBottom: 4,
    backgroundColor: 'rgba(0,255,120,0.08)', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: 'rgba(92,255,176,0.35)',
  },
  creditsNoticeText: { fontSize: 12, fontWeight: '600', color: DS.color.greenEnd, textAlign: 'center' },

  errorBox: {
    flexDirection: 'row', gap: 8, backgroundColor: Colors.dangerLight,
    borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, padding: 12, alignItems: 'flex-start', marginTop: 10,
  },
  errorText: { flex: 1, fontSize: 12, color: Colors.danger, lineHeight: 17, fontWeight: '500' },

  warnBox: {
    flexDirection: 'row', gap: 8, backgroundColor: Colors.warningLight,
    borderWidth: 1, borderColor: '#FDE68A', borderRadius: 10, padding: 12, alignItems: 'flex-start', marginTop: 10,
  },
  warnText: { fontSize: 12, color: Colors.warning, lineHeight: 17, fontWeight: '500' },

  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 14,
  },
  successText: { fontSize: 15, fontWeight: '700', color: Colors.white },

  deductRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: DS.color.bgTertiary, borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: DS.color.borderSubtle, marginBottom: 6,
  },
  expiryItemCard: {
    marginBottom: 10,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DS.color.borderSubtle,
  },
  expiryTipRow: {
    marginTop: 6,
    marginLeft: 4,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(0,255,120,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(92,255,176,0.22)',
  },
  expiryTipGame: {
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderColor: 'rgba(251,191,36,0.28)',
  },
  expiryTipKind: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: DS.color.greenEnd,
    marginBottom: 2,
  },
  expiryTipTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: DS.color.heading,
    marginBottom: 2,
  },
  expiryTipBody: {
    fontSize: 12,
    color: DS.color.muted,
    lineHeight: 17,
  },
  expiryTipCta: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: DS.color.greenEnd,
  },
  expiryLegalBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.25)',
  },
  expiryLegalText: {
    fontSize: 11,
    color: DS.color.muted,
    lineHeight: 15,
  },
  deductName: { flex: 1, fontSize: 13, color: DS.color.body, fontWeight: '500', paddingRight: 8 },
  deductQty: { fontSize: 13, fontWeight: '800', color: DS.color.heading },

  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 16, alignItems: 'stretch' },
  primaryBtn: {
    flex: 1.15, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: DS.color.greenEnd, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10,
    shadowColor: DS.color.greenEnd, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 4,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#0A0A0A', fontSize: 12, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
  secondaryBtn: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 8,
    borderWidth: 1, borderColor: DS.color.borderSubtle,
  },
  secondaryBtnText: { color: DS.color.muted, fontSize: 12, fontWeight: '700', flexShrink: 1, textAlign: 'center' },

  // Voice CRUD — Jarvis fuzzy-match banner + supplier action tiles
  jarvisBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(0,255,120,0.1)', borderRadius: 12, padding: 12,
    borderLeftWidth: 3, borderLeftColor: DS.color.greenEnd, marginBottom: 12,
  },
  jarvisBannerIcon: { fontSize: 20, marginTop: 2 },
  jarvisBannerText: { fontSize: 13, color: DS.color.heading, fontWeight: '500', lineHeight: 18 },
  jarvisBannerMatched: { fontWeight: '800', color: DS.color.greenEnd },
  jarvisBannerQuestion: { fontSize: 13, color: DS.color.muted, marginTop: 3, fontStyle: 'italic' },

  supplierActionInfo: { gap: 8 },
  supplierActionTitle: { fontSize: 15, fontWeight: '800', color: DS.color.heading, marginBottom: 6 },
  supplierActionHint: { fontSize: 12, color: DS.color.muted, fontStyle: 'italic', marginTop: 4, lineHeight: 17 },
  periodConfirmBox: {
    backgroundColor: 'rgba(0,255,120,0.08)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(92,255,176,0.28)',
    gap: 6,
  },
  periodConfirmWarn: { fontSize: 12, fontWeight: '700', color: DS.color.greenEnd, lineHeight: 17 },
  periodConfirmPreview: { fontSize: 14, fontWeight: '800', color: DS.color.heading },
});
