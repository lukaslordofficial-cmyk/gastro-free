import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { DS } from '@/constants/premiumTheme';

export function LoadingScreen() {
  const theme = useAppTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <ActivityIndicator size="large" color={theme.accent} />
      <Text style={[styles.text, { color: theme.textMuted }]}>Ładowanie danych...</Text>
    </View>
  );
}

export function ErrorScreen({ message }: { message: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <Text style={styles.errorEmoji}>⚠️</Text>
      <Text style={[styles.errorTitle, { color: theme.text }]}>Błąd połączenia</Text>
      <Text style={[styles.errorText, { color: theme.textMuted }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DS.color.bgPrimary,
    gap: 12,
    padding: 24,
  },
  text: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  errorEmoji: {
    fontSize: 36,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  errorText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
