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
  Modal,
} from 'react-native';
import { Link, Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DS, PremiumTokens } from '@/constants/premiumTheme';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function LoginScreen() {
  const { signIn, resetPassword, isAuthenticated, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  if (ready && isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  const onSubmit = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await signIn(email, password);
      if (!res.ok) setError(res.message);
    } finally {
      setBusy(false);
    }
  };

  const openForgot = () => {
    setForgotError(null);
    setForgotEmail(email.trim());
    setForgotOpen(true);
  };

  const onSendReset = async () => {
    setForgotError(null);
    const target = forgotEmail.trim().toLowerCase();
    if (!target) {
      setForgotError('Podaj adres e-mail.');
      return;
    }
    setForgotBusy(true);
    try {
      const res = await resetPassword(target);
      if (!res.ok) {
        setForgotError(res.message);
        return;
      }
      setForgotOpen(false);
      setInfo(
        'Jeśli konto istnieje, wysłaliśmy link do ustawienia nowego hasła. Sprawdź skrzynkę, ustaw hasło na stronie, potem zaloguj się w aplikacji.',
      );
      setError(null);
    } finally {
      setForgotBusy(false);
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

            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={openForgot}
              disabled={busy || forgotBusy}
              testID="login-forgot-password"
            >
              <Text style={styles.forgotText}>Zapomniałem hasła</Text>
            </TouchableOpacity>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {info ? <Text style={styles.info}>{info}</Text> : null}

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

      <Modal
        visible={forgotOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !forgotBusy && setForgotOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reset hasła</Text>
            <Text style={styles.modalSub}>
              Podaj e-mail — wyślemy link do ustawienia nowego hasła (nie wysyłamy starego hasła).
            </Text>
            <Text style={styles.label}>E-mail</Text>
            <TextInput
              style={styles.input}
              value={forgotEmail}
              onChangeText={setForgotEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="nazwa@restauracja.pl"
              placeholderTextColor={PremiumTokens.color.textFaint}
              editable={!forgotBusy}
              testID="forgot-email"
            />
            {forgotError ? <Text style={styles.error}>{forgotError}</Text> : null}
            <TouchableOpacity
              style={[styles.cta, forgotBusy && styles.ctaDisabled]}
              onPress={() => void onSendReset()}
              disabled={forgotBusy}
              activeOpacity={0.85}
              testID="forgot-submit"
            >
              <LinearGradient
                colors={[...DS.gradient.green]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.ctaGrad}
              >
                {forgotBusy ? (
                  <ActivityIndicator color="#0A0A0A" />
                ) : (
                  <Text style={styles.ctaText}>Wyślij link</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setForgotOpen(false)}
              disabled={forgotBusy}
            >
              <Text style={styles.footerMuted}>Anuluj</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  forgotBtn: {
    alignSelf: 'flex-end',
    marginTop: -8,
    marginBottom: 12,
    paddingVertical: 4,
  },
  forgotText: {
    color: DS.color.greenEnd,
    fontSize: 13,
    fontWeight: '700',
  },
  error: {
    color: DS.color.danger,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    lineHeight: 18,
  },
  info: {
    color: DS.color.greenEnd,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: DS.color.bgSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    padding: 20,
  },
  modalTitle: {
    color: DS.color.heading,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalSub: {
    color: PremiumTokens.color.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  modalCancel: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
});
