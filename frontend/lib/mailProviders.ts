/**
 * Popularne dostawcy poczty — domeny → URL logowania (PL + global).
 * op.pl = Onet (NIE Orange). Domeny firmowe → null (brak zewnętrznego linku).
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
   * null = brak publicznego API → openMailCompose używa mailto: (gotowy szkic).
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
    id: 'icloud',
    label: 'iCloud Mail',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    webInboxUrl: 'https://www.icloud.com/mail/',
    webComposeUrl: null,
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    domains: ['yahoo.com', 'yahoo.pl', 'ymail.com'],
    webInboxUrl: 'https://mail.yahoo.com/',
    webComposeUrl: (to, subject, body) =>
      `https://compose.mail.yahoo.com/?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`,
  },
  {
    id: 'wp',
    label: 'WP Poczta',
    domains: ['wp.pl'],
    webInboxUrl: 'https://poczta.wp.pl/',
    webComposeUrl: null,
  },
  {
    id: 'onet',
    label: 'Onet Poczta',
    // op.pl historycznie = Onet (nie mylić z Orange)
    domains: ['onet.pl', 'op.pl', 'poczta.onet.pl'],
    webInboxUrl: 'https://poczta.onet.pl/',
    webComposeUrl: null,
  },
  {
    id: 'o2',
    label: 'o2 Poczta',
    domains: ['o2.pl', 'go2.pl', 'tlen.pl'],
    webInboxUrl: 'https://poczta.o2.pl/',
    webComposeUrl: null,
  },
  {
    id: 'interia',
    label: 'Interia',
    domains: ['interia.pl', 'interia.eu', 'poczta.fm', 'vip.interia.pl'],
    webInboxUrl: 'https://poczta.interia.pl/',
    webComposeUrl: null,
  },
  {
    id: 'gazeta',
    label: 'Gazeta.pl',
    domains: ['gazeta.pl'],
    webInboxUrl: 'https://poczta.gazeta.pl/',
    webComposeUrl: null,
  },
  {
    id: 'proton',
    label: 'Proton Mail',
    domains: ['proton.me', 'protonmail.com', 'pm.me'],
    webInboxUrl: 'https://account.proton.me/',
    webComposeUrl: null,
  },
  {
    id: 'tuta',
    label: 'Tuta',
    domains: ['tuta.com', 'tutanota.com'],
    webInboxUrl: 'https://app.tuta.com/',
    webComposeUrl: null,
  },
  {
    id: 'gmx',
    label: 'GMX',
    domains: ['gmx.com', 'gmx.de', 'gmx.net', 'gmx.pl'],
    webInboxUrl: 'https://www.gmx.com/',
    webComposeUrl: null,
  },
  {
    id: 'orange',
    label: 'Orange Poczta',
    domains: ['orange.pl', 'orange.com'],
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
  const p = findMailProvider(fromEmail);
  if (p) return p.label;
  const d = domainOf(fromEmail);
  return d ? `Poczta firmowa (${d})` : 'Poczta';
}

/** true = znany portal z linkiem logowania; false = domena firmowa / nieznana. */
export function hasKnownMailLogin(fromEmail: string): boolean {
  return findMailProvider(fromEmail) != null;
}
