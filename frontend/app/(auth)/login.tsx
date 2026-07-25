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
import { Link, Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DS, PremiumTokens } from '@/constants/premiumTheme';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function LoginScreen() {
  const { signIn, isAuthenticated, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ready && isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  const onSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await signIn(email, password);
      if (!res.ok) setError(res.message);
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
            <Text style={styles.title}>Zaloguj się</Text>
            <Text style={styles.sub}>
              Dostęp do magazynu, menu i kredytów AI Twojej restauracji.
            </Text>

            {!isSupabaseConfigured && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  Brak konfiguracji Supabase. Uzupełnij EXPO_PUBLIC_SUPABASE_URL oraz
                  EXPO_PUBLIC_SUPABASE_ANON_KEY w frontend/.env.
                </Text>
              </View>
            )}

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
              testID="login-email"
            />

            <Text style={styles.label}>Hasło</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={PremiumTokens.color.textFaint}
              editable={!busy}
              testID="login-password"
              onSubmitEditing={() => void onSubmit()}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.cta, busy && styles.ctaDisabled]}
              onPress={() => void onSubmit()}
              disabled={busy}
              activeOpacity={0.85}
              testID="login-submit"
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
                  <Text style={styles.ctaText}>Zaloguj</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <Text style={styles.footerMuted}>Nie masz konta?</Text>
              <Link href="/(auth)/register" asChild>
                <TouchableOpacity disabled={busy}>
                  <Text style={styles.footerLink}>Zarejestruj się</Text>
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
    paddingTop: 48,
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
    maxWidth: 340,
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
  banner: {
    backgroundColor: PremiumTokens.color.warningSoft,
    borderColor: PremiumTokens.color.warning,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 20,
  },
  bannerText: {
    color: PremiumTokens.color.warning,
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
