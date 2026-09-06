import { Alert } from 'react-native';
import { ASSISTANT_FROM_EMAIL } from '@/components/OrderEmailComposer';
import { stripAssistantOrderFooter } from '@/lib/orderEmailFooter';
import { openMailInBrowser } from '@/lib/openMailCompose';
import {
  checkSupplierMinOrder,
  minOrderAlertCopy,
} from '@/lib/supplierMinOrder';
import { readApiErrorMessage } from '@/components/dealHunter/apiErrors';
import type { MessageCard } from '@/components/dealHunter/types';

export type SendEmailResult = {
  key: string;
  supplierName: string;
  ok: boolean;
  error?: string;
  /** Otwarto zewnętrzną skrzynkę zamiast API Resend. */
  viaMailClient?: boolean;
};

type SendCtx = {
  backendUrl: string;
  apiHeaders: () => Promise<Record<string, string>>;
  toEmails: Record<string, string>;
  fromEmails: Record<string, string>;
  bodyText: Record<string, string>;
  subjectText: Record<string, string>;
};

export async function sendOneOrderEmail(
  m: MessageCard,
  ctx: SendCtx,
): Promise<SendEmailResult> {
  const key = m.supplier_id ?? m.supplier_name;
  const supplierName = m.supplier_name || 'Dostawca';
  const to = (ctx.toEmails[key] ?? m.supplier_email ?? '').trim();
  const from = (ctx.fromEmails[key] ?? ASSISTANT_FROM_EMAIL).trim() || ASSISTANT_FROM_EMAIL;
  const subject = (ctx.subjectText[key] ?? m.email_subject ?? '').trim() || m.email_subject;
  const body = ctx.bodyText[key] ?? m.email_body_text;

  if (!to) {
    return { key, supplierName, ok: false, error: 'Brak adresu e-mail odbiorcy.' };
  }

  if (m.supplier_id) {
    const check = await checkSupplierMinOrder({
      supplierId: m.supplier_id,
      subtotalPln: Number(m.subtotal_pln) || 0,
      supplierName: m.supplier_name,
    });
    if (!check.ok) {
      const copy = minOrderAlertCopy(check);
      return { key, supplierName, ok: false, error: copy.message };
    }
  }

  const usesAssistant = from.toLowerCase() === ASSISTANT_FROM_EMAIL.toLowerCase();
  const bodyToSend = usesAssistant ? body : stripAssistantOrderFooter(body);

  if (!usesAssistant) {
    try {
      await openMailInBrowser({ fromEmail: from, to, subject, body: bodyToSend });
      return { key, supplierName, ok: true, viaMailClient: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie otwarto klienta poczty.';
      return { key, supplierName, ok: false, error: msg };
    }
  }

  try {
    const res = await fetch(`${ctx.backendUrl}/api/orders/send-email`, {
      method: 'POST',
      headers: await ctx.apiHeaders(),
      body: JSON.stringify({
        to,
        subject,
        body_text: bodyToSend,
        from_email: ASSISTANT_FROM_EMAIL,
        supplier_name: m.supplier_name,
      }),
    });
    if (!res.ok) {
      const detail = await readApiErrorMessage(res, `Błąd wysyłki (${res.status})`);
      return { key, supplierName, ok: false, error: detail };
    }
    return { key, supplierName, ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Błąd sieci przy wysyłce.';
    return { key, supplierName, ok: false, error: msg };
  }
}

export function buildSendSummary(results: SendEmailResult[]): {
  title: string;
  message: string;
  allOk: boolean;
  anyOk: boolean;
} {
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const anyOk = ok.length > 0;
  const allOk = results.length > 0 && fail.length === 0;

  if (!results.length) {
    return { title: 'Brak wiadomości', message: 'Nie ma zamówień do wysyłki.', allOk: false, anyOk: false };
  }

  if (allOk) {
    return {
      title: 'Wiadomości wysłane',
      message:
        `Udało się wysłać ${ok.length} ${ok.length === 1 ? 'wiadomość' : 'wiadomości'} do dostawców.\n\n`
        + 'Zamówienia trafiły do Dostawcy → Zamówienia (Przygotowywane).\n'
        + 'Gdy odbierzesz dostawę, zaktualizuj magazyn skanem faktury albo „Odebrałem dostawę”.',
      allOk: true,
      anyOk: true,
    };
  }

  const failLines = fail.map((r) => `• ${r.supplierName}: ${r.error || 'nieznany błąd'}`);
  const okNote = ok.length
    ? `\n\nWysłano poprawnie (${ok.length}): ${ok.map((r) => r.supplierName).join(', ')}.`
      + '\nTe zamówienia przeniesiono do Przygotowywanych i usunięto z koszyka.'
    : '';

  return {
    title: ok.length ? 'Częściowo wysłane' : 'Wysyłka nieudana',
    message:
      `Nie wysłano (${fail.length}):\n${failLines.join('\n')}`
      + okNote
      + (fail.length ? '\n\nNieudane zostają w podglądzie — popraw i spróbuj ponownie.' : ''),
    allOk: false,
    anyOk,
  };
}

export function alertPrivateFromBatch(): void {
  Alert.alert(
    'Wysyłka po kolei',
    'Przy prywatnym nadawcy otwieramy skrzynkę osobno dla każdego dostawcy. '
      + 'Ustaw nadawcę na asystent.dostaw@gastromanager.org, aby wysłać wszystko naraz z poziomu aplikacji.',
  );
}
