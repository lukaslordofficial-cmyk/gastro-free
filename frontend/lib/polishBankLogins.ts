/**
 * Polskie banki — logowanie osobiste / firmowe (płatność manualna).
 * Wariant A: wybór typu konta. Wariant B: jeden wspólny link.
 */

export type BankAccountOption = {
  id: 'personal' | 'business';
  /** np. „Konto osobiste” / „Konto firmowe (mBank CompanyNet)” */
  label: string;
  url: string;
};

export type PolishBankLogin = {
  id: string;
  name: string;
  short: string;
  color: string;
  /**
   * null = Wariant B (jedna URL → od razu przeglądarka).
   * tablica = Wariant A (najpierw wybór osobiste / firmowe).
   */
  accounts: BankAccountOption[] | null;
  /** Wariant B — wspólny adres; przy A nieużywane (patrz accounts). */
  loginUrl: string;
};

function single(url: string): Pick<PolishBankLogin, 'accounts' | 'loginUrl'> {
  return { accounts: null, loginUrl: url };
}

function dual(
  personalUrl: string,
  businessUrl: string,
  businessPlatform: string,
): Pick<PolishBankLogin, 'accounts' | 'loginUrl'> {
  return {
    loginUrl: personalUrl,
    accounts: [
      { id: 'personal', label: 'Konto osobiste', url: personalUrl },
      {
        id: 'business',
        label: `Konto firmowe (${businessPlatform})`,
        url: businessUrl,
      },
    ],
  };
}

/** 18 banków — kolejność jak w specyfikacji produktu. */
export const POLISH_BANK_LOGINS: PolishBankLogin[] = [
  {
    id: 'mbank',
    name: 'mBank',
    short: 'mB',
    color: '#000000',
    ...dual('https://online.mbank.pl', 'https://companynet.mbank.pl', 'mBank CompanyNet'),
  },
  {
    id: 'pko',
    name: 'PKO BP',
    short: 'PKO',
    color: '#003399',
    ...dual('https://www.ipko.pl', 'https://www.ipkobiznes.pl', 'iPKO biznes'),
  },
  {
    id: 'santander',
    name: 'Santander',
    short: 'SA',
    color: '#EC0000',
    ...dual('https://santander.pl', 'https://ibiznes24.pl', 'iBiznes24'),
  },
  {
    id: 'pekao',
    name: 'Bank Pekao S.A.',
    short: 'PE',
    color: '#A11117',
    ...dual('https://pekao24.pl', 'https://pekaobiznes24.pl', 'PekaoBiznes24'),
  },
  {
    id: 'bnp',
    name: 'BNP Paribas',
    short: 'BNP',
    color: '#00915A',
    ...dual('https://bnpparibas.pl', 'https://bnpparibas.pl', 'BiznesPl@net'),
  },
  {
    id: 'inteligo',
    name: 'PKO BP (Inteligo)',
    short: 'INT',
    color: '#003399',
    ...dual('https://inteligo.pl', 'https://inteligo.pl', 'Inteligo Firma'),
  },
  {
    id: 'ing',
    name: 'ING Bank Śląski',
    short: 'ING',
    color: '#FF6200',
    ...single('https://ingbank.pl'),
  },
  {
    id: 'millennium',
    name: 'Millennium Bank',
    short: 'ML',
    color: '#E6007E',
    ...single('https://bankmillennium.pl'),
  },
  {
    id: 'alior',
    name: 'Alior Bank',
    short: 'AL',
    color: '#C4A35A',
    ...single('https://aliorbank.pl'),
  },
  {
    id: 'credit_agricole',
    name: 'Credit Agricole',
    short: 'CA',
    color: '#006633',
    ...single('https://credit-agricole.pl'),
  },
  {
    id: 'velobank',
    name: 'VeloBank',
    short: 'VB',
    color: '#E30613',
    ...single('https://velobank.pl'),
  },
  {
    id: 'bos',
    name: 'BOŚ Bank',
    short: 'BOŚ',
    color: '#2E7D32',
    ...single('https://bosbank24.pl'),
  },
  {
    id: 'nest',
    name: 'Nest Bank',
    short: 'NB',
    color: '#5B8C3E',
    ...single('https://nestbank.pl'),
  },
  {
    id: 'raiffeisen',
    name: 'Raiffeisen Digital Bank',
    short: 'RDB',
    color: '#FFED00',
    ...single('https://raiffeisendigital.com'),
  },
  {
    id: 'pocztowy',
    name: 'Bank Pocztowy',
    short: 'BP',
    color: '#C2185B',
    ...single('https://pocztowy.pl'),
  },
  {
    id: 'toyota',
    name: 'Toyota Bank',
    short: 'TB',
    color: '#4CAF50',
    ...single('https://toyotabank.pl'),
  },
  {
    id: 'sgb',
    name: 'SGB',
    short: 'SGB',
    color: '#C8102E',
    ...single('https://sgb24.pl'),
  },
  {
    id: 'bps',
    name: 'BPS',
    short: 'BPS',
    color: '#1A237E',
    ...single('https://e-bps.pl'),
  },
];

export function bankNeedsAccountChoice(bank: PolishBankLogin): boolean {
  return Array.isArray(bank.accounts) && bank.accounts.length > 0;
}
