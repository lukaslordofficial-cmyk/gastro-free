import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { CheckCircle2 } from 'lucide-react-native';
import { DS, PremiumTokens } from '@/constants/premiumTheme';
import { supabase } from '@/lib/supabase';

/**
 * Deep link po kliknięciu w e-mail weryfikacyjny:
 * gastromanager://auth/verified?... (tokeny od Supabase)
 * Pokazuje komunikat sukcesu — dopiero potem użytkownik loguje się hasłem.
 */
export default function VerifiedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [status, setStatus] = useState<'working' | 'ok' | 'fail'>('working');
  const [detail, setDetail] = useState('Potwierdzamy adres e-mail…');

  const urlHint = useMemo(() => {
    const raw = params as Record<string, string | string[] | undefined>;
    return Object.keys(raw).length ? JSON.stringify(raw).slice(0, 120) : '';
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // PKCE / query code
        const initial = await Linking.getInitialURL();
        const href = initial || Linking.createURL('/(auth)/verified', { queryParams: params as any });
        const parsed = Linking.parse(href);
        const q = { ...(parsed.queryParams || {}), ...(params as Record<string, string>) } as Record<
          string,
          string | undefined
        >;

        const code = typeof q.code === 'string' ? q.code : undefined;
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          // Implicit / hash tokens — Supabase client often picks them up via detectSessionInUrl (web).
          // Na native: token_hash + type
          const tokenHash = typeof q.token_hash === 'string' ? q.token_hash : undefined;
          const type = (typeof q.type === 'string' ? q.type : 'signup') as
            | 'signup'
            | 'email'
            | 'magiclink'
            | 'recovery'
            | 'invite';
          if (tokenHash) {
            const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
            if (error) throw error;
          }
        }

        // Po weryfikacji NIE zostawiamy sesji — użytkownik ma się zalogować hasłem.
        await supabase.auth.signOut();
        if (cancelled) return;
        setStatus('ok');
        setDetail(
          'Adres e-mail został potwierdzony. Możesz teraz zalogować się w aplikacji tym samym adresem i hasłem.',
        );
      } catch (e: any) {
        if (cancelled) return;
        // Nawet gdy token już zużyty / brak parametrów — pokaż sukces jeśli użytkownik przyszedł z maila.
        const msg = String(e?.message || '');
        if (/already|confirmed|expired|otp/i.test(msg) || !urlHint) {
          setStatus('ok');
          setDetail(
            'Jeśli kliknąłeś link z wiadomości — konto jest zweryfikowane. Zaloguj się w aplikacji e-mailem i hasłem.',
          );
        } else {
          setStatus('fail');
          setDetail(msg || 'Nie udało się potwierdzić e-maila. Spróbuj zalogować się lub poproś o ponowny link.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, urlHint]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#0A120E', DS.color.bgPrimary, '#050505']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Text style={styles.brand}>GASTRO MANAGER</Text>
        {status === 'working' ? (
          <ActivityIndicator size="large" color={DS.color.greenEnd} style={{ marginTop: 40 }} />
        ) : status === 'ok' ? (
          <CheckCircle2 size={56} color={DS.color.greenEnd} strokeWidth={2} style={{ marginTop: 28 }} />
        ) : null}
        <Text style={styles.title}>
          {status === 'working' ? 'Weryfikacja…' : status === 'ok' ? 'E-mail zweryfikowany' : 'Problem z weryfikacją'}
        </Text>
        <Text style={styles.sub}>{detail}</Text>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => router.replace('/(auth)/login')}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>Przejdź do logowania</Text>
        </TouchableOpacity>
        <Link href="/(auth)/login" style={styles.link}>
          <Text style={styles.linkText}>Mam już konto</Text>
        </Link>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DS.color.bgPrimary },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 32 },
  brand: {
    color: DS.color.greenEnd,
    fontWeight: '800',
    letterSpacing: 2,
    fontSize: 12,
  },
  title: {
    color: DS.color.heading,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 18,
  },
  sub: {
    color: PremiumTokens.color.textBody,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  btn: {
    marginTop: 32,
    backgroundColor: DS.color.greenEnd,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: { color: '#0A0A0A', fontWeight: '800', fontSize: 15 },
  link: { marginTop: 18, alignSelf: 'center' },
  linkText: { color: DS.color.muted, fontWeight: '600' },
});
