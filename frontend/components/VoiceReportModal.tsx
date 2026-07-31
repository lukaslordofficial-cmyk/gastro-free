/**
 * VoiceReportModal
 *
 * Uniwersalny modal głosowego raportowania w Gastro Manager.
 *
 * Flow:
 *   1. użytkownik naciska mikrofon → nagrywa audio
 *      • WEB → MediaRecorder API
 *      • iOS / Android → expo-av Audio.Recording (natywne)
 *   2. blob/plik → POST /api/voice/transcribe (Whisper-1)
 *   3. tekst → POST /api/voice/interpret (GPT-4o mini, Structured Outputs)
 *        → zwraca { intent, payload, confidence, reason }
 *   4. użytkownik EDYTUJE dane w formularzu (nazwa, kategoria, ilość, bufor itd.)
 *   5. potwierdza podgląd → POST /api/actions/apply
 *        → zapisuje do właściwej tabeli Supabase (waste_logs, revenue_entries,
 *          fixed_costs, variable_cost_entries, inventory_items, menu_items+recipe,
 *          suppliers, supplier_catalog)
 *
 * Obsługiwane intencje: waste | add_revenue | add_fixed_cost | add_variable_cost |
 *   add_inventory_item | add_menu_item | add_supplier | add_supplier_product | unknown
 */
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
import { DealHunterModal } from './DealHunterModal';
import { ExpirationVoiceForm } from './ExpirationVoiceForm';
import { PeriodPickerTree, labelForSelections, parsePeriodHintToSelection, type PeriodSelection } from './PeriodPickerTree';
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
} from './JarvisFormExtras';
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
import { WeightRealityCheckModal } from '@/components/WeightRealityCheckModal';
import { offerWeightRealityCheck } from '@/lib/offerWeightRealityCheck';
import { VolumeRealityCheckModal } from '@/components/VolumeRealityCheckModal';
import { offerVolumeRealityCheck } from '@/lib/offerVolumeRealityCheck';
import {
  shouldPreferVolumeRealityCheck,
  suggestedMlFromQty,
} from '@/lib/volumeRealityCheck';
import {
  findProduceConverter,
  piecesToKg,
  type ProduceSizeKey,
} from '@/lib/produceSizeConverter';

type Stage =
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
const DESTRUCTIVE_INTENTS = new Set<Intent>([
  'bulk_delete_menu', 'bulk_delete_suppliers', 'bulk_reset_inventory', 'bulk_delete_inventory',
]);
/** Intencje sterowania UI — wykonywane natychmiast na froncie (nawigacja/filtry). */
const NAV_INTENTS = new Set<Intent>([
  'navigate_screen', 'filter_ui_inventory', 'filter_ui_menu_blocked',
]);
/** Analizy okresu — wymagają drzewka dat przed uruchomieniem. */
const PERIOD_INTENTS = new Set<Intent>([
  'summarize_custom_period', 'compare_two_periods', 'rank_menu_sales', 'rank_inventory_usage',
  'rank_waste_cost', 'rank_dead_menu', 'rank_supplier_spend',
]);
/** Wgrywanie dokumentów — otwiera skaner po zatwierdzeniu. */
const UPLOAD_INTENTS = new Set<Intent>([
  'upload_invoice', 'upload_offer', 'upload_document', 'upload_menu',
]);
const CONFIRM_WORD = 'POTWIERDZAM';

interface FuzzyMatch {
  field: string;
  matched_to: string;
  score: number;
  resolved_id: string;
}

interface Interpretation {
  intent: Intent;
  confidence: number;
  reason?: string | null;
  payload: Record<string, any>;
  fuzzy_matches?: FuzzyMatch[];
  alternate_intents?: { intent: Intent; label: string }[];
  credits_deducted?: number;
  credits_remaining?: number | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onApplied?: (intent: Intent) => void;
  contextHint?: string;
  /** Po otwarciu od razu start nagrywania (wake word / FAB). */
  autoStartRecording?: boolean;
  /** Po otwarciu od razu włącz nasłuch hasła w modalu. */
  autoStartWakeListen?: boolean;
}


const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ??
  process.env.REACT_APP_BACKEND_URL ??
  '';

const UNIT_OPTIONS = ['kg', 'g', 'l', 'ml', 'szt', 'op'];

/** Meta per intent — labels shown in preview */
const INTENT_META: Record<Intent, { icon: string; label: string; color: string }> = {
  waste:                { icon: '🗑️', label: 'Strata magazynowa',            color: '#DC2626' },
  add_revenue:          { icon: '💰', label: 'Nowy przychód',                 color: '#059669' },
  add_fixed_cost:       { icon: '🏢', label: 'Koszt stały',                   color: '#7C3AED' },
  add_variable_cost:    { icon: '📦', label: 'Koszt zmienny',                 color: '#EA580C' },
  add_inventory_item:   { icon: '📥', label: 'Nowy produkt w magazynie',      color: '#0284C7' },
  add_menu_item:        { icon: '🍽️', label: 'Nowa propozycja w menu',        color: '#DB2777' },
  add_supplier:         { icon: '🚚', label: 'Nowy dostawca',                 color: '#0891B2' },
  add_supplier_product: { icon: '🏷️', label: 'Produkt w cenniku dostawcy',    color: '#2563EB' },
  edit_menu_item_price: { icon: '✏️', label: 'Zmiana ceny w menu',            color: '#DB2777' },
  add_recipe_ingredient:{ icon: '➕', label: 'Dodaj składnik do receptury',   color: '#F59E0B' },
  edit_recipe_ingredient_qty: { icon: '⚖️', label: 'Zmień gramaturę składnika', color: '#F59E0B' },
  edit_inventory_item:  { icon: '🛠️', label: 'Zmień parametry produktu',      color: '#0284C7' },
  add_expiration_batch: { icon: '📅', label: 'Data ważności (partia)',        color: '#059669' },
  order_product:        { icon: '🛒', label: 'Zamówienie u dostawcy',         color: '#2563EB' },
  order_critical_items_by_category: { icon: '📦', label: 'Zbiorcze zamówienie braków', color: '#8B5CF6' },
  supplier_flip_order:  { icon: '🔄', label: 'Przerzucenie koszyka',          color: '#F97316' },
  budget_cap_order:     { icon: '💸', label: 'Zamówienie do limitu',          color: '#0891B2' },
  compare_catalogs_top_savings: { icon: '📊', label: 'TOP 5 promocji',        color: '#059669' },
  predictive_weekend_restock:   { icon: '🔮', label: 'Prognoza zamówienia',   color: '#7C3AED' },
  check_minimum_order_value:    { icon: '📦', label: 'Minimum darmowej dostawy', color: '#0284C7' },
  bulk_delete_menu:      { icon: '💣', label: 'Wyczyść całe menu',            color: '#B91C1C' },
  bulk_delete_suppliers: { icon: '💣', label: 'Usuń wszystkich dostawców',    color: '#B91C1C' },
  bulk_reset_inventory:  { icon: '💣', label: 'Reset magazynu do zera',       color: '#B91C1C' },
  bulk_delete_inventory: { icon: '💣', label: 'Usuń cały magazyn',            color: '#B91C1C' },
  restore_last_deleted_menu: { icon: '↩️', label: 'Przywróć usunięte menu',   color: '#059669' },
  restore_deleted_inventory: { icon: '↩️', label: 'Przywróć magazyn',         color: '#059669' },
  delete_menu_item:      { icon: '🗑️', label: 'Usuń danie z menu',            color: '#DC2626' },
  delete_supplier:       { icon: '🗑️', label: 'Usuń dostawcę',                color: '#DC2626' },
  delete_inventory_item: { icon: '🗑️', label: 'Usuń produkt z magazynu',      color: '#DC2626' },
  toggle_menu_item_availability: { icon: '🔀', label: 'Dostępność dania (POS)', color: '#0891B2' },
  bulk_edit_menu_prices_percentage: { icon: '📈', label: 'Masowa zmiana cen', color: '#059669' },
  bulk_edit_menu_prices_fixed:      { icon: '💵', label: 'Masowa zmiana cen (zł)', color: '#059669' },
  bulk_edit_inventory_buffers:      { icon: '🛡️', label: 'Masowa zmiana buforów', color: '#7C3AED' },
  edit_menu_item_category: { icon: '🏷️', label: 'Zmiana kategorii dania',     color: '#DB2777' },
  rename_menu_item:        { icon: '✏️', label: 'Zmiana nazwy dania',          color: '#DB2777' },
  scale_recipe:            { icon: '🧮', label: 'Kalkulator porcji',           color: '#F59E0B' },
  navigate_screen:         { icon: '🧭', label: 'Nawigacja po aplikacji',      color: '#2563EB' },
  filter_ui_inventory:     { icon: '🔍', label: 'Filtr magazynu',             color: '#0284C7' },
  filter_ui_menu_blocked:  { icon: '🔍', label: 'Filtr: zablokowane dania',   color: '#DC2626' },
  summarize_custom_period: { icon: '📊', label: 'Pokazanie danych / zysków', color: '#2563EB' },
  compare_two_periods:     { icon: '📈', label: 'Porównanie okresów',       color: '#0891B2' },
  rank_menu_sales:         { icon: '🏆', label: 'Ranking sprzedaży menu',   color: '#D97706' },
  rank_inventory_usage:    { icon: '📦', label: 'Zużycie magazynu',         color: '#7C3AED' },
  rank_waste_cost:         { icon: '🗑️', label: 'Straty w złotówkach',     color: '#DC2626' },
  rank_dead_menu:          { icon: '☠️', label: 'Najsłabiej sprzedające się', color: '#9F1239' },
  list_expiring_soon:      { icon: '⏳', label: 'Drabina dat ważności',    color: '#EA580C' },
  rank_supplier_spend:     { icon: '🧾', label: 'Wydatki u dostawców',    color: '#0F766E' },
  manager_core_alerts:     { icon: '🚨', label: 'Alerty korelacji CORE',  color: '#B91C1C' },
  haccp_tip:               { icon: '🌡️', label: 'Porada HACCP / FIFO',   color: '#0369A1' },
  upload_invoice:          { icon: '📄', label: 'Wgraj fakturę',            color: '#059669' },
  upload_offer:            { icon: '🏷️', label: 'Wgraj ofertę',             color: '#2563EB' },
  upload_document:         { icon: '📎', label: 'Wgraj dokument',           color: '#0891B2' },
  upload_menu:             { icon: '🍽️', label: 'Wgraj / skanuj menu',      color: '#16A34A' },
  unknown:              { icon: '❓', label: 'Nie rozpoznano intencji',       color: '#6B7280' },
};

/** Lista komend (klik → formularz / drzewko bez STT). */
const COMMAND_EXAMPLES: { intent: Intent; example: string }[] = [
  { intent: 'add_expiration_batch', example: 'Ustaw datę ważności produktu' },
  { intent: 'waste', example: 'Opisz stratę produktową' },
  { intent: 'add_menu_item', example: 'Dodaj do menu nowy produkt/potrawę' },
  { intent: 'bulk_edit_menu_prices_percentage', example: 'Podnieś ceny wszystkich produktów o x% lub x złotych' },
  { intent: 'navigate_screen', example: 'Otwórz dowolną zakładkę' },
  { intent: 'add_revenue', example: 'Dodaj nowy przychód, nieujęty w POS' },
  { intent: 'add_fixed_cost', example: 'Dodaj nowy koszt stały' },
  { intent: 'add_variable_cost', example: 'Dodaj nowy koszt zmienny' },
  { intent: 'add_inventory_item', example: 'Dodaj nowy produkt do magazynu' },
  { intent: 'add_supplier', example: 'Dodaj nowego dostawcę' },
  { intent: 'edit_menu_item_price', example: 'Zmień cenę dowolnego dania' },
  { intent: 'order_product', example: 'Zamów dowolny produkt/y z oferty twoich dostawców' },
  { intent: 'order_critical_items_by_category', example: 'Zamów ser kozi i brakujące warzywa' },
  { intent: 'summarize_custom_period', example: 'Pokaż zyski z wybranych okresów' },
  { intent: 'rank_menu_sales', example: 'Pokaż ranking sprzedaży z wybranego okresu' },
  { intent: 'rank_waste_cost', example: 'Ile pieniędzy utracono przez straty produktowe' },
  { intent: 'rank_dead_menu', example: 'Najgorzej sprzedające się produkty' },
  { intent: 'list_expiring_soon', example: 'Pokaż produkty z kończącą się datą ważności' },
  { intent: 'rank_supplier_spend', example: 'Ile wydałem u dostawców w wybranym okresie?' },
  { intent: 'haccp_tip', example: 'Jak przechowywać świeżego łososia? Co to FIFO?' },
  { intent: 'upload_invoice', example: 'Wgraj fakturę' },
  { intent: 'upload_offer', example: 'Wgraj ofertę' },
  { intent: 'scale_recipe', example: 'Przelicz recepturę dania na x porcji' },
  { intent: 'delete_menu_item', example: 'Usuń z menu wybrane danie' },
  { intent: 'filter_ui_inventory', example: 'Pokaż produkty z krytycznym stanem magazynowym' },
];

/** Dodatkowe frazy PL/EN do typeaheadu przy niepewnej intencji. */
const INTENT_SEARCH_ALIASES: Partial<Record<Intent, string[]>> = {
  add_revenue: ['dodaj przychód', 'przychód', 'nowy przychód', 'utarg', 'add revenue', 'add income'],
  add_fixed_cost: ['koszt stały', 'dodaj koszt stały', 'pensje', 'wynagrodzenia', 'fixed cost'],
  add_variable_cost: ['koszt zmienny', 'dodaj koszt zmienny', 'variable cost'],
  waste: ['strata', 'wyrzuciłem', 'waste'],
  add_menu_item: ['dodaj do menu', 'nowe danie', 'add menu'],
  summarize_custom_period: ['pokaż zyski', 'dane z okresu', 'podsumowanie'],
  compare_two_periods: ['porównaj okresy', 'porównanie'],
  upload_invoice: ['wgraj fakturę', 'skanuj fakturę'],
  upload_offer: ['wgraj ofertę', 'skanuj ofertę'],
};

export function VoiceReportModal({
  visible,
  onClose,
  onApplied,
  contextHint,
  autoStartRecording,
  autoStartWakeListen,
}: Props) {
  // Jarvis zawsze w Black Premium: zielone CTA, czarny tekst na przyciskach
  const jarvisAccent = DS.color.greenEnd;
  const jarvisCtaText = '#0A0A0A';
  const { credits, dealHunterUnlocked } = useSubscription();
  const commandsUnlocked = credits > 0;
  const visibleCommands = useMemo(() => {
    if (!commandsUnlocked) return [];
    // Łowca: wyłącznie tier ≥ 2 lub aktywny trial Premium (dealHunterUnlocked)
    return COMMAND_EXAMPLES.filter((c) => {
      if (!dealHunterUnlocked && isDealHunterIntent(c.intent)) return false;
      return true;
    });
  }, [commandsUnlocked, dealHunterUnlocked]);
  const router = useRouter();
  const { openProductCascade, setWakeListenEnabled, openDocumentScan, openMenuScan } = useUiOverlay();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [stage, setStage] = useState<Stage>('idle');
  const [transcript, setTranscript] = useState('');
  const [interp, setInterp] = useState<Interpretation | null>(null);
  const [edited, setEdited] = useState<Record<string, any>>({});
  const [confirmText, setConfirmText] = useState('');
  const [applyResult, setApplyResult] = useState<{ detail: string; extras: any; warnings: string[] } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [categories, setCategories] = useState<{ id: string; name: string; color: string }[]>([]);
  const [menuCategories, setMenuCategories] = useState<string[]>([]);
  // Bulk Deal Hunter — po zatwierdzeniu order_critical_items_by_category
  // otwieramy Modal Łowcy Okazji z gotowym zestawieniem.
  const [bulkCompare, setBulkCompare] = useState<OptimizeResult | null>(null);
  const [bulkContextLabel, setBulkContextLabel] = useState<string>('');
  const [creditsNotice, setCreditsNotice] = useState<string | null>(null);
  const [wakeWord, setWakeWordState] = useState('Gastro');
  const [wakeDraft, setWakeDraft] = useState('Gastro');
  const [wakeListening, setWakeListening] = useState(false);
  const [wakeStatus, setWakeStatus] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [commandHint, setCommandHint] = useState<string | null>(null);
  const [clarifyQuery, setClarifyQuery] = useState('');
  const [showWeightCheck, setShowWeightCheck] = useState(false);
  const [weightCheckItem, setWeightCheckItem] = useState<string | null>(null);
  const [weightCheckSuggestedG, setWeightCheckSuggestedG] = useState<number | null>(null);
  const [showVolumeCheck, setShowVolumeCheck] = useState(false);
  const [volumeCheckItem, setVolumeCheckItem] = useState<string | null>(null);
  const [volumeCheckSuggestedMl, setVolumeCheckSuggestedMl] = useState<number | null>(null);
  const { alert: premiumAlert } = usePremiumAlert();
  const wakeListeningRef = useRef(false);
  const autoStartedRef = useRef(false);
  const followUpModeRef = useRef(false);
  const followUpReturnStageRef = useRef<Stage>('review');
  const stageRef = useRef<Stage>('idle');
  stageRef.current = stage;
  // Aktualne wartości do apply (drzewko dat / legenda) — bez stale closure
  const editedRef = useRef<Record<string, any>>({});
  const interpRef = useRef<Interpretation | null>(null);
  const transcriptRef = useRef('');
  useEffect(() => { editedRef.current = edited; }, [edited]);
  useEffect(() => { interpRef.current = interp; }, [interp]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  // Web-only refs
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    void getJarvisWakeWord().then((w) => {
      setWakeWordState(w);
      setWakeDraft(w);
    });
  }, []);

  useEffect(() => {
    if (!visible) {
      cleanup();
      autoStartedRef.current = false;
      setStage('idle');
      setTranscript('');
      setInterp(null);
      setEdited({});
      setConfirmText('');
      setApplyResult(null);
      setErrorMsg(null);
      setElapsed(0);
      setBulkCompare(null);
      setBulkContextLabel('');
      setCreditsNotice(null);
      return;
    }
    if (autoStartedRef.current) return;
    if (autoStartRecording) {
      autoStartedRef.current = true;
      const t = setTimeout(() => void startRecording(), 250);
      return () => clearTimeout(t);
    }
    if (autoStartWakeListen) {
      autoStartedRef.current = true;
      const t = setTimeout(() => startWakeListen(), 250);
      return () => clearTimeout(t);
    }
  }, [visible, autoStartRecording, autoStartWakeListen]);

  // Load inventory + menu categories when modal opens
  useEffect(() => {
    if (!visible || !isSupabaseConfigured) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('inventory_categories')
          .select('id, name, color')
          .order('sort_order');
        if (data) setCategories(data as any);
      } catch { /* non-critical */ }
      try {
        const { data } = await supabase
          .from('menu_items')
          .select('category')
          .eq('is_active', true)
          .limit(2000);
        const set = new Set<string>();
        for (const r of data || []) {
          const c = String((r as any).category || '').trim();
          if (c) set.add(c);
        }
        setMenuCategories(Array.from(set).sort((a, b) => a.localeCompare(b, 'pl')));
      } catch { /* non-critical */ }
    })();
  }, [visible]);

  function cleanup() {
    wakeListeningRef.current = false;
    try { mediaRecorderRef.current?.stop?.(); } catch {}
    try { streamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
    try { if (audioRecorder.isRecording) audioRecorder.stop(); } catch {}
    try { recognitionRef.current?.stop?.(); } catch {}
    try { recognitionRef.current?.abort?.(); } catch {}
    recognitionRef.current = null;
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setWakeListening(false);
    setWakeStatus(null);
  }

  async function saveWakeWord() {
    const next = (wakeDraft || '').trim() || 'Gastro';
    await setJarvisWakeWord(next);
    setWakeWordState(next);
    setWakeDraft(next);
    await setJarvisWakeListenEnabled(true);
    setWakeListenEnabled(true);
    setWakeStatus(`Hasło zapisane: „${next}”. Aplikacja czeka na komendę głosową.`);
    // Od razu włącz nasłuch (web) / przygotuj nagrywanie
    startWakeListen();
  }

  function stopWakeListen() {
    wakeListeningRef.current = false;
    try { recognitionRef.current?.stop?.(); } catch {}
    try { recognitionRef.current?.abort?.(); } catch {}
    recognitionRef.current = null;
    setWakeListening(false);
    setWakeStatus(null);
    void setJarvisWakeListenEnabled(false);
    setWakeListenEnabled(false);
  }

  function startWakeListen() {
    void setJarvisWakeListenEnabled(true);
    setWakeListenEnabled(true);
    // Natywny iOS/Android: brak ciągłego SR — nagranie hasło+komenda w jednym ujęciu
    if (Platform.OS !== 'web') {
      wakeListeningRef.current = true;
      setWakeListening(true);
      setWakeStatus(`Nagrywam… powiedz „${wakeWord}” i komendę w jednym nagraniu.`);
      void startRecording();
      return;
    }

    const SR =
      (typeof window !== 'undefined' &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      setWakeStatus('Przeglądarka nie wspiera rozpoznawania mowy — użyj przycisku mikrofonu.');
      return;
    }

    try {
      // Restart lokalnego SR bez wyłączania globalnego nasłuchu
      wakeListeningRef.current = false;
      try { recognitionRef.current?.stop?.(); } catch {}
      try { recognitionRef.current?.abort?.(); } catch {}
      recognitionRef.current = null;

      wakeListeningRef.current = true;
      setWakeListening(true);
      setWakeStatus(`Nasłuchuję hasła „${wakeWord}”… mów wyraźnie (działa też poza tym oknem).`);

      const attach = () => {
        if (!wakeListeningRef.current) return;
        const rec = new SR();
        rec.lang = 'pl-PL';
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 3;

        rec.onresult = (ev: any) => {
          let text = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            text += ev.results[i][0]?.transcript || '';
          }
          if (!transcriptContainsWakeWord(text, wakeWord)) return;

          wakeListeningRef.current = false;
          try { rec.stop?.(); } catch {}
          recognitionRef.current = null;
          setWakeListening(false);
          setWakeStatus(`Usłyszano „${wakeWord}” — nagrywam komendę…`);
          // SR i getUserMedia kolidują — krótka przerwa przed MediaRecorder
          setTimeout(() => {
            void startRecording();
          }, 200);
        };

        rec.onerror = (ev: any) => {
          const code = String(ev?.error || '');
          // no-speech / aborted = normalne w continuous — restart
          if (code === 'no-speech' || code === 'aborted') return;
          if (code === 'not-allowed') {
            wakeListeningRef.current = false;
            setWakeListening(false);
            setWakeStatus('Brak zgody na mikrofon — zezwól w przeglądarce.');
            return;
          }
          setWakeStatus(`Nasłuch: ${code || 'błąd'} — ponawiam…`);
        };

        rec.onend = () => {
          if (!wakeListeningRef.current) return;
          // Chrome kończy sesję po ciszy — restart
          setTimeout(() => {
            if (!wakeListeningRef.current) return;
            try {
              attach();
            } catch {
              setWakeStatus('Nasłuch przerwany — kliknij ponownie „Nasłuchuj”.');
              wakeListeningRef.current = false;
              setWakeListening(false);
            }
          }, 120);
        };

        recognitionRef.current = rec;
        try {
          rec.start();
        } catch (e: any) {
          // "already started" — ignore
          if (!String(e?.message || '').includes('started')) {
            throw e;
          }
        }
      };

      attach();
    } catch {
      wakeListeningRef.current = false;
      setWakeListening(false);
      setWakeStatus('Nie udało się uruchomić nasłuchu — sprawdź mikrofon / HTTPS.');
    }
  }

  async function startRecording() {
    setErrorMsg(null);
    try {
      if (Platform.OS === 'web') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mime =
          (window as any).MediaRecorder?.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
            : (window as any).MediaRecorder?.isTypeSupported?.('audio/webm') ? 'audio/webm'
            : 'audio/mp4';
        const mr = new (window as any).MediaRecorder(stream, { mimeType: mime });
        mediaRecorderRef.current = mr;
        chunksRef.current = [];
        mr.ondataavailable = (e: any) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: mime });
          cleanup();
          await handleAudioReady(blob, mime);
        };
        mr.start();
      } else {
        // Native (iOS / Android) via expo-audio
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          throw new Error('Brak zgody na dostęp do mikrofonu. Włącz w ustawieniach systemu.');
        }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();
      }
      setStage('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Nie udało się uruchomić mikrofonu.');
      setStage('error');
    }
  }

  async function stopRecording() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (Platform.OS === 'web') {
      try { mediaRecorderRef.current?.stop?.(); } catch {}
      // onstop callback fires handleAudioReady
    } else {
      try {
        await audioRecorder.stop();
        const uri = audioRecorder.uri;
        if (!uri) throw new Error('Brak URI nagrania.');
        // Expo Go / RN: FormData wymaga { uri, name, type }, nie Blob
        await handleAudioReady(uri, 'audio/m4a');
      } catch (e: any) {
        setErrorMsg(e?.message ?? 'Nie udało się zatrzymać nagrywania.');
        setStage('error');
      }
    }
  }

  async function handleAudioReady(source: Blob | string, mime: string) {
    if (!BACKEND_URL) {
      setErrorMsg('Brak adresu backendu. Ustaw EXPO_PUBLIC_BACKEND_URL w pliku frontend/.env (port 8001) i zrestartuj Expo.');
      setStage('error');
      return;
    }
    setStage('transcribing');
    try {
      const form = new FormData();
      const ext = mime.includes('webm') ? 'webm'
        : mime.includes('m4a') || mime.includes('mp4') ? 'm4a'
        : mime.includes('wav') ? 'wav' : 'webm';
      if (typeof source === 'string') {
        // @ts-ignore  React Native FormData — natywny upload z pliku na dysku
        form.append('audio', { uri: source, name: `voice.${ext}`, type: mime } as any);
      } else {
        // @ts-ignore  Web — MediaRecorder Blob
        form.append('audio', source as any, `voice.${ext}`);
      }
      form.append('language', 'pl');
      const result = await fetchJson<{ text?: string }>(`${BACKEND_URL}/api/voice/transcribe`, {
        method: 'POST',
        headers: await (await import('@/lib/apiHeaders')).apiMultipartHeaders(),
        body: form,
      });
      if (!result.ok) throw new Error(result.error);
      const text = (result.data?.text ?? '').trim();
      if (!text) throw new Error('Nie wykryto mowy w nagraniu.');
      const cleaned = stripWakeWord(text, wakeWord) || text;
      setTranscript(cleaned);

      // Dalsze sterowanie głosem w podglądzie / kalkulatorze
      if (followUpModeRef.current) {
        followUpModeRef.current = false;
        await handleVoiceFollowUp(cleaned);
        return;
      }

      await handleInterpret(cleaned);
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Błąd transkrypcji.');
      setStage('error');
    }
  }

  function foldPl(s: string): string {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function handleVoiceFollowUp(text: string) {
    const t = foldPl(text);
    // Zatwierdź / zapisz
    if (/\b(zatwierdz|zapisz|potwierdz|ok|okej|wykonaj|wlacz danie|wylacz danie|otworz kalkulator)\b/.test(t)
      || t === 'tak' || t === 'jasne') {
      if (followUpReturnStageRef.current === 'review') {
        setStage('review');
        // krótkie opóźnienie żeby canApply z aktualnego stanu zadziałał po setState
        setTimeout(() => { void handleApply(); }, 50);
        return;
      }
      if (followUpReturnStageRef.current === 'done') {
        onClose();
        return;
      }
    }
    // Anuluj
    if (/\b(anuluj|cofnij|stop|rezygnuj|zamknij)\b/.test(t)) {
      if (followUpReturnStageRef.current === 'done') {
        onClose();
        return;
      }
      resetAll();
      return;
    }
    // Porcje w kalkulatorze
    const porcje = t.match(/(?:na\s+)?(\d+)\s*porcj/);
    if (porcje && interp?.intent === 'scale_recipe' && applyResult?.extras) {
      const p = Math.max(1, parseInt(porcje[1], 10));
      const extras = applyResult.extras;
      const ingredients = (extras.ingredients as any[] || []).map((s) => {
        const per = Number(s.per_portion) || 0;
        const total = Math.round(per * p * 100) / 100;
        const have = s.in_stock != null ? Number(s.in_stock) : null;
        return { ...s, total_needed: total, enough: have != null ? have >= total : s.enough };
      });
      setApplyResult({
        ...applyResult,
        extras: {
          ...extras,
          portions: p,
          ingredients,
          message: `Przeliczono „${extras.dish_name || 'danie'}” na ${p} porcji.`,
        },
      });
      setStage('done');
      return;
    }

    // Uzupełnij pola — ponowna interpretacja i merge
    setStage('interpreting');
    try {
      const result = await fetchJson<Interpretation>(`${BACKEND_URL}/api/voice/interpret`, {
        method: 'POST',
        headers: await (await import('@/lib/apiHeaders')).apiJsonHeaders(),
              body: JSON.stringify({ text }),
      });
      if (!result.ok) throw new Error(result.error);
      const data = result.data;
      if (data.intent === interp?.intent || data.intent !== 'unknown') {
        const seeded = seedPayload(data.intent, data.payload || {}, { transcript: text });
        setEdited((prev) => ({ ...prev, ...seeded }));
        if (data.intent !== interp?.intent && data.intent !== 'unknown') {
          setInterp(data);
        }
      }
      setStage('review');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Nie zrozumiano uzupełnienia głosowego.');
      setStage('review');
    }
  }

  function startFollowUpRecording() {
    followUpModeRef.current = true;
    followUpReturnStageRef.current = stageRef.current === 'done' ? 'done' : 'review';
    void startRecording();
  }

  async function handleInterpret(text: string) {
    setStage('interpreting');
    try {
      const result = await fetchJson<Interpretation>(`${BACKEND_URL}/api/voice/interpret`, {
        method: 'POST',
        headers: await (await import('@/lib/apiHeaders')).apiJsonHeaders(),
              body: JSON.stringify({ text }),
      });
      if (!result.ok) throw new Error(result.error);
      const data = correctPeriodIntentFromTranscript(text, result.data);
      if (data.credits_deducted && data.credits_deducted > 0) {
        const rem = data.credits_remaining ?? '—';
        setCreditsNotice(`Ta akcja kosztowała: ${data.credits_deducted} kredytów. Pozostałe saldo: ${rem}.`);
      }
      setInterp(data);
      setClarifyQuery('');
      // Intencje nawigacji/filtrów wykonujemy natychmiast (bez ekranu potwierdzenia).
      if (NAV_INTENTS.has(data.intent)) {
        performNavigation(data.intent, data.payload || {});
        return;
      }
      // Seed editable form state with AI defaults — user may freely change values.
      // AI often returns 0 when it did not recognise a numeric value; convert 0 → null
      // so the TextInput shows the placeholder and the user notices they must type it.
      setEdited(seedPayload(data.intent, data.payload || {}, { transcript: text }));
      setStage('review');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Błąd interpretacji AI.');
      setStage('error');
    }
  }

  async function fetchInventoryRows() {
    const { data } = await supabase
      .from('inventory_items')
      .select('id, name, quantity, min_quantity, unit')
      .order('name');
    return (data ?? []).map((i: any) => ({
      id: String(i.id),
      name: String(i.name || 'Produkt'),
      quantity: Number(i.quantity) || 0,
      minQuantity: Number(i.min_quantity) || 0,
      unit: String(i.unit || 'szt'),
    }));
  }

  async function openInventoryCascadeFromVoice(
    mode: 'critical' | 'stock_asc',
    title?: string,
  ) {
    try {
      const rows = await fetchInventoryRows();
      const items =
        mode === 'critical'
          ? rows.filter((r) => r.quantity <= r.minQuantity)
          : [...rows].sort((a, b) => a.quantity - b.quantity);
      openProductCascade({
        title:
          title ||
          (mode === 'critical' ? 'Produkty krytyczne' : 'Stan magazynowy (rosnąco)'),
        subtitle:
          mode === 'critical'
            ? `${items.length} produktów poniżej progu`
            : `${items.length} produktów · od najniższego stanu`,
        mode: mode === 'critical' ? 'critical' : 'stock_asc',
        items,
      });
    } catch {
      /* best-effort */
    }
  }

  function performNavigation(intent: Intent, payload: Record<string, any>) {
    const textHint = `${JSON.stringify(payload)} ${transcript}`.toLowerCase();
    const wantsCritical =
      payload?.critical ||
      payload?.low_stock ||
      payload?.mode === 'critical' ||
      /krytycz|niski stan|uzupeln|uzupełn|brak(i)? magazyn/.test(textHint);
    const wantsStockAsc =
      payload?.sort === 'quantity_asc' ||
      payload?.mode === 'stock_asc' ||
      /od najnizsz|od najniższ|rosnąco|rosnaco|stan(u)? magazyn/.test(textHint);

    void (async () => {
      try {
        if (wantsCritical || (intent === 'filter_ui_inventory' && wantsCritical)) {
          await openInventoryCascadeFromVoice('critical');
          onClose();
          return;
        }
        if (wantsStockAsc || (intent === 'filter_ui_inventory' && wantsStockAsc)) {
          await openInventoryCascadeFromVoice('stock_asc');
          onClose();
          return;
        }
        if (intent === 'navigate_screen') {
          const screen = String(payload.screen || '');
          if (screen === 'magazyn' && wantsCritical) {
            await openInventoryCascadeFromVoice('critical');
            onClose();
            return;
          }
          const map: Record<string, any> = {
            index: '/(tabs)',
            menu: '/(tabs)/menu',
            magazyn: '/(tabs)/magazyn',
            dostawcy: '/(tabs)/dostawcy',
            ustawienia: '/(tabs)/ustawienia',
          };
          router.push(map[screen] ?? '/(tabs)');
        } else if (intent === 'filter_ui_inventory') {
          // Domyślnie: kaskada produktów kategorii / całego magazynu
          const rows = await fetchInventoryRows();
          const cat = String(payload.category || '').toLowerCase();
          const filtered = cat
            ? rows // brak kategorii w inventory_items w tym select — pokaż wszystkie
            : rows;
          openProductCascade({
            title: cat ? `Magazyn · ${payload.category}` : 'Magazyn — produkty',
            subtitle: `${filtered.length} pozycji`,
            mode: 'custom',
            items: filtered,
          });
        } else if (intent === 'filter_ui_menu_blocked') {
          router.push({ pathname: '/(tabs)/menu', params: { voiceBlocked: '1' } });
        }
      } catch {
        /* navigation best-effort */
      }
      onClose();
    })();
  }

  async function handleApply(opts?: {
    interp?: Interpretation;
    edited?: Record<string, any>;
    transcript?: string;
  }) {
    const curInterp = opts?.interp ?? interpRef.current ?? interp;
    const curEdited = opts?.edited ?? editedRef.current ?? edited;
    const curTranscript = opts?.transcript ?? transcriptRef.current ?? transcript;
    if (!curInterp || curInterp.intent === 'unknown') return;

    // Free / tier 1 bez trialu → PremiumAlert, bez compare-offers / Łowcy
    if (isDealHunterIntent(curInterp.intent) && !dealHunterUnlocked) {
      premiumAlert(DEAL_HUNTER_GATE_TITLE, DEAL_HUNTER_GATE_MESSAGE);
      return;
    }

    if (curInterp.intent === 'add_expiration_batch') {
      const stock = Number(curEdited.current_stock ?? 0);
      const batches = Array.isArray(curEdited.batches) ? curEdited.batches : [];
      const sum = batches.reduce(
        (s: number, b: any) => s + (Number(b?.quantity) || 0),
        0,
      );
      if (!curEdited.inventory_id) {
        setErrorMsg('Wybierz produkt z magazynu przed zapisaniem dat ważności.');
        setStage('error');
        return;
      }
      if (stock <= 0) {
        setErrorMsg('Nie ma już tego produktu w magazynie (stan 0). Najpierw dodaj go na stan.');
        setStage('error');
        return;
      }
      if (sum > stock + 0.001) {
        setErrorMsg(`Nie masz tylu sztuk w magazynie (suma partii ${sum} > stan ${stock}).`);
        setStage('error');
        return;
      }
    }

    // Wgrywanie dokumentów — otwórz skaner (bez zbędnego round-tripu, jeśli BE i tak tylko open_scan).
    if (UPLOAD_INTENTS.has(curInterp.intent)) {
      if (curInterp.intent === 'upload_menu') {
        openMenuScan();
        onApplied?.(curInterp.intent);
        onClose();
        return;
      }
      const kind =
        curInterp.intent === 'upload_invoice'
          ? 'invoice'
          : curInterp.intent === 'upload_offer'
            ? 'offer'
            : 'document';
      openDocumentScan(kind);
      onApplied?.(curInterp.intent);
      onClose();
      return;
    }

      setStage('applying');
    try {
      let applyIntent: Intent = curInterp.intent;
      if (applyIntent === 'bulk_edit_menu_prices_percentage' || applyIntent === 'bulk_edit_menu_prices_fixed') {
        applyIntent = curEdited.price_mode === 'fixed'
          ? 'bulk_edit_menu_prices_fixed'
          : 'bulk_edit_menu_prices_percentage';
      }
      if (applyIntent === 'navigate_screen' || applyIntent === 'filter_ui_inventory' || applyIntent === 'filter_ui_menu_blocked') {
        performNavigation(applyIntent, curEdited);
        return;
      }

      // Zamówienie produktów → zawsze /compare-offers (nie zależymy od starego /actions/apply).
      if (applyIntent === 'order_product') {
        const rawItems = Array.isArray(curEdited.items) ? curEdited.items : [];
        const compareItems = rawItems
          .map((it: any) => ({
            product_name_or_id: String(it?.product_name || it?.name || '').trim(),
            quantity: Number(it?.quantity) > 0 ? Number(it.quantity) : 1,
            unit: String(it?.unit || 'szt').trim() || 'szt',
          }))
          .filter((it: { product_name_or_id: string }) => !!it.product_name_or_id);
        if (!compareItems.length) {
          setErrorMsg('Dodaj co najmniej jeden produkt do zamówienia.');
          setStage('error');
          return;
        }
        const cmp = await fetchJson<Record<string, any>>(`${BACKEND_URL}/api/orders/compare-offers`, {
          method: 'POST',
          headers: await (await import('@/lib/apiHeaders')).apiJsonHeaders(),
                body: JSON.stringify({ items: compareItems }),
        });
        if (!cmp.ok) throw new Error(cmp.error);
        const compare = cmp.data;
        const found = Array.isArray(compare?.items_requested)
          ? compare.items_requested.filter((x: any) => x?.found).length
          : 0;
        setApplyResult({
          detail: `Koszyk: ${compareItems.length} · oferty ${found}/${compareItems.length}`,
          extras: {
            ok: true,
            action: 'order_product',
            compare,
            message: `Znaleziono oferty dla ${found}/${compareItems.length}. Otwieram Łowcę Okazji.`,
          },
          warnings: [],
        });
        setStage('done');
        onApplied?.(applyIntent);
        setBulkContextLabel('Zamówienie u dostawcy');
        setBulkCompare(normalizeOptimizeResult(compare));
        return;
      }

      // Drzewko dat → zawsze wyślij czyste selected_periods (liczby, nie stringi)
      // Dodatkowo: jeśli transcript ma jawny rok (np. 2025), wymuś go na zaznaczeniach
      let rawSels = Array.isArray(curEdited.selected_periods) ? curEdited.selected_periods : [];
      const trYear = (curTranscript || '').match(/\b(20\d{2})\b/);
      if (trYear && rawSels.length) {
        const y = Number(trYear[1]);
        rawSels = rawSels.map((s: any) => ({ ...s, year: y }));
      } else if (trYear && !rawSels.length) {
        const parsed = parsePeriodHintToSelection(curTranscript, { preferYear: Number(trYear[1]) });
        if (parsed) rawSels = [parsed];
      }
      const selected_periods = rawSels
        .filter((s: any) => s && typeof s === 'object' && s.kind && s.year != null)
        .map((s: any) => ({
          kind: String(s.kind),
          year: Number(s.year),
          ...(s.month != null ? { month: Number(s.month) } : {}),
          ...(s.week != null ? { week: Number(s.week) } : {}),
          ...(s.day != null ? { day: Number(s.day) } : {}),
        }));
      let categories = curEdited.categories;
      if (applyIntent === 'order_critical_items_by_category') {
        // NIGDY nie wstrzykuj categories=['all'] gdy puste — to dokładało
        // wszystkie braki magazynowe do koszyka (np. przy samym „ser kozi”
        // albo MIX bez rozpoznanej kategorii). „all” tylko gdy użytkownik/LLM
        // jawnie wybrał „Wszystkie” / „wszystkie braki”.
        if (!Array.isArray(categories)) categories = [];
        const namedItems = Array.isArray(curEdited.items)
          ? curEdited.items.filter((it: any) =>
              String(it?.product_name || it?.name || '').trim())
          : [];
        if (categories.length === 0 && namedItems.length === 0) {
          setErrorMsg(
            'Wybierz kategorię braków (lub „Wszystkie”) albo dodaj produkt z nazwy.',
          );
          setStage('error');
          return;
        }
      }
      const payload = {
        ...curEdited,
        categories,
        selected_periods,
        period_1: selected_periods.length
          ? labelForSelections(selected_periods as PeriodSelection[])
          : curEdited.period_1,
      };

      // Waste: visual size → kg for produce counted as pieces
      let weightHintG: number | null = null;
      if (applyIntent === 'waste' && payload.produce_size) {
        const conv = findProduceConverter(String(payload.item_name || ''));
        const pcs = Number(payload.quantity);
        const sizeKey = String(payload.produce_size) as ProduceSizeKey;
        const tier = conv?.sizes.find((s) => s.key === sizeKey);
        if (conv && tier && Number.isFinite(pcs) && pcs > 0) {
          const { kg, grams } = piecesToKg(pcs, tier);
          payload.produce_pieces = pcs;
          payload.produce_converter_id = conv.id;
          payload.quantity = kg;
          payload.unit = 'kg';
          weightHintG = grams;
        }
      } else if (applyIntent === 'waste') {
        const q = Number(payload.quantity);
        const u = String(payload.unit || '').toLowerCase();
        if (Number.isFinite(q) && q > 0) {
          if (u === 'g') weightHintG = q;
          else if (u === 'kg') weightHintG = q * 1000;
        }
      }

      const result = await fetchJson<{
        ok?: boolean;
        detail?: string;
        extras?: Record<string, any>;
        warnings?: string[];
      }>(`${BACKEND_URL}/api/actions/apply`, {
        method: 'POST',
        headers: await (await import('@/lib/apiHeaders')).apiJsonHeaders(),
              body: JSON.stringify({
          intent: applyIntent,
          payload,
          transcript: curTranscript,
          source: 'voice',
        }),
      });
      if (!result.ok) throw new Error(result.error);
      const data = result.data;
      const extras = data.extras ?? {};
      if (data.ok === false) {
        // Analizy okresu: pokaż komunikat (np. brak danych POS) zamiast „martwego” błędu
        if (PERIOD_INTENTS.has(applyIntent)) {
          setApplyResult({
            detail: data.detail ?? extras.message ?? extras.assistant_speech ?? 'Brak danych',
            extras: {
              ...extras,
              message: extras.message || extras.assistant_speech || data.detail,
            },
            warnings: data.warnings ?? [],
          });
          setStage('done');
          onApplied?.(applyIntent);
          return;
        }
        setErrorMsg(data.detail ?? 'Operacja nie powiodła się.');
        setStage('error');
        return;
      }
      // BE może zwrócić open_scan także po apply
      if (extras.open_scan) {
        if (extras.doc_kind === 'menu') {
          openMenuScan();
        } else {
          openDocumentScan(
            extras.doc_kind === 'offer' ? 'offer' : extras.doc_kind === 'document' ? 'document' : 'invoice',
          );
        }
        onApplied?.(applyIntent);
        onClose();
        return;
      }
      setApplyResult({
        detail: data.detail ?? 'OK',
        extras,
        warnings: data.warnings ?? [],
      });
      if (applyIntent === 'add_expiration_batch') {
        try {
          const { scheduleExpiryReminders } = require('@/lib/pushNotifications') as typeof import('@/lib/pushNotifications');
          const name = String(curEdited.item_name_resolved || curEdited.item_name || curEdited.product_name || 'Produkt');
          const alertDays = Array.isArray(curEdited.alert_days) ? curEdited.alert_days.map(Number) : [7, 3, 1];
          const batches = Array.isArray(curEdited.batches) ? curEdited.batches : [{ expiration_date: curEdited.expiration_date }];
          void scheduleExpiryReminders(
            name,
            batches
              .filter((b: any) => b?.expiration_date)
              .map((b: any) => ({
                expirationDate: String(b.expiration_date),
                alertDays,
              })),
          );
        } catch {
          /* best-effort */
        }
      }
      setStage('done');
      onApplied?.(applyIntent);
      // Bulk Category-Targeted Orders — otwórz Łowcę Okazji z gotowym compare.
      if (applyIntent === 'order_critical_items_by_category') {
        const compare = extras.compare;
        if (compare) {
          const label = Array.isArray(extras.matched_categories) && extras.matched_categories.length > 0
            ? (extras.matched_categories.includes('all')
                ? 'Braki: wszystkie kategorie'
                : `Braki: ${extras.matched_categories.join(', ')}`)
            : 'Zbiorcze zamówienie braków';
          setBulkContextLabel(label);
          setBulkCompare(normalizeOptimizeResult(compare));
        }
      }
      if (applyIntent === 'waste') {
        const itemLabel = String(payload.item_name || curEdited.item_name || '');
        const unitStr = String(payload.unit || '');
        const qtyNum = Number(payload.quantity);
        const preferVolume = shouldPreferVolumeRealityCheck({
          unit: unitStr,
          itemName: itemLabel,
          reason: String(payload.reason_text || curEdited.reason_text || ''),
        });
        setWeightCheckItem(itemLabel);
        setWeightCheckSuggestedG(weightHintG);
        setVolumeCheckItem(itemLabel);
        setVolumeCheckSuggestedMl(
          Number.isFinite(qtyNum) ? suggestedMlFromQty(qtyNum, unitStr) : null,
        );
        setTimeout(() => {
          if (preferVolume) {
            offerVolumeRealityCheck(premiumAlert, {
              onAccept: () => setShowVolumeCheck(true),
            });
          } else {
            offerWeightRealityCheck(premiumAlert, {
              onAccept: () => setShowWeightCheck(true),
            });
          }
        }, 400);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Błąd zapisu.');
      setStage('error');
    }
  }

  /** Klik w legendzie — bez STT / interpret (0 kredytów głosowych). */
  async function runLegendCommand(c: { intent: Intent; example: string }) {
    const text = c.example;
    const seeded = seedPayload(c.intent, {}, { transcript: text, fromLegend: true });
    const data: Interpretation = {
      intent: c.intent,
      confidence: 1,
      reason: 'Wybrane z listy komend (bez głosu)',
      payload: seeded,
    };
    setShowCommands(false);
    setCommandHint(null);
    setCreditsNotice(null);
    setErrorMsg(null);
    setTranscript(text);
    setInterp(data);
    setEdited(seeded);
    transcriptRef.current = text;
    interpRef.current = data;
    editedRef.current = seeded;

    // Filtry UI — od razu; nawigacja i reszta → formularz (użytkownik wybiera zakładkę / okres)
    if (c.intent === 'filter_ui_inventory' || c.intent === 'filter_ui_menu_blocked') {
      performNavigation(c.intent, seeded);
      return;
    }
    if (c.intent === 'list_expiring_soon') {
      await handleApply({ interp: data, edited: seeded, transcript: text });
      return;
    }
    setStage('review');
  }

  function resetAll() {
    cleanup();
    setStage('idle');
    setTranscript('');
    setInterp(null);
    setEdited({});
    setConfirmText('');
    setApplyResult(null);
    setErrorMsg(null);
    setElapsed(0);
    setClarifyQuery('');
  }

  function applyClarifiedIntent(nextIntent: Intent) {
    const prevPayload = { ...(interp?.payload || {}), ...(edited || {}) };
    const amountFromPayload = Number(prevPayload.amount_pln);
    const amountFromText = extractAmountFromText(transcript || '');
    const merged: Record<string, any> = { ...prevPayload };
    if (
      (nextIntent === 'add_revenue' || nextIntent === 'add_fixed_cost' || nextIntent === 'add_variable_cost')
      && !(amountFromPayload > 0)
      && amountFromText != null
    ) {
      merged.amount_pln = amountFromText;
    }
    const seeded = seedPayload(nextIntent, merged, { transcript });
    setInterp((prev) => (prev
      ? {
          ...prev,
          intent: nextIntent,
          confidence: 0.95,
          reason: 'Wybrane z podpowiedzi (wpis / autocomplete)',
          payload: seeded,
        }
      : {
          intent: nextIntent,
          confidence: 0.95,
          reason: 'Wybrane z podpowiedzi (wpis / autocomplete)',
          payload: seeded,
        }));
    setEdited(seeded);
    setClarifyQuery('');
  }

  const needsIntentClarify = !!interp && (
    interp.intent === 'unknown'
    || (Array.isArray(interp.alternate_intents) && interp.alternate_intents.length >= 2)
    || (typeof interp.confidence === 'number' && interp.confidence < 0.7)
  );

  const clarifySuggestions = useMemo(() => {
    const q = clarifyQuery.trim().toLowerCase();
    if (q.length < 1) return [];
    const pool = visibleCommands.length
      ? visibleCommands
      : COMMAND_EXAMPLES.filter((c) => !isDealHunterIntent(c.intent) || dealHunterUnlocked);
    const scored: { id: string; name: string; hint?: string; intent: Intent; score: number }[] = [];
    for (const c of pool) {
      if (c.intent === 'unknown') continue;
      const meta = INTENT_META[c.intent];
      const aliases = INTENT_SEARCH_ALIASES[c.intent] || [];
      const hay = [
        meta.label,
        c.example,
        c.intent.replace(/_/g, ' '),
        ...aliases,
      ].join(' ').toLowerCase();
      if (!hay.includes(q) && !q.split(/\s+/).every((tok) => hay.includes(tok))) continue;
      const starts =
        meta.label.toLowerCase().startsWith(q)
        || aliases.some((a) => a.startsWith(q))
        || c.example.toLowerCase().startsWith(q);
      scored.push({
        id: c.intent,
        name: `${meta.icon} ${meta.label}`,
        hint: c.example,
        intent: c.intent,
        score: starts ? 0 : 1,
      });
    }
    scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'pl'));
    return scored.slice(0, 8).map(({ id, name, hint, intent }) => ({ id, name, hint, intent }));
  }, [clarifyQuery, visibleCommands, dealHunterUnlocked]);

  const patchEdited = (patch: Record<string, any>) => {
    setEdited((prev) => {
      const next = { ...prev, ...patch };
      editedRef.current = next;
      return next;
    });
  };

  const isDestructive = interp ? DESTRUCTIVE_INTENTS.has(interp.intent) : false;
  const confirmOk = confirmText.trim().toUpperCase() === CONFIRM_WORD;
  const canApply = !!interp && interp.intent !== 'unknown' && (!isDestructive || confirmOk)
    && (interp.intent !== 'scale_recipe' || (!!edited.dish_id && edited.dish_accepted === true))
    && (interp.intent !== 'toggle_menu_item_availability' || (!!edited.dish_id && edited.dish_accepted === true))
    && (interp.intent !== 'edit_menu_item_price' || (!!edited.dish_id && edited.dish_accepted === true))
    && (interp.intent !== 'delete_menu_item' || (!!edited.dish_id && edited.dish_accepted === true))
    && (interp.intent !== 'navigate_screen' || !!edited.screen)
    && (!PERIOD_INTENTS.has(interp.intent)
      || (Array.isArray(edited.selected_periods) && edited.selected_periods.length > 0))
    && (!(interp.intent === 'bulk_edit_menu_prices_percentage' || interp.intent === 'bulk_edit_menu_prices_fixed')
      || ((edited.price_mode === 'fixed'
        ? Number(edited.amount) > 0
        : Number(edited.percentage) > 0)))
    && (interp.intent !== 'order_product'
      || (Array.isArray(edited.items) && edited.items.some((it: any) => String(it?.product_name || '').trim())))
    && (interp.intent !== 'order_critical_items_by_category'
      || ((Array.isArray(edited.categories) && edited.categories.length > 0)
        || (Array.isArray(edited.items) && edited.items.some((it: any) => String(it?.product_name || '').trim()))));
  const meta = interp ? INTENT_META[interp.intent] : INTENT_META.unknown;
  const workingMessage =
    stage === 'transcribing' ? 'Zamieniam mowę na tekst (Whisper)…'
      : stage === 'interpreting' ? 'AI klasyfikuje intencję (GPT-4o mini)…'
      : stage === 'applying' ? (PERIOD_INTENTS.has(interp?.intent as Intent) ? 'Analizuję dane…' : 'Zapisuję do Supabase…')
      : '';

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.72)' }]}>
        <View style={[
          styles.sheet,
          {
            backgroundColor: DS.color.bgSecondary,
            borderTopWidth: 1,
            borderColor: DS.color.borderSubtle,
          },
        ]}>
          <View style={[styles.header, { borderBottomColor: DS.color.borderSubtle }]}>
            <View style={styles.headerLeft}>
              <View style={[styles.iconBadge, { backgroundColor: jarvisAccent, shadowColor: jarvisAccent }]}>
                <Mic size={16} color={jarvisCtaText} strokeWidth={2.5} />
              </View>
              <View>
                <Text style={[styles.title, { color: jarvisAccent }]} testID="voice-modal-title">
                  Jarvis · dyktowanie
                </Text>
                <Text style={[styles.subtitle, { color: DS.color.muted }]}>
                  {contextHint ? `${contextHint} · ` : ''}dyktowanie AI
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: '#222' }]}
              testID="voice-modal-close"
            >
              <X size={20} color={DS.color.muted} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {creditsNotice ? (
            <View style={styles.creditsNotice} testID="voice-credits-notice">
              <Text style={styles.creditsNoticeText}>{creditsNotice}</Text>
            </View>
          ) : null}

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {(stage === 'idle' || stage === 'error') && (
              <View style={styles.idleWrap}>
                <Text
                  style={[
                    styles.idleHint,
                    { color: DS.color.heading },
                  ]}
                >
                  Powiedz jedną z komend lub kliknij ją na liście
                  {commandHint ? `:\n„${commandHint}"` : ', np.:\n„Dodaj do menu pizzę margherita za 32 zł"'}
                </Text>

                {commandsUnlocked ? (
                  <>
                <TouchableOpacity
                  style={[
                    styles.commandsToggle,
                    {
                      borderColor: 'rgba(0,255,136,0.35)',
                      backgroundColor: 'rgba(0,255,120,0.08)',
                    },
                  ]}
                  onPress={() => setShowCommands((v) => !v)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.commandsToggleText,
                      { color: jarvisAccent },
                    ]}
                  >
                    {showCommands ? 'Ukryj listę komend' : 'Komendy głosowe'}
                  </Text>
                </TouchableOpacity>

                {showCommands ? (
                  <ScrollView
                    style={[
                      styles.commandsList,
                      {
                        backgroundColor: 'rgba(22,22,22,0.92)',
                        borderColor: 'rgba(255,255,255,0.08)',
                      },
                    ]}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                  >
                    {visibleCommands.map((c) => {
                      const meta = INTENT_META[c.intent];
                      return (
                        <TouchableOpacity
                          key={c.intent + c.example}
                          style={styles.commandRow}
                          onPress={() => { void runLegendCommand(c); }}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.commandIcon}>{meta?.icon ?? '🎤'}</Text>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.commandLabel,
                                { color: '#F8F8F8' },
                              ]}
                            >
                              {meta?.label ?? c.intent}
                            </Text>
                            <Text
                              style={[
                                styles.commandExample,
                                { color: '#A0A0A0' },
                              ]}
                              numberOfLines={2}
                            >
                              „{c.example}"
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                ) : null}
                  </>
                ) : (
                  <Text style={[styles.idleHint, { color: DS.color.muted, marginTop: 8 }]}>
                    Brak kredytów — lista komend AI jest ukryta. Dostępna pozostaje edycja manualna.
                    Doładuj kredyty lub wykup subskrypcję, aby odblokować Jarvis.
                  </Text>
                )}

                <View style={styles.wakeBox}>
                  <Text style={styles.wakeTitle}>Ustaw hasło do wywoływania sterowania głosowego</Text>
                  <Text style={styles.wakeHint}>
                    Ustaw słowo wywołujące, np. Gastro, a aplikacja zacznie czekać na twoją komendę głosową.
                    Wypowiedzenie hasła od razu otwiera nagrywanie (bez dodatkowych przycisków na ekranie).
                  </Text>
                  <View style={styles.wakeRow}>
                    <TextInput
                      style={styles.wakeInput}
                      value={wakeDraft}
                      onChangeText={setWakeDraft}
                      placeholder="Gastro"
                      placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="words"
                      maxLength={32}
                    />
                    <TouchableOpacity style={[styles.wakeSave, { backgroundColor: jarvisAccent }]} onPress={() => void saveWakeWord()}>
                      <Text style={styles.wakeSaveText}>Zapisz</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.wakeListenBtn,
                      wakeListening && { borderColor: jarvisAccent, backgroundColor: `${jarvisAccent}22` },
                    ]}
                    onPress={() => (wakeListening ? stopWakeListen() : startWakeListen())}
                    activeOpacity={0.85}
                  >
                    <Mic size={14} color={wakeListening ? jarvisAccent : Colors.textSecondary} strokeWidth={2.5} />
                    <Text style={[styles.wakeListenText, wakeListening && { color: jarvisAccent }]}>
                      {wakeListening ? 'Zatrzymaj nasłuch' : `Włącz nasłuch „${wakeWord}”`}
                    </Text>
                  </TouchableOpacity>
                  {wakeStatus ? <Text style={styles.wakeStatus}>{wakeStatus}</Text> : null}
                </View>

                <TouchableOpacity
                  style={[styles.recBtn, styles.recBtnStart, { backgroundColor: jarvisAccent, shadowColor: jarvisAccent }]}
                  onPress={startRecording}
                  activeOpacity={0.85}
                  testID="voice-record-start"
                >
                  <Mic size={30} color={Colors.white} strokeWidth={2.5} />
                </TouchableOpacity>
                <Text style={styles.recBtnLabel}>Rozpocznij nagrywanie</Text>
                {stage === 'error' && errorMsg && (
                  <View style={styles.errorBox} testID="voice-error-box">
                    <AlertTriangle size={14} color={Colors.danger} strokeWidth={2.5} />
                    <Text style={styles.errorText}>{errorMsg}</Text>
                  </View>
                )}
              </View>
            )}

            {stage === 'recording' && (
              <View style={styles.idleWrap}>
                <View style={styles.pulseRing}>
                  <TouchableOpacity
                    style={[styles.recBtn, styles.recBtnStop]}
                    onPress={stopRecording}
                    activeOpacity={0.85}
                    testID="voice-record-stop"
                  >
                    <Square size={22} color={Colors.white} strokeWidth={2.5} />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.recBtnLabel, { color: Colors.danger }]}>
                  Nagrywanie… {elapsed}s
                </Text>
                <Text style={styles.idleHint}>Kliknij ponownie aby zakończyć</Text>
              </View>
            )}

            {(stage === 'transcribing' || stage === 'interpreting' || stage === 'applying') && (
              <View style={styles.workingWrap}>
                <ActivityIndicator size="large" color={Colors.accent} />
                <Text style={styles.workingText}>{workingMessage}</Text>
                {transcript && stage !== 'transcribing' && (
                  <View style={styles.transcriptBox}>
                    <Text style={styles.transcriptLabel}>Rozpoznany tekst:</Text>
                    <Text style={styles.transcriptText}>{transcript}</Text>
                  </View>
                )}
              </View>
            )}

            {stage === 'review' && interp && (
              <View>
                <View style={styles.transcriptBox}>
                  <Text style={styles.transcriptLabel}>Rozpoznany tekst</Text>
                  <Text style={styles.transcriptText}>{transcript}</Text>
                </View>

                <Text style={styles.sectionLabel}>Intencja AI</Text>
                <View style={[styles.intentBadge, { backgroundColor: `${meta.color}18`, borderColor: `${meta.color}55` }]}>
                  <Text style={styles.intentBadgeIcon}>{meta.icon}</Text>
                  <Text style={[styles.intentBadgeText, { color: meta.color }]}>{meta.label}</Text>
                  <Text style={styles.intentBadgeConf}>{Math.round((interp.confidence ?? 0) * 100)}%</Text>
                </View>

                {interp.reason ? (
                  <Text style={styles.intentReason}>{interp.reason}</Text>
                ) : null}

                {Array.isArray(interp.alternate_intents) && interp.alternate_intents.length >= 2 ? (
                  <View style={styles.altIntentsBox} testID="voice-alt-intents">
                    <Text style={styles.periodConfirmWarn}>Jarvis nie jest pewien — wybierz:</Text>
                    {interp.alternate_intents.slice(0, 2).map((alt) => (
                      <TouchableOpacity
                        key={alt.intent}
                        style={[
                          styles.altIntentBtn,
                          interp.intent === alt.intent && styles.altIntentBtnOn,
                        ]}
                        onPress={() => applyClarifiedIntent(alt.intent as Intent)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.altIntentText, interp.intent === alt.intent && { color: '#0A0A0A' }]}>
                          {alt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    <Text style={styles.clarifyHint}>Albo wpisz, co chcesz zrobić:</Text>
                    <JarvisSuggestBox
                      query={clarifyQuery}
                      onChangeQuery={setClarifyQuery}
                      suggestions={clarifySuggestions}
                      onPick={(s) => {
                        const intent = (s.id || '') as Intent;
                        if (intent && INTENT_META[intent]) applyClarifiedIntent(intent);
                      }}
                      placeholder="np. dodaj przychód, koszt stały…"
                      testID="voice-clarify-input"
                    />
                  </View>
                ) : needsIntentClarify ? (
                  <View style={styles.altIntentsBox} testID="voice-clarify-box">
                    <Text style={styles.periodConfirmWarn}>
                      {interp.intent === 'unknown'
                        ? 'Nie rozpoznano komendy — wpisz, co chcesz zrobić:'
                        : 'Jarvis nie jest pewien — doprecyzuj wpisując komendę:'}
                    </Text>
                    <JarvisSuggestBox
                      query={clarifyQuery}
                      onChangeQuery={setClarifyQuery}
                      suggestions={clarifySuggestions}
                      onPick={(s) => {
                        const intent = (s.id || '') as Intent;
                        if (intent && INTENT_META[intent]) applyClarifiedIntent(intent);
                      }}
                      placeholder="np. dodaj przychód, koszt stały…"
                      testID="voice-clarify-input"
                    />
                  </View>
                ) : null}

                {interp.intent !== 'unknown' && !isDestructive && (
                  <Text style={styles.editHint}>
                    Sprawdź i popraw dane przed zapisem — możesz edytować każde pole.
                  </Text>
                )}

                {isDestructive && (
                  <View style={styles.dangerBox} testID="voice-danger-box">
                    <View style={styles.dangerHeader}>
                      <ShieldAlert size={20} color="#FFFFFF" strokeWidth={2.5} />
                      <Text style={styles.dangerTitle}>⚠️ Uwaga! Operacja nieodwracalna</Text>
                    </View>
                    <Text style={styles.dangerText}>
                      Jarvis wykrył intencję masowego usunięcia / resetu danych
                      („{meta.label}"). Aby kontynuować, wpisz poniżej słowo{'\n'}
                      <Text style={styles.dangerWord}>{CONFIRM_WORD}</Text>.
                    </Text>
                    <TextInput
                      style={styles.dangerInput}
                      value={confirmText}
                      onChangeText={setConfirmText}
                      placeholder={CONFIRM_WORD}
                      placeholderTextColor="rgba(255,255,255,0.5)"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      testID="voice-confirm-input"
                    />
                  </View>
                )}

                {!isDestructive && (
                  <IntentEditor
                    intent={interp.intent}
                    edited={edited}
                    patch={patchEdited}
                    categories={categories}
                    menuCategories={menuCategories}
                  />
                )}

                {interp.intent === 'unknown' && !needsIntentClarify && (
                  <View style={styles.errorBox}>
                    <AlertTriangle size={14} color={Colors.danger} strokeWidth={2.5} />
                    <Text style={styles.errorText}>
                      AI nie rozpoznało jednoznacznej intencji. Nagraj ponownie
                      z konkretnymi słowami: „wyrzuciłem", „dodaj do menu",
                      „rachunek za…", „nowy dostawca…".
                    </Text>
                  </View>
                )}

                {interp.intent === 'unknown' && needsIntentClarify ? (
                  <Text style={styles.editHint}>
                    Wybierz podpowiedź powyżej albo nagraj jeszcze raz z jaśniejszą komendą.
                  </Text>
                ) : null}

                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={resetAll} activeOpacity={0.85} testID="voice-review-retry">
                    <RefreshCw size={14} color={DS.color.muted} strokeWidth={2.5} />
                    <Text style={styles.secondaryBtnText} numberOfLines={2}>Nagraj jeszcze raz</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      isDestructive && styles.dangerBtn,
                      !canApply && styles.primaryBtnDisabled,
                    ]}
                    onPress={() => { void handleApply(); }}
                    disabled={!canApply}
                    activeOpacity={0.85}
                    testID="voice-review-apply"
                  >
                    {isDestructive
                      ? <Trash2 size={14} color={Colors.white} strokeWidth={2.5} />
                      : <Send size={14} color="#0A0A0A" strokeWidth={2.5} />}
                    <Text style={[styles.primaryBtnText, isDestructive && { color: Colors.white }]} numberOfLines={2}>
                      {isDestructive ? 'Usuń bezpowrotnie'
                        : interp.intent === 'restore_last_deleted_menu' ? 'Przywróć menu'
                        : interp.intent === 'restore_deleted_inventory' ? 'Przywróć magazyn'
                        : interp.intent === 'scale_recipe' ? 'Otwórz kalkulator'
                        : interp.intent === 'toggle_menu_item_availability'
                          ? (edited.available === true ? 'Włącz danie' : 'Wyłącz danie')
                        : PERIOD_INTENTS.has(interp.intent) ? 'Analizuj'
                        : (interp.intent === 'order_product' || interp.intent === 'order_critical_items_by_category')
                          ? 'Zamów'
                        : UPLOAD_INTENTS.has(interp.intent)
                          ? (interp.intent === 'upload_offer' ? 'Wgraj ofertę' : interp.intent === 'upload_document' ? 'Wgraj dokument' : 'Wgraj fakturę')
                        : 'Zapisz'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.wakeListenBtn, { marginTop: 10 }]}
                  onPress={startFollowUpRecording}
                  activeOpacity={0.85}
                  testID="voice-review-followup"
                >
                  <Mic size={14} color="#0A0A0A" strokeWidth={2.5} />
                  <Text style={[styles.wakeListenText, { color: '#0A0A0A' }]} numberOfLines={2}>
                    Mów dalej — uzupełnij lub zatwierdź głosem
                  </Text>
                </TouchableOpacity>
                <Text style={[styles.editHint, { marginTop: 6 }]}>
                  Np. „zatwierdź”, „anuluj”, „na 30 porcji”, albo popraw nazwę dania głosem.
                </Text>
              </View>
            )}

            {stage === 'done' && applyResult && interp && (
              <View>
                <View style={[styles.successBox, { backgroundColor: meta.color }]}>
                  <Check size={20} color={Colors.white} strokeWidth={3} />
                  <Text style={styles.successText}>
                    {interp.intent === 'scale_recipe'
                      ? 'Kalkulator porcji'
                      : PERIOD_INTENTS.has(interp.intent)
                        ? `${meta.label} — wynik`
                        : UPLOAD_INTENTS.has(interp.intent)
                          ? `${meta.label}`
                          : `${meta.label} — zapisano`}
                  </Text>
                </View>

                <IntentDoneSummary
                  intent={interp.intent}
                  extras={applyResult.extras}
                  onExtrasChange={(next) => setApplyResult((prev) => prev ? { ...prev, extras: next } : prev)}
                />

                {applyResult.warnings.length > 0 && (
                  <View style={styles.warnBox}>
                    <AlertTriangle size={13} color={Colors.warning} strokeWidth={2.5} />
                    <View style={{ flex: 1 }}>
                      {applyResult.warnings.map((w, i) => (
                        <Text key={i} style={styles.warnText}>• {w}</Text>
                      ))}
                    </View>
                  </View>
                )}

                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={resetAll} activeOpacity={0.85} testID="voice-done-again">
                    <Mic size={14} color={DS.color.muted} strokeWidth={2.5} />
                    <Text style={styles.secondaryBtnText} numberOfLines={2}>Zgłoś kolejną</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.primaryBtn} onPress={onClose} activeOpacity={0.85} testID="voice-done-close">
                    <Check size={14} color="#0A0A0A" strokeWidth={2.5} />
                    <Text style={styles.primaryBtnText}>Zamknij</Text>
                  </TouchableOpacity>
                </View>
                {(interp.intent === 'scale_recipe') ? (
                  <TouchableOpacity
                    style={[styles.wakeListenBtn, { marginTop: 10 }]}
                    onPress={startFollowUpRecording}
                    activeOpacity={0.85}
                  >
                    <Mic size={14} color="#0A0A0A" strokeWidth={2.5} />
                    <Text style={[styles.wakeListenText, { color: '#0A0A0A' }]} numberOfLines={2}>
                      Zmień porcje głosem (np. „na 40 porcji”)
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
      {/* Bulk Deal Hunter — otwierany po zbiorczym zamówieniu braków. */}
      {bulkCompare ? (
        <DealHunterModal
          visible={!!bulkCompare}
          product={null}
          restaurantName={undefined}
          initialCompare={bulkCompare}
          bulkContextLabel={bulkContextLabel}
          onClose={() => { setBulkCompare(null); setBulkContextLabel(''); onClose(); }}
        />
      ) : null}
      <WeightRealityCheckModal
        visible={showWeightCheck}
        onClose={() => setShowWeightCheck(false)}
        itemName={weightCheckItem}
        suggestedGrams={weightCheckSuggestedG}
      />
      <VolumeRealityCheckModal
        visible={showVolumeCheck}
        onClose={() => setShowVolumeCheck(false)}
        itemName={volumeCheckItem}
        suggestedMl={volumeCheckSuggestedMl}
      />
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Intent-specific EDITORS (user can modify AI defaults before confirming)
// ────────────────────────────────────────────────────────────────────────────

interface EditorProps {
  intent: Intent;
  edited: Record<string, any>;
  patch: (p: Record<string, any>) => void;
  categories: { id: string; name: string; color: string }[];
  menuCategories: string[];
}

function IntentEditor({ intent, edited, patch, categories, menuCategories }: EditorProps) {
  const { openDocumentScan } = useUiOverlay();
  if (intent === 'navigate_screen') {
    return <NavigateScreenEditor edited={edited} patch={patch} />;
  }
  if (intent === 'bulk_edit_menu_prices_percentage' || intent === 'bulk_edit_menu_prices_fixed') {
    return <BulkPriceEditor edited={edited} patch={patch} menuCategories={menuCategories} />;
  }
  if (intent === 'waste') {
    const isDish = (edited.item_type ?? 'ingredient') === 'dish';
    // Danie z menu → jednostki liczone z receptury (porcja) + gramatura płynów/wagi.
    // Składnik z magazynu → jednostki magazynowe.
    const wasteUnits = isDish ? ['porcja', 'l', 'kg', 'g', 'ml'] : ['szt', 'op', 'l', 'ml', 'g', 'kg'];
    const changeType = (v: string) => {
      const next: Record<string, any> = { item_type: v, produce_size: null };
      const validNow = (v === 'dish' ? ['porcja', 'l', 'kg', 'g', 'ml'] : ['szt', 'op', 'l', 'ml', 'g', 'kg']);
      if (!validNow.includes(edited.unit)) {
        next.unit = v === 'dish' ? 'porcja' : 'szt';
      }
      patch(next);
    };
    const produce = !isDish ? findProduceConverter(String(edited.item_name || '')) : null;
    const selectedSize = (edited.produce_size as ProduceSizeKey | null) || null;
    const pcs = Number(edited.quantity) || 0;
    return (
      <Card>
        <SegmentedField
          label="Typ"
          value={edited.item_type ?? 'ingredient'}
          onChange={changeType}
          options={[
            { key: 'ingredient', label: 'Składnik z magazynu' },
            { key: 'dish', label: 'Danie z menu' },
          ]}
        />
        <EditRow label="Pozycja" value={edited.item_name ?? ''} onChangeText={(v) => patch({ item_name: v, produce_size: null })} placeholder={isDish ? 'np. Krem z dyni' : 'np. Mleko'} />
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <EditRow label="Ilość" value={edited.quantity == null ? '' : String(edited.quantity)} onChangeText={(v) => patch({ quantity: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0" />
          </View>
          <View style={{ flex: 1 }}>
            <UnitField value={edited.unit ?? ''} onChange={(v) => patch({ unit: v })} options={wasteUnits} />
          </View>
        </View>
        {produce && (edited.unit === 'szt' || edited.unit === 'op' || edited.unit === 'kg' || !edited.unit) ? (
          <ProduceSizePicker
            converter={produce}
            pieceCount={pcs}
            selectedSize={selectedSize}
            onSelectSize={(size) => patch({ produce_size: size, unit: 'szt' })}
          />
        ) : null}
        {isDish && (
          <Text style={styles.editHint2}>
            Jednostka „porcja” odejmie składniki z receptury × liczba porcji. Litr/kg/g/ml odejmie wg wielkości porcji dania.
          </Text>
        )}
        <EditRow label="Powód" value={edited.reason_text ?? ''} onChangeText={(v) => patch({ reason_text: v })} placeholder="np. skwaśniało" multiline />
      </Card>
    );
  }
  if (intent === 'add_revenue') {
    return (
      <Card>
        <EditRow label="Opis" value={edited.description ?? ''} onChangeText={(v) => patch({ description: v })} placeholder="np. Utarg dzienny" />
        <EditRow label="Kwota (PLN)" value={edited.amount_pln == null ? '' : String(edited.amount_pln)} onChangeText={(v) => patch({ amount_pln: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0.00" />
        <EditRow label="Notatka" value={edited.note ?? ''} onChangeText={(v) => patch({ note: v })} placeholder="opcjonalnie" multiline />
      </Card>
    );
  }
  if (intent === 'add_fixed_cost' || intent === 'add_variable_cost') {
    return (
      <Card>
        <EditRow label="Nazwa" value={edited.cost_name ?? ''} onChangeText={(v) => patch({ cost_name: v })} placeholder="np. Rachunek za prąd" />
        <EditRow label="Kategoria" value={edited.cost_type ?? ''} onChangeText={(v) => patch({ cost_type: v })} placeholder="other" />
        <EditRow label="Kwota (PLN)" value={edited.amount_pln == null ? '' : String(edited.amount_pln)} onChangeText={(v) => patch({ amount_pln: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0.00" />
      </Card>
    );
  }
  if (intent === 'add_inventory_item') {
    return (
      <Card>
        <EditRow
          label="Nazwa produktu"
          value={edited.product_name ?? ''}
          onChangeText={(v) => patch({ product_name: v })}
          placeholder="np. Mleko"
          testID="voice-edit-product-name"
        />

        <FieldLabel text="Kategoria" />
        {categories.length === 0 ? (
          <TextInput
            style={styles.editInput}
            value={edited.category_name ?? ''}
            onChangeText={(v) => patch({ category_name: v })}
            placeholder="np. Nabiał (wpisz ręcznie)"
            placeholderTextColor={Colors.textTertiary}
            testID="voice-edit-category-text"
          />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {categories.map((cat) => {
              const active = (edited.category_name ?? '').toLowerCase() === cat.name.toLowerCase();
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.pill, active && { backgroundColor: cat.color, borderColor: cat.color }]}
                  onPress={() => patch({ category_name: cat.name })}
                  activeOpacity={0.7}
                  testID={`voice-edit-category-${cat.name}`}
                >
                  {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                  <Text style={[styles.pillText, active && { color: Colors.white, fontWeight: '700' }]}>{cat.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={[styles.twoCol, { marginTop: 12 }]}>
          <View style={{ flex: 1 }}>
            <EditRow
              label="Ilość"
              value={edited.quantity == null ? '' : String(edited.quantity)}
              onChangeText={(v) => patch({ quantity: numOrNull(v) })}
              keyboardType="decimal-pad"
              placeholder="0"
              testID="voice-edit-quantity"
            />
          </View>
          <View style={{ flex: 1 }}>
            <UnitField value={edited.unit ?? ''} onChange={(v) => patch({ unit: v })} />
          </View>
        </View>

        <EditRow
          label="Próg krytyczny"
          value={edited.min_quantity == null ? '' : String(edited.min_quantity)}
          onChangeText={(v) => patch({ min_quantity: numOrNull(v) })}
          keyboardType="decimal-pad"
          placeholder="np. 2"
          testID="voice-edit-min-quantity"
          hint={`Alarm o niskim stanie włącza się poniżej tej wartości (${edited.unit ?? 'jednostki'})`}
        />

        <EditRow
          label="Próg optymalny"
          value={edited.optimal_quantity == null ? '' : String(edited.optimal_quantity)}
          onChangeText={(v) => patch({ optimal_quantity: numOrNull(v) })}
          keyboardType="decimal-pad"
          placeholder="np. 10"
          testID="voice-edit-optimal-quantity"
          hint="Docelowy stan magazynu — używany przy zamówieniu braków „do optymalnego”"
        />

        <EditRow
          label="Bufor bezpieczeństwa (%)"
          value={String(edited.safety_buffer_percent ?? 20)}
          onChangeText={(v) => patch({ safety_buffer_percent: numOrNull(v) })}
          keyboardType="number-pad"
          placeholder="20"
          testID="voice-edit-safety-buffer"
        />
        <View style={styles.bufferInfoBox}>
          <Info size={12} color={DS.color.muted} strokeWidth={2} />
          <Text style={styles.bufferInfoText}>
            <Text style={styles.bufferInfoBold}>Bufor bezpieczeństwa</Text> – Zapas na niezgłoszone straty i ubytki. Ostrzeżenie o braku towaru włączy się o tyle % wcześniej.
          </Text>
        </View>
      </Card>
    );
  }
  if (intent === 'add_menu_item') {
    const ingredients: any[] = Array.isArray(edited.ingredients) ? edited.ingredients : [];
    const updateIngredient = (idx: number, changes: Record<string, any>) => {
      const next = ingredients.map((ing, i) => (i === idx ? { ...ing, ...changes } : ing));
      patch({ ingredients: next });
    };
    const removeIngredient = (idx: number) => {
      patch({ ingredients: ingredients.filter((_, i) => i !== idx) });
    };
    const addIngredient = () => {
      patch({ ingredients: [...ingredients, { ingredient_name: '', quantity: null, unit: 'g' }] });
    };
    return (
      <Card>
        <EditRow
          label="Nazwa dania"
          value={edited.product_name ?? ''}
          onChangeText={(v) => patch({ product_name: v })}
          placeholder="np. Sałatka grecka"
          testID="voice-edit-menu-name"
        />
        <MenuCategorySuggest
          value={edited.menu_category ?? ''}
          onChange={(v) => patch({ menu_category: v })}
          categories={menuCategories}
        />
        <EditRow
          label="Cena (PLN)"
          value={edited.price_pln == null ? '' : String(edited.price_pln)}
          onChangeText={(v) => patch({ price_pln: numOrNull(v) })}
          keyboardType="decimal-pad"
          placeholder="np. 32.00"
          testID="voice-edit-menu-price"
          hint="Cena sprzedaży dania w karcie menu"
        />

        <View style={styles.ingHeader}>
          <Text style={styles.editLabel}>Składniki ({ingredients.length})</Text>
          <TouchableOpacity onPress={addIngredient} style={styles.ingAddBtn} activeOpacity={0.8} testID="voice-edit-ingredient-add">
            <Plus size={12} color="#0A0A0A" strokeWidth={2.5} />
            <Text style={styles.ingAddText}>Dodaj składnik</Text>
          </TouchableOpacity>
        </View>

        {ingredients.length === 0 ? (
          <Text style={styles.ingEmpty}>Brak składników — kliknij „Dodaj składnik".</Text>
        ) : ingredients.map((ing, idx) => (
          <View key={idx} style={styles.ingCard} testID={`voice-edit-ingredient-${idx}`}>
            <View style={styles.ingCardHead}>
              <Text style={styles.ingCardIdx}>#{idx + 1}</Text>
              <TouchableOpacity onPress={() => removeIngredient(idx)} style={styles.ingRemoveBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} testID={`voice-edit-ingredient-remove-${idx}`}>
                <X size={13} color="#F87171" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
            <IngredientNameSuggest
              value={ing.ingredient_name ?? ''}
              onChange={(v) => updateIngredient(idx, { ingredient_name: v })}
              onPickUnit={(u) => updateIngredient(idx, { unit: u })}
            />
            <View style={[styles.twoCol, { marginTop: 8 }]}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.editInput}
                  value={ing.quantity == null ? '' : String(ing.quantity)}
                  onChangeText={(v) => updateIngredient(idx, { quantity: numOrNull(v) })}
                  keyboardType="decimal-pad"
                  placeholder="Ilość"
                  placeholderTextColor="#777"
                  testID={`voice-edit-ingredient-qty-${idx}`}
                />
              </View>
              <View style={{ flex: 1.2 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
                  {UNIT_OPTIONS.map((u) => {
                    const active = ing.unit === u;
                    return (
                      <TouchableOpacity
                        key={u}
                        style={[styles.unitPillSm, active && styles.unitPillActive]}
                        onPress={() => updateIngredient(idx, { unit: u })}
                        activeOpacity={0.7}
                        testID={`voice-edit-ingredient-unit-${idx}-${u}`}
                      >
                        <Text style={[styles.unitPillTextSm, active && styles.unitPillTextActive]}>{u}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          </View>
        ))}
      </Card>
    );
  }
  if (intent === 'add_supplier') {
    return (
      <SupplierWithCatalogEditor
        edited={edited}
        patch={patch}
        onUploadCatalog={() => {
          patch({ upload_catalog_after: true });
          openDocumentScan('offer');
        }}
      />
    );
  }
  if (intent === 'add_supplier_product') {
    return (
      <Card>
        <EditRow label="Dostawca" value={edited.supplier_name ?? ''} onChangeText={(v) => patch({ supplier_name: v })} placeholder="np. Makro" />
        <EditRow label="Produkt" value={edited.product_name ?? ''} onChangeText={(v) => patch({ product_name: v })} placeholder="np. Piwo Tyskie" />
        <EditRow label="Wariant" value={edited.variant ?? ''} onChangeText={(v) => patch({ variant: v })} placeholder="opcjonalnie" />
        <EditRow label="Opakowanie" value={edited.volume_label ?? ''} onChangeText={(v) => patch({ volume_label: v })} placeholder="np. zgrzewka 24szt" />
        <EditRow label="Cena (PLN)" value={edited.price_pln == null ? '' : String(edited.price_pln)} onChangeText={(v) => patch({ price_pln: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0.00" />
      </Card>
    );
  }

  // ── Voice CRUD (edycja istniejących obiektów) ─────────────────────────────
  if (intent === 'edit_menu_item_price') {
    return (
      <DishPickEditor
        edited={edited}
        patch={patch}
        priceField
        title="Wpisz nazwę dania i kliknij propozycję z listy, potem podaj nową cenę."
      />
    );
  }
  if (intent === 'delete_menu_item') {
    return (
      <DishPickEditor
        edited={edited}
        patch={patch}
        title="Wybierz danie do usunięcia — kliknij propozycję z listy (samo wpisanie nie wystarczy)."
      />
    );
  }
  if (intent === 'add_recipe_ingredient' || intent === 'edit_recipe_ingredient_qty') {
    const isEdit = intent === 'edit_recipe_ingredient_qty';
    return (
      <Card>
        <JarvisMatchBanner
          label="składnik receptury"
          matched={edited.dish_name_resolved || edited.dish_name}
          question={isEdit ? `Zmienić gramaturę ${edited.ingredient_name} na ${edited.quantity} ${edited.unit || 'g'}?`
                          : `Dodać ${edited.quantity} ${edited.unit || 'g'} składnika "${edited.ingredient_name}" do dania?`}
        />
        <EditRow label="Danie" value={edited.dish_name_resolved ?? edited.dish_name ?? ''}
          onChangeText={(v) => patch({ dish_name: v, dish_name_resolved: v, dish_id: null })}
          placeholder="np. Sałatka Grecka" />
        <EditRow label="Składnik"
          value={edited.ingredient_name_resolved ?? edited.ingredient_name ?? ''}
          onChangeText={(v) => patch({ ingredient_name: v, ingredient_name_resolved: v })}
          placeholder="np. Feta" />
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <EditRow
              label="Gramatura"
              value={edited.quantity == null ? '' : String(edited.quantity)}
              onChangeText={(v) => patch({ quantity: numOrNull(v) })}
              keyboardType="decimal-pad"
              placeholder="0"
              testID="voice-edit-recipe-qty"
              hint="⭐ Pole podświetlone"
            />
          </View>
          <View style={{ flex: 1 }}>
            <UnitField value={edited.unit ?? 'g'} onChange={(v) => patch({ unit: v })} />
          </View>
        </View>
      </Card>
    );
  }
  if (intent === 'edit_inventory_item') {
    return (
      <Card>
        <JarvisMatchBanner
          label="produkt w magazynie"
          matched={edited.item_name_resolved || edited.item_name}
          question="Czy zapisać nowe parametry?"
        />
        <EditRow label="Nazwa produktu"
          value={edited.item_name_resolved ?? edited.item_name ?? ''}
          onChangeText={(v) => patch({ item_name: v, item_name_resolved: v, inventory_id: null })}
          placeholder="np. Mleko" />
        <EditRow label="Nowy próg krytyczny"
          value={edited.min_quantity == null ? '' : String(edited.min_quantity)}
          onChangeText={(v) => patch({ min_quantity: numOrNull(v) })}
          keyboardType="decimal-pad" placeholder="pozostaw puste, aby nie zmieniać"
          testID="voice-edit-min-qty"
          hint={edited.min_quantity != null ? '⭐ Wypełnione z komendy' : undefined}
        />
        <EditRow label="Nowy stan magazynu"
          value={edited.current_quantity == null ? '' : String(edited.current_quantity)}
          onChangeText={(v) => patch({ current_quantity: numOrNull(v) })}
          keyboardType="decimal-pad" placeholder="pozostaw puste"
          testID="voice-edit-current-qty"
          hint={edited.current_quantity != null ? '⭐ Wypełnione z komendy' : undefined}
        />
        <EditRow label="Bufor bezpieczeństwa (%)"
          value={edited.safety_buffer_percent == null ? '' : String(edited.safety_buffer_percent)}
          onChangeText={(v) => patch({ safety_buffer_percent: numOrNull(v) })}
          keyboardType="decimal-pad" placeholder="np. 20"
          testID="voice-edit-buffer"
          hint={edited.safety_buffer_percent != null ? '⭐ Wypełnione z komendy' : undefined}
        />
        <UnitField value={edited.unit ?? 'szt'} onChange={(v) => patch({ unit: v })} />
      </Card>
    );
  }

  if (intent === 'add_expiration_batch') {
    return (
      <ExpirationVoiceForm
        edited={edited}
        patch={patch}
        Card={Card}
        UnitField={UnitField}
        JarvisMatchBanner={JarvisMatchBanner as any}
      />
    );
  }

  if (intent === 'scale_recipe') {
    return (
      <ScaleRecipePicker edited={edited} patch={patch} />
    );
  }

  if (intent === 'toggle_menu_item_availability') {
    return (
      <ToggleDishPicker edited={edited} patch={patch} />
    );
  }

  // ── Dostawcy: podgląd akcji (nie edycja formularza — użytkownik zatwierdza wykonanie).
  if (intent === 'order_product') {
    return <OrderProductEditor edited={edited} patch={patch} />;
  }
  if (intent === 'order_critical_items_by_category') {
    return (
      <CriticalOrderEditor
        edited={edited}
        patch={patch}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    );
  }
  if (intent === 'supplier_flip_order' || intent === 'budget_cap_order' ||
      intent === 'compare_catalogs_top_savings' || intent === 'predictive_weekend_restock' ||
      intent === 'check_minimum_order_value') {
    return (
      <Card>
        <View style={styles.supplierActionInfo} testID={`voice-supplier-action-${intent}`}>
          <Text style={styles.supplierActionTitle}>{INTENT_META[intent].label}</Text>
          {intent === 'supplier_flip_order' && (
            <>
              <EditRow label="Z dostawcy" value={edited.from_supplier_resolved ?? edited.from_supplier ?? ''}
                onChangeText={(v) => patch({ from_supplier: v, from_supplier_resolved: v })} placeholder="np. Makro" />
              <EditRow label="Do dostawcy" value={edited.to_supplier_resolved ?? edited.to_supplier ?? ''}
                onChangeText={(v) => patch({ to_supplier: v, to_supplier_resolved: v })} placeholder="np. Sokołów" />
              <EditRow label="Kategoria (opcjonalnie)" value={edited.category ?? ''}
                onChangeText={(v) => patch({ category: v })} placeholder="mięso, napoje…" />
            </>
          )}
          {intent === 'budget_cap_order' && (
            <>
              <EditRow label="Maks. budżet (PLN)" value={edited.max_budget == null ? '' : String(edited.max_budget)}
                onChangeText={(v) => patch({ max_budget: numOrNull(v) })} keyboardType="decimal-pad" placeholder="np. 500"
                hint="⭐ Pole podświetlone — Jarvis wypełnił z komendy" />
              <EditRow label="Kategoria (opcjonalnie)" value={edited.category ?? ''}
                onChangeText={(v) => patch({ category: v })} placeholder="mięso, napoje…" />
            </>
          )}
          {intent === 'check_minimum_order_value' && (
            <>
              <EditRow label="Dostawca" value={edited.supplier_name_resolved ?? edited.supplier_name ?? ''}
                onChangeText={(v) => patch({ supplier_name: v, supplier_name_resolved: v })} placeholder="np. Makro" />
              <EditRow label="Aktualna wartość koszyka (PLN)"
                value={edited.current_cart_total == null ? '' : String(edited.current_cart_total)}
                onChangeText={(v) => patch({ current_cart_total: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0.00" />
            </>
          )}
          {(intent === 'compare_catalogs_top_savings' || intent === 'predictive_weekend_restock') && (
            <Text style={styles.supplierActionHint}>
              Po zatwierdzeniu Jarvis wykona akcję i pokaże wynik na dole.
            </Text>
          )}
        </View>
      </Card>
    );
  }

  if (PERIOD_INTENTS.has(intent)) {
    return (
      <PeriodConfirmEditor
        intent={intent}
        edited={edited}
        patch={patch}
        categories={categories.map((c) => c.name)}
        menuCategories={menuCategories}
      />
    );
  }

  if (UPLOAD_INTENTS.has(intent)) {
    const kindLabel =
      intent === 'upload_offer'
        ? 'ofertę dostawcy lub fakturę zakupową u dostawcy'
        : intent === 'upload_document'
          ? 'dokument (faktura lub oferta)'
          : intent === 'upload_menu'
            ? 'kartę dań (menu restauracji)'
            : 'fakturę zakupową do magazynu';
    return (
      <Card>
        <View style={styles.supplierActionInfo} testID={`voice-upload-${intent}`}>
          <Text style={styles.supplierActionTitle}>{INTENT_META[intent].label}</Text>
          <Text style={styles.supplierActionHint}>
            {intent === 'upload_menu'
              ? 'Po zatwierdzeniu otworzy się skaner menu — potrawy trafią do zakładki Menu. Istniejące dania nie będą dublowane.'
              : intent === 'upload_offer'
                ? 'Po zatwierdzeniu otworzy się skaner z widokiem Dostawców — system doda/uzupełni profil dostawcy i katalog.'
                : intent === 'upload_invoice'
                  ? 'Po zatwierdzeniu otworzy się skaner z widokiem Magazynu — produkty trafią na stan, a koszty zmienne wzrosną.'
                  : `Po zatwierdzeniu otworzy się skaner — wgraj ${kindLabel}.`}
          </Text>
        </View>
      </Card>
    );
  }

  return null;
}

function PeriodConfirmEditor({
  intent,
  edited,
  patch,
  categories = [],
  menuCategories = [],
}: {
  intent: Intent;
  edited: Record<string, any>;
  patch: (p: Record<string, any>) => void;
  categories?: string[];
  menuCategories?: string[];
}) {
  const preview = previewPeriodLabel(edited);
  const selected: PeriodSelection[] = Array.isArray(edited.selected_periods)
    ? edited.selected_periods
    : [];
  const showTree = intent !== 'list_expiring_soon' && intent !== 'haccp_tip';
  const prefer = parsePeriodHintToSelection(String(edited.period_1 || edited.note || ''));
  const [supplierNames, setSupplierNames] = useState<string[]>([]);

  useEffect(() => {
    if (intent !== 'rank_supplier_spend' || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('suppliers')
          .select('name')
          .eq('is_active', true)
          .order('name')
          .limit(200);
        if (cancelled) return;
        const names = (data || [])
          .map((r: any) => String(r?.name || '').trim())
          .filter(Boolean);
        setSupplierNames(names);
      } catch {
        if (!cancelled) setSupplierNames([]);
      }
    })();
    return () => { cancelled = true; };
  }, [intent]);

  const onTreeChange = (next: PeriodSelection[]) => {
    const label = next.length ? labelForSelections(next) : edited.period_1;
    if (intent === 'compare_two_periods') {
      const p1 = next[0] ? labelForSelections([next[0]]) : edited.period_1;
      const p2 = next[1] ? labelForSelections([next[1]]) : edited.period_2;
      patch({
        selected_periods: next.slice(0, 2),
        period_1: p1,
        period_2: p2,
        note: label,
      });
      return;
    }
    patch({
      selected_periods: next,
      period_1: label,
      note: label,
      period_type: next.some((s) => s.kind === 'year')
        ? 'year'
        : next.some((s) => s.kind === 'day')
          ? 'custom'
          : 'month',
    });
  };

  return (
    <Card>
      <View style={styles.supplierActionInfo} testID={`voice-period-confirm-${intent}`}>
        <Text style={styles.supplierActionTitle}>{INTENT_META[intent].label}</Text>
        <View style={styles.periodConfirmBox}>
          <Text style={styles.periodConfirmWarn}>
            {intent === 'compare_two_periods'
              ? 'Zaznacz w drzewie dokładnie 2 okresy (checkboxy), potem kliknij Analizuj.'
              : 'Wybierz w drzewie rok / miesiąc / tydzień / dzień — możesz zaznaczyć kilka okresów.'}
          </Text>
          <Text style={styles.periodConfirmPreview} testID="voice-period-preview">
            Wybrany okres: {selected.length ? preview : 'brak — zaznacz w drzewie poniżej'}
          </Text>
        </View>

        {intent === 'compare_two_periods' ? (
          <View style={{ gap: 8, marginBottom: 10 }}>
            <View style={styles.compareTile}>
              <Text style={styles.compareTileLabel}>Okres 1 (usłyszane)</Text>
              <Text style={styles.compareTileValue}>{edited.period_1 || '—'}</Text>
            </View>
            <View style={styles.compareTile}>
              <Text style={styles.compareTileLabel}>Okres 2 (usłyszane)</Text>
              <Text style={styles.compareTileValue}>{edited.period_2 || '—'}</Text>
            </View>
            <Text style={styles.editHint2}>
              Zaznacz w drzewie 2 okresy (np. Lipiec i Sierpień) — nadpiszą kafelki.
            </Text>
          </View>
        ) : null}

        {showTree ? (
          <PeriodPickerTree
            value={selected}
            onChange={onTreeChange}
            preferYear={prefer?.year ?? new Date().getFullYear()}
            preferMonth={prefer?.month}
          />
        ) : null}

        {(intent === 'rank_menu_sales' || intent === 'rank_inventory_usage') && (
          <>
            <FieldLabel text={intent === 'rank_menu_sales' ? 'Ranking sprzedaży' : 'Ranking zużycia'} />
            <View style={styles.pillRow}>
              {[
                { key: 'best', label: intent === 'rank_inventory_usage' ? 'Najwięcej' : 'Najlepiej' },
                { key: 'worst', label: intent === 'rank_inventory_usage' ? 'Najmniej' : 'Najsłabiej' },
              ].map((r) => {
                const active = (edited.rank || 'best') === r.key;
                return (
                  <TouchableOpacity
                    key={r.key}
                    style={[styles.pill, active && { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }]}
                    onPress={() => patch({ rank: r.key })}
                    activeOpacity={0.7}
                    testID={`voice-rank-${r.key}`}
                  >
                    <Text style={[styles.pillText, active && { color: '#0A0A0A', fontWeight: '700' }]}>{r.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <EditRow
                  label="Ile pozycji (TOP)"
                  value={edited.top_n == null ? '' : String(edited.top_n)}
                  onChangeText={(v) => patch({ top_n: numOrNull(v) })}
                  keyboardType="number-pad"
                  placeholder="5"
                  hint="Puste = 5 · lub użyj − / +"
                  testID="voice-top-n"
                />
              </View>
              <TouchableOpacity
                style={[styles.unitPill, { marginBottom: 18 }]}
                onPress={() => patch({ top_n: Math.max(1, Number(edited.top_n) || 5) - 1 })}
                testID="voice-top-n-dec"
              >
                <Text style={styles.unitPillText}>−</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unitPill, styles.unitPillActive, { marginBottom: 18 }]}
                onPress={() => patch({ top_n: Math.min(20, (Number(edited.top_n) || 5) + 1) })}
                testID="voice-top-n-inc"
              >
                <Text style={[styles.unitPillText, styles.unitPillTextActive]}>+</Text>
              </TouchableOpacity>
            </View>
            <FieldLabel text={intent === 'rank_menu_sales' ? 'Kategoria menu (opcjonalnie)' : 'Kategoria magazynu (opcjonalnie)'} />
            <View style={styles.pillRow}>
              {(intent === 'rank_menu_sales' ? menuCategories : categories).map((c) => {
                const active = String(edited.category || edited.category_name || '').toLowerCase() === c.toLowerCase();
                return (
                  <TouchableOpacity
                    key={c}
                    style={[styles.pill, active && { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }]}
                    onPress={() => patch({ category: active ? '' : c, category_name: active ? '' : c })}
                    testID={`voice-rank-cat-${c}`}
                  >
                    <Text style={[styles.pillText, active && { color: '#0A0A0A', fontWeight: '700' }]}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {(intent === 'rank_waste_cost' || intent === 'rank_dead_menu') && (
          <>
            <FieldLabel text={intent === 'rank_waste_cost' ? 'Straty w złotówkach' : 'Najsłabiej sprzedające się dania'} />
            <EditRow
              label="Ile pozycji (TOP)"
              value={edited.top_n == null ? '' : String(edited.top_n)}
              onChangeText={(v) => patch({ top_n: numOrNull(v) })}
              keyboardType="number-pad"
              placeholder={intent === 'rank_dead_menu' ? '8' : '5'}
              hint={intent === 'rank_dead_menu' ? 'Puste = 8 (tylko dania ze sprzedażą > 0)' : 'Puste = 5 pozycji'}
              testID="voice-waste-top-n"
            />
            {intent === 'rank_dead_menu' ? (
              <>
                <FieldLabel text="Kategoria menu — kliknij kafelek" />
                <View style={styles.pillRow}>
                  {menuCategories.map((c) => {
                    const active = String(edited.category || edited.category_name || '').toLowerCase() === c.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[styles.pill, active && { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }]}
                        onPress={() => patch({ category: active ? '' : c, category_name: active ? '' : c })}
                        testID={`voice-dead-cat-${c}`}
                      >
                        <Text style={[styles.pillText, active && { color: '#0A0A0A', fontWeight: '700' }]}>{c}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}
          </>
        )}

        {intent === 'list_expiring_soon' && (
          <>
            <FieldLabel text="Drabina dat ważności" />
            <EditRow
              label="Horyzont (dni)"
              value={edited.limit_days == null ? '3' : String(edited.limit_days)}
              onChangeText={(v) => patch({ limit_days: numOrNull(v) })}
              keyboardType="number-pad"
              placeholder="3"
              hint="np. 3 = produkty kończące się dziś, jutro i pojutrze"
              testID="voice-expiry-horizon"
            />
            <EditRow
              label="Max pozycji"
              value={edited.top_n == null ? '' : String(edited.top_n)}
              onChangeText={(v) => patch({ top_n: numOrNull(v) })}
              keyboardType="number-pad"
              placeholder="20"
              hint="Puste = 20 pozycji"
              testID="voice-expiry-top-n"
            />
          </>
        )}

        {(intent === 'rank_supplier_spend' || intent === 'manager_core_alerts') && (
          <>
            <FieldLabel text={intent === 'rank_supplier_spend' ? 'Wydatki u dostawców' : 'Alerty korelacji CORE'} />
            {intent === 'rank_supplier_spend' ? (
              <>
                <FieldLabel text="Dostawca — kliknij kafelek lub wpisz" />
                <View style={styles.pillRow}>
                  {supplierNames.map((name) => {
                    const active = String(edited.supplier_name || '').toLowerCase() === name.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={name}
                        style={[styles.pill, active && { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }]}
                        onPress={() => patch({ supplier_name: active ? '' : name })}
                        testID={`voice-supplier-chip-${name}`}
                      >
                        <Text style={[styles.pillText, active && { color: '#0A0A0A', fontWeight: '700' }]} numberOfLines={1}>
                          {name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <EditRow
                  label="Lub wpisz nazwę dostawcy"
                  value={edited.supplier_name ?? ''}
                  onChangeText={(v) => patch({ supplier_name: v })}
                  placeholder="np. Makro"
                />
                <EditRow
                  label="Ile pozycji (TOP)"
                  value={edited.top_n == null ? '' : String(edited.top_n)}
                  onChangeText={(v) => patch({ top_n: numOrNull(v) })}
                  keyboardType="number-pad"
                  placeholder="5"
                  hint="Puste = 5 pozycji"
                />
              </>
            ) : null}
          </>
        )}
      </View>
    </Card>
  );
}

const MONTHS_PL_PREVIEW: Record<string, string> = {
  styczen: 'styczeń', sty: 'styczeń',
  luty: 'luty', lut: 'luty',
  marzec: 'marzec', mar: 'marzec',
  kwiecien: 'kwiecień', kwi: 'kwiecień',
  maj: 'maj',
  czerwiec: 'czerwiec', cze: 'czerwiec',
  lipiec: 'lipiec', lip: 'lipiec',
  sierpien: 'sierpień', sie: 'sierpień',
  wrzesien: 'wrzesień', wrz: 'wrzesień',
  pazdziernik: 'październik', paz: 'październik',
  listopad: 'listopad', lis: 'listopad',
  grudzien: 'grudzień', gru: 'grudzień',
};

function stripPlPreview(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .trim();
}

function previewPeriodLabel(edited: Record<string, any>): string {
  if (Array.isArray(edited.selected_periods) && edited.selected_periods.length > 0) {
    return labelForSelections(edited.selected_periods);
  }
  if (edited.period_2) {
    return `${edited.period_1 || '?'} vs ${edited.period_2}`;
  }
  const hint = String(edited.period_1 || edited.note || '').trim();
  if (/^\d{4}-\d{1,2}$/.test(hint)) return hint;
  const key = stripPlPreview(hint);
  if (key && MONTHS_PL_PREVIEW[key]) {
    const now = new Date();
    const names = Object.values(MONTHS_PL_PREVIEW);
    // find month index roughly
    const order = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
    const mo = order.indexOf(MONTHS_PL_PREVIEW[key]) + 1;
    let y = now.getFullYear();
    if (mo > now.getMonth() + 1) y -= 1;
    return `${MONTHS_PL_PREVIEW[key]} ${y}`;
  }
  const pt = String(edited.period_type || 'week');
  const days = edited.limit_days != null ? Number(edited.limit_days) : null;
  if (days && days > 0) return `ostatnie ${days} dni`;
  return ({ day: 'ostatni dzień', week: 'ostatni tydzień', month: 'ostatnie ~30 dni', year: 'ostatni rok', custom: 'okres niestandardowy' } as Record<string, string>)[pt] || pt;
}

function ScaleRecipePicker({
  edited,
  patch,
}: {
  edited: Record<string, any>;
  patch: (p: Record<string, any>) => void;
}) {
  const [query, setQuery] = useState(String(edited.dish_name_resolved || edited.dish_name || ''));
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const accepted = edited.dish_accepted === true && !!edited.dish_id;

  useEffect(() => {
    if (accepted) {
      setSuggestions([]);
      return;
    }
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        let { data, error } = await supabase
          .from('menu_items')
          .select('id, name')
          .ilike('name', `%${q}%`)
          .eq('is_active', true)
          .order('name')
          .limit(8);
        if (error) {
          const retry = await supabase
            .from('menu_items')
            .select('id, name')
            .ilike('name', `%${q}%`)
            .order('name')
            .limit(8);
          data = retry.data;
        }
        if (!cancelled) setSuggestions((data as any[]) ?? []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, accepted]);

  return (
    <Card>
      <Text style={styles.editHint}>
        Wpisz nazwę dania z menu, wybierz podpowiedź i zaakceptuj — dopiero wtedy otworzysz kalkulator porcji.
      </Text>
      <FieldLabel text="Nazwa dania z menu" />
      <TextInput
        style={[styles.editInput, accepted && { borderColor: Colors.success, backgroundColor: '#F0FDF4' }]}
        value={query}
        onChangeText={(v) => {
          setQuery(v);
          patch({
            dish_name: v,
            dish_name_resolved: v,
            dish_id: null,
            dish_accepted: false,
          });
        }}
        placeholder="np. Sałatka Grecka"
        placeholderTextColor={Colors.textTertiary}
        testID="voice-scale-dish-search"
      />
      {loading ? <ActivityIndicator size="small" color={Colors.accent} style={{ marginVertical: 8 }} /> : null}
      {!accepted && suggestions.length > 0 && (
        <View style={styles.suggestBox} testID="voice-scale-suggestions">
          {suggestions.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.suggestRow}
              onPress={() => {
                setQuery(s.name);
                patch({
                  dish_id: s.id,
                  dish_name: s.name,
                  dish_name_resolved: s.name,
                  dish_accepted: true,
                  portions: edited.portions > 0 ? edited.portions : 10,
                });
                setSuggestions([]);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.suggestText}>{s.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {accepted ? (
        <View style={styles.acceptedDishBox}>
          <Text style={styles.acceptedDishText}>Wybrane: {edited.dish_name_resolved || edited.dish_name}</Text>
          <TouchableOpacity
            onPress={() => patch({ dish_id: null, dish_accepted: false })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.acceptedDishChange}>Zmień</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.scaleNeedPick}>Kliknij podpowiedź z listy, aby zaakceptować danie.</Text>
      )}
      {accepted ? (
        <EditRow
          label="Wstępna liczba porcji (możesz zmienić w kalkulatorze)"
          value={edited.portions == null ? '' : String(edited.portions)}
          onChangeText={(v) => patch({ portions: numOrNull(v) })}
          keyboardType="decimal-pad"
          placeholder="np. 10"
          testID="voice-scale-portions-preview"
        />
      ) : null}
    </Card>
  );
}

function ToggleDishPicker({
  edited,
  patch,
}: {
  edited: Record<string, any>;
  patch: (p: Record<string, any>) => void;
}) {
  const [query, setQuery] = useState(String(edited.dish_name_resolved || edited.dish_name || ''));
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; is_available?: boolean | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const accepted = edited.dish_accepted === true && !!edited.dish_id;
  const turningOff = edited.available !== true;

  useEffect(() => {
    if (accepted) {
      setSuggestions([]);
      return;
    }
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        let { data, error } = await supabase
          .from('menu_items')
          .select('id, name, is_available')
          .ilike('name', `%${q}%`)
          .eq('is_active', true)
          .order('name')
          .limit(10);
        if (error) {
          const retry = await supabase
            .from('menu_items')
            .select('id, name')
            .ilike('name', `%${q}%`)
            .order('name')
            .limit(10);
          data = retry.data;
        }
        if (!cancelled) setSuggestions((data as any[]) ?? []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, accepted]);

  return (
    <Card>
      <Text style={styles.editHint}>
        {turningOff
          ? 'Wpisz nazwę dania do wyłączenia w POS. Tylko kliknięcie podpowiedzi podstawia danie — potem zatwierdź.'
          : 'Wpisz nazwę dania do włączenia w POS. Tylko kliknięcie podpowiedzi podstawia danie — potem zatwierdź.'}
      </Text>
      <FieldLabel text="Nazwa dania (menu / POS)" />
      <TextInput
        style={[styles.editInput, accepted && { borderColor: Colors.success, backgroundColor: '#F0FDF4' }]}
        value={query}
        onChangeText={(v) => {
          setQuery(v);
          patch({
            dish_name: v,
            dish_name_resolved: v,
            dish_id: null,
            dish_accepted: false,
          });
        }}
        placeholder="np. Burger Bacon"
        placeholderTextColor={Colors.textTertiary}
        testID="voice-toggle-dish-search"
      />
      {loading ? <ActivityIndicator size="small" color={Colors.accent} style={{ marginVertical: 8 }} /> : null}
      {!accepted && suggestions.length > 0 && (
        <View style={styles.suggestBox} testID="voice-toggle-suggestions">
          {suggestions.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.suggestRow}
              onPress={() => {
                setQuery(s.name);
                patch({
                  dish_id: s.id,
                  dish_name: s.name,
                  dish_name_resolved: s.name,
                  dish_accepted: true,
                  available: turningOff ? false : true,
                });
                setSuggestions([]);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.suggestText}>{s.name}</Text>
              {s.is_available === false ? (
                <Text style={{ fontSize: 11, color: Colors.danger, fontWeight: '700' }}>wyłączone</Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      )}
      {accepted ? (
        <View style={styles.acceptedDishBox}>
          <Text style={styles.acceptedDishText}>
            {turningOff ? 'Do wyłączenia: ' : 'Do włączenia: '}
            {edited.dish_name_resolved || edited.dish_name}
          </Text>
          <TouchableOpacity
            onPress={() => patch({ dish_id: null, dish_accepted: false })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.acceptedDishChange}>Zmień</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.scaleNeedPick}>Kliknij podpowiedź z listy, aby zaakceptować danie.</Text>
      )}
    </Card>
  );
}

function JarvisMatchBanner({ label, matched, question }:
  { label: string; matched?: string | null; question: string }) {
  if (!matched) return null;
  return (
    <View
      style={[
        styles.jarvisBanner,
        {
          backgroundColor: 'rgba(0,255,120,0.1)',
          borderLeftColor: DS.color.greenEnd,
        },
      ]}
      testID="jarvis-match-banner"
    >
      <Text style={styles.jarvisBannerIcon}>🎯</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.jarvisBannerText, { color: DS.color.heading }]}>
          {label}{' '}
          <Text style={[styles.jarvisBannerMatched, { color: DS.color.greenEnd }]}>
            {matched}
          </Text>
        </Text>
        <Text style={[styles.jarvisBannerQuestion, { color: DS.color.muted }]}>
          {question}
        </Text>
      </View>
    </View>
  );
}

function IntentDoneSummary({
  intent,
  extras,
  onExtrasChange,
}: {
  intent: Intent;
  extras: any;
  onExtrasChange?: (next: any) => void;
}) {
  if (intent === 'waste' && Array.isArray(extras?.deductions) && extras.deductions.length > 0) {
    return (
      <>
        <Text style={styles.sectionLabel}>Odjęto z magazynu ({extras.deductions.length})</Text>
        {extras.deductions.map((d: any, i: number) => (
          <View key={i} style={styles.deductRow}>
            <Text style={styles.deductName}>{d.name}</Text>
            <Text style={styles.deductQty}>−{Number(d.deducted).toFixed(2)} {d.unit}</Text>
          </View>
        ))}
      </>
    );
  }
  if (intent === 'scale_recipe' && Array.isArray(extras?.ingredients)) {
    const portions = Number(extras.portions) || 1;
    const setPortions = (next: number) => {
      const p = Math.max(1, Math.round(next));
      const ingredients = (extras.ingredients as any[]).map((s) => {
        const per = Number(s.per_portion) || 0;
        const total = Math.round(per * p * 100) / 100;
        const have = s.in_stock != null ? Number(s.in_stock) : null;
        return {
          ...s,
          total_needed: total,
          enough: have != null ? have >= total : s.enough,
        };
      });
      const missing = ingredients.filter((s) => !s.enough).map((s) => s.ingredient_name);
      onExtrasChange?.({
        ...extras,
        portions: p,
        ingredients,
        missing,
        message: `Przeliczono „${extras.dish_name || 'danie'}” na ${p} porcji (${ingredients.length} składników).`
          + (missing.length ? ` Braki: ${missing.join(', ')}` : ''),
      });
    };
    return (
      <>
        <Text style={styles.sectionLabel}>Kalkulator porcji — {extras.dish_name || 'danie'}</Text>
        <View style={styles.portionStepper}>
          <TouchableOpacity
            style={styles.portionBtn}
            onPress={() => setPortions(portions - 1)}
            activeOpacity={0.8}
            testID="voice-scale-portion-minus"
          >
            <Text style={styles.portionBtnText}>−</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.portionInput}
            value={String(portions)}
            onChangeText={(v) => {
              const n = parseFloat(v.replace(',', '.'));
              if (!isNaN(n) && n > 0) setPortions(n);
            }}
            keyboardType="number-pad"
            testID="voice-scale-portion-input"
          />
          <TouchableOpacity
            style={styles.portionBtn}
            onPress={() => setPortions(portions + 1)}
            activeOpacity={0.8}
            testID="voice-scale-portion-plus"
          >
            <Text style={styles.portionBtnText}>+</Text>
          </TouchableOpacity>
          <Text style={styles.portionLabel}>porcji</Text>
        </View>
        {extras.message ? <Text style={styles.doneMessage}>{extras.message}</Text> : null}
        <Text style={styles.sectionLabel}>Składniki na {portions} porcji</Text>
        {extras.ingredients.map((s: any, i: number) => (
          <View key={i} style={styles.deductRow}>
            <Text style={styles.deductName}>{s.ingredient_name}</Text>
            <Text style={[styles.deductQty, { color: s.enough ? '#059669' : Colors.danger }]}>
              {Number(s.total_needed).toFixed(2)} {s.unit}{s.enough ? ' ✓' : ' ⚠︎'}
            </Text>
          </View>
        ))}
      </>
    );
  }
  if (Array.isArray(extras?.changes) && extras.changes.length > 0) {
    return (
      <>
        {extras.message ? <Text style={styles.doneMessage}>{extras.message}</Text> : null}
        <Text style={styles.sectionLabel}>Zmiany ({extras.affected})</Text>
        {extras.changes.map((c: any, i: number) => (
          <View key={i} style={styles.deductRow}>
            <Text style={styles.deductName}>{c.name}</Text>
            <Text style={styles.deductQty}>{Number(c.old).toFixed(2)} → {Number(c.new).toFixed(2)}</Text>
          </View>
        ))}
      </>
    );
  }
  if (intent === 'order_critical_items_by_category') {
    const critical = Number(extras?.critical_count ?? extras?.critical_products?.length ?? 0);
    const found = Number(extras?.found_in_offers_count ?? 0);
    const categoryTotal = Number(extras?.category_total ?? 0);
    const denom = categoryTotal > 0
      ? categoryTotal
      : (Array.isArray(extras?.compare?.items_requested)
        ? extras.compare.items_requested.length
        : critical);
    return (
      <>
        {extras?.message ? <Text style={styles.doneMessage}>{extras.message}</Text> : null}
        <View style={styles.deductRow}>
          <Text style={styles.deductName}>Braki do zamówienia</Text>
          <Text style={styles.deductQty}>{critical}</Text>
        </View>
        {categoryTotal > 0 ? (
          <View style={styles.deductRow}>
            <Text style={styles.deductName}>Produktów w kategorii</Text>
            <Text style={styles.deductQty}>{categoryTotal}</Text>
          </View>
        ) : null}
        <View style={styles.deductRow}>
          <Text style={styles.deductName}>Znalezione w ofertach dostawców</Text>
          <Text style={[styles.deductQty, { color: Colors.success }]}>
            {found} / {denom}
          </Text>
        </View>
      </>
    );
  }
  if (
    intent === 'rank_menu_sales' || intent === 'rank_inventory_usage' || intent === 'rank_waste_cost'
    || intent === 'rank_dead_menu' || intent === 'list_expiring_soon' || intent === 'rank_supplier_spend'
    || intent === 'manager_core_alerts' || intent === 'haccp_tip'
  ) {
    const periodBlocks: { label: string; items: any[]; total_cost_pln?: number }[] =
      Array.isArray(extras?.periods) && extras.periods.length > 0
        ? extras.periods.map((p: any) => ({
            label: String(p.label || p.period_label || 'Okres'),
            items: Array.isArray(p.items) ? p.items : [],
            total_cost_pln: p.total_cost_pln,
          }))
        : [{
            label: extras?.period_label ? String(extras.period_label) : '',
            items: Array.isArray(extras?.items) ? extras.items : [],
            total_cost_pln: extras?.total_cost_pln ?? extras?.total_spend_pln,
          }];

    const renderExpiryLadder = (items: any[], blockKey: string) => {
      if (!items.length) {
        return (
          <Text key={`${blockKey}-empty`} style={[styles.doneMessage, { color: DS.color.muted }]}>
            Brak pozycji w tym horyzoncie.
          </Text>
        );
      }
      const builtRows = items.map((row: any, idx: number) => {
        const daysLeft = Number(row.days_left);
        const urgent = Number.isFinite(daysLeft) && daysLeft >= 0 && daysLeft < 7;
        const ladder = String(row.ladder || (Number.isFinite(daysLeft)
          ? (daysLeft <= 0 ? 'dziś' : daysLeft === 1 ? 'jutro' : `za ${daysLeft} dni`)
          : ''));
        const built = buildExpiryTipsForItem({
          daysLeft: Number.isFinite(daysLeft) ? daysLeft : 3,
          productName: row.name || row.product_name,
          qty: row.qty,
          unit: row.unit,
          inventoryCategoryName: row.category_name || row.inventory_category,
          menuCategory: row.menu_category,
          limit: 3,
          includeGames: true,
        });
        const fallbackTip = !built.tips.length && row.tip ? String(row.tip) : null;
        return { row, idx, daysLeft, urgent, ladder, built, fallbackTip };
      });
      const anyGameOrLegal = builtRows.some((r) => r.built.showLegalDisclaimer);
      return (
        <>
          {builtRows.map(({ row, idx, urgent, ladder, built, fallbackTip }) => (
            <View
              key={`${blockKey}-${row.id || row.name || idx}`}
              style={styles.expiryItemCard}
              testID={`voice-expiry-item-${idx}`}
            >
              <View style={styles.deductRow}>
                <Text style={[styles.deductName, urgent && { color: '#F87171' }]} numberOfLines={3}>
                  {idx + 1}. {row.name || row.inventory_name || row.ingredient_name}
                  {ladder ? ` · ${ladder}` : ''}
                </Text>
                <Text style={[styles.deductQty, urgent && { color: '#F87171', fontWeight: '800' }]}>
                  {`${row.qty ?? 0} ${row.unit || ''} · do ${row.expiration_date || '?'}`.trim()}
                </Text>
              </View>
              {built.tips.map((tip) => (
                <View
                  key={tip.id}
                  style={[
                    styles.expiryTipRow,
                    tip.kind === 'game_safe' && styles.expiryTipGame,
                  ]}
                  testID={`voice-expiry-tip-${tip.id}`}
                >
                  <Text style={styles.expiryTipKind}>
                    {tip.kind === 'game_safe'
                      ? 'Gra'
                      : tip.kind === 'social'
                        ? 'Social'
                        : tip.kind === 'marketing'
                          ? 'Marketing'
                          : tip.kind === 'kitchen'
                            ? 'Kuchnia'
                            : 'Operacje'}
                  </Text>
                  <Text style={styles.expiryTipTitle}>{tip.title}</Text>
                  <Text style={styles.expiryTipBody}>{tip.body}</Text>
                  {tip.cta_label ? (
                    <Text style={styles.expiryTipCta}>{tip.cta_label}</Text>
                  ) : null}
                </View>
              ))}
              {!built.tips.length && !fallbackTip ? (
                <Text style={[styles.expiryTipBody, { marginTop: 4, opacity: 0.75 }]}>
                  {built.phase
                    ? 'Brak tipów Zero Waste dla tej pozycji.'
                    : 'Tipy Zero Waste: horyzont T−3…T−1 (za 1–3 dni / dziś).'}
                </Text>
              ) : null}
              {fallbackTip ? (
                <Text style={[styles.expiryTipBody, { marginTop: 4 }]}>{fallbackTip}</Text>
              ) : null}
            </View>
          ))}
          {anyGameOrLegal ? (
            <View style={styles.expiryLegalBox} testID="voice-expiry-legal-disclaimer">
              <Text style={styles.expiryLegalText}>{EXPIRY_TIPS_LEGAL_DISCLAIMER}</Text>
            </View>
          ) : null}
        </>
      );
    };

    const renderPlainItems = (items: any[], blockKey: string) => (
      items.length === 0 ? (
        <Text key={`${blockKey}-empty`} style={[styles.doneMessage, { color: DS.color.muted }]}>
          Brak pozycji dla tego okresu.
        </Text>
      ) : (
        items.map((row: any, idx: number) => (
          <View key={`${blockKey}-${row.menu_item_id || row.id || row.name || idx}`} style={styles.deductRow}>
            <Text style={styles.deductName} numberOfLines={3}>
              {idx + 1}. {row.name || row.inventory_name || row.ingredient_name}
            </Text>
            <Text style={styles.deductQty}>
              {intent === 'rank_waste_cost'
                ? `${row.qty ?? 0} ${row.unit || ''} · ${Math.round(Number(row.cost_pln || 0))} zł`.trim()
                : intent === 'rank_supplier_spend'
                  ? `${Math.round(Number(row.spend_pln || 0))} zł · ${row.invoice_count ?? 0} fakt.`
                  : intent === 'manager_core_alerts' || intent === 'haccp_tip'
                    ? String(row.detail || row.tip || row.opportunity || '').slice(0, 90)
                    : `${row.qty_used ?? 0} ${row.unit || ''}`.trim()}
            </Text>
          </View>
        ))
      )
    );

    /** Ranking sprzedaży / najsłabsze: osobno sztuki i utarg (bez ściany tekstu). */
    const renderSalesDual = (items: any[], blockKey: string) => {
      if (!items.length) {
        return (
          <Text key={`${blockKey}-empty`} style={[styles.doneMessage, { color: DS.color.muted }]}>
            Brak pozycji dla tego okresu.
          </Text>
        );
      }
      const byQty = [...items].sort((a, b) => Number(b.qty_sold || 0) - Number(a.qty_sold || 0));
      const byRev = [...items].sort((a, b) => Number(b.revenue_pln || 0) - Number(a.revenue_pln || 0));
      // dla najsłabszych — sort rosnąco
      if (intent === 'rank_dead_menu' || extras?.rank === 'worst') {
        byQty.sort((a, b) => Number(a.qty_sold || 0) - Number(b.qty_sold || 0));
        byRev.sort((a, b) => Number(a.revenue_pln || 0) - Number(b.revenue_pln || 0));
      }
      const list = (rows: any[], suffix: string, fmt: (r: any) => string) =>
        rows.map((row: any, idx: number) => (
          <View key={`${blockKey}-${suffix}-${row.menu_item_id || row.name || idx}`} style={styles.deductRow}>
            <Text style={styles.deductName} numberOfLines={2}>
              {idx + 1}. {row.name}
            </Text>
            <Text style={styles.deductQty}>{fmt(row)}</Text>
          </View>
        ));
      return (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 4 }]}>Według sztuki</Text>
          {list(byQty, 'qty', (r) => `${r.qty_sold ?? 0} szt`)}
          <Text style={[styles.sectionLabel, { marginTop: 10 }]}>Według utargu</Text>
          {list(byRev, 'rev', (r) => `${Math.round(Number(r.revenue_pln || 0))} zł`)}
        </>
      );
    };

    return (
      <>
        {periodBlocks.map((block, bi) => (
          <View
            key={`rank-block-${bi}`}
            style={{
              marginBottom: 14,
              padding: 12,
              borderRadius: 12,
              backgroundColor: DS.color.bgPrimary,
              borderWidth: 1,
              borderColor: DS.color.borderSubtle,
            }}
          >
            {block.label ? (
              <Text style={[styles.sectionLabel, { marginBottom: 8 }]} testID={`voice-done-period-${bi}`}>
                {block.label}
              </Text>
            ) : null}
            {block.total_cost_pln != null ? (
              <View style={styles.deductRow}>
                <Text style={styles.deductName}>
                  {intent === 'rank_supplier_spend' ? 'Suma wydatków' : 'Suma strat'}
                </Text>
                <Text style={[styles.deductQty, { color: Colors.danger }]}>
                  {Math.round(Number(block.total_cost_pln)).toLocaleString('pl-PL')} zł
                </Text>
              </View>
            ) : null}
            {intent === 'rank_menu_sales' || intent === 'rank_dead_menu'
              ? renderSalesDual(block.items, `b${bi}`)
              : intent === 'list_expiring_soon'
                ? renderExpiryLadder(block.items, `b${bi}`)
                : renderPlainItems(block.items, `b${bi}`)}
          </View>
        ))}
      </>
    );
  }
  if (intent === 'summarize_custom_period' || intent === 'compare_two_periods') {
    const periods = Array.isArray(extras?.periods) ? extras.periods : [];
    if (intent === 'compare_two_periods' && extras?.period_1 && extras?.period_2) {
      periods.length = 0;
      periods.push(extras.period_1, extras.period_2);
    }
    const money = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('pl-PL');
    const row = (label: string, val: unknown, color?: string) =>
      val != null ? (
        <View style={styles.deductRow} key={label}>
          <Text style={styles.deductName}>{label}</Text>
          <Text style={[styles.deductQty, color ? { color } : null]}>{money(val)} zł</Text>
        </View>
      ) : null;
    const renderAgg = (a: any, title?: string) => (
      <View
        style={{
          gap: 4,
          marginBottom: 12,
          padding: 12,
          borderRadius: 12,
          backgroundColor: DS.color.bgPrimary,
          borderWidth: 1,
          borderColor: DS.color.borderSubtle,
        }}
        key={title || 'agg'}
      >
        {title ? <Text style={styles.sectionLabel}>{title}</Text> : null}
        {a?.since && a?.until ? (
          <Text style={[styles.doneMessage, { color: DS.color.muted }]}>
            {a.since} → {a.until}
            {a.revenue_source ? ` · ${a.revenue_source}` : ''}
          </Text>
        ) : null}
        {row('Przychód (utarg)', a.total_revenue, DS.color.heading)}
        {row('Koszty stałe (proporcja dni)', a.fixed_costs_allocated, DS.color.muted)}
        {row('Straty produktowe', a.total_waste_cost, Colors.danger)}
        {row(
          'Koszty zmienne (po odjęciu strat)',
          a.variable_costs_net ?? Math.max(0, Number(a.variable_costs_allocated || 0) - Number(a.total_waste_cost || 0)),
          DS.color.muted,
        )}
        {row(
          'Koszty zmienne brutto (zakupy)',
          a.variable_costs_gross ?? a.variable_costs_allocated,
          DS.color.muted,
        )}
        {row('Zysk', a.net_profit, Number(a.net_profit) >= 0 ? DS.color.greenEnd : Colors.danger)}
      </View>
    );
    return (
      <>
        {periods.length > 0
          ? periods.map((p: any, i: number) => renderAgg(p.aggregates, p.label || `Okres ${i + 1}`))
          : extras?.aggregates
            ? renderAgg(extras.aggregates)
            : null}
      </>
    );
  }
  if (typeof extras?.message === 'string' && extras.message) {
    return <Text style={styles.doneMessage} testID="voice-done-message">{extras.message}</Text>;
  }
  return null;
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.reviewCard} testID="voice-review-card">{children}</View>;
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.editLabel}>{text}</Text>;
}

interface EditRowProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad' | 'email-address' | 'phone-pad';
  multiline?: boolean;
  testID?: string;
  hint?: string;
}
function EditRow({ label, value, onChangeText, placeholder, keyboardType, multiline, testID, hint }: EditRowProps) {
  return (
    <View style={styles.editRow}>
      <FieldLabel text={label} />
      <TextInput
        style={[styles.editInput, multiline && styles.editInputMulti]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textTertiary}
        keyboardType={keyboardType ?? 'default'}
        multiline={!!multiline}
        testID={testID}
      />
      {hint ? <Text style={styles.editHint2}>{hint}</Text> : null}
    </View>
  );
}

function UnitField({ value, onChange, options }: { value: string; onChange: (v: string) => void; options?: string[] }) {
  const units = options ?? UNIT_OPTIONS;
  return (
    <View style={styles.editRow}>
      <FieldLabel text="Jednostka" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
        {units.map((u) => {
          const active = value === u;
          return (
            <TouchableOpacity
              key={u}
              style={[styles.unitPill, active && styles.unitPillActive]}
              onPress={() => onChange(u)}
              activeOpacity={0.7}
              testID={`voice-edit-unit-${u}`}
            >
              <Text style={[styles.unitPillText, active && styles.unitPillTextActive]}>{u}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SegmentedField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { key: string; label: string }[];
}) {
  return (
    <View style={styles.editRow}>
      <FieldLabel text={label} />
      <View style={styles.segmentRow}>
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => onChange(opt.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function numOrNull(v: string): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v.replace(',', '.'));
  return isFinite(n) ? n : null;
}

function stripPlIntent(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

/** Korekta po stronie FE — działa nawet gdy stary backend nadal zwraca compare. */
function correctPeriodIntentFromTranscript(
  transcript: string,
  data: Interpretation,
): Interpretation {
  const t = stripPlIntent(transcript);
  const hasCompare = /\b(porownaj|porownanie|porownac|zestaw|zestawienie|versus|\bvs\b|roznic)/.test(t);
  const months = t.match(
    /\b(stycznia|styczen|lutego|luty|marca|marzec|kwietnia|kwiecien|maja|maj|czerwca|czerwiec|lipca|lipiec|sierpnia|sierpien|wrzesnia|wrzesien|pazdziernika|pazdziernik|listopada|listopad|grudnia|grudzien)\b/g,
  );
  const monthHits = months?.length ?? 0;
  const finance = /\b(zysk|zyski|przychod|przychody|utarg|podsumuj|analiz|dane|raport|sprzedaz)\b/.test(t);

  let intent = data.intent;
  let payload = { ...(data.payload || {}) };
  let reason = data.reason || '';

  if (finance && monthHits <= 1 && !hasCompare) {
    intent = 'summarize_custom_period';
    reason = `${reason} | FE: pokazanie danych jednego okresu`.trim();
    if (!payload.period_1) payload.period_1 = transcript.trim();
    payload.period_type = payload.period_type || 'month';
    delete payload.period_2;
  } else if (data.intent === 'compare_two_periods' && !hasCompare && monthHits <= 1) {
    intent = 'summarize_custom_period';
    reason = `${reason} | FE: skorygowano compare→analiza`.trim();
    if (!payload.period_1 && payload.period_2) payload.period_1 = payload.period_2;
    delete payload.period_2;
  }

  // FE: „wgraj menu” nie może iść do oferty dostawcy
  if (/\b(wgraj|zeskanuj|skanuj)\b.{0,40}\bmenu\b/.test(t) || /\bmenu\b.{0,40}\b(wgraj|zeskanuj|skanuj)\b/.test(t)) {
    if (intent === 'upload_offer' || intent === 'upload_document' || intent === 'upload_invoice' || intent === 'unknown') {
      intent = 'upload_menu';
      reason = `${reason} | FE: upload_menu`.trim();
    }
  }
  if (/\b(przywroc|cofnij)\b/.test(t) && /\b(magazyn|produkt|skladnik)/.test(t) && !/\b(menu|danie|potraw)/.test(t)) {
    intent = 'restore_deleted_inventory';
    reason = `${reason} | FE: restore_inventory`.trim();
  }

  const alts = data.alternate_intents?.length
    ? data.alternate_intents
    : [
        { intent: 'summarize_custom_period' as Intent, label: 'Pokazanie danych / zysków z okresu' },
        { intent: 'compare_two_periods' as Intent, label: 'Porównanie dwóch okresów' },
      ];

  return {
    ...data,
    intent,
    payload,
    reason,
    alternate_intents: finance || intent === 'summarize_custom_period' || intent === 'compare_two_periods'
      ? alts
      : data.alternate_intents,
  };
}

/**
 * Sanitize AI-returned payload before showing editable form.
 * AI returns 0 for numeric fields it couldn't recognise (price, amount, quantity).
 * Convert those 0s to null so the TextInput shows placeholder — makes the user
 * notice they must fill it in instead of silently saving zero.
 */
function extractAmountFromText(text: string): number | null {
  if (!text) return null;
  // Prefer jawne kwoty przy słowach finansowych; inaczej ostatnia sensowna liczba w tekście.
  const normalized = text.replace(/\u00a0/g, ' ').replace(/(\d)\s+(\d{3})\b/g, '$1$2');
  const moneyNear = normalized.match(
    /(?:przych[oó]d|utarg|wpłat|kwot|zł|pln|koszt|pensj|wynagrodzeni)[^\d]{0,24}(\d+(?:[.,]\d{1,2})?)/i,
  );
  const raw = moneyNear?.[1]
    ?? [...normalized.matchAll(/\b(\d{2,6}(?:[.,]\d{1,2})?)\b/g)].map((m) => m[1]).pop();
  if (!raw) return null;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function seedPayload(
  intent: Intent,
  payload: Record<string, any>,
  opts?: { transcript?: string; fromLegend?: boolean },
): Record<string, any> {
  const p = { ...payload };
  const NUMERIC_ZERO_TO_NULL = [
    'price_pln', 'amount_pln', 'quantity', 'min_quantity', 'optimal_quantity',
    'new_price', 'current_quantity', 'safety_buffer_percent', 'max_budget',
    'percentage', 'amount',
  ];
  for (const k of NUMERIC_ZERO_TO_NULL) {
    if (p[k] === 0) p[k] = null;
  }
  // Menu item: also clean ingredient quantities so 0 → null
  if (intent === 'add_menu_item' && Array.isArray(p.ingredients)) {
    p.ingredients = p.ingredients.map((ing: any) => ({
      ingredient_name: ing?.ingredient_name ?? '',
      quantity: ing?.quantity === 0 ? null : ing?.quantity ?? null,
      unit: ing?.unit ?? 'g',
    }));
  }
  if (intent === 'add_menu_item' && (!Array.isArray(p.ingredients) || p.ingredients.length === 0)) {
    p.ingredients = [{ ingredient_name: '', quantity: null, unit: 'g' }];
  }
  // Zbiorcze zamówienie braków (+ opcjonalnie nazwiane produkty MIX)
  if (intent === 'order_critical_items_by_category') {
    const raw = p.categories;
    let cats: string[] = [];
    if (Array.isArray(raw)) cats = raw.filter((x) => typeof x === 'string' && x.trim());
    else if (typeof raw === 'string' && raw.trim()) cats = [raw.trim()];
    // Z legendy: użytkownik sam zaznacza kategorie (nie zgaduj „all”)
    if (opts?.fromLegend) cats = [];
    p.categories = cats;
    // „Brakujące / krytyczne” = critical. Optimal tylko gdy LLM/UI jawnie poda.
    // NIE nadpisuj critical→optimal — to wciągało produkty poza zakresem braków.
    const st = String(p.stock_target || '').trim().toLowerCase();
    if (st !== 'optimal' && st !== 'critical') {
      p.stock_target = 'critical';
    } else {
      p.stock_target = st;
    }
    // MIX: „ser kozi + brakujące warzywa” — zachowaj items[] z interpretacji
    if (!Array.isArray(p.items)) p.items = [];
    else {
      p.items = p.items
        .filter((it: any) => it && String(it.product_name || it.name || '').trim())
        .map((it: any) => {
          const rawQty = Number(it.quantity);
          const unit = String(it.unit || 'szt').trim() || 'szt';
          // Voice często wstawia „1 szt” bez sensu — zostaw puste pod „Stan optymalny”
          const isPlaceholderSzt =
            Number.isFinite(rawQty) && rawQty === 1 && /^(szt|sztuka|sztuki|opak|op)$/i.test(unit);
          const qty =
            Number.isFinite(rawQty) && rawQty > 0 && !isPlaceholderSzt ? rawQty : null;
          return {
            product_name: String(it.product_name || it.name || '').trim(),
            quantity: qty,
            unit,
          };
        });
    }
  }
  if (intent === 'order_product') {
    if (!Array.isArray(p.items) || p.items.length === 0) {
      p.items = [{ product_name: '', quantity: null, unit: 'szt' }];
    }
  }
  if (intent === 'bulk_edit_menu_prices_percentage' || intent === 'bulk_edit_menu_prices_fixed') {
    if (!p.price_mode) {
      p.price_mode = intent === 'bulk_edit_menu_prices_fixed' ? 'fixed' : 'percent';
    }
    if (!p.action) p.action = 'increase';
    if (opts?.fromLegend) {
      p.percentage = null;
      p.amount = null;
      p.category = '';
    }
  }
  if (intent === 'edit_menu_item_price' || intent === 'delete_menu_item') {
    if (opts?.fromLegend) {
      p.dish_accepted = false;
      p.dish_id = null;
      p.dish_name = '';
      p.dish_name_resolved = '';
      if (intent === 'edit_menu_item_price') p.new_price = null;
    } else if (p.dish_accepted == null) {
      p.dish_accepted = !!p.dish_id;
    }
  }
  if (intent === 'navigate_screen' && opts?.fromLegend) {
    p.screen = null;
  }
  // Kalkulator / wyłączanie dania — wymagają kliknięcia podpowiedzi
  if (intent === 'scale_recipe' || intent === 'toggle_menu_item_availability') {
    p.dish_accepted = false;
    if (intent === 'toggle_menu_item_availability' && p.available == null) {
      p.available = false;
    }
  }
  // Analizy okresu
  if (PERIOD_INTENTS.has(intent)) {
    const transcriptHint = String(opts?.transcript || p._transcript || '').trim();
    // Z legendy: puste drzewko — użytkownik sam wybiera okres
    if (opts?.fromLegend) {
      p.selected_periods = [];
      p.period_1 = '';
      p.period_2 = '';
      p.note = '';
      p.period_type = 'month';
    } else {
      if (!p.period_1 && typeof p.note === 'string' && p.note.trim()) {
        p.period_1 = p.note.trim();
      }
      if (!p.period_1 && transcriptHint) {
        p.period_1 = transcriptHint;
      }
      if (!p.period_type) {
        p.period_type = p.period_1 ? 'month' : 'year';
      }
      if (!Array.isArray(p.selected_periods) || p.selected_periods.length === 0) {
        const sels: PeriodSelection[] = [];
        const preferYear = new Date().getFullYear();
        const a = parsePeriodHintToSelection(String(p.period_1 || transcriptHint || ''), { preferYear });
        if (a) sels.push(a);
        if (intent === 'compare_two_periods') {
          const b = parsePeriodHintToSelection(String(p.period_2 || ''), { preferYear });
          if (b) sels.push(b);
        }
        if (!sels.length) {
          sels.push({ kind: 'year', year: preferYear });
        }
        if (sels.length) {
          p.selected_periods = sels;
          p.period_1 = labelForSelections(intent === 'compare_two_periods' && sels[0] ? [sels[0]] : sels);
          if (intent === 'compare_two_periods' && sels[1]) {
            p.period_2 = labelForSelections([sels[1]]);
          }
        }
      } else {
        const hintSrc = String(transcriptHint || p.period_1 || '');
        const yInHint = hintSrc.match(/\b(20\d{2})\b/);
        if (yInHint) {
          const yWanted = Number(yInHint[1]);
          const fixed = (p.selected_periods as PeriodSelection[]).map((s) =>
            s.year !== yWanted ? { ...s, year: yWanted } : s,
          );
          const parsed = parsePeriodHintToSelection(hintSrc, { preferYear: yWanted });
          p.selected_periods = parsed ? [parsed] : fixed;
          p.period_1 = labelForSelections(p.selected_periods);
        }
      }
    }
    if ((intent === 'rank_menu_sales' || intent === 'rank_inventory_usage') && !p.rank) {
      p.rank = 'best';
    }
    if ((intent === 'rank_menu_sales' || intent === 'rank_inventory_usage' || intent === 'rank_waste_cost' || intent === 'rank_dead_menu') && p.top_n == null) {
      p.top_n = intent === 'rank_dead_menu' ? 8 : 5;
    }
  }
  if (intent === 'list_expiring_soon') {
    if (p.limit_days == null) p.limit_days = 3650; // pełna drabina
    if (p.top_n == null) p.top_n = 100;
  }
  if (intent === 'rank_supplier_spend' && p.top_n == null) p.top_n = 5;
  if (intent === 'haccp_tip' && !p.item_name && p.product_name) p.item_name = p.product_name;
  if (intent === 'add_expiration_batch') {
    if (!Array.isArray(p.batches) || p.batches.length === 0) {
      p.batches = [
        {
          quantity: p.quantity ?? null,
          expiration_date: p.expiration_date ?? '',
        },
      ];
    }
    if (!Array.isArray(p.alert_days) || p.alert_days.length === 0) {
      p.alert_days = [7, 3, 1];
    }
    p.increase_stock = false;
  }
  return p;
}

// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
