import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Link, Redirect, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DS, PremiumTokens } from '@/constants/premiumTheme';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function RegisterScreen() {
  const { signUp, isAuthenticated, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (ready && isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  const onSubmit = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await signUp(email, password, restaurantName);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      if (res.needsEmailConfirm) {
        setInfo(
          'Konto utworzone, ale brak aktywnej sesji. Zaloguj się tym samym e-mailem i hasłem. ' +
            'Na closed beta wyłącz w Supabase „Confirm email” ' +
            '(Authentication → Providers → Email → Confirm email OFF).',
        );
        return;
      }
      router.replace('/(tabs)');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#0A120E', DS.color.bgPrimary, '#050505']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.brand}>GASTRO MANAGER</Text>
            <Text style={styles.title}>Nowe konto</Text>
            <Text style={styles.sub}>
              Rejestracja e-mail + hasło — bez potwierdzenia maila (beta). Po założeniu konta
              otrzymujesz 100 kredytów AI, 30 dni trialu Premium i własny magazyn / menu.
            </Text>

            {!isSupabaseConfigured && (
              <View style={styles.bannerWarn}>
                <Text style={styles.bannerWarnText}>
                  Brak konfiguracji Supabase w frontend/.env — rejestracja nie zadziała.
                </Text>
              </View>
            )}

            <Text style={styles.label}>Nazwa restauracji (opcjonalnie)</Text>
            <TextInput
              style={styles.input}
              value={restaurantName}
              onChangeText={setRestaurantName}
              placeholder="np. Bistro Zielone"
              placeholderTextColor={PremiumTokens.color.textFaint}
              editable={!busy}
              testID="register-restaurant"
            />

            <Text style={styles.label}>E-mail</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="nazwa@restauracja.pl"
              placeholderTextColor={PremiumTokens.color.textFaint}
              editable={!busy}
              testID="register-email"
            />

            <Text style={styles.label}>Hasło (min. 6 znaków)</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={PremiumTokens.color.textFaint}
              editable={!busy}
              testID="register-password"
              onSubmitEditing={() => void onSubmit()}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {info ? (
              <View style={styles.bannerInfo}>
                <Text style={styles.bannerInfoText}>{info}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.cta, busy && styles.ctaDisabled]}
              onPress={() => void onSubmit()}
              disabled={busy}
              activeOpacity={0.85}
              testID="register-submit"
            >
              <LinearGradient
                colors={[...DS.gradient.green]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.ctaGrad}
              >
                {busy ? (
                  <ActivityIndicator color="#0A0A0A" />
                ) : (
                  <Text style={styles.ctaText}>Utwórz konto</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <Text style={styles.footerMuted}>Masz już konto?</Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity disabled={busy}>
                  <Text style={styles.footerLink}>Zaloguj się</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DS.color.bgPrimary },
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 32,
    justifyContent: 'center',
  },
  brand: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 3.2,
    color: DS.color.greenEnd,
    marginBottom: 20,
  },
  title: {
    ...PremiumTokens.type.display,
    color: DS.color.heading,
    marginBottom: 8,
  },
  sub: {
    ...PremiumTokens.type.body,
    color: PremiumTokens.color.textMuted,
    marginBottom: 28,
    maxWidth: 360,
  },
  label: {
    ...PremiumTokens.type.micro,
    color: PremiumTokens.color.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: 'rgba(22,22,22,0.92)',
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    borderRadius: DS.radius.button,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: DS.color.heading,
    marginBottom: 16,
  },
  error: {
    color: DS.color.danger,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    lineHeight: 18,
  },
  bannerWarn: {
    backgroundColor: PremiumTokens.color.alertSoft,
    borderColor: PremiumTokens.color.alertBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 20,
  },
  bannerWarnText: {
    color: DS.color.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  bannerInfo: {
    backgroundColor: PremiumTokens.color.neonSoft,
    borderColor: PremiumTokens.color.neonLine,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  bannerInfoText: {
    color: DS.color.greenEnd,
    fontSize: 13,
    lineHeight: 18,
  },
  cta: {
    marginTop: 8,
    borderRadius: DS.radius.button,
    overflow: 'hidden',
    ...DS.shadow.greenGlow,
  },
  ctaDisabled: { opacity: 0.7 },
  ctaGrad: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0A0A0A',
    letterSpacing: 0.2,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 28,
  },
  footerMuted: { color: PremiumTokens.color.textMuted, fontSize: 14 },
  footerLink: { color: DS.color.greenEnd, fontSize: 14, fontWeight: '700' },
});
