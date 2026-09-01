import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSubscription } from '@/contexts/SubscriptionContext';

export default function BillingPortalReturnScreen() {
  const router = useRouter();
  const { refresh } = useSubscription();

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch {
        /* ignore */
      }
      router.replace('/(tabs)/ustawienia');
    })();
  }, [refresh, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A120E' }}>
      <ActivityIndicator color="#00FF88" />
    </View>
  );
}
