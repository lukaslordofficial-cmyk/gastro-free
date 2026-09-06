/**
 * Katalog popularnych systemów POS w PL + instrukcje podpięcia webhooka.
 * Backend normalizuje payloady przez ten sam `provider` id.
 */

export type PosProviderId =
  | 'generic'
  | 'gopos'
  | 'posbistro'
  | 'dotykacka'
  | 'softpos'
  | 'ipos'
  | 'poster'
  | 'restimo'
  | 's4h';

export type PosProvider = {
  id: PosProviderId;
  name: string;
  shortName: string;
  blurb: string;
  /** I. Webhook + API Key */
  connectSteps: string[];
  /** II. Skąd wziąć kody SKU/ID */
  skuSteps: string[];
  /** III. Parowanie w aplikacji */
  mappingSteps: string[];
  /** Dodatkowa wskazówka specyficzna dla POS */
  tip?: string;
  samplePayload: string;
  needsApiKey: boolean;
  panelHint: string;
  /** @deprecated — używaj connectSteps; zostawione dla kompatybilności */
  steps: string[];
};

const MAPPING_STEPS_COMMON = [
  'W aplikacji Gastro Manager wejdź w Ustawienia → Mapowanie receptur.',
  'Przy każdej potrawie wpisz/wklej kod SKU (lub numer POS) dokładnie jak w kasie. Zapisz.',
  'Gdy POS sprzeda niezmapowany kod, pojawi się on na liście „Do przypisania” — kliknij i sparuj. POS i tak dostał potwierdzenie 200 OK.',
];

function withLegacySteps(p: Omit<PosProvider, 'steps'>): PosProvider {
  return {
    ...p,
    steps: [...p.connectSteps, ...p.skuSteps, ...p.mappingSteps],
  };
}

export const POS_PROVIDERS: PosProvider[] = [
  withLegacySteps({
    id: 'generic',
    name: 'Inne POS',
    shortName: 'Inne',
    blurb: 'Dowolny POS / middleware wysyłający nasz format kanoniczny.',
    needsApiKey: false,
    panelHint: 'Ustawienia → Integracje / Webhook / Dla deweloperów',
    tip: 'Jako zdarzenie wyzwalające zaznacz: „Zrealizowana sprzedaż”, „Zamknięcie rachunku” lub „Order Paid”. Nasz link już zawiera token — wklejaj go w całości.',
    connectSteps: [
      'Zaloguj się do panelu zarządzania POS w przeglądarce (komputer lub telefon).',
      'Wejdź w Ustawienia → Integracje (lub Dostępy API / Dla deweloperów).',
      'Jeśli POS wymaga klucza API — wygeneruj go i wklej w polu „Klucz API” poniżej, potem zapisz ustawienia.',
      'Skopiuj swój indywidualny link (Webhook) z tej aplikacji i wklej go w polu Webhook w POS-ie.',
    ],
    skuSteps: [
      'W panelu POS przejdź do Menu / Produkty / Potrawy.',
      'Przy każdej potrawie znajdź unikalny kod — SKU, Kod kreskowy, PLU lub ID produktu.',
      'Spisz kody potraw, które chcesz monitorować w magazynie.',
    ],
    mappingSteps: MAPPING_STEPS_COMMON,
    samplePayload: `{
  "event_id": "sale-ORD-1001",
  "external_order_id": "ORD-1001",
  "items": [
    { "pos_external_id": "BURGER-01", "quantity_sold": 2, "unit_price_pln": 32.00 }
  ]
}`,
  }),
  withLegacySteps({
    id: 'gopos',
    name: 'GoPOS',
    shortName: 'GoPOS',
    blurb: 'Jeden z najpopularniejszych POS-ów gastronomicznych w Polsce.',
    needsApiKey: true,
    panelHint: 'Panel GoPOS (przeglądarka) → Ustawienia → Dostępy do API',
    tip: 'Dostęp do API w GoPOS często wymaga zgłoszenia do ich supportu o licencję integracyjną. Kody: SKU lub systemowe ID z bazy. Event: sprzedaż / zamknięcie rachunku.',
    connectSteps: [
      'Zaloguj się do panelu GoPOS w przeglądarce.',
      'Wejdź w Ustawienia → Dostępy do API (lub Integracje → Webhooki).',
      'Wygeneruj klucz API (po nadaniu licencji integracyjnej) i wklej go poniżej jako „Klucz API”, potem zapisz.',
      'Skopiuj link webhook z tej aplikacji i wklej go w GoPOS jako adres webhooka sprzedaży.',
    ],
    skuSteps: [
      'W GoPOS otwórz katalog produktów / menu.',
      'Przy pozycji znajdź SKU lub systemowe ID produktu.',
      'Spisz te kody — muszą być 1:1 z polami w Mapowaniu receptur.',
    ],
    mappingSteps: MAPPING_STEPS_COMMON,
    samplePayload: `{
  "orderId": "GP-8821",
  "products": [
    { "sku": "BURGER-01", "qty": 2, "price": 32.00 }
  ]
}`,
  }),
  withLegacySteps({
    id: 'posbistro',
    name: 'POSbistro',
    shortName: 'POSbistro',
    blurb: 'Popularny system dla restauracji i sieci lokalnych.',
    needsApiKey: true,
    panelHint: 'Panel Admina → Ustawienia → Integracje',
    tip: 'Funkcja API / webhook czasem wymaga aktywacji dodatkowego modułu u opiekuna klienta POSbistro. Kod: SKU z karty produktu.',
    connectSteps: [
      'Zaloguj się do panelu Admina POSbistro.',
      'Wejdź w Ustawienia → Integracje.',
      'Jeśli opiekun aktywował moduł API — wygeneruj / skopiuj klucz i wklej go poniżej.',
      'Wklej link webhook z tej aplikacji i włącz powiadomienia o sprzedaży / zamknięciu rachunku.',
    ],
    skuSteps: [
      'Otwórz kartotekę produktów / menu w POSbistro.',
      'Przy każdej potrawie znajdź Kod SKU przypisany do karty produktu.',
      'Spisz SKU pozycji, które chcesz zdejmować z magazynu.',
    ],
    mappingSteps: MAPPING_STEPS_COMMON,
    samplePayload: `{
  "receipt_id": "PB-441",
  "lines": [
    { "plu": "BURGER-01", "quantity": 1, "unit_price": 32 }
  ]
}`,
  }),
  withLegacySteps({
    id: 'dotykacka',
    name: 'Dotykačka',
    shortName: 'Dotykačka',
    blurb: 'Dotykowy POS często spotykany w barach i food courtach.',
    needsApiKey: true,
    panelHint: 'Chmura Dotykačka → Integracje → zakładka Webhook',
    tip: 'Dotykačka obsługuje webhooki metodą POST. W paczce danych szukaj m.in. encji „Zrealizowane sprzedaże”. Identyfikatory: EAN / PLU lub wewnętrzne ID bazy.',
    connectSteps: [
      'Zaloguj się do chmury Dotykačka w przeglądarce.',
      'Wejdź w Integracje → zakładka Webhook.',
      'Opcjonalnie zapisz klucz API w polu poniżej (jeśli panel go wymaga).',
      'Wklej link webhook z tej aplikacji i wybierz zdarzenie sprzedaży / zamknięcia zamówienia (POST).',
    ],
    skuSteps: [
      'W katalogu produktów znajdź EAN, PLU lub wewnętrzne ID pozycji.',
      'Spisz te kody dla dań, które monitorujesz.',
    ],
    mappingSteps: MAPPING_STEPS_COMMON,
    samplePayload: `{
  "order": {
    "id": "DT-19",
    "items": [
      { "productId": "BURGER-01", "quantity": 1, "price": 32 }
    ]
  }
}`,
  }),
  withLegacySteps({
    id: 'softpos',
    name: 'SoftPOS / Softtronic',
    shortName: 'SoftPOS',
    blurb: 'Polski SoftPOS — webhook na zamknięcie rachunku.',
    needsApiKey: false,
    panelHint: 'Panel SoftPOS → Integracje zewnętrzne',
    tip: 'Ustaw endpoint HTTP na event sprzedaży / zamknięcia rachunku. Kody towarów = code / SKU z SoftPOS.',
    connectSteps: [
      'Zaloguj się do panelu SoftPOS.',
      'Wejdź w Integracje zewnętrzne (lub Webhook).',
      'Skopiuj link webhook z tej aplikacji i dodaj go jako endpoint sprzedaży.',
      'Jako zdarzenie wybierz zamknięcie rachunku / zrealizowaną sprzedaż.',
    ],
    skuSteps: [
      'W kartotece towarów SoftPOS znajdź kody (code / SKU).',
      'Spisz je do mapowania w aplikacji.',
    ],
    mappingSteps: MAPPING_STEPS_COMMON,
    samplePayload: `{
  "sale_id": "SP-77",
  "items": [
    { "code": "BURGER-01", "amount": 2, "price_netto": 32 }
  ]
}`,
  }),
  withLegacySteps({
    id: 'ipos',
    name: 'iPOS',
    shortName: 'iPOS',
    blurb: 'iPOS — integracja przez webhook / API sprzedaży.',
    needsApiKey: true,
    panelHint: 'iPOS Backoffice → Integracje',
    tip: 'W backoffice wklej URL webhooka na sprzedaż. Kody pozycji = externalId / SKU z iPOS. Przy problemach z API skontaktuj się z opiekunem iPOS.',
    connectSteps: [
      'Zaloguj się do iPOS Backoffice.',
      'Wejdź w Integracje / Webhooki.',
      'Jeśli wymagany jest klucz API — wklej go poniżej i zapisz ustawienia.',
      'Wklej link webhook z tej aplikacji i włącz zdarzenie sprzedaży / Order Paid.',
    ],
    skuSteps: [
      'W menu iPOS odczytaj externalId / SKU każdej pozycji.',
      'Spisz kody do Mapowania receptur.',
    ],
    mappingSteps: MAPPING_STEPS_COMMON,
    samplePayload: `{
  "transactionId": "IP-301",
  "positions": [
    { "externalId": "BURGER-01", "qty": 1, "price": 32 }
  ]
}`,
  }),
  withLegacySteps({
    id: 'poster',
    name: 'Poster POS',
    shortName: 'Poster',
    blurb: 'Poster — webhook po zamknięciu zamówienia.',
    needsApiKey: true,
    panelHint: 'Poster → Ustawienia → API / Webhooks',
    tip: 'Dodaj webhook na closed transaction / zamknięte zamówienie. product_id bywa liczbowy; ceny w Posterze często w groszach — nasz adapter to uwzględnia.',
    connectSteps: [
      'Zaloguj się do panelu Poster.',
      'Wejdź w Ustawienia → API / Webhooks.',
      'Wygeneruj token API (jeśli potrzebny) i wklej poniżej.',
      'Dodaj webhook z naszym linkiem na zamknięcie transakcji.',
    ],
    skuSteps: [
      'W produktach Poster znajdź product_id lub SKU.',
      'Spisz je i wpisz w Mapowaniu receptur.',
    ],
    mappingSteps: MAPPING_STEPS_COMMON,
    samplePayload: `{
  "object": "transaction",
  "transaction_id": "PO-55",
  "products": [
    { "product_id": "BURGER-01", "count": 1, "price": 3200 }
  ]
}`,
  }),
  withLegacySteps({
    id: 'restimo',
    name: 'Restimo',
    shortName: 'Restimo',
    blurb: 'Agregator zamówień — webhook przy statusie delivered / accepted.',
    needsApiKey: true,
    panelHint: 'Restimo → Integracje → Webhook',
    tip: 'Ustaw webhook na zamówienia zakończone (delivered / accepted). SKU = zewnętrzne ID dań z Restimo / menu.',
    connectSteps: [
      'Zaloguj się do Restimo.',
      'Wejdź w Integracje → Webhook.',
      'Wklej klucz API poniżej (jeśli Restimo go wymaga) i zapisz.',
      'Wklej nasz link i wybierz statusy zakończonego zamówienia.',
    ],
    skuSteps: [
      'W katalogu Restimo / zsynchronizowanym menu odczytaj SKU pozycji.',
      'Spisz je do mapowania w aplikacji.',
    ],
    mappingSteps: MAPPING_STEPS_COMMON,
    samplePayload: `{
  "orderId": "RS-120",
  "items": [
    { "sku": "BURGER-01", "quantity": 1, "unitPrice": 32 }
  ]
}`,
  }),
  withLegacySteps({
    id: 's4h',
    name: 'S4H / inne PL',
    shortName: 'S4H',
    blurb: 'S4H i podobne systemy — uniwersalny adapter pól PLU/kod.',
    needsApiKey: false,
    panelHint: 'Panel → Eksport / Webhook sprzedaży',
    tip: 'Skonfiguruj wysyłkę JSON (POST) po zamknięciu rachunku. Mapuj pola PLU / kod / ilość — nasz adapter czyta „pozycje”.',
    connectSteps: [
      'Zaloguj się do panelu S4H (lub podobnego POS).',
      'Znajdź Eksport / Webhook / Integracje.',
      'Wklej nasz link jako adres docelowy sprzedaży.',
      'Jako event wybierz zamknięcie dokumentu / sprzedaż.',
    ],
    skuSteps: [
      'W kartotece odczytaj PLU lub kod produktu.',
      'Spisz je do Mapowania receptur.',
    ],
    mappingSteps: MAPPING_STEPS_COMMON,
    samplePayload: `{
  "dokument": "FV/12",
  "pozycje": [
    { "plu": "BURGER-01", "ilosc": 2, "cena": 32 }
  ]
}`,
  }),
];

export function getPosProvider(id: string | null | undefined): PosProvider {
  return POS_PROVIDERS.find((p) => p.id === id) ?? POS_PROVIDERS[0];
}

export function buildPosWebhookUrl(
  baseUrl: string,
  providerId: PosProviderId,
  opts?: { account?: string; token?: string; shortPath?: string },
): string {
  const base = baseUrl.replace(/\/$/, '');
  if (opts?.shortPath) {
    const p = opts.shortPath.startsWith('/') ? opts.shortPath : `/${opts.shortPath}`;
    return `${base}${p}`;
  }
  const params = new URLSearchParams();
  if (opts?.account) params.set('account', opts.account);
  if (opts?.token) params.set('token', opts.token);
  if (providerId && providerId !== 'generic') params.set('provider', providerId);
  const qs = params.toString();
  return qs ? `${base}/api/pos/webhook?${qs}` : `${base}/api/pos/webhook`;
}
