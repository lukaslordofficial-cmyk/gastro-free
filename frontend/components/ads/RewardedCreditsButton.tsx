/**
 * Rewarded Interstitial AdMob → +1 kredyt AI (backend claim / SSV).
 * Format jednostki: „Reklama pełnoekranowa z nagrodą” (RewardedInterstitialAd).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Play } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { pickAdUnit, REWARDED_DAILY_LIMIT } from '@/lib/adConfig';
import { loadAdsModule } from '@/lib/adsNative';
import { claimRewardCredit } from '@/lib/subscriptionClient';
import { isRealAccountKey } from '@/lib/tenantScope';

type Props = {
  compact?: boolean;
  testID?: string;
  onGranted?: (balance: number) => void;
};

type RewardedLike = {
  load: () => void;
  show: () => Promise<void>;
  loaded: boolean;
  addAdEventListener: (type: string, listener: (...args: unknown[]) => void) => () => void;
};

export function RewardedCreditsButton({
  compact,
  testID = 'rewarded-credits-btn',
  onGranted,
}: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const { accountKey } = useAuth();
  const { refresh } = useSubscription();
  const { alert } = usePremiumAlert();
  const adsMod = loadAdsModule();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const rewardedRef = useRef<RewardedLike | null>(null);
  const earnedRef = useRef(false);

  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const card = prem ? DS.color.surfaceCard : Colors.card;
  const border = prem ? DS.color.borderSubtle : Colors.border;

  const reloadAd = useCallback(() => {
    if (!adsMod || !isRealAccountKey(accountKey)) {
      setReady(false);
      return;
    }
    try {
      const {
        RewardedInterstitialAd,
        RewardedAd,
        RewardedAdEventType,
        AdEventType,
      } = adsMod as typeof adsMod & {
        RewardedInterstitialAd?: {
          createForAdRequest: (id: string, opts?: object) => RewardedLike;
        };
      };

      const Factory = RewardedInterstitialAd || RewardedAd;
      if (!Factory?.createForAdRequest) {
        setReady(false);
        return;
      }

      const ad = Factory.createForAdRequest(pickAdUnit('rewarded'), {
        serverSideVerificationOptions: {
          userId: accountKey,
          customData: accountKey,
        },
      });
      rewardedRef.current = ad;
      setReady(false);
      const unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => setReady(true));
      const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earnedRef.current = true;
      });
      const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
        void (async () => {
          if (!earnedRef.current) {
            setBusy(false);
            ad.load();
            return;
          }
          earnedRef.current = false;
          setBusy(true);
          try {
            const claim = await claimRewardCredit();
            await new Promise((r) => setTimeout(r, 1200));
            await refresh();
            if (claim.ok) {
              onGranted?.(claim.credits_balance);
              alert('Kredyt przyznany', claim.message, [{ text: 'OK', style: 'primary' }]);
            } else {
              alert('Reklama', claim.message, [{ text: 'OK', style: 'primary' }]);
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Nie udało się dodać kredytu.';
            alert('Błąd', msg, [{ text: 'OK', style: 'primary' }]);
          } finally {
            setBusy(false);
            ad.load();
          }
        })();
      });
      ad.load();
      return () => {
        unsubLoaded();
        unsubEarned();
        unsubClosed();
      };
    } catch (e) {
      if (__DEV__) console.warn('[ads] rewarded interstitial setup', e);
      setReady(false);
      return undefined;
    }
  }, [adsMod, accountKey, alert, onGranted, refresh]);

  useEffect(() => {
    const cleanup = reloadAd();
    return () => {
      cleanup?.();
      rewardedRef.current = null;
    };
  }, [reloadAd]);

  if (!adsMod || !isRealAccountKey(accountKey) || REWARDED_DAILY_LIMIT <= 0) {
    return null;
  }

  const onPress = async () => {
    if (busy) return;
    const ad = rewardedRef.current;
    if (!ad) {
      alert('Reklama', 'Moduł reklam niedostępny w tej kompilacji (wymagany build natywny).');
      return;
    }
    if (!ad.loaded && !ready) {
      ad.load();
      alert('Reklama', 'Ładujemy reklamę — spróbuj za chwilę.');
      return;
    }
    setBusy(true);
    try {
      earnedRef.current = false;
      await ad.show();
    } catch (e: unknown) {
      setBusy(false);
      const msg = e instanceof Error ? e.message : 'Nie udało się pokazać reklamy.';
      alert('Reklama', msg);
      ad.load();
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.btn,
        compact && styles.compact,
        { backgroundColor: card, borderColor: border, opacity: busy ? 0.7 : 1 },
      ]}
      onPress={() => void onPress()}
      disabled={busy}
      activeOpacity={0.88}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator color={accent} />
      ) : (
        <Play size={16} color={accent} strokeWidth={2.4} fill={accent} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.title, { color: text }]} numberOfLines={2}>
          Zyskaj darmowy kredyt AI (Obejrzyj reklamę)
        </Text>
        {!compact ? (
          <Text style={[styles.sub, { color: muted }]}>
            Po obejrzeniu wideo +1 kredyt · limit {REWARDED_DAILY_LIMIT}/dzień
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  compact: { paddingVertical: 10 },
  title: { fontSize: 13, fontWeight: '800' },
  sub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
});
