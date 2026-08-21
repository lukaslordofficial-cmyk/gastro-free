/** Oficjalne strony logowania banków PL — otwierane w przeglądarce (bez bramek płatności). */
export type PolishBankLogin = {
  id: string;
  name: string;
  short: string;
  /** Kolor akcentu kafelka (hex) */
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
    color: '#8B1FA9',
    loginUrl: 'https://system.aliorbank.pl/',
  },
  {
    id: 'millennium',
    name: 'Millennium',
    short: 'ML',
    color: '#D4002A',
    loginUrl: 'https://www.bankmillennium.pl/logowanie',
  },
  {
    id: 'bnp',
    name: 'BNP Paribas',
    short: 'BNP',
    color: '#00915A',
    loginUrl: 'https://login.bnpparibas.pl/',
  },
];
