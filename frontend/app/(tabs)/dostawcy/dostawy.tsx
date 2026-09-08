/**
 * Stara ścieżka /(tabs)/dostawcy/dostawy → Lokalni Przetwórcy (gdy włączone).
 */
import { Redirect } from 'expo-router';
import { LOCAL_PRODUCERS_MODULE } from '@/types/localProducers';

export default function DostawyRedirect() {
  if (!LOCAL_PRODUCERS_MODULE.enabled) {
    return <Redirect href="/(tabs)/dostawcy" />;
  }
  return <Redirect href="/(tabs)/dostawcy/lokalni-przetworcy" />;
}
