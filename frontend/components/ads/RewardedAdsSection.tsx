/**
 * Sekcja zakładki Finanse → Reklamy (portfel + przycisk rewarded / info w Expo Go).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { isAdsNativeSupported } from '@/lib/adsNative';
import { RewardedCreditsButton } from '@/components/ads/RewardedCreditsButton';

type Props = {
  testID?: string;
  onGranted?: (balance: number) => void;
};

export function RewardedAdsSection({ testID = 'panel-rewarded-credits', onGranted }: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const nativeAds = isAdsNativeSupported();
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const card = prem ? DS.color.surfaceCard : Colors.card;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const accent = prem ? DS.color.greenEnd : Colors.accent;

  return (
    <>
      <Text
        style={[
          styles.heading,
          { color: prem ? DS.color.heading : Colors.textSecondary },
        ]}
      >
        Kredyty AI za reklamy
      </Text>
      <Text style={[styles.lead, { color: muted }]}>
        Obejrzyj krótką reklamę, a na konto trafi +1 kredyt AI (dzienny limit).
      </Text>
      {nativeAds ? (
        <View style={styles.btnWrap}>
          <RewardedCreditsButton testID={testID} onGranted={onGranted} />
        </View>
      ) : (
        <View style={[styles.info, { backgroundColor: card, borderColor: border }]}>
          <Info size={18} color={accent} strokeWidth={2.2} />
          <Text style={[styles.infoText, { color: muted }]}>
            W Expo Go reklamy AdMob są wyłączone (brak modułu natywnego). Zainstaluj APK lub
            wersję ze sklepu — tam pojawi się przycisk „Obejrzyj reklamę”.
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  lead: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  btnWrap: { marginBottom: 12 },
  info: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
});
