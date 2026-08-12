/**
 * Realtime: invoice_url na producer_orders → push/in-app + deep link do zamówienia.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { getAccountKey } from '@/lib/accountKey';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { showDesktopOrLocalNow } from '@/lib/pushNotifications';

let Notifications: typeof import('expo-notifications') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

function invoiceUrlOf(row: Record<string, unknown> | null | undefined): string {
  if (!row) return '';
  return String(
    row.invoice_url || row.settlement_invoice_url || row.invoice_file_url || '',
  ).trim();
}

export function ProducerInvoiceWatcher() {
  const router = useRouter();
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const accountKey = getAccountKey();
    if (!accountKey) return;

    const channel = supabase
      .channel(`lp-invoices-${accountKey}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'producer_orders',
          filter: `restaurant_account_key=eq.${accountKey}`,
        },
        (payload) => {
          const prev = payload.old as Record<string, unknown> | null;
          const row = payload.new as Record<string, unknown> | null;
          if (!row?.id) return;
          const nextUrl = invoiceUrlOf(row);
          const prevUrl = invoiceUrlOf(prev);
          if (!nextUrl || prevUrl === nextUrl) return;

          const orderId = String(row.id);
          const key = `${orderId}:invoice`;
          if (seen.current.has(key)) return;
          seen.current.add(key);

          const producerName = String(
            (row as { producer_name?: string }).producer_name || 'lokalnego przetwórcy',
          );
          // Nazwę uzupełnimy asynchronicznie gdy brak w payloadzie
          void (async () => {
            let name = producerName;
            if (!row.producer_name && row.producer_id) {
              try {
                const { data } = await supabase
                  .from('local_producers')
                  .select('company_name')
                  .eq('id', String(row.producer_id))
                  .maybeSingle();
                if (data?.company_name) name = String(data.company_name);
              } catch {
                /* ignore */
              }
            }
            const shortId = orderId.slice(0, 8);
            const body =
              `📄 Pojawiła się faktura/rachunek od lokalnego przetwórcy ${name} ` +
              `za zamówienie #${shortId}. Kliknij, aby pobrać.`;
            await showDesktopOrLocalNow('Dokument rozliczeniowy', body, {
              type: 'lp_invoice',
              order_id: orderId,
              invoice_url: nextUrl,
            });
          })();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // Kliknięcie w powiadomienie → szczegóły zamówienia / faktury
  useEffect(() => {
    if (!Notifications) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data || {}) as {
        type?: string;
        order_id?: string;
        invoice_url?: string;
      };
      if (data.type === 'lp_invoice' && data.order_id) {
        // Zawsze szczegóły zamówienia — invoice_url bywa ``bucket:path``, nie HTTPS.
        router.push({
          pathname: '/(tabs)/dostawcy/zamowienie/[id]',
          params: { id: data.order_id },
        });
      }
    });
    return () => sub.remove();
  }, [router]);

  return null;
}
