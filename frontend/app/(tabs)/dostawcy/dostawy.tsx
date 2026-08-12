/**
 * Stara ścieżka /(tabs)/dostawcy/dostawy → Lokalni Przetwórcy (Dostawy są tam wewnątrz).
 */
import { Redirect } from 'expo-router';

export default function DostawyRedirect() {
  return <Redirect href="/(tabs)/dostawcy/lokalni-przetworcy" />;
}
