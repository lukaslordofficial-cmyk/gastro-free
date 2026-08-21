/**
 * Popularne dostawcy poczty — domeny + URL web (login / compose).
 */
export type MailProvider = {
  id: string;
  label: string;
  /** Domeny From (bez @), dopasowanie exact lub endsWith. */
  domains: string[];
  /** Strona logowania / skrzynki w przeglądarce. */
  webInboxUrl: string;
  /**
   * Compose w przeglądarce z prefill (to, subject, body).
   * null = brak API — otwieramy inbox + kopiujemy treść.
   */
  webComposeUrl: ((to: string, subject: string, body: string) => string) | null;
  /** Opcjonalne deep-linki aplikacji natywnych. */
  appSchemes?: (to: string, subject: string, body: string) => string[];
};

function enc(s: string): string {
  return encodeURIComponent(s);
}

export const MAIL_PROVIDERS: MailProvider[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    webInboxUrl: 'https://mail.google.com/',
    webComposeUrl: (to, subject, body) =>
      `https://mail.google.com/mail/?view=cm&fs=1&tf=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`,
    appSchemes: (to, subject, body) => [
      `googlegmail://co?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`,
    ],
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    domains: ['yahoo.com', 'yahoo.pl'],
    webInboxUrl: 'https://mail.yahoo.com/',
    webComposeUrl: (to, subject, body) =>
      `https://compose.mail.yahoo.com/?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`,
  },
  {
    id: 'outlook',
    label: 'Outlook / Hotmail',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.office365.com'],
    webInboxUrl: 'https://outlook.live.com/mail/',
    webComposeUrl: (to, subject, body) =>
      `https://outlook.live.com/mail/0/deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`,
    appSchemes: (to, subject, body) => [
      `ms-outlook://compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`,
    ],
  },
  {
    id: 'wp',
    label: 'WP Poczta',
    domains: ['wp.pl'],
    webInboxUrl: 'https://poczta.wp.pl/',
    webComposeUrl: null,
  },
  {
    id: 'o2',
    label: 'O2 Poczta',
    domains: ['o2.pl'],
    webInboxUrl: 'https://poczta.o2.pl/',
    webComposeUrl: null,
  },
  {
    id: 'interia',
    label: 'Interia',
    domains: ['interia.pl'],
    webInboxUrl: 'https://poczta.interia.pl/',
    webComposeUrl: null,
  },
  {
    id: 'onet',
    label: 'Onet Poczta',
    domains: ['onet.pl'],
    webInboxUrl: 'https://poczta.onet.pl/',
    webComposeUrl: null,
  },
  {
    id: 'gazeta',
    label: 'Gazeta.pl',
    domains: ['gazeta.pl', 'agora.pl'],
    webInboxUrl: 'https://poczta.gazeta.pl/',
    webComposeUrl: null,
  },
  {
    id: 'tlen',
    label: 'Tlen / O2',
    domains: ['tlen.pl'],
    webInboxUrl: 'https://poczta.o2.pl/',
    webComposeUrl: null,
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    webInboxUrl: 'https://www.icloud.com/mail/',
    webComposeUrl: null,
  },
  {
    id: 'proton',
    label: 'Proton Mail',
    domains: ['proton.me', 'protonmail.com', 'pm.me'],
    webInboxUrl: 'https://mail.proton.me/',
    webComposeUrl: null,
  },
  {
    id: 'zoho',
    label: 'Zoho Mail',
    domains: ['zoho.com', 'zohomail.eu'],
    webInboxUrl: 'https://mail.zoho.com/',
    webComposeUrl: null,
  },
  {
    id: 'gmx',
    label: 'GMX',
    domains: ['gmx.com', 'gmx.pl', 'gmx.net'],
    webInboxUrl: 'https://www.gmx.com/',
    webComposeUrl: null,
  },
  {
    id: 'op',
    label: 'OP / Orange',
    // „op” bywa używane potocznie; orange.pl / op.pl gdy występują
    domains: ['op.pl', 'orange.pl', 'orange.com'],
    webInboxUrl: 'https://poczta.orange.pl/',
    webComposeUrl: null,
  },
];

export function domainOf(email: string): string {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 0) return '';
  return email.trim().toLowerCase().slice(at + 1);
}

function domainMatches(domain: string, pattern: string): boolean {
  return domain === pattern || domain.endsWith(`.${pattern}`);
}

export function findMailProvider(fromEmail: string): MailProvider | null {
  const d = domainOf(fromEmail);
  if (!d) return null;
  for (const p of MAIL_PROVIDERS) {
    if (p.domains.some((dom) => domainMatches(d, dom))) return p;
  }
  return null;
}

export function mailProviderLabel(fromEmail: string): string {
  return findMailProvider(fromEmail)?.label ?? 'Poczta';
}
