import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { RefreshCw, CheckCircle2, AlertTriangle, Clock } from 'lucide-react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { apiJsonHeaders } from '@/lib/apiHeaders';
import { supabase } from '@/lib/supabase';
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

type ConnectionStatus = 'pending' | 'connected' | 'disconnected' | null;

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
export function PosSyncStatusCard({ accountKey }: { accountKey?: string }) {
  const theme = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(null);

  const loadConnection = useCallback(async () => {
    if (!supabase || !accountKey) return;
    try {
      const { data } = await supabase
        .from('pos_settings')
        .select('connection_status,is_connected,last_sync_at')
        .eq('account_key', accountKey)
        .maybeSingle();
      const row = data as {
        connection_status?: string;
        is_connected?: boolean;
      } | null;
      if (!row) {
        setConnectionStatus('pending');
        return;
      }
      const cs = (row.connection_status || '').toLowerCase();
      if (cs === 'connected' || cs === 'pending' || cs === 'disconnected') {
        setConnectionStatus(cs);
      } else {
        setConnectionStatus(row.is_connected ? 'connected' : 'pending');
      }
    } catch {
      /* kolumna może jeszcze nie istnieć */
    }
  }, [accountKey]);

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
      await loadConnection();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać statusu sync');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [loadConnection]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase || !accountKey) return;
    const channel = supabase
      .channel(`pos_settings_conn_${accountKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pos_settings',
          filter: `account_key=eq.${accountKey}`,
        },
        () => {
          void loadConnection();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [accountKey, loadConnection]);

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

      {connectionStatus ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
          {connectionStatus === 'connected' ? (
            <CheckCircle2 size={16} color={theme.accent} strokeWidth={2.2} />
          ) : (
            <Clock size={16} color={theme.textSecondary} strokeWidth={2.2} />
          )}
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', flex: 1 }}>
            {connectionStatus === 'connected'
              ? 'Połączono pomyślnie!'
              : connectionStatus === 'disconnected'
                ? 'Rozłączono'
                : 'Oczekiwanie na pierwszy sygnał z POS…'}
          </Text>
        </View>
      ) : null}

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
