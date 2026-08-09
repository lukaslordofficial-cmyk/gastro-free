/**
 * Formatowanie pól logistyki producenta (shipping_days, adres).
 */
import type { LocalProducer, ProducerShippingDays } from '@/types/localProducers';

const DAY_LABELS: Record<string, string> = {
  pon: 'Pon',
  wt: 'Wt',
  sr: 'Śr',
  czw: 'Czw',
  pt: 'Pt',
  sob: 'Sob',
  nd: 'Nd',
  mon: 'Pon',
  tue: 'Wt',
  wed: 'Śr',
  thu: 'Czw',
  fri: 'Pt',
  sat: 'Sob',
  sun: 'Nd',
  '0': 'Nd',
  '1': 'Pon',
  '2': 'Wt',
  '3': 'Śr',
  '4': 'Czw',
  '5': 'Pt',
  '6': 'Sob',
};

export function formatShippingDays(days: ProducerShippingDays | undefined): string {
  if (!days) return 'Brak danych o dniach wysyłki';
  if (Array.isArray(days)) {
    if (!days.length) return 'Brak danych o dniach wysyłki';
    return days.map((d) => DAY_LABELS[String(d).toLowerCase()] || String(d)).join(', ');
  }
  const active = Object.entries(days)
    .filter(([, v]) => !!v)
    .map(([k]) => DAY_LABELS[k.toLowerCase()] || k);
  return active.length ? active.join(', ') : 'Brak danych o dniach wysyłki';
}

export function formatProducerAddress(p: LocalProducer): string {
  const line1 = [p.address, p.postal_code].filter(Boolean).join(', ');
  const line2 = [p.city, p.county, p.voivodeship].filter(Boolean).join(', ');
  return [line1, line2].filter(Boolean).join('\n') || 'Adres nieuzupełniony';
}

/** HARD RULE marketplace — czy restauracja może widzieć producenta. */
export function isMarketplaceVisibleProducer(p: Partial<LocalProducer> | null | undefined): boolean {
  if (!p) return false;
  if (p.archived_at) return false;
  if (p.active !== true) return false;
  if (p.verified !== true) return false;
  const connectId = String(p.stripe_connect_id || p.stripe_account_id || '').trim();
  if (!connectId.startsWith('acct_')) return false;
  const status = String(p.verification_status || '').toLowerCase();
  // Jeśli kolumna jeszcze nie istnieje w starym wierszu — wymagaj verified+active+Connect
  if (!status) return true;
  return status === 'approved';
}
