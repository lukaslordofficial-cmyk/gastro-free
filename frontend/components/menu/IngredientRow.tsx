import React, { useState } from 'react';
import { Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Check, Trash2, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { UNIT_OPTIONS } from '@/constants/menuUi';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PIECE_WEIGHT_HINT } from '@/lib/menuScreenHelpers';
import type { IngredientDraft, StockStatus } from '@/types/menu';
import { ingredientRowStyles as ingStyles } from '@/components/menu/ingredientRowStyles';

function IngredientStockBadge({ status }: { status: StockStatus | null }) {
  const [showTip, setShowTip] = useState(false);
  if (!status) return <View style={ingStyles.statusPlaceholder} />;

  const label = status.found
    ? `Na stanie: ${status.qty % 1 === 0 ? status.qty.toFixed(0) : status.qty.toFixed(2)} ${status.unit}`
    : 'Brak produktu w magazynie';

  return (
    <View style={ingStyles.statusWrap}>
      <Pressable
        onPress={() => setShowTip((s) => !s)}
        onHoverIn={() => setShowTip(true)}
        onHoverOut={() => setShowTip(false)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[ingStyles.statusIcon, status.found ? ingStyles.statusOk : ingStyles.statusBad]}
        testID={`ingredient-status-${status.found ? 'ok' : 'missing'}`}
      >
        {status.found ? (
          <Check size={13} color={Colors.white} strokeWidth={3} />
        ) : (
          <X size={13} color={Colors.white} strokeWidth={3} />
        )}
      </Pressable>
      {showTip && (
        <View style={ingStyles.tooltip} testID="ingredient-status-tooltip">
          <Text style={ingStyles.tooltipText}>{label}</Text>
        </View>
      )}
    </View>
  );
}

export function IngredientRow({
  draft,
  index,
  suggestions,
  stock,
  onChange,
  onRemove,
  onSelectSuggestion,
}: {
  draft: IngredientDraft;
  index: number;
  suggestions: string[];
  stock: StockStatus | null;
  onChange: (key: string, field: keyof IngredientDraft, value: string) => void;
  onRemove: (key: string) => void;
  onSelectSuggestion: (key: string, name: string) => void;
}) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  // Po wybraniu podpowiedzi nazwa == podpowiedź → odfiltruj dokładne trafienie,
  // dzięki czemu lista znika po podstawieniu (a nie „wisi” dalej).
  const nameKey = draft.name.trim().toLowerCase();
  const filteredSuggestions = suggestions.filter((s) => s.trim().toLowerCase() !== nameKey);
  const showSuggestions = draft.name.length >= 2 && filteredSuggestions.length > 0;
  const inputPrem = prem
    ? {
        backgroundColor: DS.color.bgTertiary,
        borderColor: DS.color.borderSubtle,
        color: DS.color.heading,
      }
    : null;
  const unitActive = prem
    ? { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }
    : null;

  return (
    <View style={ingStyles.outerWrap}>
      <View style={[ingStyles.wrap, prem && { backgroundColor: DS.color.surfaceCard, borderColor: DS.color.borderSubtle }]}>
        <View style={[ingStyles.indexWrap, prem && { backgroundColor: 'rgba(0,255,120,0.14)' }]}>
          <Text style={[ingStyles.index, prem && { color: DS.color.greenEnd }]}>{index + 1}</Text>
        </View>
        <View style={ingStyles.fields}>
          <View>
            <View style={ingStyles.nameRow}>
              <TextInput
                style={[ingStyles.input, ingStyles.nameInput, inputPrem]}
                placeholder="Nazwa składnika"
                placeholderTextColor={prem ? DS.color.muted : Colors.textTertiary}
                value={draft.name}
                onChangeText={(v) => onChange(draft.key, 'name', v)}
                returnKeyType="next"
                autoCorrect={false}
              />
              <IngredientStockBadge status={stock} />
            </View>
            {showSuggestions && (
              <View style={[ingStyles.suggestionsBox, prem && { backgroundColor: DS.color.bgTertiary, borderColor: DS.color.borderSubtle }]}>
                {filteredSuggestions.slice(0, 5).map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={ingStyles.suggestionRow}
                    onPress={() => onSelectSuggestion(draft.key, s)}
                    activeOpacity={0.7}
                  >
                    <Text style={[ingStyles.suggestionText, prem && { color: DS.color.heading }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          <View style={ingStyles.qtyRow}>
            <TextInput
              style={[ingStyles.input, ingStyles.qtyInput, inputPrem]}
              placeholder="Ilość"
              placeholderTextColor={prem ? DS.color.muted : Colors.textTertiary}
              value={draft.quantity}
              onChangeText={(v) => onChange(draft.key, 'quantity', v)}
              keyboardType="decimal-pad"
            />
            <View style={ingStyles.unitWrap}>
              {UNIT_OPTIONS.map((u) => {
                const active = draft.unit === u;
                return (
                  <TouchableOpacity
                    key={u}
                    style={[
                      ingStyles.unitBtn,
                      prem && { backgroundColor: DS.color.bgTertiary, borderColor: DS.color.borderSubtle },
                      active && (unitActive ?? ingStyles.unitBtnActive),
                    ]}
                    onPress={() => onChange(draft.key, 'unit', u)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        ingStyles.unitText,
                        prem && !active && { color: DS.color.muted },
                        active && ingStyles.unitTextActive,
                        active && prem && { color: '#0A0A0A' },
                      ]}
                    >
                      {u}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={ingStyles.removeBtn} onPress={() => onRemove(draft.key)} activeOpacity={0.7}>
              <Trash2 size={14} color={Colors.danger} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          {(draft.unit === 'szt' || draft.unit === 'sztuka') && (
            <View
              style={[
                ingStyles.pieceWeightBox,
                prem && {
                  backgroundColor: 'rgba(0,255,120,0.06)',
                  borderColor: DS.color.borderSubtle,
                },
              ]}
            >
              <Text style={[ingStyles.pieceWeightLabel, prem && { color: DS.color.muted }]}>
                Wzorcowa waga 1 sztuki (g)
              </Text>
              <TextInput
                style={[ingStyles.input, ingStyles.pieceWeightInput, inputPrem]}
                placeholder="opcjonalnie, np. 180"
                placeholderTextColor={prem ? DS.color.muted : Colors.textTertiary}
                value={draft.pieceWeightG ?? ''}
                onChangeText={(v) => onChange(draft.key, 'pieceWeightG', v)}
                keyboardType="decimal-pad"
              />
              <Text style={[ingStyles.pieceWeightHint, prem && { color: DS.color.muted }]}>
                {PIECE_WEIGHT_HINT}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
