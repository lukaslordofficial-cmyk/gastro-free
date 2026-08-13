import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { clearPendingLpCheckout } from '@/services/localProducers/checkoutClient';

export default function LpCancelScreen() {
  const router = useRouter();
  useEffect(() => {
    void clearPendingLpCheckout();
    router.replace('/(tabs)/dostawcy');
  }, [router]);
  return <View style={{ flex: 1, backgroundColor: '#0A120E' }} />;
}
