/**
 * Deep link / Expo Go: exp://host/--/lp/success?session_id=cs_…
 * gastromanager:///lp/success oraz gastromanager://lp/success (host=lp → /success).
 */
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  LP_PAID_MESSAGE,
  LP_PAID_TITLE,
  tryConfirmPendingLpPayment,
} from '@/services/localProducers/checkoutClient';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useAuth } from '@/contexts/AuthContext';
import { isRealAccountKey } from '@/lib/tenantScope';

export default function LpSuccessScreen() {
  const router = useRouter();
  const { alert } = usePremiumAlert();
  const { accountKey } = useAuth();
  const params = useLocalSearchParams<{ session_id?: string }>();
  const ran = useRef(false);

  useEffect(() => {
    if (!isRealAccountKey(accountKey)) return;
    if (ran.current) return;
    ran.current = true;
    const sid = typeof params.session_id === 'string' ? params.session_id : undefined;
    void (async () => {
      const conf = await tryConfirmPendingLpPayment({ sessionId: sid });
      if (conf.paid && conf.shouldShowPaidAlert) {
        alert(LP_PAID_TITLE, conf.message || LP_PAID_MESSAGE, [
          { text: 'OK', style: 'primary' },
        ]);
      }
      router.replace('/(tabs)/dostawcy');
    })();
  }, [accountKey, alert, params.session_id, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A120E' }}>
      <ActivityIndicator color="#00FF88" />
    </View>
  );
}
