/**
 * Pod-menu: Konto osobiste / firmowe po kliknięciu banku (Wariant A).
 */
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { Building2, User, X } from 'lucide-react-native';
import type { BankAccountOption, PolishBankLogin } from '@/lib/polishBankLogins';
import { BankLogoBadge } from '@/components/dealHunter/BankLogoBadge';

type Props = {
  visible: boolean;
  bank: PolishBankLogin | null;
  onClose: () => void;
  onPick: (opt: BankAccountOption) => void;
  colors: {
    card: string;
    text: string;
    textSecondary: string;
    border: string;
    accent: string;
    background: string;
  };
};

export function BankAccountTypeSheet({ visible, bank, onClose, onPick, colors: C }: Props) {
  const slide = useRef(new Animated.Value(40)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    slide.setValue(40);
    fade.setValue(0);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, friction: 8, tension: 80, useNativeDriver: true }),
    ]).start();
  }, [visible, bank?.id, fade, slide]);

  if (!bank?.accounts?.length) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: C.card,
              borderColor: C.border,
              opacity: fade,
              transform: [{ translateY: slide }],
            },
          ]}
        >
          <View style={styles.head}>
            <BankLogoBadge bank={bank} size={36} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: C.text }]} allowFontScaling={false}>
                {bank.name}
              </Text>
              <Text style={[styles.sub, { color: C.textSecondary }]} allowFontScaling={false}>
                Wybierz typ konta do logowania
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <X size={20} color={C.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {bank.accounts.map((opt) => {
            const Icon = opt.id === 'business' ? Building2 : User;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.row, { borderColor: C.border, backgroundColor: C.background }]}
                onPress={() => onPick(opt)}
                activeOpacity={0.85}
                testID={`bank-account-${bank.id}-${opt.id}`}
              >
                <View style={[styles.iconWrap, { backgroundColor: `${C.accent}22` }]}>
                  <Icon size={18} color={C.accent} strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: C.text }]} allowFontScaling={false}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.rowSub, { color: C.textSecondary }]} numberOfLines={1} allowFontScaling={false}>
                    {opt.url.replace(/^https?:\/\//, '')}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  title: { fontSize: 16, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 11, marginTop: 2 },
});
