import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Store } from 'lucide-react-native';
import { formatPln } from '@/lib/format';
import type { OptimizeResult } from '@/lib/bargainHunter';
import { themedStyles, useDealColors } from '@/components/dealHunter/theme';
import { MinOrderBadge } from '@/components/dealHunter/smallComponents';

type TiedSupplier = NonNullable<OptimizeResult['tied_suppliers']>[number];
type BestOption = NonNullable<OptimizeResult['best_option']>;

type Props = {
  best: BestOption;
  tied: TiedSupplier[];
  tiedSupplierId: string | null;
  onSelectTied: (supplierId: string) => void;
};

export function SingleBestOptionCard({
  best,
  tied,
  tiedSupplierId,
  onSelectTied,
}: Props) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  const showTied = tied.length > 1;

  return (
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
                  onPress={() => onSelectTied(t.supplier_id)}
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
  );
}
