/**
 * Deep link po Stripe Checkout: gastromanager:///billing/success?session_id=cs_…
 * Auto-potwierdza sesję (backend pyta Stripe) i odświeża portfel.
 */
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { confirmPendingCheckout } from '@/lib/billingClient';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useAuth } from '@/contexts/AuthContext';
import { isRealAccountKey } from '@/lib/tenantScope';

export default function BillingSuccessScreen() {
  const router = useRouter();
  const { refresh } = useSubscription();
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
      const conf = await confirmPendingCheckout(sid);
      try {
        await refresh();
      } catch {
        /* ignore */
      }
      if (conf.paid) {
        alert('Płatność potwierdzona', conf.message, [
          { text: 'OK', style: 'primary' },
        ]);
      } else if (conf.message) {
        alert('Płatność', conf.message, [{ text: 'OK', style: 'primary' }]);
      }
      router.replace('/(tabs)/');
    })();
  }, [accountKey, alert, params.session_id, refresh, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A120E' }}>
      <ActivityIndicator color="#00FF88" />
    </View>
  );
}
