/**
 * Ręczna płatność przelewem (bez bramek) — Łowca Okazji, podsumowanie zamówienia hurtowego.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Check, Copy, Landmark, Pencil, X } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { POLISH_BANK_LOGINS } from '@/lib/polishBankLogins';
import { buildManualPayCopyRows, type ManualPayCopyRow } from '@/lib/manualPayCopyRows';
import { buildManualOrderTitle } from '@/lib/manualOrderTitle';
import {
  fetchRestaurantProfile,
  type RestaurantProfile,
} from '@/services/restaurantProfileService';
import { useAuth } from '@/contexts/AuthContext';
import { DS } from '@/constants/premiumTheme';
import { manualPayStyles as styles } from '@/components/dealHunter/manualBankPaymentStyles';
import { BankLogoBadge } from '@/components/dealHunter/BankLogoBadge';

export type ManualPaymentOrder = {
  supplierId: string | null;
  supplierName: string;
  /** Ignorowane — tytuł budowany z profilu restauracji. */
  orderTitle?: string;
  totalPln: number;
};

type SupplierPayProfile = {
  name: string;
  bankAccount: string | null;
  address: string | null;
};

type Props = {
  visible: boolean;
  order: ManualPaymentOrder | null;
  onClose: () => void;
  colors: {
    card: string;
    text: string;
    textSecondary: string;
    textTertiary: string;
    border: string;
    accent: string;
    background: string;
    isPremium?: boolean;
  };
};

type CopyRow = ManualPayCopyRow;

export function ManualBankPaymentSheet({ visible, order, onClose, colors: C }: Props) {
  const { profile: authProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<SupplierPayProfile | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantProfile | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !order) {
      setProfile(null);
      setRestaurant(null);
      setCopiedKey(null);
      setToast(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [rest, supplier] = await Promise.all([
          fetchRestaurantProfile().catch(() => null),
          (async (): Promise<SupplierPayProfile> => {
            const sid = order.supplierId?.trim();
            if (!sid) {
              return { name: order.supplierName, bankAccount: null, address: null };
            }
            const { data, error } = await supabase
              .from('suppliers')
              .select('name,address,bank_account')
              .eq('id', sid)
              .maybeSingle();
            if (error || !data) {
              return { name: order.supplierName, bankAccount: null, address: null };
            }
            const row = data as {
              name?: string;
              address?: string | null;
              bank_account?: string | null;
            };
            return {
              name: (row.name || order.supplierName).trim() || order.supplierName,
              bankAccount: (row.bank_account || '').trim() || null,
              address: (row.address || '').trim() || null,
            };
          })(),
        ]);
        if (cancelled) return;
        setRestaurant(rest);
        setProfile(supplier);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, order]);

  const orderTitle = useMemo(() => {
    const name =
      (restaurant?.company_name || '').trim() ||
      (authProfile?.restaurant_name || '').trim() ||
      null;
    const addr = (restaurant?.delivery_address || '').trim() || null;
    return buildManualOrderTitle({
      restaurantName: name,
      deliveryAddress: addr,
    });
  }, [restaurant, authProfile?.restaurant_name]);

  const rows: CopyRow[] = useMemo(() => {
    if (!order) return [];
    return buildManualPayCopyRows({
      supplierName: profile?.name || order.supplierName,
      bankAccount: profile?.bankAccount ?? null,
      address: profile?.address ?? null,
      totalPln: order.totalPln,
      orderTitle,
    });
  }, [order, profile, orderTitle]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const copyValue = useCallback(
    async (row: CopyRow) => {
      const text = (row.value || '').trim();
      if (!text || text === '—') {
        showToast(row.emptyHint || 'Brak danych do skopiowania');
        return;
      }
      await Clipboard.setStringAsync(text);
      setCopiedKey(row.key);
      showToast('Skopiowano do schowka telefonu');
      setTimeout(() => setCopiedKey((k) => (k === row.key ? null : k)), 2000);
    },
    [showToast],
  );

  const openBank = useCallback(
    async (url: string, bankName: string) => {
      try {
        const ok = await Linking.canOpenURL(url);
        if (!ok) {
          showToast(`Nie udało się otworzyć ${bankName}`);
          return;
        }
        await Linking.openURL(url);
      } catch {
        showToast(`Nie udało się otworzyć ${bankName}`);
      }
    },
    [showToast],
  );

  const goEditProfile = useCallback(() => {
    onClose();
    router.push('/(tabs)/ustawienia');
  }, [onClose]);

  if (!order) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.72)' }]}>
        <View style={[styles.sheet, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Landmark size={18} color={C.accent} strokeWidth={2.2} />
              <Text style={[styles.headerTitle, { color: C.text }]} allowFontScaling={false}>
                Opłać zamówienie
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12} testID="manual-pay-close">
              <X size={22} color={C.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.editDataBtn, { borderColor: C.border, backgroundColor: C.background }]}
            onPress={goEditProfile}
            activeOpacity={0.8}
            testID="manual-pay-edit-data"
          >
            <Pencil size={14} color={C.accent} strokeWidth={2.2} />
            <Text style={[styles.editDataText, { color: C.accent }]} allowFontScaling={false}>
              Edytuj swoje dane
            </Text>
          </TouchableOpacity>

          <Text style={[styles.hint, { color: C.textSecondary }]} allowFontScaling={false}>
            Skopiuj dane do przelewu, potem otwórz bank i wklej je w formularzu. Płatność jest
            całkowicie poza aplikacją — bez prowizji.
          </Text>

          {toast ? (
            <View
              style={[
                styles.toast,
                {
                  backgroundColor: C.isPremium
                    ? 'rgba(92,255,176,0.18)'
                    : 'rgba(16,185,129,0.12)',
                },
              ]}
            >
              <Check size={14} color={C.accent} strokeWidth={2.5} />
              <Text style={[styles.toastText, { color: C.accent }]} allowFontScaling={false}>
                {toast}
              </Text>
            </View>
          ) : null}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <ActivityIndicator style={{ marginVertical: 24 }} color={C.accent} />
            ) : (
              <>
                <Text style={[styles.sectionLabel, { color: C.textTertiary }]} allowFontScaling={false}>
                  Dane do przelewu
                </Text>
                {rows.map((row) => {
                  const hasValue = !!(row.value || '').trim() && row.value !== '—';
                  const isCopied = copiedKey === row.key;
                  return (
                    <TouchableOpacity
                      key={row.key}
                      style={[styles.copyRow, { borderColor: C.border, backgroundColor: C.background }]}
                      onPress={() => void copyValue(row)}
                      activeOpacity={0.75}
                      testID={`manual-pay-copy-${row.key}`}
                    >
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={[styles.copyLabel, { color: C.textTertiary }]} allowFontScaling={false}>
                          {row.label}
                        </Text>
                        <Text
                          style={[styles.copyValue, { color: hasValue ? C.text : C.textTertiary }]}
                          allowFontScaling={false}
                        >
                          {hasValue ? row.value : row.emptyHint || '—'}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.copyIcon,
                          {
                            backgroundColor: isCopied
                              ? C.isPremium
                                ? 'rgba(92,255,176,0.2)'
                                : 'rgba(16,185,129,0.15)'
                              : C.isPremium
                                ? 'rgba(255,255,255,0.06)'
                                : 'rgba(0,0,0,0.05)',
                          },
                        ]}
                      >
                        {isCopied ? (
                          <Check size={16} color={C.accent} strokeWidth={2.5} />
                        ) : (
                          <Copy size={16} color={C.accent} strokeWidth={2.2} />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <Text
                  style={[styles.sectionLabel, { color: C.textTertiary, marginTop: 20 }]}
                  allowFontScaling={false}
                >
                  Otwórz bank
                </Text>
                <View style={styles.bankGrid}>
                  {POLISH_BANK_LOGINS.map((bank) => (
                    <TouchableOpacity
                      key={bank.id}
                      style={[styles.bankTile, { borderColor: C.border, backgroundColor: C.background }]}
                      onPress={() => void openBank(bank.loginUrl, bank.name)}
                      activeOpacity={0.8}
                      testID={`manual-pay-bank-${bank.id}`}
                    >
                      <BankLogoBadge bank={bank} size={42} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text
                          style={[styles.bankName, { color: C.text }]}
                          numberOfLines={1}
                          allowFontScaling={false}
                        >
                          {bank.name}
                        </Text>
                        <Text
                          style={{ fontSize: 10, fontWeight: '600', color: C.textTertiary }}
                          allowFontScaling={false}
                        >
                          Logowanie →
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.footerNote, { color: C.textTertiary }]} allowFontScaling={false}>
                  Otworzy się oficjalna strona logowania wybranego banku w przeglądarce.
                </Text>
              </>
            )}
            <View style={{ height: 28 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export const MANUAL_PAY_FALLBACK_COLORS = {
  card: DS.color.surfaceCard,
  text: DS.color.heading,
  textSecondary: DS.color.muted,
  textTertiary: DS.color.muted,
  border: DS.color.borderSubtle,
  accent: DS.color.greenEnd,
  background: DS.color.bgSecondary,
  isPremium: true,
};
