/**
 * Modal kaskady produktów (Pro Dark) — alerty krytyczne / sortowanie stanu / Jarvis.
 * Produkty wjeżdżają jeden po drugim w ≤ ~1 s łącznie.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from 'react-native';
import { X } from 'lucide-react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { PremiumColors } from '@/constants/premiumTheme';
import { imageSourceForProduct } from '@/lib/productImages';
import { LaserScanner, FloatingAsset } from '@/components/premium/premiumAnimations';

export type CascadeProduct = {
  id: string;
  name: string;
  quantity: number;
  minQuantity?: number;
  unit?: string;
};

type Props = {
  visible: boolean;
  title?: string;
  subtitle?: string;
  items: CascadeProduct[];
  onClose: () => void;
  onSelect?: (item: CascadeProduct) => void;
};

function fmtQty(n: number, unit?: string) {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
  return `${v}${unit ? ` ${unit}` : ''}`;
}

export function ProductCascadeModal({
  visible,
  title = 'Produkty',
  subtitle,
  items,
  onClose,
  onSelect,
}: Props) {
  const [wave, setWave] = useState(0);

  useEffect(() => {
    if (visible) setWave((w) => w + 1);
  }, [visible, items.length]);

  const n = Math.max(items.length, 1);
  /** Cała kaskada w max ~900 ms */
  const stepMs = Math.min(70, Math.floor(900 / n));

  const rows = useMemo(() => items, [items]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Animated.View entering={FadeIn.duration(200)} style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.close} hitSlop={10}>
              <X size={18} color={PremiumColors.textMuted} strokeWidth={2.5} />
            </TouchableOpacity>
          </Animated.View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            {rows.length === 0 ? (
              <Text style={styles.empty}>Brak produktów do wyświetlenia.</Text>
            ) : (
              rows.map((item, i) => (
                <Animated.View
                  key={`${wave}-${item.id}`}
                  entering={FadeInUp.delay(stepMs * i)
                    .duration(280)
                    .springify()
                    .damping(16)
                    .stiffness(160)
                    .mass(0.6)}
                >
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.85}
                    onPress={() => onSelect?.(item)}
                  >
                    <LaserScanner active={i < 8}>
                      <FloatingAsset
                        source={imageSourceForProduct(item.name)}
                        size={52}
                        delay={stepMs * i}
                      />
                    </LaserScanner>
                    <View style={styles.meta}>
                      <Text style={styles.name} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.qty}>
                        Stan: {fmtQty(item.quantity, item.unit)}
                        {item.minQuantity != null
                          ? ` · próg: ${fmtQty(item.minQuantity, item.unit)}`
                          : ''}
                      </Text>
                    </View>
                    {item.minQuantity != null && item.quantity <= item.minQuantity ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>Niski</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                </Animated.View>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: PremiumColors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    paddingTop: 14,
    paddingHorizontal: 14,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 8,
  },
  title: {
    color: PremiumColors.neon,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  sub: {
    color: PremiumColors.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: PremiumColors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PremiumColors.border,
  },
  scroll: { flexGrow: 0 },
  empty: {
    color: PremiumColors.textMuted,
    textAlign: 'center',
    paddingVertical: 28,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PremiumColors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    padding: 10,
    marginBottom: 8,
  },
  meta: { flex: 1, marginLeft: 12, minWidth: 0 },
  name: { color: PremiumColors.text, fontSize: 14, fontWeight: '700' },
  qty: { color: PremiumColors.textSecondary, fontSize: 11, marginTop: 3 },
  badge: {
    backgroundColor: PremiumColors.alertSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { color: PremiumColors.alert, fontSize: 10, fontWeight: '800' },
});
