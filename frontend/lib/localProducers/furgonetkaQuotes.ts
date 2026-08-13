import { getAccountKey } from '@/lib/accountKey';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

export type FurgonetkaQuote = {
  service_id: number | string;
  service: string;
  name: string;
  available: boolean;
  price_gross: number | null;
  price_net?: number | null;
  error?: string | null;
  source?: string;
};

export type CourierQuotesResult = {
  ok: boolean;
  source?: string;
  weight_kg: number;
  width_cm: number;
  height_cm: number;
  depth_cm: number;
  parcels?: number;
  quotes: FurgonetkaQuote[];
  cheapest?: FurgonetkaQuote | null;
  note?: string;
  message?: string;
};

export type CourierQuoteItem = {
  quantity: number;
  unit?: string | null;
  weight_g?: number | null;
  product_id?: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Account-Key': getAccountKey(),
  };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  return headers;
}

export async function fetchCourierQuotes(input: {
  producerId: string;
  items: CourierQuoteItem[];
  receiverName?: string;
  receiverPhone?: string;
  street: string;
  buildingNumber?: string;
  city: string;
  postCode: string;
  widthCm?: number;
  heightCm?: number;
  depthCm?: number;
}): Promise<CourierQuotesResult> {
  if (!BACKEND_URL) {
    return { ok: false, weight_kg: 0, width_cm: 0, height_cm: 0, depth_cm: 0, quotes: [], message: 'Brak backendu.' };
  }
  const res = await fetch(`${BACKEND_URL}/api/local-producers/courier-quotes`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      producer_id: input.producerId,
      items: input.items,
      receiver_name: input.receiverName,
      receiver_phone: input.receiverPhone,
      street: input.street,
      building_number: input.buildingNumber,
      city: input.city,
      post_code: input.postCode,
      width_cm: input.widthCm,
      height_cm: input.heightCm,
      depth_cm: input.depthCm,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      weight_kg: 0,
      width_cm: input.widthCm || 0,
      height_cm: input.heightCm || 0,
      depth_cm: input.depthCm || 0,
      quotes: [],
      message: typeof data.detail === 'string' ? data.detail : `Błąd wyceny (${res.status})`,
    };
  }
  return {
    ok: true,
    source: data.source,
    weight_kg: Number(data.weight_kg) || 0,
    width_cm: Number(data.width_cm) || 0,
    height_cm: Number(data.height_cm) || 0,
    depth_cm: Number(data.depth_cm) || 0,
    parcels: Number(data.parcels) || 1,
    quotes: Array.isArray(data.quotes) ? data.quotes : [],
    cheapest: data.cheapest || null,
    note: data.note,
  };
}
