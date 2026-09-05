import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { RefreshCw, CheckCircle2, AlertTriangle, Clock } from 'lucide-react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { apiJsonHeaders } from '@/lib/apiHeaders';
import { settingsScreenStyles as styles } from '@/components/settings/settingsScreenStyles';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

type SyncStatus = {
  ok?: boolean;
  synced?: boolean;
  migration_required?: boolean;
  message?: string;
  processed?: number;
  pending?: number;
  errors?: number;
  last_processed_at?: string | null;
  last_error?: string | null;
  sampled_events?: number;
};

function formatTs(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Status synchronizacji POS (idempotencja / kolejka / błędy) — panel w Ustawieniach. */
export function PosSyncStatusCard() {
  const theme = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!BACKEND_URL) {
      setError('Brak EXPO_PUBLIC_BACKEND_URL');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = await apiJsonHeaders();
      const res = await fetch(`${BACKEND_URL}/api/pos/sync/status`, { headers });
      const data = (await res.json().catch(() => ({}))) as SyncStatus;
      if (!res.ok) {
        setError(typeof data?.message === 'string' ? data.message : `HTTP ${res.status}`);
        setStatus(null);
      } else {
        setStatus(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać statusu sync');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const synced = !!status?.synced && !status?.migration_required;
  const pending = status?.pending ?? 0;
  const errors = status?.errors ?? 0;

  return (
    <View
      style={[
        styles.card,
        theme.isPremium && {
          backgroundColor: theme.card,
          borderColor: theme.border,
        },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary, marginBottom: 0 }]}>
          Synchronizacja POS
        </Text>
        <TouchableOpacity onPress={() => void load()} hitSlop={10} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <RefreshCw size={16} color={theme.textSecondary} strokeWidth={2.2} />
          )}
        </TouchableOpacity>
      </View>

      {error ? (
        <Text style={[styles.fieldHint, { color: theme.danger, marginTop: 8 }]}>{error}</Text>
      ) : null}

      {status?.migration_required ? (
        <Text style={[styles.fieldHint, { color: theme.warning, marginTop: 8 }]}>
          {status.message ||
            'Uruchom migrację ADD_POS_SYNC_EVENTS.sql w Supabase, aby włączyć dziennik zdarzeń.'}
        </Text>
      ) : null}

      {status && !status.migration_required ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {synced ? (
              <CheckCircle2 size={16} color={theme.accent} strokeWidth={2.2} />
            ) : errors > 0 ? (
              <AlertTriangle size={16} color={theme.warning} strokeWidth={2.2} />
            ) : (
              <Clock size={16} color={theme.textSecondary} strokeWidth={2.2} />
            )}
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', flex: 1 }}>
              {synced
                ? 'Dane zsynchronizowane'
                : errors > 0
                  ? 'Wystąpiły błędy synchronizacji'
                  : pending > 0
                    ? 'Trwa przetwarzanie zdarzeń'
                    : 'Brak ostatnich zdarzeń w próbce'}
            </Text>
          </View>

          <Text style={[styles.fieldHint, { color: theme.textMuted, marginTop: 0 }]}>
            Przetworzone: {status.processed ?? 0} · Oczekujące: {pending} · Błędy: {errors}
            {status.sampled_events != null ? ` · Próbka: ${status.sampled_events}` : ''}
          </Text>
          <Text style={[styles.fieldHint, { color: theme.textMuted, marginTop: 0 }]}>
            Ostatnie OK: {formatTs(status.last_processed_at)}
          </Text>
          {status.last_error ? (
            <Text style={[styles.fieldHint, { color: theme.danger, marginTop: 0 }]} numberOfLines={3}>
              Ostatni błąd: {status.last_error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
