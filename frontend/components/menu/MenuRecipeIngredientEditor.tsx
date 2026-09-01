import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Link, Link2Off, Save, Plus, Trash2 } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';
import type { EditableIngredient } from './menuRecipeTypes';
import { UNIT_OPTIONS, PIECE_WEIGHT_HINT } from './menuRecipeHelpers';
import { menuRecipeRowStyles as styles } from './menuRecipeRowStyles';

type Props = {
  prem: boolean;
  accent: string;
  accentFg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  inputBg: string;
  inputBorder: string;
  drafts: EditableIngredient[];
  loadingIngredients: boolean;
  recipeDirty: boolean;
  recipeSaving: boolean;
  suggesting: boolean;
  mappedCount: number;
  totalCount: number;
  onSaveRecipe: () => void;
  onSuggestRecipe: () => void;
  onUpdateDraft: (key: string, patch: Partial<EditableIngredient>) => void;
  onRemoveIngredient: (key: string) => void;
  onAddIngredient: () => void;
  onOpenPicker: (key: string) => void;
  onUnmap: (key: string) => void;
};

export function MenuRecipeIngredientEditor({
  prem,
  accent,
  accentFg,
  textPrimary,
  textSecondary,
  textMuted,
  inputBg,
  inputBorder,
  drafts,
  loadingIngredients,
  recipeDirty,
  recipeSaving,
  suggesting,
  mappedCount,
  totalCount,
  onSaveRecipe,
  onSuggestRecipe,
  onUpdateDraft,
  onRemoveIngredient,
  onAddIngredient,
  onOpenPicker,
  onUnmap,
}: Props) {
  return (
    <>
          <View style={styles.recipeHeaderRow}>
            <Text style={[styles.ingredientsTitle, { color: textSecondary, marginBottom: 0 }]}>
              Składniki receptury (1:1 z Menu)
            </Text>
            {recipeDirty ? (
              <TouchableOpacity
                style={[styles.saveRecipeBtn, { backgroundColor: accent }]}
                onPress={() => onSaveRecipe()}
                disabled={recipeSaving}
                activeOpacity={0.75}
              >
                {recipeSaving ? (
                  <ActivityIndicator size="small" color={accentFg} />
                ) : (
                  <>
                    <Save size={12} color={accentFg} />
                    <Text style={[styles.saveRecipeBtnText, { color: accentFg }]}>Zapisz</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={[styles.posHint, { color: textMuted, marginBottom: 10 }]}>
            Edycja tutaj zmienia też recepturę w Menu — i odwrotnie. Przy sprzedaży POS odejmie te
            ilości z magazynu ({mappedCount}/{totalCount} zmapowanych).
          </Text>

          {loadingIngredients ? (
            <ActivityIndicator size="small" color={accent} style={styles.loader} />
          ) : drafts.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={[styles.emptyText, { color: textMuted }]}>
                Brak składników w recepturze. Dodaj je poniżej albo pozwól AI zaproponować wzorcową
                recepturę z gramaturami.
              </Text>
              <TouchableOpacity
                style={[styles.suggestBtn, { backgroundColor: accent }]}
                onPress={() => onSuggestRecipe()}
                disabled={suggesting}
                activeOpacity={0.75}
              >
                {suggesting ? (
                  <ActivityIndicator size="small" color={accentFg} />
                ) : (
                  <Text style={[styles.suggestBtnText, { color: accentFg }]}>
                    Zaproponuj recepturę AI
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            drafts.map((ing, index) => (
              <View
                key={ing.key}
                style={[
                  styles.ingredientCard,
                  {
                    backgroundColor: prem ? DS.color.bgTertiary : '#F8FAFC',
                    borderColor: prem ? DS.color.borderSubtle : '#E2E8F0',
                  },
                ]}
              >
                <View style={styles.ingredientTop}>
                  <View
                    style={[
                      styles.indexBadge,
                      prem && { backgroundColor: 'rgba(0,255,120,0.14)' },
                    ]}
                  >
                    <Text style={[styles.indexText, prem && { color: DS.color.greenEnd }]}>
                      {index + 1}
                    </Text>
                  </View>
                  <TextInput
                    style={[
                      styles.nameInput,
                      { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary },
                    ]}
                    value={ing.name}
                    onChangeText={(v) => onUpdateDraft(ing.key, { name: v })}
                    placeholder="Nazwa składnika"
                    placeholderTextColor={textMuted}
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => onRemoveIngredient(ing.key)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Trash2 size={15} color={prem ? DS.color.danger : '#DC2626'} />
                  </TouchableOpacity>
                </View>

                <View style={styles.qtyRow}>
                  <TextInput
                    style={[
                      styles.qtyInput,
                      { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary },
                    ]}
                    value={ing.quantity}
                    onChangeText={(v) => onUpdateDraft(ing.key, { quantity: v })}
                    placeholder="Ilość"
                    placeholderTextColor={textMuted}
                    keyboardType="decimal-pad"
                  />
                  <View style={styles.unitWrap}>
                    {UNIT_OPTIONS.map((u) => {
                      const active = ing.unit === u;
                      return (
                        <TouchableOpacity
                          key={u}
                          style={[
                            styles.unitBtn,
                            {
                              backgroundColor: prem ? DS.color.bgSecondary : '#fff',
                              borderColor: prem ? DS.color.borderSubtle : '#E2E8F0',
                            },
                            active && {
                              backgroundColor: accent,
                              borderColor: accent,
                            },
                          ]}
                          onPress={() => onUpdateDraft(ing.key, { unit: u })}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.unitBtnText,
                              { color: textSecondary },
                              active && { color: accentFg, fontWeight: '700' },
                            ]}
                          >
                            {u}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {(ing.unit === 'szt' || ing.unit === 'sztuka') && (
                  <View
                    style={[
                      styles.pieceWeightBox,
                      {
                        backgroundColor: prem ? 'rgba(0,255,120,0.06)' : '#F8FAFC',
                        borderColor: prem ? DS.color.borderSubtle : '#E2E8F0',
                      },
                    ]}
                  >
                    <Text style={[styles.pieceWeightLabel, { color: textMuted }]}>
                      Wzorcowa waga 1 sztuki (g)
                    </Text>
                    <TextInput
                      style={[
                        styles.pieceWeightInput,
                        { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary },
                      ]}
                      value={ing.pieceWeightG ?? ''}
                      onChangeText={(v) => onUpdateDraft(ing.key, { pieceWeightG: v })}
                      placeholder="opcjonalnie, np. 180"
                      placeholderTextColor={textMuted}
                      keyboardType="decimal-pad"
                    />
                    <Text style={[styles.pieceWeightHint, { color: textMuted }]}>
                      {PIECE_WEIGHT_HINT}
                    </Text>
                  </View>
                )}

                <View style={styles.mapRow}>
                  <Text
                    style={[
                      styles.stockHint,
                      { color: ing.in_stock ? (prem ? DS.color.greenEnd : '#16A34A') : (prem ? DS.color.danger : '#DC2626') },
                    ]}
                  >
                    {ing.warehouse_product_id
                      ? ing.in_stock
                        ? `Na stanie (${ing.stock_qty ?? 0})`
                        : 'Zmapowano — brak na magazynie'
                      : 'Nie zmapowano do magazynu'}
                  </Text>
                  <View style={styles.ingredientAction}>
                    {ing.warehouse_product_id ? (
                      <>
                        <View style={[styles.linkedBadge, prem && styles.linkedBadgePrem]}>
                          <Link size={11} color={prem ? DS.color.greenEnd : '#16A34A'} />
                          <Text
                            style={[styles.linkedBadgeText, prem && { color: DS.color.greenEnd }]}
                            numberOfLines={1}
                          >
                            {ing.warehouse_product_name || 'magazyn'}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.changeBtn, prem && styles.changeBtnPrem]}
                          onPress={() => onOpenPicker(ing.key)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.changeBtnText, prem && { color: DS.color.greenEnd }]}>
                            Zmień
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.unlinkBtn}
                          onPress={() => onUnmap(ing.key)}
                          activeOpacity={0.7}
                        >
                          <Link2Off size={14} color={textSecondary} />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity
                        style={[
                          styles.mapBtn,
                          prem && {
                            backgroundColor: DS.color.bgSecondary,
                            borderColor: DS.color.borderSubtle,
                          },
                        ]}
                        onPress={() => onOpenPicker(ing.key)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.mapBtnText, { color: textSecondary }]}>Mapuj</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))
          )}

          <View style={styles.footerActions}>
            <TouchableOpacity
              style={[
                styles.addIngBtn,
                prem && {
                  backgroundColor: DS.color.bgTertiary,
                  borderColor: DS.color.borderSubtle,
                },
              ]}
              onPress={onAddIngredient}
              activeOpacity={0.75}
            >
              <Plus size={14} color={accent} />
              <Text style={[styles.addIngBtnText, { color: accent }]}>Dodaj składnik</Text>
            </TouchableOpacity>
            {drafts.length === 0 ? null : (
              <TouchableOpacity
                style={[styles.suggestBtnSmall, { borderColor: accent }]}
                onPress={() => onSuggestRecipe()}
                disabled={suggesting}
                activeOpacity={0.75}
              >
                {suggesting ? (
                  <ActivityIndicator size="small" color={accent} />
                ) : (
                  <Text style={[styles.suggestBtnSmallText, { color: accent }]}>AI receptura</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
    </>
  );
}
