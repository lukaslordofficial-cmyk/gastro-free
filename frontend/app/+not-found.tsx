import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function NotFoundScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ session_id?: string }>();

  useEffect(() => {
    const sid = typeof params.session_id === 'string' ? params.session_id : '';
    if (sid.startsWith('cs_')) {
      router.replace({ pathname: '/lp/success', params: { session_id: sid } });
    }
  }, [params.session_id, router]);

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={styles.container}>
        <Text style={styles.text}>Ta karta nie istnieje.</Text>
        <Link href="/(tabs)/dostawcy" style={styles.link}>
          <Text>Wróć do Dostawców</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#0A120E',
  },
  text: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F5F5',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
});
