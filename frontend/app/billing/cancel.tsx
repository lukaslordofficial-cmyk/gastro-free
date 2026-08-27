import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

export default function BillingCancelScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/(tabs)/ustawienia');
  }, [router]);
  return <View style={{ flex: 1, backgroundColor: '#0A120E' }} />;
}
