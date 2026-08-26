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
  mixedPiecesToKg,
  type ProduceSizeCounts,
  type ProduceSizeKey,
} from '@/lib/produceSizeConverter';
import { useAuth } from '@/contexts/AuthContext';

import type { EditorProps } from './types';
import { INTENT_META, PERIOD_INTENTS, UNIT_OPTIONS, UPLOAD_INTENTS } from './constants';
import { PeriodConfirmEditor } from './PeriodConfirmEditor';
import { numOrNull } from './helpers';
import { ScaleRecipePicker } from './ScaleRecipePicker';
import { ToggleDishPicker } from './ToggleDishPicker';
import { JarvisMatchBanner } from './JarvisMatchBanner';
import { Card, EditRow, FieldLabel, SegmentedField, UnitField } from './fields';
import { styles } from './styles';

export function IntentEditor({ intent, edited, patch, categories, menuCategories }: EditorProps) {
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
      const next: Record<string, any> = { item_type: v, produce_size: null, produce_size_counts: {} };
      const validNow = (v === 'dish' ? ['porcja', 'l', 'kg', 'g', 'ml'] : ['szt', 'op', 'l', 'ml', 'g', 'kg']);
      if (!validNow.includes(edited.unit)) {
        next.unit = v === 'dish' ? 'porcja' : 'szt';
      }
      patch(next);
    };
    const produce = !isDish ? findProduceConverter(String(edited.item_name || '')) : null;
    const sizeCounts = (edited.produce_size_counts as ProduceSizeCounts) || {};
    const mixedPreview = produce ? mixedPiecesToKg(sizeCounts, produce) : null;
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
        {isDish ? (
          <DishPickEditor
            edited={{
              ...edited,
              dish_name: edited.dish_name || edited.item_name,
              dish_name_resolved:
                edited.dish_name_resolved || edited.item_name_resolved || edited.item_name,
              dish_id: edited.dish_id || edited.related_id,
              dish_accepted:
                edited.dish_accepted === true ||
                (!!edited.related_id && !!(edited.item_name_resolved || edited.dish_name_resolved)),
            }}
            patch={(p) => {
              const next: Record<string, any> = { ...p, produce_size: null, produce_size_counts: {} };
              if (p.dish_name !== undefined) next.item_name = p.dish_name;
              if (p.dish_name_resolved !== undefined) {
                next.item_name = p.dish_name_resolved;
                next.item_name_resolved = p.dish_name_resolved;
              }
              if (p.dish_id !== undefined) next.related_id = p.dish_id;
              if (p.dish_accepted === true && (p.dish_id || edited.related_id)) {
                next.related_id = p.dish_id ?? edited.related_id;
              }
              if (p.dish_accepted === false) next.related_id = null;
              patch(next);
            }}
            title="Wybierz danie z menu (kliknij propozycję)."
          />
        ) : (
          <View style={{ marginBottom: 8 }}>
            <FieldLabel text="Pozycja z magazynu" />
            <IngredientNameSuggest
              value={String(edited.item_name_resolved || edited.item_name || '')}
              onChange={(v) =>
                patch({
                  item_name: v,
                  item_name_resolved: null,
                  related_id: null,
                  produce_size: null,
                  produce_size_counts: {},
                })
              }
              onPickUnit={(u) => patch({ unit: u })}
              onPickItem={(item) =>
                patch({
                  item_name: item.label || item.name,
                  item_name_resolved: item.label || item.name,
                  related_id: item.id,
                  produce_size: null,
                  produce_size_counts: {},
                  ...(item.unit ? { unit: item.unit } : {}),
                })
              }
            />
            {edited.related_id ? (
              <Text style={styles.editHint2}>Wybrano z magazynu · ID powiązane</Text>
            ) : (
              <Text style={styles.editHint2}>Wybierz produkt z listy — inaczej strata nie zejdzie ze stanu.</Text>
            )}
          </View>
        )}
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <EditRow label="Ilość" value={edited.quantity == null ? '' : String(edited.quantity)} onChangeText={(v) => patch({ quantity: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0" />
          </View>
          <View style={{ flex: 1 }}>
            <UnitField value={edited.unit ?? ''} onChange={(v) => patch({ unit: v })} options={wasteUnits} />
          </View>
        </View>
        {produce && (edited.unit === 'szt' || edited.unit === 'op' || edited.unit === 'kg' || !edited.unit) ? (
          <>
            <ProduceSizePicker
              converter={produce}
              counts={sizeCounts}
              onChangeCounts={(next) => {
                const tot = mixedPiecesToKg(next, produce);
                patch({
                  produce_size_counts: next,
                  produce_size: (['S', 'M', 'L'] as ProduceSizeKey[])
                    .filter((k) => (tot.counts[k] || 0) > 0)
                    .map((k) => `${tot.counts[k]}×${k}`)
                    .join('+') || null,
                  unit: 'szt',
                  quantity: tot.pieces > 0 ? tot.pieces : edited.quantity,
                });
              }}
            />
            {mixedPreview && mixedPreview.pieces > 0 ? (
              <Text style={styles.editHint2}>
                Razem ≈ {mixedPreview.kg} kg ({mixedPreview.pieces} szt.)
              </Text>
            ) : (
              <Text style={styles.editHint2}>
                Bez S/M/L wpisana liczba sztuk = wzorzec M (~{produce.sizes.find((s) => s.key === 'M')?.avgWeightG ?? 200} g).
              </Text>
            )}
          </>
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
