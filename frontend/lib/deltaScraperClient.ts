import { fetchJson } from '@/lib/safeFetch';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim();

export interface ScrapeTarget {
  id: string;
  url: string;
  supplier_id: string | null;
  label: string | null;
  fetch_mode: 'httpx' | 'playwright' | 'auto';
  css_selector: string | null;
  check_interval_hours: number;
  is_active: boolean;
  content_hash: string | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  product_count: number;
  created_at: string;
}

export interface PriceAlert {
  id: string;
  target_id: string | null;
  supplier_id: string | null;
  url: string;
  change_type: string;
  product_name: string | null;
  details: Record<string, unknown>;
  detected_at: string;
}

export interface CatalogSyncResult {
  products_total?: number;
  visible_count?: number;
  hidden_count?: number;
  match_preview?: Array<{
    product: string;
    is_visible: boolean;
    matched_via?: string | null;
    matched_to?: string | null;
    score?: number;
  }>;
  warnings?: string[];
  error?: string;
  crawl?: {
    pages_crawled?: number;
    pages_with_products?: number;
    products_merged?: number;
    fetch_errors?: number;
    seed_url?: string;
  };
}

export interface CheckResultItem {
  target_id: string;
  url: string;
  changed: boolean;
  skipped_hash?: boolean;
  product_count?: number;
  new_product_count?: number;
  catalog_sync?: CatalogSyncResult | null;
  error?: string;
}

/** Krótki opis synchronizacji z katalogiem dostawcy (magazyn/menu). */
export function formatCatalogSyncSummary(sync?: CatalogSyncResult | null): string {
  if (!sync) return '';
  if (sync.error) return `Katalog: błąd — ${sync.error}`;
  const visible = sync.visible_count ?? 0;
  const hidden = sync.hidden_count ?? 0;
  const total = sync.products_total ?? visible + hidden;
  const crawl = sync.crawl;
  const hits = (sync.match_preview ?? [])
    .filter((m) => m.is_visible)
    .slice(0, 3)
    .map((m) => m.matched_to || m.product)
    .filter(Boolean);
  const lines: string[] = [];
  if (crawl?.pages_crawled) {
    lines.push(
      `Przeszukano ${crawl.pages_crawled} stron`
        + (crawl.products_merged != null ? ` · ${crawl.products_merged} pozycji` : ''),
    );
  }
  let line = `Do katalogu: ${visible} widocznych (pasuje do magazynu/menu) z ${total} wykrytych`;
  if (hidden > 0) line += `, ${hidden} ukrytych`;
  lines.push(line);
  if (hits.length) lines.push(`np. ${hits.join(', ')}`);
  return lines.join('\n');
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BACKEND_URL) {
    throw new Error('Brak EXPO_PUBLIC_BACKEND_URL — ustaw adres backendu w frontend/.env (port 8001).');
  }
  const result = await fetchJson<T>(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/** Lista celów — najpierw backend, fallback Supabase (gdy API niedostępne). */
export async function listScrapeTargets(): Promise<{
  ok: boolean;
  targets: ScrapeTarget[];
  needs_migration?: boolean;
  warning?: string;
}> {
  try {
    return await api('/api/scraper/targets');
  } catch (e: unknown) {
    const { data, error } = await supabase
      .from('scrape_targets')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      if (/scrape_targets|does not exist|schema cache/i.test(error.message)) {
        return { ok: false, needs_migration: true, targets: [] };
      }
      throw new Error(
        (e instanceof Error ? e.message + ' · ' : '') + (error.message || 'Nie udało się wczytać stron.'),
      );
    }
    return {
      ok: true,
      targets: (data ?? []) as ScrapeTarget[],
      warning: e instanceof Error ? e.message : undefined,
    };
  }
}

export async function addScrapeTarget(payload: {
  url: string;
  supplier_id?: string | null;
  label?: string;
  check_interval_hours?: number;
}): Promise<{ ok: boolean; target: ScrapeTarget }> {
  const body = {
    url: payload.url.trim(),
    supplier_id: payload.supplier_id ?? null,
    label: payload.label ?? null,
    fetch_mode: 'auto' as const,
    css_selector: null,
    check_interval_hours: payload.check_interval_hours ?? 24,
  };

  try {
    return await api('/api/scraper/targets', { method: 'POST', body: JSON.stringify(body) });
  } catch (e: unknown) {
    // Fallback: zapis bezpośrednio do Supabase
    const { data, error } = await supabase
      .from('scrape_targets')
      .insert({
        url: body.url,
        supplier_id: body.supplier_id,
        label: body.label,
        fetch_mode: 'auto',
        is_active: true,
        check_interval_hours: body.check_interval_hours,
      })
      .select('*')
      .single();
    if (error) {
      if (/scrape_targets|does not exist|schema cache/i.test(error.message)) {
        throw new Error(
          'Brak tabel monitoringu. Uruchom w Supabase SQL: ADD_DELTA_SCRAPER.sql',
        );
      }
      if (/duplicate|unique/i.test(error.message)) {
        throw new Error('Ten adres URL jest już na liście monitoringu.');
      }
      throw new Error(
        (e instanceof Error ? `${e.message} · ` : '') + (error.message || 'Nie udało się dodać URL.'),
      );
    }
    return { ok: true, target: data as ScrapeTarget };
  }
}

export async function removeScrapeTarget(targetId: string): Promise<void> {
  try {
    await api(`/api/scraper/targets/${targetId}`, { method: 'DELETE' });
  } catch {
    const { error } = await supabase.from('scrape_targets').delete().eq('id', targetId);
    if (error) throw new Error(error.message);
  }
}

export async function checkAllTargets(force = false): Promise<{ ok: boolean; checked: number; results: CheckResultItem[] }> {
  return api('/api/scraper/check', { method: 'POST', body: JSON.stringify({ force }) });
}

export async function checkOneTarget(targetId: string, force = false): Promise<{ ok: boolean; result: CheckResultItem }> {
  return api(`/api/scraper/check/${targetId}?force=${force ? 'true' : 'false'}`, { method: 'POST' });
}

export async function listPriceAlerts(limit = 50, supplierId?: string): Promise<{ ok: boolean; alerts: PriceAlert[] }> {
  const q = supplierId ? `?limit=${limit}&supplier_id=${supplierId}` : `?limit=${limit}`;
  try {
    return await api(`/api/scraper/alerts${q}`);
  } catch {
    let query = supabase.from('price_alerts').select('*').order('detected_at', { ascending: false }).limit(limit);
    if (supplierId) query = query.eq('supplier_id', supplierId);
    const { data, error } = await query;
    if (error) return { ok: false, alerts: [] };
    return { ok: true, alerts: (data ?? []) as PriceAlert[] };
  }
}

export async function refreshCatalogVisibility(supplierId: string): Promise<{ ok: boolean; updated?: number }> {
  return api(`/api/suppliers/${supplierId}/refresh-catalog-visibility`, { method: 'POST' });
}

export function formatAlertSummary(alert: PriceAlert): string {
  const d = alert.details ?? {};
  if (typeof d.message === 'string' && d.message.trim()) {
    return d.message.trim();
  }
  switch (alert.change_type) {
    case 'price_drop':
      return `${alert.product_name ?? 'Produkt'}: ${d.before ?? d.price_before} → ${d.after ?? d.price_after} (${d.difference ?? 'spadek'})`;
    case 'price_rise':
      return `${alert.product_name ?? 'Produkt'}: wzrost ceny do ${d.after ?? d.price_after}`;
    case 'new_items':
      return d.summary ? String(d.summary) : `Nowy produkt: ${alert.product_name ?? '?'}`;
    case 'status_change':
      return `${alert.product_name ?? 'Produkt'}: ${d.before ?? '?'} → ${d.after ?? '?'}`;
    case 'removed_item':
      return `Usunięto z oferty: ${alert.product_name ?? '?'}`;
    default:
      return alert.product_name ?? alert.change_type;
  }
}

export async function deletePriceAlert(alertId: string): Promise<void> {
  try {
    await api(`/api/scraper/alerts/${alertId}`, { method: 'DELETE' });
  } catch {
    const { error } = await supabase.from('price_alerts').delete().eq('id', alertId);
    if (error) throw new Error(error.message);
  }
}
