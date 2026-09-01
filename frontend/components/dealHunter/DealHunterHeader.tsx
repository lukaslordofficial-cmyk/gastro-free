import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { X, Sparkles, Check } from 'lucide-react-native';
import { themedStyles, useDealColors } from '@/components/dealHunter/theme';

type Props = {
  subtitle: string;
  stepLabels: string[];
  activeStepIndex: number;
  error: string | null;
  onClose: () => void;
};

export function DealHunterHeader({
  subtitle,
  stepLabels,
  activeStepIndex,
  error,
  onClose,
}: Props) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);

  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Sparkles size={16} color={C.accent} strokeWidth={2.4} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Łowca Okazji</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={onClose} testID="deal-hunter-close" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={22} color={C.textSecondary} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <View style={styles.steps}>
        {stepLabels.map((label, i) => {
          const active = activeStepIndex === i;
          const done = activeStepIndex > i;
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
    </>
  );
}
