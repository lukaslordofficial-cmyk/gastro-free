/**
 * Dane firmy / dostaw / przelewu — Ustawienia + „Edytuj swoje dane”.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Building2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { settingsScreenStyles as styles } from '@/components/settings/settingsScreenStyles';
import {
  EMPTY_RESTAURANT_PROFILE,
  fetchRestaurantProfile,
  saveRestaurantProfile,
  type RestaurantProfile,
} from '@/services/restaurantProfileService';

type FieldKey = Exclude<keyof RestaurantProfile, 'complete'>;

const FIELDS: { key: FieldKey; label: string; placeholder: string; keyboard?: 'email-address' | 'default' | 'phone-pad' }[] = [
  { key: 'contact_email', label: 'E-mail do kontaktu (dostawy)', placeholder: 'zamowienia@restauracja.pl', keyboard: 'email-address' },
  { key: 'contact_phone', label: 'Telefon kontaktowy', placeholder: '+48 …', keyboard: 'phone-pad' },
  { key: 'company_name', label: 'Pełna nazwa firmy', placeholder: 'np. Gastro Sp. z o.o.' },
  { key: 'delivery_address', label: 'Adres do dostaw', placeholder: 'ul. …, kod, miasto' },
  { key: 'bank_account', label: 'Numer konta bankowego', placeholder: 'PL…' },
  { key: 'nip', label: 'NIP', placeholder: '10 cyfr' },
  { key: 'regon', label: 'REGON', placeholder: '9 lub 14 cyfr' },
];

export function RestaurantBillingForm() {
  const theme = useAppTheme();
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
      Alert.alert('Profil restauracji', msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const email = form.contact_email.trim();
    if (email && (!email.includes('@') || !email.includes('.'))) {
      Alert.alert('E-mail', 'Podaj poprawny adres e-mail.');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveRestaurantProfile(form);
      setForm(saved);
      Alert.alert('Zapisano', 'Dane restauracji zostały zaktualizowane.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się zapisać.';
      Alert.alert('Błąd', msg);
    } finally {
      setSaving(false);
    }
  };

  const inputBg = theme.isPremium ? theme.card : Colors.borderLight;
  const border = theme.border;
  const text = theme.text;
  const muted = theme.textSecondary;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Building2 size={16} color={muted} />
        <Text style={[styles.sectionTitle, { color: muted }]}>Dane restauracji</Text>
      </View>
      <View
        style={[
          styles.card,
          theme.isPremium && { backgroundColor: theme.card, borderColor: border },
        ]}
      >
        <Text style={[styles.fieldHint, { color: theme.textMuted, marginBottom: 12 }]}>
          Te dane trafiają do tytułu przelewu („Opłać zamówienie”) i jako domyślny nadawca e-maili do dostawców.
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
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={() => void save()}
          disabled={saving || loading}
          activeOpacity={0.85}
          testID="settings-restaurant-save"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Zapisz dane restauracji</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
