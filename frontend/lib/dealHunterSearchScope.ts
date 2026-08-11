/** Zakres wyszukiwania ofert w Łowcy Okazji. */
export type DealHunterSearchScope =
  | 'suppliers_only'
  | 'local_producers_only'
  | 'both';

export const DEAL_HUNTER_SEARCH_SCOPE_OPTIONS: {
  key: DealHunterSearchScope;
  label: string;
  hint: string;
}[] = [
  {
    key: 'suppliers_only',
    label: 'Tylko moi hurtownicy',
    hint: 'Katalogi dostawców wgrane do apki',
  },
  {
    key: 'local_producers_only',
    label: 'Tylko lokalni dostawcy',
    hint: 'Marketplace Lokalni Przetwórcy / dystrybutorzy',
  },
  {
    key: 'both',
    label: 'Hurtownicy i lokalni dostawcy',
    hint: 'Porównaj obie bazy naraz',
  },
];

export const DEFAULT_DEAL_HUNTER_SEARCH_SCOPE: DealHunterSearchScope = 'suppliers_only';
