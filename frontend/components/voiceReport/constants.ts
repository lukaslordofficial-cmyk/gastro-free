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

import type { Intent } from './types';

export const DESTRUCTIVE_INTENTS = new Set<Intent>([
  'bulk_delete_menu', 'bulk_delete_suppliers', 'bulk_reset_inventory', 'bulk_delete_inventory',
]);
/** Intencje sterowania UI — wykonywane natychmiast na froncie (nawigacja/filtry). */
export const NAV_INTENTS = new Set<Intent>([
  'navigate_screen', 'filter_ui_inventory', 'filter_ui_menu_blocked',
]);
/** Analizy okresu — wymagają drzewka dat przed uruchomieniem. */
export const PERIOD_INTENTS = new Set<Intent>([
  'summarize_custom_period', 'compare_two_periods', 'rank_menu_sales', 'rank_inventory_usage',
  'rank_waste_cost', 'rank_dead_menu', 'rank_supplier_spend',
]);
/** Wgrywanie dokumentów — otwiera skaner po zatwierdzeniu. */
export const UPLOAD_INTENTS = new Set<Intent>([
  'upload_invoice', 'upload_offer', 'upload_document', 'upload_menu',
]);
export const CONFIRM_WORD = 'POTWIERDZAM';

export const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ??
  process.env.REACT_APP_BACKEND_URL ??
  '';

export const UNIT_OPTIONS = ['kg', 'g', 'l', 'ml', 'szt', 'op'];

/** Meta per intent — labels shown in preview */
export const INTENT_META: Record<Intent, { icon: string; label: string; color: string }> = {
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
export const COMMAND_EXAMPLES: { intent: Intent; example: string }[] = [
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
export const INTENT_SEARCH_ALIASES: Partial<Record<Intent, string[]>> = {
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

export const MONTHS_PL_PREVIEW: Record<string, string> = {
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

export const VOICE_CATEGORY_SYNONYMS: Record<string, string[]> = {
  'Mięso i wędliny': ['mieso', 'mięso', 'wedliny', 'wędliny', 'mieso i wedliny', 'mięso i wędliny'],
  'Ryby i owoce morza': ['ryby', 'ryba', 'owoce morza', 'ryby i owoce morza'],
  Nabiał: ['nabial', 'nabiał', 'nabialowe', 'nabiałowe'],
  'Warzywa i owoce': ['warzywa', 'owoce', 'jarzyny', 'warzywa i owoce', 'warzywo'],
  Pieczywo: ['pieczywo'],
  Alkohole: ['alkohol', 'alkohole'],
  Napoje: ['napoje', 'napoj', 'napój'],
  Mrożonki: ['mrozonki', 'mrożonki', 'mrozone', 'mrożone'],
  'Suchy magazyn': ['suchy', 'suchy magazyn', 'sucha pantry', 'pantry'],
  'Oleje i tłuszcze': ['olej', 'oleje', 'oliwa', 'oliwy', 'tluszcze', 'tłuszcze', 'oleje i tluszcze', 'oleje i tłuszcze'],
  Przyprawy: ['przyprawy', 'przyprawa', 'ziola', 'zioła'],
  'Wywary i sosy': ['wywary', 'sosy', 'wywar', 'sos', 'wywary i sosy'],
  'Chemia i czystość': ['chemia', 'srodki czystosci', 'środki czystości', 'chemia i czystosc', 'chemia i czystość'],
  Opakowania: ['opakowania', 'opakowanie'],
  Inne: ['inne', 'pozostale', 'pozostałe'],
};

export const VOICE_CAT_STOP = new Set([
  'brakujace', 'brakujacych', 'brakujacy', 'braki', 'wszystkie', 'wszystkich',
  'kategoria', 'kategorii', 'z', 'i', 'oraz', 'a', 'tez', 'też', 'plus',
  'zamow', 'zamów', 'prosze', 'proszę',
]);
