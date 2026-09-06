/**
 * Lista SKU z POS bez mapowania na menu — UPSERT z webhooka.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { RefreshCw, Link2 } from 'lucide-react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { supabase } from '@/lib/supabase';
import { settingsScreenStyles as styles } from '@/components/settings/settingsScreenStyles';

export type UnmappedPosRow = {
  id: string;
  pos_sku: string;
  dish_name_hint: string | null;
  occurrence_count: number;
  last_seen: string;
};

type Props = {
  accountKey: string;
  onAssignHint?: (sku: string) => void;
};

export function UnmappedPosItemsCard({ accountKey, onAssignHint }: Props) {
  const theme = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<UnmappedPosRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !accountKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from('unmapped_pos_items')
        .select('id,pos_sku,dish_name_hint,occurrence_count,last_seen')
        .eq('account_key', accountKey)
        .order('last_seen', { ascending: false })
        .limit(40);
      if (qErr) {
        // Tabela jeszcze nie istnieje — cicho
        if (/does not exist|PGRST|schema cache/i.test(qErr.message || '')) {
          setRows([]);
          setError(null);
        } else {
          setError(qErr.message);
        }
      } else {
        setRows((data as UnmappedPosRow[]) || []);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Błąd odczytu');
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase || !accountKey) return;
    const channel = supabase
      .channel(`unmapped_pos_${accountKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'unmapped_pos_items',
          filter: `account_key=eq.${accountKey}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [accountKey, load]);

  if (!rows.length && !error && !loading) return null;

  return (
    <View
      style={[
        styles.card,
        theme.isPremium && { backgroundColor: theme.card, borderColor: theme.border },
        { marginBottom: 12 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary, marginBottom: 0 }]}>
          Do przypisania z POS
        </Text>
        <TouchableOpacity onPress={() => void load()} hitSlop={10} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <RefreshCw size={16} color={theme.textSecondary} strokeWidth={2.2} />
          )}
        </TouchableOpacity>
      </View>
      <Text style={[styles.fieldHint, { color: theme.textMuted, marginTop: 6 }]}>
        Wykryliśmy sprzedaż tych kodów z kasy — kliknij, żeby wpisać ten SKU przy daniu w mapowaniu.
      </Text>
      {error ? (
        <Text style={[styles.fieldHint, { color: theme.danger, marginTop: 8 }]}>{error}</Text>
      ) : null}
      {rows.map((r) => (
        <TouchableOpacity
          key={r.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            marginTop: 10,
            paddingVertical: 8,
            borderTopWidth: 1,
            borderTopColor: theme.isPremium ? theme.border : '#E2E8F0',
          }}
          onPress={() => onAssignHint?.(r.pos_sku)}
          activeOpacity={0.8}
        >
          <Link2 size={16} color={theme.accent} strokeWidth={2.2} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>{r.pos_sku}</Text>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
              {r.dish_name_hint || 'bez nazwy'} · ×{r.occurrence_count}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}
