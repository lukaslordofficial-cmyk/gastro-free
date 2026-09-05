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
import { validateRegisterShipping } from '@/lib/authVerify';

export default function RegisterScreen() {
  const { signUp, isAuthenticated, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [building, setBuilding] = useState('');
  const [city, setCity] = useState('');
  const [postCode, setPostCode] = useState('');
  const [nip, setNip] = useState('');
  const [regon, setRegon] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (ready && isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  const onSubmit = async () => {
    setError(null);
    setInfo(null);
    const shippingCheck = validateRegisterShipping({
      restaurantName,
      phone,
      street,
      building,
      city,
      postCode,
      nip,
      regon,
      contactEmail: email,
    });
    if (shippingCheck) {
      setError(shippingCheck);
      return;
    }
    setBusy(true);
    try {
      const res = await signUp(email, password, {
        restaurantName,
        phone,
        street,
        building,
        city,
        postCode,
        nip,
        regon,
        contactEmail: email,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setDone(true);
      setInfo(
        'Konto utworzone. Sprawdź skrzynkę e-mail i kliknij link weryfikacyjny — dopiero potem będzie można się zalogować w aplikacji.',
      );
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
              Uzupełnij dane lokalu i adres dostawy — użyjemy ich przy zamówieniach u producentów.
              Na start: 100 kredytów AI, 30 dni trialu Premium i własny magazyn / menu.
            </Text>

            {!isSupabaseConfigured && (
              <View style={styles.bannerWarn}>
                <Text style={styles.bannerWarnText}>
                  Brak konfiguracji Supabase w frontend/.env — rejestracja nie zadziała.
                </Text>
              </View>
            )}

            {done && info ? (
              <View style={styles.bannerInfo}>
                <Text style={styles.bannerInfoText}>{info}</Text>
                <Link href="/(auth)/login" asChild>
                  <TouchableOpacity style={styles.afterLink} disabled={busy}>
                    <Text style={styles.footerLink}>Przejdź do logowania</Text>
                  </TouchableOpacity>
                </Link>
              </View>
            ) : (
              <>
                <Text style={styles.section}>Konto</Text>

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
                />

                <Text style={styles.section}>Lokal i dostawy</Text>

                <Text style={styles.label}>Nazwa restauracji / lokalu</Text>
                <TextInput
                  style={styles.input}
                  value={restaurantName}
                  onChangeText={setRestaurantName}
                  placeholder="np. Bistro Zielone"
                  placeholderTextColor={PremiumTokens.color.textFaint}
                  editable={!busy}
                  testID="register-restaurant"
                />

                <Text style={styles.label}>Telefon do dostaw</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="+48 …"
                  placeholderTextColor={PremiumTokens.color.textFaint}
                  editable={!busy}
                  testID="register-phone"
                />

                <Text style={styles.label}>Ulica</Text>
                <TextInput
                  style={styles.input}
                  value={street}
                  onChangeText={setStreet}
                  placeholder="ul. Przykładowa"
                  placeholderTextColor={PremiumTokens.color.textFaint}
                  editable={!busy}
                  testID="register-street"
                />

                <Text style={styles.label}>Numer budynku / lokalu</Text>
                <TextInput
                  style={styles.input}
                  value={building}
                  onChangeText={setBuilding}
                  placeholder="np. 12A"
                  placeholderTextColor={PremiumTokens.color.textFaint}
                  editable={!busy}
                  testID="register-building"
                />

                <Text style={styles.label}>Kod pocztowy</Text>
                <TextInput
                  style={styles.input}
                  value={postCode}
                  onChangeText={setPostCode}
                  placeholder="00-000"
                  placeholderTextColor={PremiumTokens.color.textFaint}
                  editable={!busy}
                  autoCapitalize="none"
                  testID="register-postcode"
                />

                <Text style={styles.label}>Miasto</Text>
                <TextInput
                  style={styles.input}
                  value={city}
                  onChangeText={setCity}
                  placeholder="Warszawa"
                  placeholderTextColor={PremiumTokens.color.textFaint}
                  editable={!busy}
                  testID="register-city"
                />

                <Text style={styles.label}>NIP (opcjonalnie)</Text>
                <TextInput
                  style={styles.input}
                  value={nip}
                  onChangeText={setNip}
                  keyboardType="number-pad"
                  placeholder="10 cyfr"
                  placeholderTextColor={PremiumTokens.color.textFaint}
                  editable={!busy}
                  testID="register-nip"
                />

                <Text style={styles.label}>REGON (opcjonalnie)</Text>
                <TextInput
                  style={styles.input}
                  value={regon}
                  onChangeText={setRegon}
                  keyboardType="number-pad"
                  placeholder="9 lub 14 cyfr"
                  placeholderTextColor={PremiumTokens.color.textFaint}
                  editable={!busy}
                  testID="register-regon"
                  onSubmitEditing={() => void onSubmit()}
                />

                {error ? <Text style={styles.error}>{error}</Text> : null}

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
              </>
            )}

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
  section: {
    ...PremiumTokens.type.micro,
    color: DS.color.greenEnd,
    marginBottom: 12,
    marginTop: 8,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
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
    padding: 16,
    marginBottom: 12,
  },
  bannerInfoText: {
    color: DS.color.greenEnd,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  afterLink: { marginTop: 14, alignSelf: 'flex-start' },
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
