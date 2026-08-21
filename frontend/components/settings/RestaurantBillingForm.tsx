/**
 * Dane firmy / dostaw / przelewu — podzakładka „Dane lokalu”.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { settingsScreenStyles as styles } from '@/components/settings/settingsScreenStyles';
import {
  EMPTY_RESTAURANT_PROFILE,
  fetchRestaurantProfile,
  saveRestaurantProfile,
  type RestaurantProfile,
} from '@/services/restaurantProfileService';

type FieldKey = Exclude<keyof RestaurantProfile, 'complete'>;

const FIELDS: {
  key: FieldKey;
  label: string;
  placeholder: string;
  keyboard?: 'email-address' | 'default' | 'phone-pad';
}[] = [
  { key: 'contact_email', label: 'E-mail do kontaktu (dostawy)', placeholder: 'zamowienia@restauracja.pl', keyboard: 'email-address' },
  { key: 'contact_phone', label: 'Telefon kontaktowy', placeholder: '+48 …', keyboard: 'phone-pad' },
  { key: 'company_name', label: 'Pełna nazwa firmy / lokalu', placeholder: 'np. Gastro Sp. z o.o.' },
  { key: 'delivery_address', label: 'Adres do dostaw', placeholder: 'ul. …, kod, miasto' },
  { key: 'bank_account', label: 'Numer konta bankowego', placeholder: 'PL…' },
  { key: 'nip', label: 'NIP', placeholder: '10 cyfr' },
  { key: 'regon', label: 'REGON', placeholder: '9 lub 14 cyfr' },
];

export function RestaurantBillingForm() {
  const theme = useAppTheme();
  const premiumAlert = usePremiumAlert();
  const [form, setForm] = useState<RestaurantProfile>({ ...EMPTY_RESTAURANT_PROFILE });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await fetchRestaurantProfile();
      setForm(p);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się wczytać danych.';
      premiumAlert.alert('Profil restauracji', msg);
    } finally {
      setLoading(false);
    }
  }, [premiumAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const email = form.contact_email.trim();
    if (email && (!email.includes('@') || !email.includes('.'))) {
      premiumAlert.alert('E-mail', 'Podaj poprawny adres e-mail.');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveRestaurantProfile({
        contact_email: form.contact_email,
        contact_phone: form.contact_phone,
        company_name: form.company_name,
        delivery_address: form.delivery_address,
        bank_account: form.bank_account,
        nip: form.nip,
        regon: form.regon,
      });
      setForm(saved);
      premiumAlert.alert('Zapisano', 'Dane lokalu zostały zaktualizowane.', [
        { text: 'OK', style: 'primary' },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się zapisać.';
      premiumAlert.alert('Błąd', msg);
    } finally {
      setSaving(false);
    }
  };

  const inputBg = theme.isPremium ? theme.card : Colors.borderLight;
  const border = theme.border;
  const text = theme.text;
  const muted = theme.textSecondary;

  return (
    <View
      style={[
        styles.card,
        theme.isPremium && { backgroundColor: theme.card, borderColor: border },
      ]}
    >
      <Text style={[styles.fieldHint, { color: theme.textMuted, marginBottom: 12 }]}>
        Te dane trafiają do tytułu przelewu („Opłać zamówienie”), szablonu „Dane do wysyłki”
        i jako kontakt w e-mailach do dostawców.
      </Text>
      {loading ? (
        <ActivityIndicator color={theme.accent} style={{ marginVertical: 16 }} />
      ) : (
        FIELDS.map((f) => (
          <View key={f.key} style={{ marginBottom: 12 }}>
            <Text style={[styles.fieldLabel, { color: muted, marginBottom: 4 }]}>{f.label}</Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: inputBg, borderColor: border, color: text },
              ]}
              value={form[f.key] || ''}
              onChangeText={(t) => setForm((prev) => ({ ...prev, [f.key]: t }))}
              placeholder={f.placeholder}
              placeholderTextColor={theme.textMuted}
              autoCapitalize={f.key === 'contact_email' ? 'none' : 'sentences'}
              keyboardType={f.keyboard || 'default'}
              testID={`settings-restaurant-${f.key}`}
            />
          </View>
        ))
      )}
      <TouchableOpacity
        style={[
          styles.saveBtn,
          theme.isPremium && { backgroundColor: theme.accent },
          saving && styles.saveBtnDisabled,
        ]}
        onPress={() => void save()}
        disabled={saving || loading}
        activeOpacity={0.85}
        testID="settings-restaurant-save"
      >
        {saving ? (
          <ActivityIndicator color={theme.isPremium ? '#0A0A0A' : '#fff'} />
        ) : (
          <Text style={[styles.saveBtnText, theme.isPremium && { color: '#0A0A0A' }]}>
            Zapisz dane lokalu
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
