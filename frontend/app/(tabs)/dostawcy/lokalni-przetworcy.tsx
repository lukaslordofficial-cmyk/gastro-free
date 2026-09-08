/**
 * Route: /(tabs)/dostawcy/lokalni-przetworcy
 * Marketplace lokalnych dystrybutorów — w tej wersji ukryty (redirect).
 */
import { Redirect } from 'expo-router';
import { LOCAL_PRODUCERS_MODULE } from '@/types/localProducers';
import LocalProducersScreen from '@/screens/localProducers/LocalProducersScreen';

export default function LokalniPrzetworcyRoute() {
  if (!LOCAL_PRODUCERS_MODULE.enabled) {
    return <Redirect href="/(tabs)/dostawcy" />;
  }
  return <LocalProducersScreen />;
}
