/**
 * Route: /(tabs)/dostawcy/producent/[id]
 */
import { Redirect } from 'expo-router';
import { LOCAL_PRODUCERS_MODULE } from '@/types/localProducers';
import ProducerDetailScreen from '@/screens/localProducers/ProducerDetailScreen';

export default function ProducerDetailRoute() {
  if (!LOCAL_PRODUCERS_MODULE.enabled) {
    return <Redirect href="/(tabs)/dostawcy" />;
  }
  return <ProducerDetailScreen />;
}
