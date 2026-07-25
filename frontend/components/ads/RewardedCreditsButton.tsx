import React, { useState } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, View } from 'react-native';
import { PlayCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAds } from '@/contexts/AdsProvider';
import { REWARDED_DAILY_LIMIT } from '@/lib/adConfig';

type Props = { compact?: boolean; testID?: string };

export function RewardedCreditsButton({ compact, testID = 'rewarded-credits-btn' }: Props) {
  const { hasAds, addRewardCredit } = useSubscription();
  const { showRewarded, canShowRewarded, rewardedViewsToday, nativeAvailable } = useAds();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!hasAds) return null;

  const onPress = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (!nativeAvailable) {
        setMsg('Reklamy wymagają buildu natywnego (nie działają w Expo Go).');
        return;
      }
      if (!canShowRewarded) {
        setMsg(`Limit ${REWARDED_DAILY_LIMIT} wideo/dzień wykorzystany.`);
        return;
      }
      const earned = await showRewarded();
      if (earned) {
        await addRewardCredit();
        setMsg('+1 kredyt AI dodany!');
      } else {
        setMsg('Nie udało się odebrać nagrody. Spróbuj ponownie.');
      }
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3500);
    }
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.btn, compact && styles.btnCompact]}
        onPress={onPress}
        disabled={busy}
        activeOpacity={0.85}
        testID={testID}
      >
        {busy
          ? <ActivityIndicator size="small" color={Colors.white} />
          : <PlayCircle size={16} color={Colors.white} strokeWidth={2.2} />}
        <Text style={styles.btnText}>
          {compact ? 'Wideo +1 kr.' : 'Obejrzyj krótkie wideo (+1 Kredyt AI)'}
        </Text>
      </TouchableOpacity>
      <Text style={styles.meta}>
        {rewardedViewsToday}/{REWARDED_DAILY_LIMIT} wideo dziś
      </Text>
      {!!msg && <Text style={styles.msg}>{msg}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 4 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#7C3AED', borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14,
  },
  btnCompact: { paddingVertical: 9 },
  btnText: { color: Colors.white, fontWeight: '800', fontSize: 13 },
  meta: { fontSize: 11, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
  msg: { fontSize: 11.5, color: '#C4B5FD', textAlign: 'center', fontWeight: '600' },
});
