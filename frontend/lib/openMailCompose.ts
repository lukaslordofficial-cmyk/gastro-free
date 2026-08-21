/**
 * Otwiera kompozytor poczty według domeny nadawcy (Gmail → Gmail, Yahoo → Yahoo…).
 * Fallback: mailto: (domyślna aplikacja systemowa).
 */
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export type MailComposeInput = {
  /** Adres nadawcy — z niego bierzemy dostawcę (gmail/yahoo/…). */
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
};

function domainOf(email: string): string {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 0) return '';
  return email.trim().toLowerCase().slice(at + 1);
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

/** Web / deep-linki compose według domeny From. */
export function composeUrlsForFrom(fromEmail: string, to: string, subject: string, body: string): string[] {
  const d = domainOf(fromEmail);
  const urls: string[] = [];

  const isGmail = d === 'gmail.com' || d === 'googlemail.com';
  const isYahoo =
    d === 'yahoo.com' ||
    d === 'yahoo.pl' ||
    d.endsWith('.yahoo.com') ||
    d.endsWith('.yahoo.pl');
  const isOutlook =
    d === 'outlook.com' ||
    d === 'hotmail.com' ||
    d === 'live.com' ||
    d === 'msn.com' ||
    d === 'outlook.office365.com';
  const isWp = d === 'wp.pl';
  const isO2 = d === 'o2.pl';
  const isInteria = d === 'interia.pl' || d.endsWith('.interia.pl');
  const isOnEt = d === 'onet.pl' || d.endsWith('.onet.pl');

  if (isGmail) {
    if (Platform.OS === 'android') {
      urls.push(`googlegmail://co?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`);
    }
    if (Platform.OS === 'ios') {
      urls.push(`googlegmail://co?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`);
    }
    urls.push(
      `https://mail.google.com/mail/?view=cm&fs=1&tf=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`,
    );
  } else if (isYahoo) {
    urls.push(
      `https://compose.mail.yahoo.com/?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`,
    );
  } else if (isOutlook) {
    urls.push(
      `ms-outlook://compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`,
    );
    urls.push(
      `https://outlook.live.com/mail/0/deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`,
    );
  } else if (isWp) {
    urls.push('https://poczta.wp.pl/');
  } else if (isO2) {
    urls.push('https://poczta.o2.pl/');
  } else if (isInteria) {
    urls.push('https://poczta.interia.pl/');
  } else if (isOnEt) {
    urls.push('https://poczta.onet.pl/');
  }

  // Zawsze na końcu uniwersalny mailto (systemowy klient)
  urls.push(`mailto:${enc(to)}?subject=${enc(subject)}&body=${enc(body)}`);
  return urls;
}

export async function openMailCompose(input: MailComposeInput): Promise<{ opened: string }> {
  const from = (input.fromEmail || '').trim();
  const to = (input.to || '').trim();
  if (!to) throw new Error('Brak adresu odbiorcy.');
  const subject = input.subject || '';
  const body = input.body || '';
  const candidates = composeUrlsForFrom(from, to, subject, body);

  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const can = await Linking.canOpenURL(url);
      if (!can && url.startsWith('http')) {
        // canOpenURL często false dla https na Android bez query — i tak próbuj
      } else if (!can && !url.startsWith('mailto:') && !url.startsWith('http')) {
        continue;
      }
      await Linking.openURL(url);
      return { opened: url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Nie udało się otworzyć aplikacji pocztowej.');
}

export function mailProviderLabel(fromEmail: string): string {
  const d = domainOf(fromEmail);
  if (d === 'gmail.com' || d === 'googlemail.com') return 'Gmail';
  if (d.includes('yahoo')) return 'Yahoo';
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(d)) return 'Outlook';
  if (d === 'wp.pl') return 'WP Poczta';
  if (d === 'o2.pl') return 'O2 Poczta';
  if (d.includes('interia')) return 'Interia';
  if (d.includes('onet')) return 'Onet Poczta';
  return 'aplikacji pocztowej';
}
