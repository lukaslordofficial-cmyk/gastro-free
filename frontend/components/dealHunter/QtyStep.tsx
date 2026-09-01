import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Sparkles } from 'lucide-react-native';
import {
  type DealHunterSearchScope,
  DEAL_HUNTER_SEARCH_SCOPE_OPTIONS,
} from '@/lib/dealHunterSearchScope';
import { themedStyles, useDealColors } from '@/components/dealHunter/theme';
import type { ProductLike } from '@/components/dealHunter/types';

type Props = {
  product: ProductLike;
  qty: string;
  searchScope: DealHunterSearchScope;
  onQtyChange: (v: string) => void;
  onSearchScopeChange: (scope: DealHunterSearchScope) => void;
  onCompare: () => void;
};

export function QtyStep({
  product,
  qty,
  searchScope,
  onQtyChange,
  onSearchScopeChange,
  onCompare,
}: Props) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);

  return (
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
                onPress={() => onSearchScopeChange(opt.key)}
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
            onChangeText={onQtyChange}
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
        <TouchableOpacity style={styles.primaryBtn} onPress={onCompare} activeOpacity={0.85} testID="deal-hunter-compare-btn">
          <Sparkles size={17} color={C.white} strokeWidth={2.2} />
          <Text style={styles.primaryBtnText}>Porównaj oferty dostawców</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
