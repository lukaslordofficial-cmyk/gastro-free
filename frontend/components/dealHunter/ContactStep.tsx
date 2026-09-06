import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Mail, Phone, ChevronRight } from 'lucide-react-native';
import { themedStyles, useDealColors } from '@/components/dealHunter/theme';

type Props = {
  contactEmail: string;
  contactPhone: string;
  savingProfile: boolean;
  onEmailChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onSave: () => void;
};

export function ContactStep({
  contactEmail,
  contactPhone,
  savingProfile,
  onEmailChange,
  onPhoneChange,
  onSave,
}: Props) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  const ctaFg = C.isPremium ? '#0A0A0A' : C.white;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Dane kontaktowe dla dostawców</Text>
          <Text style={styles.infoText}>
            Wpisz dane, na które hurtownia ma się z Tobą kontaktować w sprawie tego zamówienia.
          </Text>
        </View>
        <Text style={styles.fieldLabel}>Twój e-mail kontaktowy</Text>
        <View style={styles.inputRow}>
          <Mail size={16} color={C.textSecondary} strokeWidth={2} />
          <TextInput
            style={styles.textInput}
            value={contactEmail}
            onChangeText={onEmailChange}
            placeholder="np. kontakt@twojarestauracja.pl"
            placeholderTextColor={C.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            testID="deal-hunter-contact-email"
          />
        </View>
        <Text style={styles.fieldLabel}>Twój telefon</Text>
        <View style={styles.inputRow}>
          <Phone size={16} color={C.textSecondary} strokeWidth={2} />
          <TextInput
            style={styles.textInput}
            value={contactPhone}
            onChangeText={onPhoneChange}
            placeholder="np. +48 600 100 200"
            placeholderTextColor={C.textTertiary}
            keyboardType="phone-pad"
            testID="deal-hunter-contact-phone"
          />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, savingProfile && styles.primaryBtnDisabled]}
          onPress={onSave}
          disabled={savingProfile}
          activeOpacity={0.85}
          testID="deal-hunter-save-profile-btn"
        >
          {savingProfile ? (
            <ActivityIndicator size="small" color={ctaFg} />
          ) : (
            <>
              <Text style={[styles.primaryBtnText, { color: ctaFg }]}>Zapisz i przejdź do podglądu</Text>
              <ChevronRight size={17} color={ctaFg} strokeWidth={2.2} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
