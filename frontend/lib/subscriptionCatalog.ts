/** Konfiguracja planów subskrypcji — lustrzane odbicie backend/server.py TIER_CONFIG. */

export type PlanDef = {
  tier_level: number;
  name: string;
  price_pln: number;
  monthly_grant: number;
  deal_hunter: boolean;
  price_note?: string | null;
  perks: string[];
};

export const TIER_PLANS: PlanDef[] = [
  {
    tier_level: 0,
    name: 'Free',
    price_pln: 0,
    monthly_grant: 0,
    deal_hunter: false,
    price_note: null,
    perks: [
      'Reklamy w aplikacji',
      'Manualny magazyn, finanse i baza receptur',
      'Jednorazowy pakiet 1000 kredytów AI na start (przy pierwszym koncie / beta)',
      'Na starcie: pełny dostęp do AI + dark premium dopóki masz kredyty',
      'Oglądaj wideo reklamowe, aby zdobyć dodatkowe kredyty AI',
    ],
  },
  {
    tier_level: 1,
    name: 'Podstawowy',
    price_pln: 50,
    monthly_grant: 1000,
    deal_hunter: false,
    price_note: '50 zł za miesiąc',
    perks: [
      '100% bez reklam',
      'Odnawialny pakiet 1000 kredytów AI co miesiąc',
      'Skanowanie i księgowanie faktur przez AI',
      'Skaner Menu z Wizją AI',
      'Sterowanie głosem',
      'Integracja z POS',
      'Kreator Zamówień AI',
    ],
  },
    {
      tier_level: 2,
      name: 'Profesjonalny',
      price_pln: 100,
      monthly_grant: 2500,
      deal_hunter: true,
      price_note: '100 zł za miesiąc',
      perks: [
        'Wszystkie funkcje pakietu Podstawowego',
        'Odnawialny pakiet 2500 kredytów AI co miesiąc',
        'Moduł „Łowca Okazji” — porównywarka ofert dostawców',
        'Dynamiczny Asystent Zamiany składników',
      ],
    },
  ];

export const FEATURE_CATALOG = [
  { key: 'voice', icon: '🎙️', name: 'Szybka komenda głosowa', cost: '~1-2 kredyty', requires_deal_hunter: false },
  { key: 'invoice', icon: '🧾', name: 'Skanowanie i księgowanie faktury', cost: '~15-20 kredytów', requires_deal_hunter: false },
  { key: 'menu', icon: '🥗', name: 'Analiza karty menu i receptur', cost: '~25-30 kredytów', requires_deal_hunter: false },
  { key: 'trend', icon: '📊', name: 'Analiza trendów AI', cost: '~5-10 kredytów', requires_deal_hunter: false },
  { key: 'deal_hunter', icon: '🏷️', name: 'Łowca Okazji (porównywarka ofert)', cost: '~3-8 kredytów', requires_deal_hunter: true },
  // Delta-Scraper wyłączony w UI — silnik w backend/delta_scraper
  // { key: 'scraper', icon: '🌐', name: 'Skan stron dostawców (monitoring)', cost: '5 kredytów / skan', requires_deal_hunter: false },
];

export const TOPUP_PACKAGES = [
  { key: 'small', credits: 100, price_pln: 10, label: '+100 kredytów' },
  { key: 'medium', credits: 500, price_pln: 30, label: '+500 kredytów' },
  { key: 'large', credits: 1000, price_pln: 50, label: '+1000 kredytów' },
] as const;

export type TopupKey = (typeof TOPUP_PACKAGES)[number]['key'];

export function tierName(level: number): string {
  return TIER_PLANS.find((p) => p.tier_level === level)?.name ?? 'Free';
}

export function tierPlan(level: number): PlanDef {
  return TIER_PLANS.find((p) => p.tier_level === level) ?? TIER_PLANS[0];
}
