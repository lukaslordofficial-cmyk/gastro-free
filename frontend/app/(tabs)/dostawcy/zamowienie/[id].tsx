/**
 * Route: /(tabs)/dostawcy/zamowienie/[id]
 */
import { Redirect } from 'expo-router';
import { LOCAL_PRODUCERS_MODULE } from '@/types/localProducers';
import ProducerOrderDetailScreen from '@/screens/localProducers/ProducerOrderDetailScreen';

export default function ProducerOrderDetailRoute() {
  if (!LOCAL_PRODUCERS_MODULE.enabled) {
    return <Redirect href="/(tabs)/dostawcy" />;
  }
  return <ProducerOrderDetailScreen />;
}
