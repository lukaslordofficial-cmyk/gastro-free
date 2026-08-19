import React from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Wallet, Crown, Zap, ChevronRight, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAppTheme } from '@/hooks/useAppTheme';
import { formatTrialDaysLeft, trialDaysRemaining } from '@/lib/subscriptionClient';

type Props = {
  onPress?: () => void;
  /** @deprecated — reklamy za kredyty usunięte */
  showRewardedButton?: boolean;
  testID?: string;
};

export function CreditsWalletCard({ onPress, testID = 'wallet-widget' }: Props) {
  const { state: data, loading } = useSubscription();
  const theme = useAppTheme();

  if (loading && !data) {
    return (
      <View style={[styles.wrap, styles.center]} testID={`${testID}-loading`}>
        <ActivityIndicator size="small" color={Colors.accent} />
      </View>
    );
  }

  if (!data || !data.ok) {
    if (data?.load_error) {
      return (
        <View style={[styles.wrap, styles.errorBox]} testID={`${testID}-error`}>
          <AlertCircle size={18} color={Colors.danger} strokeWidth={2.2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.errorTitle}>Portfel niedostępny</Text>
            <Text style={styles.errorText}>{data.message ?? 'Sprawdź migrację Supabase.'}</Text>
          </View>
        </View>
      );
    }
    return null;
  }

  const low = data.credits_balance <= 0;
  const periodEnd = data.current_period_end
    ? new Date(data.current_period_end).toLocaleDateString('pl-PL')
    : null;
  const trialDays = data.trial_active ? trialDaysRemaining(data.trial_ends_at) : null;
  const trialLabel = data.trial_active ? formatTrialDaysLeft(trialDays) : null;

  const inner = (
    <>
      <View style={styles.row}>
        <View style={styles.iconBox}>
          {data.tier_level >= 2
            ? <Crown size={16} color="#0A0A0A" strokeWidth={2.2} />
            : <Wallet size={16} color="#0A0A0A" strokeWidth={2.2} />}
        </View>
        <View style={styles.mainCol}>
          <Text style={styles.planLabel} allowFontScaling={false}>Twój plan</Text>
          <Text style={styles.planName} numberOfLines={1} allowFontScaling={false}>{data.tier_name}</Text>
        </View>
        <View style={styles.creditsCol}>
          <Text style={styles.creditsVal} testID="credits-balance" allowFontScaling={false}>
            {data.credits_balance}
          </Text>
          <Text style={styles.creditsUnit} allowFontScaling={false}>kredytów</Text>
        </View>
        {data.status === 'canceled' && <Text style={styles.canceledBadge}>Anulowana</Text>}
        {onPress && <ChevronRight size={18} color="rgba(10,10,10,0.45)" strokeWidth={2.2} />}
      </View>

      {low && (
        <View style={styles.lowWarn}>
          <Zap size={12} color={Colors.danger} strokeWidth={2.4} />
          <Text style={styles.lowWarnText}>Brak kredytów — AI zablokowane.</Text>
        </View>
      )}
      {trialLabel ? (
        <Text style={styles.trialText} testID="trial-days-left">
          {trialLabel}
        </Text>
      ) : null}
      {periodEnd && data.status === 'active' && data.tier_level >= 1 && (
        <Text style={styles.periodText}>Doładowanie: {periodEnd}</Text>
      )}
    </>
  );

  if (theme.isPremium) {
    const card = (
      <LinearGradient
        colors={[...DS.gradient.green]}
        start={{ x: 0, y: 0.15 }}
        end={{ x: 1, y: 0.85 }}
        style={styles.gradCard}
      >
        {inner}
      </LinearGradient>
    );
    if (onPress) {
      return (
        <TouchableOpacity style={[styles.wrap, styles.glowWrap]} onPress={onPress} activeOpacity={0.88} testID={testID}>
          {card}
        </TouchableOpacity>
      );
    }
    return (
      <View style={[styles.wrap, styles.glowWrap]} testID={testID}>
        {card}
      </View>
    );
  }

  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.wrap, styles.wallet, data.tier_level >= 2 && styles.walletPro]}
        onPress={onPress}
        activeOpacity={0.88}
        testID={testID}
      >
        {inner}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.wrap, styles.wallet, data.tier_level >= 2 && styles.walletPro]} testID={testID}>
      {inner}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, marginBottom: 4 },
  center: { paddingVertical: 20, alignItems: 'center' },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#FEF2F2', borderRadius: 16, borderWidth: 1, borderColor: '#FECACA', padding: 14,
  },
  errorTitle: { fontSize: 13, fontWeight: '800', color: Colors.danger, marginBottom: 3 },
  errorText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  glowWrap: { borderRadius: 16, ...DS.shadow.greenGlow },
  gradCard: { borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  wallet: { backgroundColor: '#059669', borderRadius: 16, padding: 14 },
  walletPro: { backgroundColor: '#00E676' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.16)', alignItems: 'center', justifyContent: 'center',
  },
  mainCol: { flex: 1, minWidth: 0 },
  planLabel: {
    fontSize: 9, color: 'rgba(10,10,10,0.55)', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  planName: { fontSize: 14, fontWeight: '900', color: '#0A0A0A', marginTop: 1 },
  creditsCol: { alignItems: 'flex-end' },
  creditsVal: { fontSize: 20, fontWeight: '900', color: '#0A0A0A', letterSpacing: -0.4 },
  creditsUnit: { fontSize: 10, color: 'rgba(10,10,10,0.6)', fontWeight: '600' },
  canceledBadge: {
    fontSize: 10, fontWeight: '700', color: '#7F1D1D',
    backgroundColor: 'rgba(254,226,226,0.9)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  lowWarn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
    backgroundColor: 'rgba(220,38,38,0.18)', borderRadius: 8, padding: 8,
  },
  lowWarnText: { flex: 1, fontSize: 11, color: '#7F1D1D', fontWeight: '600' },
  trialText: {
    fontSize: 11,
    color: 'rgba(10,10,10,0.72)',
    marginTop: 8,
    fontWeight: '700',
  },
  periodText: { fontSize: 10, color: 'rgba(10,10,10,0.55)', marginTop: 6, fontWeight: '600' },
});
