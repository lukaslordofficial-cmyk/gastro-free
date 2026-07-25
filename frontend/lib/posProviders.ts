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
  steps: string[];
  samplePayload: string;
  needsApiKey: boolean;
  panelHint: string;
};

export const POS_PROVIDERS: PosProvider[] = [
  {
    id: 'generic',
    name: 'Inne POS',
    shortName: 'Inne',
    blurb: 'Dowolny POS / middleware wysyłający nasz format kanoniczny.',
    needsApiKey: false,
    panelHint: 'Ustawienia → Webhook / Integracje → URL + zdarzenie sprzedaży',
    steps: [
      'Skopiuj swój link webhook.',
      'W swoim POS wklej go jako endpoint zdarzenia „zamknięcie rachunku / sale”.',
      'Upewnij się, że body to JSON z tablicą items (pos_external_id, quantity_sold).',
      'W sekcji Mapowanie receptur wpisz te same kody produktów co w POS (SKU / ID).',
    ],
    samplePayload: `{
  "external_order_id": "ORD-1001",
  "items": [
    { "pos_external_id": "BURGER-01", "quantity_sold": 2, "unit_price_pln": 32.00 }
  ]
}`,
  },
  {
    id: 'gopos',
    name: 'GoPOS',
    shortName: 'GoPOS',
    blurb: 'Jeden z najpopularniejszych POS-ów gastronomicznych w Polsce.',
    needsApiKey: true,
    panelHint: 'Panel GoPOS → Integracje → Webhooki / API',
    steps: [
      'Skopiuj swój link webhook.',
      'W panelu GoPOS wejdź w Integracje → Webhooki.',
      'Dodaj URL i wybierz zdarzenie sprzedaży / zamknięcia rachunku.',
      'Jeśli GoPOS poda token — wklej go w „Klucz API” poniżej.',
      'W Mapowaniu receptur wpisz kody produktów dokładnie jak w GoPOS (SKU / ID pozycji).',
    ],
    samplePayload: `{
  "orderId": "GP-8821",
  "products": [
    { "sku": "BURGER-01", "qty": 2, "price": 32.00 }
  ]
}`,
  },
  {
    id: 'posbistro',
    name: 'POSbistro',
    shortName: 'POSbistro',
    blurb: 'Popularny system dla restauracji i sieci lokalnych.',
    needsApiKey: true,
    panelHint: 'POSbistro Admin → Ustawienia → Integracje',
    steps: [
      'Skopiuj swój link webhook.',
      'W adminie POSbistro: Ustawienia → Integracje / Webhook.',
      'Wklej URL i włącz powiadomienia o sprzedaży.',
      'Zmapuj kody PLU/SKU dań w sekcji Mapowanie receptur.',
    ],
    samplePayload: `{
  "receipt_id": "PB-441",
  "lines": [
    { "plu": "BURGER-01", "quantity": 1, "unit_price": 32 }
  ]
}`,
  },
  {
    id: 'dotykacka',
    name: 'Dotykačka',
    shortName: 'Dotykačka',
    blurb: 'Dotykowy POS często spotykany w barach i food courtach.',
    needsApiKey: true,
    panelHint: 'Cloud → Nastavení → Webhooky / API',
    steps: [
      'Skopiuj swój link webhook.',
      'W chmurze Dotykačka dodaj webhook na zdarzenie order/sale.',
      'Wklej URL i (opcjonalnie) zapisz klucz API.',
      'Kody produktów w mapowaniu = ID / SKU z katalogu Dotykačka.',
    ],
    samplePayload: `{
  "order": {
    "id": "DT-19",
    "items": [
      { "productId": "BURGER-01", "quantity": 1, "price": 32 }
    ]
  }
}`,
  },
  {
    id: 'softpos',
    name: 'SoftPOS / Softtronic',
    shortName: 'SoftPOS',
    blurb: 'Polski SoftPOS — webhook na zamknięcie rachunku.',
    needsApiKey: false,
    panelHint: 'Panel SoftPOS → Integracje zewnętrzne',
    steps: [
      'Skopiuj swój link webhook.',
      'W panelu SoftPOS dodaj endpoint HTTP na event sprzedaży.',
      'Zmapuj kody towarów 1:1 w Mapowaniu receptur.',
    ],
    samplePayload: `{
  "sale_id": "SP-77",
  "items": [
    { "code": "BURGER-01", "amount": 2, "price_netto": 32 }
  ]
}`,
  },
  {
    id: 'ipos',
    name: 'iPOS',
    shortName: 'iPOS',
    blurb: 'iPOS — integracja przez webhook / API sprzedaży.',
    needsApiKey: true,
    panelHint: 'iPOS Backoffice → Integracje',
    steps: [
      'Skopiuj swój link webhook.',
      'W backoffice iPOS wklej URL webhooka sprzedaży.',
      'Wpisz kody pozycji menu zgodnie z iPOS.',
    ],
    samplePayload: `{
  "transactionId": "IP-301",
  "positions": [
    { "externalId": "BURGER-01", "qty": 1, "price": 32 }
  ]
}`,
  },
  {
    id: 'poster',
    name: 'Poster POS',
    shortName: 'Poster',
    blurb: 'Poster — webhook po zamknięciu zamówienia.',
    needsApiKey: true,
    panelHint: 'Poster → Ustawienia → API / Webhooks',
    steps: [
      'Skopiuj swój link webhook.',
      'W Poster dodaj webhook na closed transaction.',
      'Zmapuj product_id / sku w Mapowaniu receptur.',
    ],
    samplePayload: `{
  "object": "transaction",
  "transaction_id": "PO-55",
  "products": [
    { "product_id": "BURGER-01", "count": 1, "price": 3200 }
  ]
}`,
  },
  {
    id: 'restimo',
    name: 'Restimo',
    shortName: 'Restimo',
    blurb: 'Agregator zamówień — webhook przy statusie delivered / accepted.',
    needsApiKey: true,
    panelHint: 'Restimo → Integracje → Webhook',
    steps: [
      'Skopiuj swój link webhook.',
      'W Restimo ustaw webhook na zamówienia zakończone.',
      'Kody pozycji = zewnętrzne ID dań z Restimo / menu.',
    ],
    samplePayload: `{
  "orderId": "RS-120",
  "items": [
    { "sku": "BURGER-01", "quantity": 1, "unitPrice": 32 }
  ]
}`,
  },
  {
    id: 's4h',
    name: 'S4H / inne PL',
    shortName: 'S4H',
    blurb: 'S4H i podobne systemy — uniwersalny adapter pól PLU/kod.',
    needsApiKey: false,
    panelHint: 'Panel → Eksport / Webhook sprzedaży',
    steps: [
      'Skopiuj swój link webhook.',
      'Skonfiguruj wysyłkę JSON po zamknięciu rachunku.',
      'Zmapuj kody PLU w aplikacji.',
    ],
    samplePayload: `{
  "dokument": "FV/12",
  "pozycje": [
    { "plu": "BURGER-01", "ilosc": 2, "cena": 32 }
  ]
}`,
  },
];

export function getPosProvider(id: string | null | undefined): PosProvider {
  return POS_PROVIDERS.find((p) => p.id === id) ?? POS_PROVIDERS[0];
}

export function buildPosWebhookUrl(baseUrl: string, providerId: PosProviderId): string {
  const base = baseUrl.replace(/\/$/, '');
  if (!providerId || providerId === 'generic') return `${base}/api/pos/webhook`;
  return `${base}/api/pos/webhook?provider=${encodeURIComponent(providerId)}`;
}
