/**
 * Realtime: gdy dystrybutor / Furgonetka ustawi shipment_status=shipped → lokalne powiadomienie.
 */
import { useEffect, useRef } from 'react';
import { getAccountKey } from '@/lib/accountKey';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { showDesktopOrLocalNow } from '@/lib/pushNotifications';

export function ProducerShipmentWatcher() {
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const accountKey = getAccountKey();
    if (!accountKey) return;

    const channel = supabase
      .channel(`lp-shipments-${accountKey}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'producer_orders',
          filter: `restaurant_account_key=eq.${accountKey}`,
        },
        (payload) => {
          const row = payload.new as {
            id?: string;
            shipment_status?: string;
            delivery_tracking?: string | null;
          } | null;
          if (!row?.id) return;
          const ship = String(row.shipment_status || '').toLowerCase();
          if (ship !== 'shipped') return;
          const key = `${row.id}:shipped`;
          if (seen.current.has(key)) return;
          seen.current.add(key);
          const tracking = (row.delivery_tracking || '').trim();
          const body = tracking
            ? `Kurier jest już w drodze. Numer przesyłki: ${tracking}. Zwykle doręczenie w 1–2 dni robocze.`
            : 'Kurier jest już w drodze. Zwykle doręczenie w 1–2 dni robocze.';
          void showDesktopOrLocalNow('Kurier w drodze', body);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
