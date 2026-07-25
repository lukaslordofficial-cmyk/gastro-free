/**
 * Katalog tipów Zero Waste przy zbliżającym się terminie (T-3 / T-2 / T-1).
 * Plan: docs/EXPIRY_TIPS_PLAN.md
 *
 * days_left = różnica dat kalendarzowych (jak w expiry-daily-cron / ProductExpiryEditor).
 * Phase 1: pickExpiryTips podpięty w VoiceReportModal (Jarvis list_expiring_soon).
 * Push / PDF — Phase 2–3 (docs/EXPIRY_TIPS_PLAN.md).
 */

export type ExpiryTipPhase = 't3' | 't2' | 't1';

/** Pack tipów — mapowanie z kategorii mag./menu: zob. resolveExpiryTipCategory */
export type ExpiryTipCategory =
  | 'general'
  | 'produce'
  | 'dairy'
  | 'meat_fish'
  | 'dry_bread'
  | 'mains'
  | 'semi';

export type ExpiryTipKind =
  | 'ops'
  | 'kitchen'
  | 'marketing'
  | 'social'
  | 'game_safe';

export type ExpiryTipVariable =
  | 'product_name'
  | 'qty'
  | 'unit'
  | 'dish_name'
  | 'restaurant_name';

/** Filtry lokalu / nastroju (eleganckie bistro vs pub studencki) */
export type ExpiryGameTag = '#szybka' | '#grupowa' | '#śmieszna' | '#odważna' | string;

export type ExpiryVenueFit = 'bar' | 'table' | 'social' | 'any';

export type ExpiryGameMechanic =
  | 'skill'
  | 'everyone_wins'
  | 'social_contest'
  | 'gentleman'
  | 'negotiation';

export type ExpiryTip = {
  id: string;
  phase: ExpiryTipPhase;
  category: ExpiryTipCategory;
  kind: ExpiryTipKind;
  title: string;
  body: string;
  cta_label?: string;
  legal_note?: string;
  variables: ExpiryTipVariable[];
  /** Tagi filtrujące (głównie gry): #szybka #grupowa #śmieszna #odważna */
  tags?: ExpiryGameTag[];
  venue_fit?: ExpiryVenueFit;
  duration_sec?: number;
  custom_forfeit_allowed?: boolean;
  /** Wariant z ryzykiem prawnym — nie rekomendować bez konsultacji */
  requires_legal_review?: boolean;
};

export type SafeGameTemplate = {
  id: string;
  phase: ExpiryTipPhase;
  /** Gdy gra pasuje do kilku faz (np. T-3…T-1) — dokumentacja / przyszły filtr UI */
  phases?: ExpiryTipPhase[];
  kind: 'game_safe';
  title: string;
  body: string;
  mechanic: ExpiryGameMechanic;
  cta_label: string;
  legal_note: string;
  variables: ExpiryTipVariable[];
  tags: ExpiryGameTag[];
  venue_fit?: ExpiryVenueFit;
  duration_sec?: number;
  custom_forfeit_allowed: boolean;
  requires_legal_review?: boolean;
  /** Preferowany wariant (np. zamiast wariantu z requires_legal_review) */
  preferred_variant_of?: string;
};

export const EXPIRY_TIPS_LEGAL_DISCLAIMER =
  'Gastro Manager podpowiada pomysły marketingowe i operacyjne związane z ograniczaniem marnowania żywności. ' +
  'Organizacja promocji, konkursów i komunikacja z gośćmi leży po stronie restauratora, który odpowiada za ' +
  'zgodność z obowiązującym prawem (w tym przepisami o grach i loteriach, ochronie konsumentów, RODO oraz ' +
  'sprzedażą alkoholu). Aplikacja nie stanowi porady prawnej.';

const LEGAL_SHORT =
  'Pomysł marketingowy — restaurator odpowiada za zgodność z lokalnym prawem.';

/** Mapowanie nazw kategorii aplikacji → pack tipów */
export function resolveExpiryTipCategory(input: {
  inventoryCategoryName?: string | null;
  menuCategory?: string | null;
  isComboPolprodukt?: boolean | null;
  productName?: string | null;
}): ExpiryTipCategory {
  if (input.isComboPolprodukt) return 'semi';

  const inv = norm(input.inventoryCategoryName || '');
  const menu = norm(input.menuCategory || '');
  const name = norm(input.productName || '');

  if (
    menu.includes('zup') ||
    menu.includes('dania glowne') ||
    menu.includes('dania obiadowe') ||
    menu.includes('makaron') ||
    menu.includes('burger') ||
    menu.includes('pizz')
  ) {
    if (name.includes('sos') || name.includes('wywar') || name.includes('bulion')) return 'semi';
    return 'mains';
  }

  if (
    inv.includes('polprodukt') ||
    name.includes('sos ') ||
    name.startsWith('sos') ||
    name.includes('wywar') ||
    name.includes('bulion') ||
    name.includes('demi-glace') ||
    name.includes('polprodukt')
  ) {
    return 'semi';
  }

  if (
    inv.includes('warzyw') ||
    inv.includes('owoc') ||
    inv === 'warzywa' ||
    /salat|rukol|szpinak|pomidor|ogorek|papryk|jablk|banan|truskaw/.test(name)
  ) {
    return 'produce';
  }

  if (inv.includes('nabial') || inv.includes('ser') || /mleko|smietan|jogurt|twarog|maslo|jajk/.test(name)) {
    return 'dairy';
  }

  if (
    inv.includes('mieso') ||
    inv.includes('wedlin') ||
    inv.includes('ryb') ||
    /kurczak|wolow|wieprz|indyk|losos|dorsz|krewet|mielon|kaczka/.test(name)
  ) {
    return 'meat_fish';
  }

  if (
    inv.includes('pieczy') ||
    inv.includes('such') ||
    inv.includes('sypk') ||
    /chleb|bulka|maka|makaron|ryz|kasza|platki|grzank/.test(name)
  ) {
    return 'dry_bread';
  }

  if (inv.includes('chemia') || inv.includes('opakow') || inv.includes('czystosc')) {
    return 'general';
  }

  return 'general';
}

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

function phaseFromDaysLeft(daysLeft: number): ExpiryTipPhase | null {
  // dziś (0) i przeterminowane (<0) → agresywne tipy T-1
  if (daysLeft <= 1) return 't1';
  if (daysLeft === 2) return 't2';
  if (daysLeft === 3) return 't3';
  return null;
}

export function expiryPhaseFromDaysLeft(daysLeft: number): ExpiryTipPhase | null {
  return phaseFromDaysLeft(daysLeft);
}

export type FilledExpiryTip = {
  id: string;
  kind: ExpiryTipKind;
  title: string;
  body: string;
  cta_label?: string;
  legal_note?: string;
};

/**
 * Dobiera i wypełnia tipy pod pozycję drabiny (Jarvis / magazyn).
 * Pomija requires_legal_review (pickExpiryTips). Gry → showLegalDisclaimer.
 */
export function buildExpiryTipsForItem(opts: {
  daysLeft: number;
  productName?: string | null;
  qty?: number | string | null;
  unit?: string | null;
  inventoryCategoryName?: string | null;
  menuCategory?: string | null;
  limit?: number;
  includeGames?: boolean;
}): { tips: FilledExpiryTip[]; showLegalDisclaimer: boolean; phase: ExpiryTipPhase | null } {
  const phase = phaseFromDaysLeft(opts.daysLeft);
  if (!phase) {
    return { tips: [], showLegalDisclaimer: false, phase: null };
  }
  const category = resolveExpiryTipCategory({
    inventoryCategoryName: opts.inventoryCategoryName,
    menuCategory: opts.menuCategory,
    productName: opts.productName,
  });
  const picked = pickExpiryTips({
    daysLeft: opts.daysLeft <= 0 ? 1 : opts.daysLeft,
    category,
    limit: opts.limit ?? 3,
    includeGames: opts.includeGames !== false,
  });
  const vars: Partial<Record<ExpiryTipVariable, string | number>> = {
    product_name: opts.productName || 'produkt',
    qty: opts.qty ?? '',
    unit: opts.unit || '',
  };
  const tips: FilledExpiryTip[] = picked.map((t) => ({
    id: t.id,
    kind: t.kind,
    title: fillTipTemplate(t.title, vars),
    body: fillTipTemplate(t.body, vars),
    cta_label: t.cta_label ? fillTipTemplate(t.cta_label, vars) : undefined,
    legal_note: t.legal_note,
  }));
  return {
    tips,
    showLegalDisclaimer: tips.some((t) => t.kind === 'game_safe' || !!t.legal_note),
    phase,
  };
}

const KIND_PRIORITY: ExpiryTipKind[] = ['ops', 'kitchen', 'marketing', 'social', 'game_safe'];

/**
 * Dobiera tipy na dany dzień: preferuje pack kategorii, dopełnia `general`, max `limit`.
 * Gry/social — max 1 na rodzaj.
 */
export function pickExpiryTips(opts: {
  daysLeft: number;
  category: ExpiryTipCategory;
  limit?: number;
  includeGames?: boolean;
}): ExpiryTip[] {
  const phase = phaseFromDaysLeft(opts.daysLeft);
  if (!phase) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 3, 5));
  const includeGames = opts.includeGames !== false;

  const pool = EXPIRY_TIPS.filter((t) => {
    if (t.phase !== phase) return false;
    if (t.category !== opts.category && t.category !== 'general') return false;
    if (!includeGames && (t.kind === 'game_safe' || t.kind === 'social')) return false;
    // Warianty z requires_legal_review nie wchodzą do auto-pick — tylko jawny wybór restauratora
    if (t.requires_legal_review) return false;
    return true;
  });

  pool.sort((a, b) => {
    const catScore = (t: ExpiryTip) => (t.category === opts.category ? 0 : 1);
    const kindScore = (t: ExpiryTip) => KIND_PRIORITY.indexOf(t.kind);
    return catScore(a) - catScore(b) || kindScore(a) - kindScore(b) || a.id.localeCompare(b.id);
  });

  const out: ExpiryTip[] = [];
  let socialUsed = false;
  let gameUsed = false;
  for (const tip of pool) {
    if (out.length >= limit) break;
    if (tip.kind === 'social') {
      if (socialUsed) continue;
      socialUsed = true;
    }
    if (tip.kind === 'game_safe') {
      if (gameUsed) continue;
      gameUsed = true;
    }
    out.push(tip);
  }
  return out;
}

export function fillTipTemplate(
  text: string,
  vars: Partial<Record<ExpiryTipVariable, string | number>>,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key as ExpiryTipVariable];
    return v == null || v === '' ? `{{${key}}}` : String(v);
  });
}

// ─── Tipy: general ───────────────────────────────────────────────────────────

const GENERAL: ExpiryTip[] = [
  // T-3
  {
    id: 'gen-t3-ops-fifo',
    phase: 't3',
    category: 'general',
    kind: 'ops',
    title: 'FIFO na półce',
    body:
      'Ustaw {{product_name}} ({{qty}} {{unit}}) na przód strefy wydania. Oznacz partię datą — zespół ma zobaczyć ją jako pierwszą do zużycia.',
    cta_label: 'Oznacz partię',
    variables: ['product_name', 'qty', 'unit'],
  },
  {
    id: 'gen-t3-ops-count',
    phase: 't3',
    category: 'general',
    kind: 'ops',
    title: 'Szybka inwentaryzacja partii',
    body:
      'Sprawdź, czy stan {{product_name}} zgadza się z etykietą. Nadmiar bez planu = ryzyko spisu w stratach za 3 dni.',
    variables: ['product_name'],
  },
  {
    id: 'gen-t3-kit-plan',
    phase: 't3',
    category: 'general',
    kind: 'kitchen',
    title: 'Wpisz w plan produkcji',
    body:
      'Dodaj {{product_name}} do planu na najbliższe 48–72 h: danie dnia, przystawka limitu lub składnik do półproduktu.',
    cta_label: 'Zaplanuj zużycie',
    variables: ['product_name'],
  },
  {
    id: 'gen-t3-mkt-soft',
    phase: 't3',
    category: 'general',
    kind: 'marketing',
    title: 'Łagodna promocja „do wyczerpania”',
    body:
      'Zaplanuj combo lub mały rabat na danie z {{product_name}} — komunikat „sezonowa porcja / limitowana ilość”, bez presji na gościa.',
    cta_label: 'Szkic oferty',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
  },
  // T-2
  {
    id: 'gen-t2-ops-brief',
    phase: 't2',
    category: 'general',
    kind: 'ops',
    title: 'Brief zmiany',
    body:
      'Na odprawie: „{{product_name}} — 2 dni”. Kelnerzy i kuchnia mają jedną listę priorytetów zużycia.',
    variables: ['product_name'],
  },
  {
    id: 'gen-t2-kit-rework',
    phase: 't2',
    category: 'general',
    kind: 'kitchen',
    title: 'Przeróbka zamiast spisu',
    body:
      'Zrób listę 2 dań, w których {{product_name}} znika w 1–2 serwisach. Unikaj nowych zakupów tego samego SKU do czasu zużycia.',
    variables: ['product_name'],
  },
  {
    id: 'gen-t2-mkt-hh',
    phase: 't2',
    category: 'general',
    kind: 'marketing',
    title: 'Happy Hour / godziny ratunkowe',
    body:
      'Wyznacz 2–3 godziny z mocniejszą zachętą do zamówienia dania z {{product_name}}. Cena nie może przekroczyć menu — tylko rabat lub dodatek.',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
  },
  {
    id: 'gen-t2-soc-story',
    phase: 't2',
    category: 'general',
    kind: 'social',
    title: 'Story: Zero Waste jutro',
    body:
      'Opublikuj relację: „Jutro / pojutrze kończymy partię {{product_name}} — przyjdź na {{dish_name}} w {{restaurant_name}}”. Bez losowania wśród komentarzy.',
    cta_label: 'Kopiuj treść',
    legal_note: LEGAL_SHORT,
    variables: ['product_name', 'dish_name', 'restaurant_name'],
  },
  // T-1
  {
    id: 'gen-t1-ops-last-call',
    phase: 't1',
    category: 'general',
    kind: 'ops',
    title: 'Ostatni dzień przed terminem',
    body:
      'Jutro kończy się ważność {{product_name}}. Dziś: tylko bezpieczne użycie w produkcji lub kontrolowana promocja. Nie „przedłużaj” etykiety.',
    variables: ['product_name'],
  },
  {
    id: 'gen-t1-kit-force',
    phase: 't1',
    category: 'general',
    kind: 'kitchen',
    title: 'Priorytet na karcie / tablicy',
    body:
      'Wystaw {{product_name}} jako składnik dania dnia lub dopisz do 86-listy po zużyciu. Cel: zejść ze stanem {{qty}} {{unit}} w tym serwisie.',
    variables: ['product_name', 'qty', 'unit'],
  },
  {
    id: 'gen-t1-mkt-urgent',
    phase: 't1',
    category: 'general',
    kind: 'marketing',
    title: 'Silna, uczciwa oferta',
    body:
      'Komunikat w lokalu: limitowana porcja z {{product_name}} — rabat lub gratis dodatek. Gość zawsze może kupić po cenie menu bez gry.',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
  },
];

// ─── Warzywa i owoce ─────────────────────────────────────────────────────────

const PRODUCE: ExpiryTip[] = [
  {
    id: 'prod-t3-ops-storage',
    phase: 't3',
    category: 'produce',
    kind: 'ops',
    title: 'Kontrola wilgotności i FIFO',
    body:
      'Przejrzyj {{product_name}}: usuń uszkodzone sztuki, osusz liście, trzymaj 2–5°C. Najstarsza partia na wierzch pojemnika.',
    variables: ['product_name'],
  },
  {
    id: 'prod-t3-kit-prep',
    phase: 't3',
    category: 'produce',
    kind: 'kitchen',
    title: 'Mise en place na 2–3 dni',
    body:
      'Pokrój / blanszuj część {{product_name}} pod konkretne pozycje (sałatka, zupa, garnish), żeby zużycie było przewidywalne.',
    variables: ['product_name'],
  },
  {
    id: 'prod-t3-kit-soup',
    phase: 't3',
    category: 'produce',
    kind: 'kitchen',
    title: 'Zupa lub puree ratunkowe',
    body:
      'Zaplanuj krem / consommé / puree z {{product_name}} jako danie dnia — warzywa „na styk” zyskują drugie życie bez spadku jakości.',
    variables: ['product_name'],
  },
  {
    id: 'prod-t3-mkt-side',
    phase: 't3',
    category: 'produce',
    kind: 'marketing',
    title: 'Dodatek sezonowy',
    body:
      'Zaproponuj sałatkę lub dodatek z {{product_name}} w cenie „sezonowej porcji” — komunikat świeżości, nie wyprzedaży odpadów.',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
  },
  {
    id: 'prod-t2-kit-pickle',
    phase: 't2',
    category: 'produce',
    kind: 'kitchen',
    title: 'Szybka kiszonka / marinade',
    body:
      'Jeśli HACCP na to pozwala: krótka marynata lub quick pickle z części {{product_name}} — wydłuża okno podania o bezpieczny okres.',
    variables: ['product_name'],
  },
  {
    id: 'prod-t2-kit-special',
    phase: 't2',
    category: 'produce',
    kind: 'kitchen',
    title: 'Special z ogrodu / rynku',
    body:
      'Jedna pozycja special: {{dish_name}} z {{product_name}}. Limit porcji = stan magazynu ({{qty}} {{unit}}).',
    variables: ['dish_name', 'product_name', 'qty', 'unit'],
  },
  {
    id: 'prod-t2-mkt-detox',
    phase: 't2',
    category: 'produce',
    kind: 'marketing',
    title: 'Komunikat „świeże dziś”',
    body:
      'Tablica: „Sałatka / bowl z {{product_name}} — kończymy dostawę”. Zero Waste + świeżość sprzedaje lepiej niż „przecena”.',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
  },
  {
    id: 'prod-t2-soc-color',
    phase: 't2',
    category: 'produce',
    kind: 'social',
    title: 'Post ze zdjęciem produktu',
    body:
      'Zdjęcie {{product_name}} + CTA: „Zostaw pomysł na danie w komentarzu — wybierzemy najciekawszy i damy zniżkę na {{dish_name}}”. Jury lokalu, nie losowanie.',
    cta_label: 'Kopiuj post',
    legal_note: LEGAL_SHORT,
    variables: ['product_name', 'dish_name'],
  },
  {
    id: 'prod-t1-ops-sort',
    phase: 't1',
    category: 'produce',
    kind: 'ops',
    title: 'Sortowanie jakościowe',
    body:
      'Odłóż tylko w pełni zdatne sztuki {{product_name}} do serwisu. Resztę — zgodnie z procedurą waste (nie do gościa).',
    variables: ['product_name'],
  },
  {
    id: 'prod-t1-kit-blend',
    phase: 't1',
    category: 'produce',
    kind: 'kitchen',
    title: 'Blend / smoothie bowl / gazpacho',
    body:
      'Zużyj {{product_name}} w daniu blenderowym lub zimnej zupie — szybkie zejście ze stanu przy zachowaniu smaku.',
    variables: ['product_name'],
  },
  {
    id: 'prod-t1-mkt-plate',
    phase: 't1',
    category: 'produce',
    kind: 'marketing',
    title: 'Porcja dnia na tablicy',
    body:
      'Wyróżnij {{dish_name}} przy wejściu. Opcjonalnie gra zręcznościowa przy stoliku (zgadnij wagę / pytanie o warzywo) — bez ryzyka dopłaty ponad menu.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
  },
];

// ─── Nabiał ──────────────────────────────────────────────────────────────────

const DAIRY: ExpiryTip[] = [
  {
    id: 'dairy-t3-ops-temp',
    phase: 't3',
    category: 'dairy',
    kind: 'ops',
    title: 'Strefa 2–6°C',
    body:
      'Przenieś {{product_name}} głębiej do lodówki (nie drzwi). Sprawdź datę otwarcia opakowania — po otwarciu okno jest krótsze niż na etykiecie fabrycznej.',
    variables: ['product_name'],
  },
  {
    id: 'dairy-t3-kit-sauce',
    phase: 't3',
    category: 'dairy',
    kind: 'kitchen',
    title: 'Sos / zapiekanka / krem',
    body:
      'Zaplanuj danie z {{product_name}}: sos śmietanowy, gratin, twarożek na przystawkę — zużycie kontrolowane w 2–3 dniach.',
    variables: ['product_name'],
  },
  {
    id: 'dairy-t3-kit-bake',
    phase: 't3',
    category: 'dairy',
    kind: 'kitchen',
    title: 'Wypiek lub deser dnia',
    body:
      'Sernik, pudding, panacotta lub sos do deseru z {{product_name}} — jedna produkcja zamiast kroplówki porcji.',
    variables: ['product_name'],
  },
  {
    id: 'dairy-t3-mkt-breakfast',
    phase: 't3',
    category: 'dairy',
    kind: 'marketing',
    title: 'Śniadaniowy push',
    body:
      'Jeśli serwujecie śniadania: wyróżnij zestaw z {{product_name}} (jogurt, omlet, tosty). Limit = stan partii.',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
  },
  {
    id: 'dairy-t2-ops-open',
    phase: 't2',
    category: 'dairy',
    kind: 'ops',
    title: 'Priorytet opakowań otwartych',
    body:
      'Najpierw zużyj otwarte {{product_name}}. Zamknięte trzymaj jako bufor — nie otwieraj nowych kartonów „na zapas”.',
    variables: ['product_name'],
  },
  {
    id: 'dairy-t2-kit-special',
    phase: 't2',
    category: 'dairy',
    kind: 'kitchen',
    title: 'Special nabiałowy',
    body:
      '{{dish_name}} z {{product_name}} jako special 48 h. Porcje policzone z {{qty}} {{unit}} — bez niedoszacowania.',
    variables: ['dish_name', 'product_name', 'qty', 'unit'],
  },
  {
    id: 'dairy-t2-mkt-combo',
    phase: 't2',
    category: 'dairy',
    kind: 'marketing',
    title: 'Combo kawa + deser',
    body:
      'Zestaw z deserem na bazie {{product_name}} w atrakcyjnej cenie łączonej — gość nie płaci więcej niż suma à la carte przy odmowie zestawu.',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
  },
  {
    id: 'dairy-t2-soc-chef',
    phase: 't2',
    category: 'dairy',
    kind: 'social',
    title: 'Pytanie do followersów',
    body:
      '„Słodkie czy wytrawne z {{product_name}}?” — wybór większości / jury kuchni decyduje o specialu. To konkurs pomysłów, nie loteria.',
    cta_label: 'Kopiuj post',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
  },
  {
    id: 'dairy-t1-ops-safety',
    phase: 't1',
    category: 'dairy',
    kind: 'ops',
    title: 'Ocena sensoryczna przed serwisem',
    body:
      'Przed użyciem {{product_name}}: wygląd, zapach, konsystencja. Wątpliwość = waste + dokumentacja, nigdy do gościa.',
    variables: ['product_name'],
  },
  {
    id: 'dairy-t1-kit-force-menu',
    phase: 't1',
    category: 'dairy',
    kind: 'kitchen',
    title: 'Wymuś zejście w serwisie',
    body:
      'Jedna pozycja obowiązkowa na tablicy dnia z {{product_name}}. Cel: zejść ze stanem przed jutrzejszą datą.',
    variables: ['product_name'],
  },
  {
    id: 'dairy-t1-mkt-staff',
    phase: 't1',
    category: 'dairy',
    kind: 'marketing',
    title: 'Rekomendacja kelnera',
    body:
      'Skrypt 10 słów: „Dziś polecamy {{dish_name}} — kończymy świeżą dostawę {{product_name}}”. Upsell bez nachalności.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name', 'product_name'],
  },
];

// ─── Mięso i ryby ────────────────────────────────────────────────────────────

const MEAT_FISH: ExpiryTip[] = [
  {
    id: 'meat-t3-ops-zone',
    phase: 't3',
    category: 'meat_fish',
    kind: 'ops',
    title: 'Strefa i etykieta',
    body:
      '{{product_name}}: dolna półka / osobna kuweta, 0–4°C (ryby bliżej 0–2°C). Data przyjęcia widoczna. Surowy drób osobno.',
    variables: ['product_name'],
  },
  {
    id: 'meat-t3-kit-portion',
    phase: 't3',
    category: 'meat_fish',
    kind: 'kitchen',
    title: 'Porcjowanie pod sprzedaż',
    body:
      'Rozportionuj {{product_name}} pod znane SKU menu. Policz porcje z {{qty}} {{unit}} i zablokuj nadmiarowe zamówienia zakupu.',
    variables: ['product_name', 'qty', 'unit'],
  },
  {
    id: 'meat-t3-kit-braise',
    phase: 't3',
    category: 'meat_fish',
    kind: 'kitchen',
    title: 'Duszenie / pulpety / tatar (gdy bezpieczne)',
    body:
      'Zaplanuj danie „przeróbkowe” z {{product_name}} (gulasz, pulpety, ryba w sosie) — wyższa rotacja niż sam grill à la carte.',
    variables: ['product_name'],
  },
  {
    id: 'meat-t3-mkt-cut',
    phase: 't3',
    category: 'meat_fish',
    kind: 'marketing',
    title: 'Kupon „cut of the week”',
    body:
      'Wyróżnij {{product_name}} jako cut tygodnia z krótkim opisem pochodzenia / marynaty. Limit porcji = stan.',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
  },
  {
    id: 'meat-t2-ops-freeze-policy',
    phase: 't2',
    category: 'meat_fish',
    kind: 'ops',
    title: 'Mrożenie tylko wg procedury',
    body:
      'Jeśli procedura HACCP pozwala na zamrożenie przed terminem — zrób to dziś z etykietą. Po terminie nie „ratuj” mrożeniem do sprzedaży.',
    variables: ['product_name'],
  },
  {
    id: 'meat-t2-kit-special',
    phase: 't2',
    category: 'meat_fish',
    kind: 'kitchen',
    title: 'Danie dnia z białka',
    body:
      '{{dish_name}} na bazie {{product_name}} — jedna produkcja na lunch + dinner. Unikaj trzymania surowego mięsa „na wszelki wypadek”.',
    variables: ['dish_name', 'product_name'],
  },
  {
    id: 'meat-t2-mkt-pair',
    phase: 't2',
    category: 'meat_fish',
    kind: 'marketing',
    title: 'Para z dodatkiem',
    body:
      'Menu lunch: {{dish_name}} + napój/zupa w cenie zestawu. Zachęta do wyboru białka z kończącej się partii.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
  },
  {
    id: 'meat-t2-soc-fire',
    phase: 't2',
    category: 'meat_fish',
    kind: 'social',
    title: 'Relacja z grill / patelni',
    body:
      'Krótki film: „{{product_name}} schodzi z grilla — {{restaurant_name}}”. CTA: pierwszy komentarz z poprawną odpowiedzią na pytanie o mięso = rabat (kryterium wiedzy).',
    cta_label: 'Kopiuj treść',
    legal_note: LEGAL_SHORT,
    variables: ['product_name', 'restaurant_name'],
  },
  {
    id: 'meat-t1-ops-critical',
    phase: 't1',
    category: 'meat_fish',
    kind: 'ops',
    title: 'Tryb krytyczny spożywczy',
    body:
      'Jutro data {{product_name}}. Dziś wyłącznie pełna obróbka termiczna wg receptury lub spis. Żadnej przeceny surowego poza procedurą bezpieczeństwa.',
    variables: ['product_name'],
  },
  {
    id: 'meat-t1-kit-urgent',
    phase: 't1',
    category: 'meat_fish',
    kind: 'kitchen',
    title: 'Wymuszone zejście w kuchni',
    body:
      'Ustaw {{product_name}} jako jedyny special białkowy. Po serwisie — inwentaryzacja i ewentualny waste z podpisem.',
    variables: ['product_name'],
  },
  {
    id: 'meat-t1-mkt-board',
    phase: 't1',
    category: 'meat_fish',
    kind: 'marketing',
    title: 'Tablica „ostatnie porcje”',
    body:
      'Jasny komunikat limitu porcji {{dish_name}}. Opcjonalnie quiz kucharza przy stoliku o zniżkę — przegrana = cena menu + forfeit humorystyczny.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
  },
];

// ─── Pieczywo i suche ────────────────────────────────────────────────────────

const DRY_BREAD: ExpiryTip[] = [
  {
    id: 'dry-t3-ops-airtight',
    phase: 't3',
    category: 'dry_bread',
    kind: 'ops',
    title: 'Szczelność i wilgoć',
    body:
      'Sprawdź opakowanie {{product_name}}: suchy magazyn, bez wilgoci. Pieczywo — oddziel od surowego mięsa i silnych zapachów.',
    variables: ['product_name'],
  },
  {
    id: 'dry-t3-kit-crouton',
    phase: 't3',
    category: 'dry_bread',
    kind: 'kitchen',
    title: 'Grzanki / panierka / pudding',
    body:
      'Zaplanuj grzanki do zupy, panierkę lub bread pudding z {{product_name}} — klasyczny Zero Waste pieczywa.',
    variables: ['product_name'],
  },
  {
    id: 'dry-t3-kit-pasta-day',
    phase: 't3',
    category: 'dry_bread',
    kind: 'kitchen',
    title: 'Dzień makaronu / kaszy',
    body:
      'Jeśli {{product_name}} to suchy produkt sypki: ustaw special obiadowy zużywający przewidywalną ilość z {{qty}} {{unit}}.',
    variables: ['product_name', 'qty', 'unit'],
  },
  {
    id: 'dry-t3-mkt-basket',
    phase: 't3',
    category: 'dry_bread',
    kind: 'marketing',
    title: 'Koszyk pieczywa do stolika',
    body:
      'Dopłata lub gratis przy daniu głównym — rotacja {{product_name}} bez wrażenia „starego chleba”.',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
  },
  {
    id: 'dry-t2-kit-toast',
    phase: 't2',
    category: 'dry_bread',
    kind: 'kitchen',
    title: 'Tosty / bruschetta / eggs Benedict',
    body:
      'Śniadania i przystawki na bazie {{product_name}} — szybkie zejście w 1–2 serwisach.',
    variables: ['product_name'],
  },
  {
    id: 'dry-t2-kit-flour-batch',
    phase: 't2',
    category: 'dry_bread',
    kind: 'kitchen',
    title: 'Jedna produkcja ciasta',
    body:
      'Zrób jedną partię ciasta / panierki / panade z {{product_name}} pod znany wolumen sprzedaży — unikaj otwierania kolejnych worków.',
    variables: ['product_name'],
  },
  {
    id: 'dry-t2-mkt-lunch',
    phase: 't2',
    category: 'dry_bread',
    kind: 'marketing',
    title: 'Lunch z dodatkiem pieczywa',
    body:
      'Zestaw lunchowy z {{dish_name}} + pieczywo z kończącej się partii. Komunikat sezonowy, nie „przeterminowane”.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
  },
  {
    id: 'dry-t2-soc-recipe',
    phase: 't2',
    category: 'dry_bread',
    kind: 'social',
    title: 'Konkurs na przepis z resztek pieczywa',
    body:
      '„Podaj pomysł na danie z {{product_name}} — najlepszy (nasze jury) dostaje zniżkę w {{restaurant_name}}”. Kryterium kreatywności.',
    cta_label: 'Kopiuj post',
    legal_note: LEGAL_SHORT,
    variables: ['product_name', 'restaurant_name'],
  },
  {
    id: 'dry-t1-ops-use-or-waste',
    phase: 't1',
    category: 'dry_bread',
    kind: 'ops',
    title: 'Decyzja: użycie lub spis',
    body:
      'Pieczywo i produkty wilgotne: dziś zużycie lub waste. Suche w zamknięciu — oceń zgodnie z datą i procedurą magazynu.',
    variables: ['product_name'],
  },
  {
    id: 'dry-t1-kit-force-side',
    phase: 't1',
    category: 'dry_bread',
    kind: 'kitchen',
    title: 'Dodatek obowiązkowy',
    body:
      'Każde danie główne z grzanką / porcją {{product_name}} do wyczerpania stanu {{qty}} {{unit}}.',
    variables: ['product_name', 'qty', 'unit'],
  },
  {
    id: 'dry-t1-mkt-staff-meal',
    phase: 't1',
    category: 'dry_bread',
    kind: 'marketing',
    title: 'Posiłek pracowniczy',
    body:
      'Bezpieczne, smaczne wykorzystanie {{product_name}} w posiłku zespołu — Zero Waste wewnętrzny przed spisem.',
    variables: ['product_name'],
  },
];

// ─── Dania główne (menu) ─────────────────────────────────────────────────────

const MAINS: ExpiryTip[] = [
  {
    id: 'mains-t3-ops-86',
    phase: 't3',
    category: 'mains',
    kind: 'ops',
    title: 'Policz porcje do 86',
    body:
      'Ustal, ile porcji {{dish_name}} zejdzie z partii. Wpisz limit w POS / tablicy — uniknij oversellu.',
    variables: ['dish_name'],
  },
  {
    id: 'mains-t3-kit-feature',
    phase: 't3',
    category: 'mains',
    kind: 'kitchen',
    title: 'Feature na 3 dni',
    body:
      'Ustaw {{dish_name}} jako rekomendację szefa na T-3→T-1. Stabilna jakość ważniejsza niż nowy experimental dish.',
    variables: ['dish_name'],
  },
  {
    id: 'mains-t3-mkt-soft-promo',
    phase: 't3',
    category: 'mains',
    kind: 'marketing',
    title: 'Delikatny push w menu',
    body:
      'Oznacz {{dish_name}} jako „polecane”. Mały rabat lub gratis napój — bez wrażenia wyprzedaży końcówki.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
  },
  {
    id: 'mains-t3-kit-side-cross',
    phase: 't3',
    category: 'mains',
    kind: 'kitchen',
    title: 'Cross-util składników',
    body:
      'Sprawdź, które garnishe z {{dish_name}} można użyć w zupie / przystawce, by zejść ze wspólnymi półproduktami.',
    variables: ['dish_name'],
  },
  {
    id: 'mains-t2-ops-brief-foh',
    phase: 't2',
    category: 'mains',
    kind: 'ops',
    title: 'FOH: jedna rekomendacja',
    body:
      'Cały serwis poleca wyłącznie {{dish_name}}. Mierz liczbę upsellów vs. stan w kuchni.',
    variables: ['dish_name'],
  },
  {
    id: 'mains-t2-kit-batch',
    phase: 't2',
    category: 'mains',
    kind: 'kitchen',
    title: 'Batch pod lunch',
    body:
      'Przygotuj partię {{dish_name}} pod przewidywany lunch — mniej hold time, szybsze zejście.',
    variables: ['dish_name'],
  },
  {
    id: 'mains-t2-mkt-hh',
    phase: 't2',
    category: 'mains',
    kind: 'marketing',
    title: 'Godziny specjalne',
    body:
      'Happy Hour na {{dish_name}} w {{restaurant_name}}: rabat lub dodatek. Gość bez promocji płaci cenę menu.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name', 'restaurant_name'],
  },
  {
    id: 'mains-t2-soc-limit',
    phase: 't2',
    category: 'mains',
    kind: 'social',
    title: 'Post limitu porcji',
    body:
      '„Zostało X porcji {{dish_name}} — zarezerwuj stoliki / przyjdź dziś.” Pierwszy komentarz z poprawną odpowiedzią na pytanie o danie = zniżka (skill), nie los.',
    cta_label: 'Kopiuj post',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
  },
  {
    id: 'mains-t1-ops-last',
    phase: 't1',
    category: 'mains',
    kind: 'ops',
    title: 'Ostatnie porcje — synchronizacja',
    body:
      'Kuchnia i sala: wspólny licznik porcji {{dish_name}}. Po zejściu — 86 i komunikat gościom.',
    variables: ['dish_name'],
  },
  {
    id: 'mains-t1-kit-all-in',
    phase: 't1',
    category: 'mains',
    kind: 'kitchen',
    title: 'All-in na jedną pozycję',
    body:
      'Nie rozpraszaj się nowymi specialami. Cały hold {{dish_name}} ma zejść dziś wieczorem.',
    variables: ['dish_name'],
  },
  {
    id: 'mains-t1-mkt-hh',
    phase: 't1',
    category: 'mains',
    kind: 'marketing',
    title: 'Mocna oferta wieczorna',
    body:
      'Wyraźny rabat lub zestaw na {{dish_name}}. Opcjonalnie gra przy stoliku (P-K-N / quiz) — przegrana bez dopłaty ponad menu.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
  },
];

// ─── Półprodukty ─────────────────────────────────────────────────────────────

const SEMI: ExpiryTip[] = [
  {
    id: 'semi-t3-ops-label',
    phase: 't3',
    category: 'semi',
    kind: 'ops',
    title: 'Etykieta produkcji',
    body:
      'Sprawdź etykietę {{product_name}}: data produkcji, ważności, ilość {{qty}} {{unit}}. FIFO w gastrze sosów / wywarów.',
    variables: ['product_name', 'qty', 'unit'],
  },
  {
    id: 'semi-t3-ops-cool',
    phase: 't3',
    category: 'semi',
    kind: 'ops',
    title: 'Łańcuch chłodniczy',
    body:
      'Utrzymuj {{product_name}} ≤5°C. Przed podaniem regeneracja do bezpiecznej temperatury w środku (≥75°C, jeśli dotyczy).',
    variables: ['product_name'],
  },
  {
    id: 'semi-t3-kit-menu-map',
    phase: 't3',
    category: 'semi',
    kind: 'kitchen',
    title: 'Mapa dań zużywających półprodukt',
    body:
      'Wypisz pozycje karty używające {{product_name}} (np. pasta z sosem kurkowym). Ustaw je jako priorytet sprzedaży.',
    variables: ['product_name'],
  },
  {
    id: 'semi-t3-mkt-pair-dish',
    phase: 't3',
    category: 'semi',
    kind: 'marketing',
    title: 'Wypchnij danie-nosiciel',
    body:
      'Promuj {{dish_name}} jako nośnik {{product_name}} — gość kupuje gotowe danie, Ty schodzisz z półproduktu.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name', 'product_name'],
  },
  {
    id: 'semi-t2-kit-extend-use',
    phase: 't2',
    category: 'semi',
    kind: 'kitchen',
    title: 'Drugie zastosowanie',
    body:
      'Sos / baza {{product_name}}: dodaj do zapiekanki, risotto, burger sauce — jedno SKU, kilka wyjść sprzedażowych.',
    variables: ['product_name'],
  },
  {
    id: 'semi-t2-kit-batch-cook',
    phase: 't2',
    category: 'semi',
    kind: 'kitchen',
    title: 'Serwis z jednej kuwety',
    body:
      'Nie otwieraj nowej produkcji {{product_name}}, dopóki schodzi bieżąca partia. Jedna kuweta = jeden serwis planowy.',
    variables: ['product_name'],
  },
  {
    id: 'semi-t2-mkt-pasta-night',
    phase: 't2',
    category: 'semi',
    kind: 'marketing',
    title: 'Wieczór pasty / sosu',
    body:
      'Tematyczny serwis: {{dish_name}} z {{product_name}} w cenie specjalnej lub z dodatkiem. Limit = stan półproduktu.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name', 'product_name'],
  },
  {
    id: 'semi-t2-soc-behind',
    phase: 't2',
    category: 'semi',
    kind: 'social',
    title: 'Behind the scenes bazy',
    body:
      'Pokaż {{product_name}} w kuchni {{restaurant_name}}. CTA kreatywne: „jak nazwiesz ten sos?” — jury wybiera, nagroda: zniżka na {{dish_name}}.',
    cta_label: 'Kopiuj post',
    legal_note: LEGAL_SHORT,
    variables: ['product_name', 'restaurant_name', 'dish_name'],
  },
  {
    id: 'semi-t1-ops-heat-serve',
    phase: 't1',
    category: 'semi',
    kind: 'ops',
    title: 'Zużyj lub spisz',
    body:
      'Ostatni dzień okna dla {{product_name}}. Regeneruj i serwuj wg receptury albo udokumentuj waste — bez „dojutrka”.',
    variables: ['product_name'],
  },
  {
    id: 'semi-t1-kit-force-carrier',
    phase: 't1',
    category: 'semi',
    kind: 'kitchen',
    title: 'Wymuś danie-nosiciel',
    body:
      'Jedyna rekomendacja kuchni: {{dish_name}} na bazie {{product_name}}. Cel: pusty pojemnik przed końcem serwisu.',
    variables: ['dish_name', 'product_name'],
  },
  {
    id: 'semi-t1-mkt-staff-up',
    phase: 't1',
    category: 'semi',
    kind: 'marketing',
    title: 'Skrypt sali + opcjonalna gra',
    body:
      'Kelner proponuje {{dish_name}}. Opcja: quiz o składniku sosu — poprawna odpowiedź = rabat; błędna = cena menu + uśmiech / rymowanka.',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
  },
];

/** Tipi operacyjne/kuchenne/marketing/social (bez osobnej tabeli gier — gry też tu jako kind game_safe w SAFE_GAMES_AS_TIPS) */
export const EXPIRY_TIPS: ExpiryTip[] = [
  ...GENERAL,
  ...PRODUCE,
  ...DAIRY,
  ...MEAT_FISH,
  ...DRY_BREAD,
  ...MAINS,
  ...SEMI,
  // Gry bezpieczne — jako tipy kind=game_safe (łatwy pickExpiryTips)
  {
    id: 'game-t2-first-comment',
    phase: 't2',
    category: 'general',
    kind: 'game_safe',
    title: 'Social: pierwszy merytoryczny komentarz',
    body:
      'Post o {{dish_name}} / {{product_name}}: nagroda dla pierwszej osoby, która spełni kryterium (np. poprawna odpowiedź lub pomysł na przepis). To konkurs z kryterium — nie losowanie wśród komentarzy.',
    cta_label: 'Uruchom pomysł',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name', 'product_name'],
    tags: ['#szybka'],
    venue_fit: 'social',
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t2-creative-caption',
    phase: 't2',
    category: 'general',
    kind: 'game_safe',
    title: 'Social: konkurs na podpis',
    body:
      'Goście proponują podpis pod zdjęciem {{dish_name}}. Jury {{restaurant_name}} wybiera zwycięzcę wg kreatywności. Bez losowania.',
    cta_label: 'Uruchom pomysł',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name', 'restaurant_name'],
    tags: ['#grupowa', '#śmieszna'],
    venue_fit: 'social',
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-rps-skill',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: 'W lokalu: papier-kamień-nożyce',
    body:
      'Gra zręcznościowa ze staffem o rabat na {{dish_name}}. Wygrana = zniżka. Przegrana = cena z menu + forfeit humorystyczny (bez kary finansowej). Udział dobrowolny — każdy może kupić po cenie menu bez gry.',
    cta_label: 'Uruchom przy stoliku',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka', '#śmieszna'],
    venue_fit: 'bar',
    duration_sec: 30,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-guess-weight',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: 'W lokalu: zgadnij wagę',
    body:
      'Gość zgaduje wagę porcji / składnika związanego z {{product_name}}. Najbliższy wynik wygrywa rabat. Umiejętność szacowania, nie los.',
    cta_label: 'Uruchom przy stoliku',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
    tags: ['#szybka'],
    venue_fit: 'table',
    duration_sec: 60,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-chef-quiz',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: 'W lokalu: pytanie szefa',
    body:
      'Jedno pytanie o {{dish_name}} lub składnik. Poprawna odpowiedź = rabat. Błędna = cena menu (bez dopłaty) + forfeit z listy humorów.',
    cta_label: 'Uruchom przy stoliku',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka'],
    venue_fit: 'table',
    duration_sec: 45,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-dice-bonus',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: 'Everyone wins: kostka bonusu',
    body:
      'Kostka ustala tylko wielkość rabatu na {{dish_name}} (np. 10/15/20%). Każdy uczestnik wygrywa co najmniej minimalny bonus; nikt nie płaci więcej niż cena menu.',
    cta_label: 'Uruchom przy stoliku',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka', '#śmieszna'],
    venue_fit: 'bar',
    duration_sec: 20,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-gentleman',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: 'Gentleman challenge',
    body:
      'Wyzwanie o zniżkę na {{dish_name}}. Porażka: pełna cena menu + niefinansowa konsekwencja (rymowanka, dad joke, uśmiech, story IG za zgodą). Nigdy kara finansowa ponad menu.',
    cta_label: 'Uruchom przy stoliku',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#śmieszna', '#odważna'],
    venue_fit: 'any',
    duration_sec: 60,
    custom_forfeit_allowed: true,
  },
  // ── Nowe gry (seed) ──────────────────────────────────────────────────────
  {
    id: 'game-t1-czarne-czerwone',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: 'Czarne czy Czerwone (kolor karty)',
    body:
      'Gość typuje kolor karty (czarny/czerwony) przed odkryciem — zabawa zręcznościowo-towarzyska przy barze o rabat na {{dish_name}}. ' +
      'Wygrana ≈ 80% off; przegrana = 100% ceny menu + opcjonalny forfeit (wachlowanie barmana podkładką). ' +
      'Udział dobrowolny — każdy może odejść i kupić po cenie menu bez gry. To nie loteria z obowiązkiem zakupu.',
    cta_label: 'Uruchom przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka', '#śmieszna'],
    venue_fit: 'bar',
    duration_sec: 30,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-thumb-war',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: 'Pojedynek na kciuki',
    body:
      'Pojedynek zręcznościowy (thumb war) ze staffem o rabat 50–80% na {{dish_name}}. ' +
      'Przegrana = cena menu + ogłoszenie „najsilniejszy kciuk przy stoliku”. Dobrowolne; bez gry = cena menu.',
    cta_label: 'Uruchom przy stoliku',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka', '#śmieszna'],
    venue_fit: 'table',
    duration_sec: 45,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-stopwatch',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: 'Rewolwerowiec / stoper',
    body:
      'Reakcja: zatrzymaj stoper jak najbliżej pełnej sekundy. Im bliżej — wyższy tier rabatu na {{dish_name}}. ' +
      'Daleko od celu = cena menu + salut (forfeit). Skill reakcji, nie los; udział dobrowolny.',
    cta_label: 'Uruchom przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka'],
    venue_fit: 'bar',
    duration_sec: 40,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t2-jenga',
    phase: 't2',
    category: 'general',
    kind: 'game_safe',
    title: 'Gastronomiczna Jenga',
    body:
      'Gra grupowa przy stole: wieża stoi do końca rundy → ~50% na rachunek stołu (lub na {{dish_name}} wg reguł lokalu). ' +
      'Kto przewróci → płaci pełną cenę swojej pozycji + śpiewa „Sto lat” (forfeit humorystyczny). ' +
      'Udział całego stolika dobrowolny; można odmówić i zamówić normalnie.',
    cta_label: 'Uruchom przy stole',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#grupowa', '#śmieszna'],
    venue_fit: 'table',
    duration_sec: 300,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t2-kalambury',
    phase: 't2',
    category: 'general',
    kind: 'game_safe',
    title: 'Szybkie Kalambury',
    body:
      'Kalambury o {{dish_name}} / {{product_name}}: odgadnięcie w limicie czasu = ~60% off. ' +
      'Porażka = cena menu + pantomima (mime forfeit). Konkurs umiejętności / kreatywności, nie loteria.',
    cta_label: 'Uruchom przy stole',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name', 'product_name'],
    tags: ['#grupowa'],
    venue_fit: 'table',
    duration_sec: 120,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-3kubki-bonus',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: '3 Kubki — wariant bonusowy (preferowany)',
    body:
      'Pod każdym kubkiem jest bonus (różne % rabatu / dodatek). Gość wybiera kubek — zawsze wygrywa co najmniej minimalny bonus na {{dish_name}}. ' +
      'Nikt nie płaci więcej niż cena menu; brak „przegranej zakupu”. Preferowany wariant prawny zamiast klasycznej skorupki.',
    cta_label: 'Uruchom przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka', '#odważna'],
    venue_fit: 'bar',
    duration_sec: 45,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-3kubki-shell',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: '3 Kubki — wariant klasyczny (wymaga przeglądu prawnego)',
    body:
      'UWAGA: klasyczna „skorupka” (zgadnij pod którym kubkiem) to mechanika bliska grze losowej. ' +
      'Nie rekomendujemy jako domyślnej promocji z obowiązkiem zakupu. Preferuj wariant bonusowy (game-t1-3kubki-bonus). ' +
      'Jeśli lokal rozważa ten wariant — tylko po konsultacji prawnej; udział w 100% dobrowolny; zawsze opcja ceny menu bez gry.',
    cta_label: 'Tylko po review prawnym',
    legal_note:
      'requires_legal_review — mechanika losowa; restaurator odpowiada za zgodność z prawem o grach. Preferuj wariant everyone-wins.',
    variables: ['dish_name'],
    tags: ['#szybka', '#odważna'],
    venue_fit: 'bar',
    duration_sec: 45,
    custom_forfeit_allowed: true,
    requires_legal_review: true,
  },
  {
    id: 'game-t3-blind-bid',
    phase: 't3',
    category: 'general',
    kind: 'game_safe',
    title: 'Licytacja w ciemno (oferta do szefa)',
    body:
      'Dobrowolna oferta „w ciemno” na {{dish_name}}: gość podaje kwotę, szef przyjmuje lub odrzuca (negocjacja, nie los). ' +
      'Odrzucenie = cena menu + łagodny forfeit z listy (np. toast Zero Waste / rymowanka). ' +
      'Opcjonalnie osobno: forfeit #odważna (np. makarena) — tylko za zgodą gościa, nigdy jako domyślny.',
    cta_label: 'Uruchom z szefem',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#odważna'],
    venue_fit: 'any',
    duration_sec: 90,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t2-blind-bid',
    phase: 't2',
    category: 'general',
    kind: 'game_safe',
    title: 'Licytacja w ciemno (oferta do szefa)',
    body:
      'Dobrowolna oferta „w ciemno” na {{dish_name}}: gość podaje kwotę, szef przyjmuje lub odrzuca (negocjacja). ' +
      'Odrzucenie = cena menu + łagodny forfeit z listy. Forfeit #odważna tylko opcjonalnie, za zgodą.',
    cta_label: 'Uruchom z szefem',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#odważna'],
    venue_fit: 'any',
    duration_sec: 90,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-blind-bid',
    phase: 't1',
    category: 'general',
    kind: 'game_safe',
    title: 'Licytacja w ciemno (oferta do szefa)',
    body:
      'Ostatni dzień partii: dobrowolna oferta „w ciemno” na {{dish_name}}. Szef akceptuje lub odrzuca — to negocjacja, nie hazard. ' +
      'Odrzucenie = cena menu + forfeit humorystyczny z listy (bez surowych/alkoholowych forfeitów domyślnych).',
    cta_label: 'Uruchom z szefem',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#odważna'],
    venue_fit: 'any',
    duration_sec: 90,
    custom_forfeit_allowed: true,
  },
];

export const SAFE_GAMES: SafeGameTemplate[] = [
  {
    id: 'game-t2-first-comment',
    phase: 't2',
    kind: 'game_safe',
    title: 'Pierwszy merytoryczny komentarz',
    body: 'Nagroda za spełnienie kryterium (odpowiedź / pomysł), nie za losowy wybór komentarza.',
    mechanic: 'social_contest',
    cta_label: 'Kopiuj brief social',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name', 'product_name', 'restaurant_name'],
    tags: ['#szybka'],
    venue_fit: 'social',
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t2-creative-caption',
    phase: 't2',
    kind: 'game_safe',
    title: 'Konkurs na podpis',
    body: 'Jury lokalu ocenia kreatywność podpisów pod zdjęciem dania.',
    mechanic: 'social_contest',
    cta_label: 'Kopiuj brief social',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name', 'restaurant_name'],
    tags: ['#grupowa', '#śmieszna'],
    venue_fit: 'social',
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-rps-skill',
    phase: 't1',
    kind: 'game_safe',
    title: 'Papier-kamień-nożyce (skill)',
    body: 'Decyzja gracza vs staff; przegrana bez dopłaty ponad menu.',
    mechanic: 'skill',
    cta_label: 'Karty zasad przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka', '#śmieszna'],
    venue_fit: 'bar',
    duration_sec: 30,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-guess-weight',
    phase: 't1',
    kind: 'game_safe',
    title: 'Zgadnij wagę',
    body: 'Najbliższy szacunek wygrywa — konkurs umiejętności.',
    mechanic: 'skill',
    cta_label: 'Karty zasad przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['product_name'],
    tags: ['#szybka'],
    venue_fit: 'table',
    duration_sec: 60,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-chef-quiz',
    phase: 't1',
    kind: 'game_safe',
    title: 'Pytanie szefa kuchni',
    body: 'Jedno pytanie merytoryczne = rabat lub cena menu + forfeit humor.',
    mechanic: 'skill',
    cta_label: 'Karty zasad przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka'],
    venue_fit: 'table',
    duration_sec: 45,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-dice-bonus',
    phase: 't1',
    kind: 'game_safe',
    title: 'Kostka tylko % bonusu',
    body: 'Wszyscy wygrywają rabat; kostka nie decyduje o obowiązku zakupu ani karze.',
    mechanic: 'everyone_wins',
    cta_label: 'Karty zasad przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka', '#śmieszna'],
    venue_fit: 'bar',
    duration_sec: 20,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-gentleman',
    phase: 't1',
    kind: 'game_safe',
    title: 'Gentleman challenge',
    body: 'Przegrana = cena menu + forfeit niefinansowy z listy.',
    mechanic: 'gentleman',
    cta_label: 'Karty zasad przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#śmieszna', '#odważna'],
    venue_fit: 'any',
    duration_sec: 60,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-czarne-czerwone',
    phase: 't1',
    kind: 'game_safe',
    title: 'Czarne czy Czerwone',
    body:
      'Typowanie koloru karty przy barze. Win ≈ 80% off; lose = 100% menu + opcjonalny forfeit (wachlowanie podkładką). Udział dobrowolny.',
    mechanic: 'skill',
    cta_label: 'Karty zasad przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka', '#śmieszna'],
    venue_fit: 'bar',
    duration_sec: 30,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-thumb-war',
    phase: 't1',
    kind: 'game_safe',
    title: 'Pojedynek na kciuki',
    body: 'Thumb war vs staff — skill. Win 50–80%; lose = cena menu + ogłoszenie najsilniejszego kciuka.',
    mechanic: 'skill',
    cta_label: 'Karty zasad przy stoliku',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka', '#śmieszna'],
    venue_fit: 'table',
    duration_sec: 45,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-stopwatch',
    phase: 't1',
    kind: 'game_safe',
    title: 'Rewolwerowiec / stoper',
    body: 'Zatrzymaj stoper na pełnej sekundzie — tier rabatu wg precyzji. Lose = salut. Skill reakcji.',
    mechanic: 'skill',
    cta_label: 'Karty zasad przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka'],
    venue_fit: 'bar',
    duration_sec: 40,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t2-jenga',
    phase: 't2',
    kind: 'game_safe',
    title: 'Gastronomiczna Jenga',
    body: 'Wieża stoi = ~50% stołu; przewrócenie = pełna cena pozycji + „Sto lat”. Gra grupowa, dobrowolna.',
    mechanic: 'skill',
    cta_label: 'Karty zasad przy stole',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#grupowa', '#śmieszna'],
    venue_fit: 'table',
    duration_sec: 300,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t2-kalambury',
    phase: 't2',
    kind: 'game_safe',
    title: 'Szybkie Kalambury',
    body: 'Odgadnięcie = ~60% off; porażka = mime forfeit. Skill / kreatywność.',
    mechanic: 'skill',
    cta_label: 'Karty zasad przy stole',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name', 'product_name'],
    tags: ['#grupowa'],
    venue_fit: 'table',
    duration_sec: 120,
    custom_forfeit_allowed: true,
  },
  {
    id: 'game-t1-3kubki-bonus',
    phase: 't1',
    kind: 'game_safe',
    title: '3 Kubki — bonus pod każdym (preferowany)',
    body: 'Każdy kubek ma bonus; gość zawsze wygrywa co najmniej minimum. Preferowany wariant prawny.',
    mechanic: 'everyone_wins',
    cta_label: 'Karty zasad przy barze',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#szybka', '#odważna'],
    venue_fit: 'bar',
    duration_sec: 45,
    custom_forfeit_allowed: true,
    preferred_variant_of: 'game-t1-3kubki-shell',
  },
  {
    id: 'game-t1-3kubki-shell',
    phase: 't1',
    kind: 'game_safe',
    title: '3 Kubki — skorupka (wymaga review prawnego)',
    body:
      'Klasyczna skorupka = mechanika losowa. Nie jako domyślna promocja z obowiązkiem zakupu. Preferuj game-t1-3kubki-bonus.',
    mechanic: 'everyone_wins',
    cta_label: 'Tylko po review prawnym',
    legal_note:
      'requires_legal_review — blisko gry losowej; restaurator odpowiada za zgodność z prawem. Preferuj wariant bonusowy.',
    variables: ['dish_name'],
    tags: ['#szybka', '#odważna'],
    venue_fit: 'bar',
    duration_sec: 45,
    custom_forfeit_allowed: true,
    requires_legal_review: true,
  },
  {
    id: 'game-t1-blind-bid',
    phase: 't1',
    phases: ['t3', 't2', 't1'],
    kind: 'game_safe',
    title: 'Licytacja w ciemno',
    body:
      'Dobrowolna oferta w ciemno — szef akceptuje/odrzuca (negocjacja, nie los). Odrzucenie = menu + łagodny forfeit. ' +
      'Forfeity #odważna (makarena / kaczuszki) tylko opcjonalnie, za zgodą — nigdy domyślnie.',
    mechanic: 'negotiation',
    cta_label: 'Karty zasad z szefem',
    legal_note: LEGAL_SHORT,
    variables: ['dish_name'],
    tags: ['#odważna'],
    venue_fit: 'any',
    duration_sec: 90,
    custom_forfeit_allowed: true,
  },
];

/** Forfeity niefinansowe — restaurator wybiera / customizuje pod lokal */
export const HUMOROUS_FORFEITS: string[] = [
  'Wyrecytuj krótką rymowankę o Zero Waste (możemy podpowiedzieć pierwsze wersy).',
  'Opowiedz jedną dad joke — salą ocenia głośnością westchnień.',
  'Uśmiechnij się do kuchni i powiedz „dzięki, że ratujecie jedzenie”.',
  'Zrób 10-sekundowy toast bez alkoholu za mniej marnowania.',
  'Za zgodą: story IG z hashtagiem {{restaurant_name}} i słowem ZeroWaste.',
  'Narysuj na serwetce buźkę i zostaw na tablicy Zero Waste.',
  'Zrób „chef’s clap” — trzy klaśnięcia w rytm kuchni.',
  'Powiedz po sąsiedzku przy stoliku: „dziś jem odpowiedzialnie”.',
  'Wachluj barmana podkładką przez 10 sekund (opcjonalny forfeit przy barze).',
  'Ogłoś przy stoliku: „oto najsilniejszy kciuk wieczoru”.',
  'Oddaj salut kuchni / barowi (3 sekundy powagi).',
  'Zaśpiewaj „Sto lat” (krótka wersja) dla stolika / kuchni.',
  'Pantomima (mime): odtwórz przygotowanie {{dish_name}} bez słów przez 15 s.',
  'Zrób mini-toast Zero Waste przy sąsiednim stoliku (bez alkoholu).',
];

/** Opcjonalne forfeity #odważna — NIGDY jako domyślne; tylko za wyraźną zgodą gościa */
export const BOLD_OPTIONAL_FORFEITS: string[] = [
  'Za zgodą: krótka Makarena przy stoliku (max 15 s).',
  'Za zgodą: „kaczuszki” / krótki taniec stołowy (max 10 s).',
];

/** Alias API / plan — ta sama lista co HUMOROUS_FORFEITS */
export const SAFE_FORFEITS = HUMOROUS_FORFEITS;

/** Placeholdery pod przyszły generator PDF regulaminu (Phase 3) */
export const REGULATION_PLACEHOLDERS = [
  'restaurant_name',
  'promo_name',
  'valid_from',
  'valid_to',
  'prize_description',
  'participation_rules',
  'organizer_address',
  'contact_email',
] as const;

export type RegulationPlaceholder = (typeof REGULATION_PLACEHOLDERS)[number];

export const REGULATION_OUTLINE_PL = `
REGULAMIN PROMOCJI / KONKURSU — {{promo_name}}
Organizator: {{restaurant_name}}, {{organizer_address}}, kontakt: {{contact_email}}
Okres: {{valid_from}} – {{valid_to}}

1. Charakter: konkurs umiejętności / konkurs z kryterium oceny / promocja „każdy wygrywa bonus”.
   To nie jest loteria ani gra hazardowa w rozumieniu przepisów o grach.
2. Udział: dobrowolny, dla osób pełnoletnich (alkohol — osobne reguły 18+).
3. Zasady udziału: {{participation_rules}}
4. Nagroda: {{prize_description}}. Wartość nagrody nie zobowiązuje do zakupu powyżej ceny menu.
5. Przegrana w grze zręcznościowej: cena z aktualnego menu + ewentualna konsekwencja niefinansowa ustalona z góry.
6. Dane osobowe: przetwarzane zgodnie z RODO wyłącznie w zakresie niezbędnym do wydania nagrody.
7. Organizator zastrzega prawo odwołania promocji z ważnych powodów (bezpieczeństwo żywności, wyczerpanie stanu).
`.trim();

function countBy<T extends string>(items: { [K in T]?: string }[], key: T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = String(item[key] ?? '');
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Statystyki katalogu — do dokumentacji / testów */
export const EXPIRY_TIPS_STATS = {
  total: EXPIRY_TIPS.length,
  byCategory: countBy(EXPIRY_TIPS, 'category'),
  byPhase: countBy(EXPIRY_TIPS, 'phase'),
  byKind: countBy(EXPIRY_TIPS, 'kind'),
  safeGames: SAFE_GAMES.length,
  safeGamesLegalReview: SAFE_GAMES.filter((g) => g.requires_legal_review).length,
  forfeits: HUMOROUS_FORFEITS.length,
  boldOptionalForfeits: BOLD_OPTIONAL_FORFEITS.length,
} as const;
