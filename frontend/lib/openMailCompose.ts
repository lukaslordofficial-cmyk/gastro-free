/**
 * Otwiera pocztę: przeglądarka (wg domeny From) albo aplikacja / mailto.
 * Nie miesza Gmaila z innymi domenami — bez „domyślnego” klienta przy trybie przeglądarki.
 */
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import {
  findMailProvider,
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
  mode: 'browser' | 'app';
  providerLabel: string;
  /** true gdy web nie wspiera prefill — treść skopiowana do schowka. */
  copiedForPaste: boolean;
};

export { mailProviderLabel, findMailProvider } from '@/lib/mailProviders';

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
 * Przeglądarka: wyłącznie strona dostawcy z From (compose jeśli dostępne).
 * Nie używa mailto → nie otworzy przypadkowo Gmaila jako domyślnej aplikacji.
 */
export async function openMailInBrowser(input: MailComposeInput): Promise<OpenMailResult> {
  const from = (input.fromEmail || '').trim();
  const to = (input.to || '').trim();
  if (!to) throw new Error('Brak adresu odbiorcy.');
  const subject = input.subject || '';
  const body = input.body || '';
  const provider = findMailProvider(from);
  const label = provider?.label ?? mailProviderLabel(from);

  if (!provider) {
    await copyComposePayload(to, subject, body);
    const ok = await tryOpen('https://www.google.com/search?q=poczta+logowanie');
    if (!ok) throw new Error('Nie udało się otworzyć przeglądarki.');
    return {
      opened: 'https://www.google.com/search?q=poczta+logowanie',
      mode: 'browser',
      providerLabel: label,
      copiedForPaste: true,
    };
  }

  let copiedForPaste = false;
  let url: string;
  if (provider.webComposeUrl) {
    url = provider.webComposeUrl(to, subject, body);
  } else {
    await copyComposePayload(to, subject, body);
    copiedForPaste = true;
    url = provider.webInboxUrl;
  }

  const ok = await tryOpen(url);
  if (!ok) throw new Error(`Nie udało się otworzyć ${label} w przeglądarce.`);
  return { opened: url, mode: 'browser', providerLabel: label, copiedForPaste };
}

/**
 * Aplikacje pocztowe: deep-link dostawcy (jeśli jest) + mailto (wybór systemu).
 */
export async function openMailInApp(input: MailComposeInput): Promise<OpenMailResult> {
  const from = (input.fromEmail || '').trim();
  const to = (input.to || '').trim();
  if (!to) throw new Error('Brak adresu odbiorcy.');
  const subject = input.subject || '';
  const body = input.body || '';
  const provider = findMailProvider(from);
  const label = provider?.label ?? 'aplikacji pocztowej';

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
        return { opened: url, mode: 'app', providerLabel: label, copiedForPaste: false };
      }
    } catch {
      /* kolejny kandydat */
    }
  }
  throw new Error('Nie udało się otworzyć aplikacji pocztowej.');
}

/** Kompatybilność: najpierw przeglądarka dostawcy, bez mailto-fallbacku do Gmaila. */
export async function openMailCompose(input: MailComposeInput): Promise<OpenMailResult> {
  return openMailInBrowser(input);
}

export function providerSupportsWebPrefill(fromEmail: string): boolean {
  const p: MailProvider | null = findMailProvider(fromEmail);
  return !!(p && p.webComposeUrl);
}
