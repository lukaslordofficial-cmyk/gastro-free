/** Oficjalne strony logowania banków PL — otwierane w przeglądarce (bez bramek płatności). */
export type PolishBankLogin = {
  id: string;
  name: string;
  short: string;
  /** Kolor akcentu kafelka (hex) — fallback gdy brak miniatury */
  color: string;
  loginUrl: string;
};

export const POLISH_BANK_LOGINS: PolishBankLogin[] = [
  {
    id: 'mbank',
    name: 'mBank',
    short: 'mB',
    color: '#000000',
    loginUrl: 'https://www.mbank.pl/serwis-transakcyjny/login',
  },
  {
    id: 'pko',
    name: 'PKO BP',
    short: 'PKO',
    color: '#003399',
    loginUrl: 'https://www.ipko.pl/',
  },
  {
    id: 'santander',
    name: 'Santander',
    short: 'SA',
    color: '#EC0000',
    loginUrl: 'https://www.santander.pl/klient-indywidualny/bankowosc-internetowa',
  },
  {
    id: 'ing',
    name: 'ING',
    short: 'ING',
    color: '#FF6200',
    loginUrl: 'https://login.ingbank.pl/',
  },
  {
    id: 'pekao',
    name: 'Pekao',
    short: 'PE',
    color: '#A11117',
    loginUrl: 'https://www.pekao24.pl/',
  },
  {
    id: 'alior',
    name: 'Alior',
    short: 'AL',
    color: '#C4A35A',
    loginUrl: 'https://system.aliorbank.pl/',
  },
  {
    id: 'millennium',
    name: 'Millennium',
    short: 'ML',
    color: '#E6007E',
    loginUrl: 'https://www.bankmillennium.pl/logowanie',
  },
  {
    id: 'bnp',
    name: 'BNP Paribas',
    short: 'BNP',
    color: '#00915A',
    loginUrl: 'https://login.bnpparibas.pl/',
  },
  {
    id: 'bos',
    name: 'BOŚ Bank',
    short: 'BOŚ',
    color: '#2E7D32',
    loginUrl: 'https://www.bosbank.pl/klient-indywidualny/bankowosc-internetowa',
  },
  {
    id: 'credit_agricole',
    name: 'Credit Agricole',
    short: 'CA',
    color: '#006633',
    loginUrl: 'https://www.credit-agricole.pl/klient-indywidualny/bankowosc-elektroniczna',
  },
  {
    id: 'velobank',
    name: 'VeloBank',
    short: 'VB',
    color: '#E30613',
    loginUrl: 'https://www.velobank.pl/klient-indywidualny/bankowosc-elektroniczna',
  },
  {
    id: 'nest',
    name: 'Nest Bank',
    short: 'NB',
    color: '#5B8C3E',
    loginUrl: 'https://www.nestbank.pl/klient-indywidualny/bankowosc-internetowa',
  },
  {
    id: 'raiffeisen',
    name: 'Raiffeisen Digital',
    short: 'RDB',
    color: '#FFED00',
    loginUrl: 'https://www.raiffeisen-digital.com/pl/login',
  },
  {
    id: 'sgb',
    name: 'SGB',
    short: 'SGB',
    color: '#C8102E',
    loginUrl: 'https://www.sgb.pl/klient-indywidualny/bankowosc-elektroniczna/',
  },
  {
    id: 'inteligo',
    name: 'Inteligo',
    short: 'INT',
    color: '#003399',
    loginUrl: 'https://www.inteligo.pl/secure/login.html',
  },
  {
    id: 'pocztowy',
    name: 'Bank Pocztowy',
    short: 'BP',
    color: '#C2185B',
    loginUrl: 'https://www.pocztowy.pl/klient-indywidualny/bankowosc-internetowa',
  },
  {
    id: 'toyota',
    name: 'Toyota Bank',
    short: 'TB',
    color: '#4CAF50',
    loginUrl: 'https://www.toyotabank.pl/klient-indywidualny',
  },
];
