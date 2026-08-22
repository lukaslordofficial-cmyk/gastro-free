/**
 * Otwiera pocztę z gotową wiadomością (adresat + temat + treść) dla KAŻDEGO dostawcy.
 * Portale bez API compose (Onet, WP, …) → mailto: (uniwersalny prefill) + schowek.
 * Gmail/Outlook/Yahoo → compose w przeglądarce gdy dostępne.
 */
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import {
  findMailProvider,
  hasKnownMailLogin,
  mailProviderLabel,
  type MailProvider,
} from '@/lib/mailProviders';

export type MailComposeInput = {
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
};

export type OpenMailResult = {
  opened: string;
  mode: 'browser' | 'app' | 'clipboard';
  providerLabel: string;
  /** true gdy treść też w schowku (wklejanie zapasowe). */
  copiedForPaste: boolean;
  /** Domena firmowa / nieznana. */
  corporateDomain?: boolean;
  /** Prefill przez mailto (portale bez web compose). */
  usedMailtoPrefill?: boolean;
};

export { mailProviderLabel, findMailProvider, hasKnownMailLogin } from '@/lib/mailProviders';

function enc(s: string): string {
  return encodeURIComponent(s);
}

function mailtoUrl(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${enc(subject)}&body=${enc(body)}`;
}

async function tryOpen(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

async function copyComposePayload(to: string, subject: string, body: string): Promise<void> {
  const text = `Do: ${to}\nTemat: ${subject}\n\n${body}`;
  await Clipboard.setStringAsync(text);
}

/**
 * Zawsze przygotowuje wiadomość: web compose URL albo mailto z to/temat/treść.
 * Kopiuje też do schowka jako zapas.
 */
export async function openMailInBrowser(input: MailComposeInput): Promise<OpenMailResult> {
  const from = (input.fromEmail || '').trim();
  const to = (input.to || '').trim();
  if (!to) throw new Error('Brak adresu odbiorcy.');
  const subject = input.subject || '';
  const body = input.body || '';
  const provider = findMailProvider(from);
  const label = provider?.label ?? mailProviderLabel(from);

  await copyComposePayload(to, subject, body);

  if (provider?.webComposeUrl) {
    const url = provider.webComposeUrl(to, subject, body);
    const ok = await tryOpen(url);
    if (!ok) throw new Error(`Nie udało się otworzyć ${label} w przeglądarce.`);
    return {
      opened: url,
      mode: 'browser',
      providerLabel: label,
      copiedForPaste: true,
    };
  }

  // Onet / WP / o2 / Interia / … — brak publicznego compose URL → mailto (gotowy szkic)
  const mail = mailtoUrl(to, subject, body);
  const ok = await tryOpen(mail);
  if (!ok) {
    return {
      opened: '',
      mode: 'clipboard',
      providerLabel: label,
      copiedForPaste: true,
      corporateDomain: !provider,
      usedMailtoPrefill: false,
    };
  }
  return {
    opened: mail,
    mode: 'app',
    providerLabel: label,
    copiedForPaste: true,
    corporateDomain: !provider,
    usedMailtoPrefill: true,
  };
}

/** Aplikacje pocztowe: deep-link dostawcy (jeśli jest) + mailto. */
export async function openMailInApp(input: MailComposeInput): Promise<OpenMailResult> {
  const from = (input.fromEmail || '').trim();
  const to = (input.to || '').trim();
  if (!to) throw new Error('Brak adresu odbiorcy.');
  const subject = input.subject || '';
  const body = input.body || '';
  const provider = findMailProvider(from);
  const label = provider?.label ?? 'aplikacji pocztowej';

  await copyComposePayload(to, subject, body);

  const candidates: string[] = [];
  if (provider?.appSchemes) {
    candidates.push(...provider.appSchemes(to, subject, body));
  }
  candidates.push(mailtoUrl(to, subject, body));

  for (const url of candidates) {
    try {
      const can = await Linking.canOpenURL(url);
      if (!can && !url.startsWith('mailto:')) continue;
      const ok = await tryOpen(url);
      if (ok) {
        return {
          opened: url,
          mode: 'app',
          providerLabel: label,
          copiedForPaste: true,
          usedMailtoPrefill: url.startsWith('mailto:'),
        };
      }
    } catch {
      /* kolejny kandydat */
    }
  }
  throw new Error('Nie udało się otworzyć aplikacji pocztowej.');
}

/** Tylko strona logowania portalu (bez prefill) — opcjonalny zapas po mailto. */
export async function openMailLoginOnly(fromEmail: string): Promise<OpenMailResult> {
  const provider = findMailProvider(fromEmail);
  if (!provider) {
    throw new Error('Brak strony logowania dla tej domeny — użyj aplikacji pocztowej.');
  }
  const ok = await tryOpen(provider.webInboxUrl);
  if (!ok) throw new Error(`Nie udało się otworzyć ${provider.label}.`);
  return {
    opened: provider.webInboxUrl,
    mode: 'browser',
    providerLabel: provider.label,
    copiedForPaste: false,
  };
}

export async function openMailCompose(input: MailComposeInput): Promise<OpenMailResult> {
  return openMailInBrowser(input);
}

export function providerSupportsWebPrefill(fromEmail: string): boolean {
  const p: MailProvider | null = findMailProvider(fromEmail);
  return !!(p && p.webComposeUrl);
}
