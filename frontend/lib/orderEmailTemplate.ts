/**
 * Szablon e-mail zamówienia — ten sam co Łowca Okazji
 * (POST /api/orders/generate-messages + stopka asystenta).
 */

import { apiJsonHeaders } from '@/lib/apiHeaders';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

/** Notatki wewnętrzne koszyka — nie wysyłamy do dostawcy. */
export function isInternalOrderNote(notes?: string | null): boolean {
  const t = (notes || '').trim().toLowerCase();
  if (!t) return true;
  const markers = [
    'łowca okazji',
    'lowca okazji',
    'zapisane na później',
    'zapisane na pozniej',
    'na później',
    'na pozniej',
    '[internal]',
  ];
  return markers.some((m) => t.includes(m));
}

export type OrderEmailItem = {
  product_name: string;
  quantity: number;
  unit: string;
  line_total?: number;
  matched_name?: string;
};

export type GeneratedOrderEmail = {
  subject: string;
  body: string;
  html?: string;
  supplierEmail?: string;
};

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    if (!raw) return `Błąd serwera (${res.status})`;
    try {
      const j = JSON.parse(raw) as { detail?: unknown };
      if (typeof j.detail === 'string' && j.detail.trim()) return j.detail.trim();
    } catch {
      /* plain text */
    }
    return raw.slice(0, 280);
  } catch {
    return `Błąd serwera (${res.status})`;
  }
}

export async function fetchOrderEmailTemplate(opts: {
  supplierId?: string | null;
  supplierName: string;
  supplierEmail?: string | null;
  restaurantName?: string;
  notes?: string;
  items: OrderEmailItem[];
}): Promise<GeneratedOrderEmail> {
  if (!BACKEND_URL) {
    throw new Error('Brak EXPO_PUBLIC_BACKEND_URL — nie można wygenerować szablonu.');
  }
  const subtotal = opts.items.reduce((s, i) => s + (Number(i.line_total) || 0), 0);
  const notes = isInternalOrderNote(opts.notes) ? undefined : opts.notes?.trim() || undefined;
  const res = await fetch(`${BACKEND_URL}/api/orders/generate-messages`, {
    method: 'POST',
    headers: await apiJsonHeaders(),
    body: JSON.stringify({
      restaurant_name: opts.restaurantName ?? 'Nasza restauracja',
      notes,
      suppliers: [
        {
          supplier_id: opts.supplierId ?? undefined,
          supplier_name: opts.supplierName,
          supplier_email: opts.supplierEmail ?? undefined,
          subtotal_pln: Math.round(subtotal * 100) / 100,
          items: opts.items.map((i) => ({
            product_name: i.product_name,
            matched_name: i.matched_name || i.product_name,
            quantity: i.quantity,
            unit: i.unit,
            line_total: i.line_total ?? 0,
          })),
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(await readErrorDetail(res));
  }
  const data = await res.json();
  const msg = (data.messages ?? [])[0];
  if (!msg) throw new Error('Serwer nie zwrócił treści wiadomości.');
  return {
    subject: msg.email_subject || `Zamówienie towaru — ${opts.supplierName}`,
    body: msg.email_body_text ?? msg.email_text ?? '',
    html: msg.email_html,
    supplierEmail: msg.supplier_email ?? opts.supplierEmail ?? undefined,
  };
}
