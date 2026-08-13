/**
 * Deep link / Expo Go: exp://host/--/lp/success?session_id=cs_…
 */
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  LP_PAID_MESSAGE,
  LP_PAID_TITLE,
  claimOptimisticLpPaidAlert,
  tryConfirmPendingLpPayment,
} from '@/services/localProducers/checkoutClient';
import { usePremiumAlert } from '@/components/PremiumAlert';

export default function LpSuccessScreen() {
  const router = useRouter();
  const { alert } = usePremiumAlert();
  const params = useLocalSearchParams<{ session_id?: string }>();

  useEffect(() => {
    const sid = typeof params.session_id === 'string' ? params.session_id : undefined;
    void (async () => {
      const optimistic = await claimOptimisticLpPaidAlert(sid);
      if (optimistic.shouldShow) {
        alert(LP_PAID_TITLE, optimistic.message || LP_PAID_MESSAGE, [
          { text: 'OK', style: 'primary' },
        ]);
      }
      void tryConfirmPendingLpPayment({ sessionId: sid });
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/dostawcy');
    })();
  }, [alert, params.session_id, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A120E' }}>
      <ActivityIndicator color="#00FF88" />
    </View>
  );
}
