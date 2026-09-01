/**
 * Rodzina katalogu ikon składników — żeby Magazyn nie mieszał nabiału z ziołami itd.
 */
import { normalizeFoodName } from '@/lib/foodNameNormalize';

export type IngredientImageFamily =
  | 'dairy'
  | 'meat'
  | 'fish'
  | 'veg'
  | 'fruit'
  | 'herbs'
  | 'dry'
  | 'liquid'
  | 'bread'
  | 'drink'
  | 'alcohol'
  | 'packaging'
  | 'other';

const FAMILY_RULES: { family: IngredientImageFamily; re: RegExp }[] = [
  {
    family: 'dairy',
    re: /\b(mascarpone|philadelphia|ricotta|mozzarella|mozarella|burrata|parmezan|parmesan|cheddar|feta|gouda|guda|brie|camembert|gorgonzola|rokpol|roquefort|emmental|pecorino|grana|halloumi|ser\w*|twarog|twaro|mleko|smietan|smietank|jogurt|kefir|maslo|butter|nabial|jajk|jaj |egg|yolk|cream cheese|ser krem)/,
  },
  {
    family: 'meat',
    re: /\b(mies|mieso|wolow|wieprz|schab|karkow|kurczak|indyk|kaczka|boczek|bacon|bekon|szynk|kielbas|salami|wedlin|antrikot|antrykot|stek|zeber|golonk|mielon|parowk|prosciutto)/,
  },
  {
    family: 'fish',
    re: /\b(ryb|losos|dorsz|tunczyk|tuna|krewet|malz|kalmar|owoc.?morza|sledz|makrel|pstrag|mintaj|dorada|halibut)/,
  },
  {
    family: 'herbs',
    re: /\b(bazyl|miet|rozmaryn|tymian|oregano|kolendr|pietruszk|natk|koperek|koper\b|szczypior|czaber|estragon|ziol|herb|kielk|grzyb|borowik|boczniak|pieczark|trufel)/,
  },
  {
    family: 'fruit',
    re: /\b(jablk|gruszk|banan|truskawk|malin|borowk|jagod|cytryn|limonk|pomarancz|grejpfrut|kiwi|mango|ananas|arbuz|melon|winogron|sliwka|brzoskw|nektaryn|owoc)/,
  },
  {
    family: 'veg',
    re: /\b(pomidor|cebula|czosnek|salat|ogorek|baklazan|marchew|ziemniak|papryk|brokul|kalafior|burak|kapust|szpinak|awokado|cukini|dyni|por\b|seler|rzodkiew|batat|fasol|groch|warzyw)/,
  },
  {
    family: 'bread',
    re: /\b(chleb|bulka|bagiet|ciabatta|tortilla|wrap|pieczyw|croissant|pita|focaccia)/,
  },
  {
    family: 'drink',
    re: /\b(woda|sok|napoj|cola|lemoniad|smoothie|herbata|kawa|espresso|latte)/,
  },
  {
    family: 'alcohol',
    re: /\b(wino|piwo|wodka|whisky|rum|gin|likier|szampan|prosecco)/,
  },
  {
    family: 'liquid',
    re: /\b(oliwa|ocet|olej|sos |ketchup|majonez|musztarda|bulion)/,
  },
  {
    family: 'dry',
    re: /\b(maka|ryz|makaron|cukier|sol\b|kasza|drozdze|przypraw|pieprz|curry|cynamon)/,
  },
  {
    family: 'packaging',
    re: /\b(opakowan|karton|pojemnik|folia|tacka|kubek|torba)/,
  },
];

const CATEGORY_TO_FAMILY: Record<string, IngredientImageFamily> = {
  nabial: 'dairy',
  mieso: 'meat',
  ryby_owoce_morza: 'fish',
  warzywa: 'veg',
  korzeniowe: 'veg',
  owoce: 'fruit',
  ziola_grzyby: 'herbs',
  sucha_spizarnia: 'dry',
  makarony_kasze: 'dry',
  plynna_spizarnia: 'liquid',
  pasty_bazy: 'liquid',
  pieczywo: 'bread',
  kawa_bar: 'drink',
  napoje: 'drink',
  wino_piwo: 'alcohol',
  alkohole_mocne: 'alcohol',
  opakowania: 'packaging',
  mrozonki: 'other',
  placeholdery: 'other',
  inne: 'other',
  kuchnia_polska: 'other',
};

const COMPAT: Record<IngredientImageFamily, Set<IngredientImageFamily>> = {
  dairy: new Set(['dairy']),
  meat: new Set(['meat']),
  fish: new Set(['fish']),
  veg: new Set(['veg', 'herbs']),
  fruit: new Set(['fruit']),
  herbs: new Set(['herbs', 'veg']),
  dry: new Set(['dry']),
  liquid: new Set(['liquid']),
  bread: new Set(['bread']),
  drink: new Set(['drink']),
  alcohol: new Set(['alcohol', 'drink']),
  packaging: new Set(['packaging']),
  other: new Set([
    'dairy', 'meat', 'fish', 'veg', 'fruit', 'herbs', 'dry', 'liquid',
    'bread', 'drink', 'alcohol', 'packaging', 'other',
  ]),
};

export function detectIngredientImageFamily(name: string): IngredientImageFamily {
  const q = normalizeFoodName(name);
  if (!q) return 'other';
  for (const rule of FAMILY_RULES) {
    if (rule.re.test(q)) return rule.family;
  }
  return 'other';
}

export function familyFromProductCategory(category: string): IngredientImageFamily {
  return CATEGORY_TO_FAMILY[category] ?? 'other';
}

export function ingredientFamiliesCompatible(
  queryFamily: IngredientImageFamily,
  entryFamily: IngredientImageFamily,
): boolean {
  if (queryFamily === 'other' || entryFamily === 'other') return true;
  return COMPAT[queryFamily]?.has(entryFamily) ?? false;
}

export function placeholderSlugForIngredientFamily(family: IngredientImageFamily): string {
  switch (family) {
    case 'dairy':
      return 'ph_sery_kregi';
    case 'meat':
      return 'ph_mieso_surowe_stek';
    case 'fish':
      return 'ph_ryby_swieze';
    case 'fruit':
      return 'ph_kosz_owoce';
    case 'herbs':
      return 'ph_ziola_doniczki';
    case 'veg':
      return 'ph_skrzynka_warzywa';
    case 'drink':
      return 'fiji_woda_butelka';
    case 'bread':
      return 'ph_kartony_brazowe';
    case 'liquid':
      return 'ph_butelki_dozujace_sosy';
    case 'dry':
      return 'ph_sloiczki_przyprawy';
    case 'alcohol':
      return 'fiji_woda_butelka';
    case 'packaging':
      return 'ph_torby_papier_kraft';
    default:
      return 'ph_skrzynka_warzywa';
  }
}

export function catalogCategoriesForFamily(family: IngredientImageFamily): string[] {
  switch (family) {
    case 'dairy':
      return ['nabial'];
    case 'meat':
      return ['mieso'];
    case 'fish':
      return ['ryby_owoce_morza'];
    case 'veg':
      return ['warzywa', 'korzeniowe'];
    case 'fruit':
      return ['owoce'];
    case 'herbs':
      return ['ziola_grzyby'];
    case 'dry':
      return ['sucha_spizarnia', 'makarony_kasze'];
    case 'liquid':
      return ['plynna_spizarnia', 'pasty_bazy'];
    case 'bread':
      return ['pieczywo'];
    case 'drink':
      return ['napoje', 'kawa_bar'];
    case 'alcohol':
      return ['wino_piwo', 'alkohole_mocne'];
    case 'packaging':
      return ['opakowania'];
    default:
      return ['nabial', 'warzywa', 'mieso', 'ziola_grzyby', 'owoce'];
  }
}
