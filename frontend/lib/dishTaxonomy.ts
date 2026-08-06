/**
 * Taksonomia + synonimy gastronomiczne (z `nazwy produktow.md`).
 * Matcher używa tego do: rozszerzenia zapytania, rodziny dania, zakazów krzyżowych.
 */

function normalizeDishName(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/ą/g, 'a')
    .replace(/ę/g, 'e')
    .replace(/ó/g, 'o')
    .replace(/ń/g, 'n')
    .replace(/ś/g, 's')
    .replace(/ć/g, 'c')
    .replace(/ź|ż/g, 'z')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemToken(t: string): string {
  let s = normalizeDishName(t);
  if (s.length < 3) return s;
  const pairs: [RegExp, string][] = [
    [/kaczk\w*/, 'kaczka'],
    [/kurczak\w*/, 'kurczak'],
    [/wolow\w*|beef/, 'wolowina'],
    [/wieprz\w*|schab\w*/, 'wieprzowina'],
    [/frytk\w*|fries/, 'frytki'],
    [/pierog\w*/, 'pierogi'],
  ];
  for (const [re, rep] of pairs) {
    if (re.test(s)) return rep;
  }
  return s;
}

/** Rozszerzona rodzina wizualna (szersza niż DishFamily w matcherce). */
export type TaxonomyFamily =
  | 'pizza'
  | 'focaccia'
  | 'pasta'
  | 'pierogi'
  | 'kluski'
  | 'placki'
  | 'burger'
  | 'kebab'
  | 'sushi'
  | 'wok'
  | 'bbq'
  | 'steak'
  | 'soup'
  | 'salad'
  | 'dessert'
  | 'drink'
  | 'coffee'
  | 'breakfast'
  | 'kids'
  | 'indian'
  | 'mexican'
  | 'georgian'
  | 'mediterranean'
  | 'middle_east_veg'
  | 'sauce'
  | 'sides'
  | 'meat'
  | 'fish'
  | 'vegan'
  | 'other';

type SynRule = {
  /** Jeśli nazwa pasuje — dodaj te warianty wyszukiwania / aliasy kanoniczne */
  re: RegExp;
  expand: string[];
  family?: TaxonomyFamily;
  tags?: string[];
};

/**
 * Synonimy / warianty nazw restauracyjnych → kanoniczne frazy do matchingu.
 * Kolejność: bardziej specyficzne reguły pierwsze.
 */
export const DISH_SYNONYM_RULES: SynRule[] = [
  // Kids
  { re: /\b(kids|junior|dzieciec|dla dzieci|happy meal|mini pizza|mini burger)\b/, expand: ['kids'], family: 'kids', tags: ['kids'] },

  // Pizza variants
  { re: /\b(pepperoni|salami piccante|pizza salami)\b/, expand: ['pizza pepperoni', 'pepperoni', 'pizza salami'], family: 'pizza', tags: ['pizza', 'pepperoni'] },
  { re: /\b(diavola|pikantna pizza)\b/, expand: ['pizza diavola', 'diavola'], family: 'pizza', tags: ['pizza'] },
  { re: /\b(hawajsk|hawaiian|ananas)\b.*\bpizza|\bpizza\b.*\b(hawajsk|ananas)\b/, expand: ['pizza hawajska', 'hawaiian pizza'], family: 'pizza', tags: ['pizza'] },
  { re: /\b(margherit|margarit)\b/, expand: ['pizza margherita', 'margherita'], family: 'pizza', tags: ['pizza'] },
  { re: /\b(quattro formaggi|4 sery|cztery sery|quatro formaggi)\b/, expand: ['pizza quattro formaggi', 'cztery sery'], family: 'pizza', tags: ['pizza', 'ser'] },
  { re: /\b(capriccios|capriciosa)\b/, expand: ['pizza capricciosa'], family: 'pizza', tags: ['pizza'] },
  { re: /\b(frutti di mare|seafood pizza|pizza owoce morza)\b/, expand: ['pizza frutti di mare'], family: 'pizza', tags: ['pizza', 'owoce morza'] },
  { re: /\b(calzone)\b/, expand: ['calzone', 'pizza calzone'], family: 'pizza', tags: ['pizza'] },
  { re: /\b(focaccia)\b/, expand: ['focaccia'], family: 'focaccia', tags: ['focaccia', 'pieczywo'] },
  { re: /\bpizza\b/, expand: ['pizza'], family: 'pizza', tags: ['pizza'] },

  // Pasta
  { re: /\b(carbonara)\b/, expand: ['spaghetti carbonara', 'carbonara'], family: 'pasta', tags: ['makaron', 'carbonara'] },
  { re: /\b(bolognese|bolonsk|ragu)\b/, expand: ['spaghetti bolognese', 'bolognese'], family: 'pasta', tags: ['makaron', 'wołowina'] },
  { re: /\b(arrabbiat)\b/, expand: ['penne arrabbiata', 'arrabbiata'], family: 'pasta', tags: ['makaron'] },
  { re: /\b(alfredo)\b/, expand: ['fettuccine alfredo', 'alfredo'], family: 'pasta', tags: ['makaron'] },
  { re: /\b(pesto)\b.*\b(makaron|pasta|trofie|penne)|(\bmakaron|\bpasta|\btrofie).*\bpesto\b/, expand: ['trofie pesto', 'pasta pesto'], family: 'pasta', tags: ['makaron', 'pesto'] },
  { re: /\b(lasagn[ae]|lazania)\b/, expand: ['lasagne', 'lasagna'], family: 'pasta', tags: ['makaron'] },
  { re: /\b(ravioli)\b/, expand: ['ravioli'], family: 'pasta', tags: ['makaron'] },
  { re: /\b(gnocchi)\b/, expand: ['gnocchi'], family: 'pasta', tags: ['gnocchi', 'makaron'] },
  { re: /\b(mac and cheese|macaroni cheese|makaron serowy)\b/, expand: ['mac and cheese'], family: 'pasta', tags: ['makaron', 'ser'] },
  { re: /\b(makaron|pasta|spaghetti|tagliatelle|penne|fettuccine|linguini|pappardelle)\b/, expand: ['makaron'], family: 'pasta', tags: ['makaron'] },

  // Polish dumplings — nie mieszać pierogi ↔ kluski ↔ placki
  { re: /\b(pierog\w*|uszka|pielmieni|wareniki)\b/, expand: ['pierogi'], family: 'pierogi', tags: ['pierogi'] },
  { re: /\b(kopytk\w*|kluski\w*|leniwe|pampuch\w*|pyzy|kartacz\w*|cepelin\w*|buchty)\b/, expand: ['kluski'], family: 'kluski', tags: ['kluski'] },
  { re: /\b(placki ziemniacz\w*|placek po zboj\w*|racuch\w*|baba ziemniacz\w*)\b/, expand: ['placki ziemniaczane'], family: 'placki', tags: ['placki', 'ziemniak'] },
  { re: /\b(nalesnik|crepes?)\b/, expand: ['nalesniki'], family: 'breakfast', tags: ['nalesniki'] },
  { re: /\b(schabow|kotlet schab|de volaille|golonka|golabk|gołąbki|bigos|rolada slask|gulasz)\b/, expand: ['danie polskie'], family: 'meat', tags: ['mięso', 'polskie'] },

  // Burger / BBQ / steak — nie mieszać
  { re: /\b(slider|mini burger)\b/, expand: ['sliders', 'mini burger'], family: 'burger', tags: ['burger'] },
  { re: /\b(burger|cheeseburger|hamburger)\b/, expand: ['burger'], family: 'burger', tags: ['burger'] },
  { re: /\b(zeberk|ribs|bbq ribs)\b/, expand: ['żeberka bbq', 'ribs'], family: 'bbq', tags: ['bbq', 'wieprzowina'] },
  { re: /\b(pulled pork|szarpana wieprz)\b/, expand: ['pulled pork'], family: 'bbq', tags: ['bbq', 'wieprzowina'] },
  { re: /\b(brisket|mostek wolow)\b/, expand: ['brisket'], family: 'bbq', tags: ['bbq', 'wołowina'] },
  { re: /\b(tomahawk|t.?bone|ribeye|rib eye|antrykot|stek)\b/, expand: ['stek', 'ribeye'], family: 'steak', tags: ['stek', 'wołowina'] },
  { re: /\b(buffalo wings|skrzydelka buffalo)\b/, expand: ['buffalo wings'], family: 'bbq', tags: ['kurczak', 'bbq'] },

  // Kebab / middle east
  { re: /\b(kebab|doner|döner|shawarma|gyro|shish|adana|kofta)\b/, expand: ['kebab'], family: 'kebab', tags: ['kebab', 'bliski wschód'] },
  { re: /\b(falafel|hummus|baba ghanoush|tabbouleh|fattoush|halloumi)\b/, expand: ['falafel'], family: 'middle_east_veg', tags: ['wege', 'bliski wschód'] },

  // Sushi
  { re: /\b(nigiri)\b/, expand: ['nigiri'], family: 'sushi', tags: ['sushi', 'nigiri', 'ryba'] },
  { re: /\b(sashimi)\b/, expand: ['sashimi'], family: 'sushi', tags: ['sushi', 'sashimi', 'ryba'] },
  { re: /\b(hosomaki|futomaki|uramaki|california|philadelphia|dragon roll|spicy tuna|tempura roll|maki)\b/, expand: ['sushi'], family: 'sushi', tags: ['sushi', 'ryba'] },
  { re: /\b(sushi)\b/, expand: ['sushi'], family: 'sushi', tags: ['sushi', 'ryba'] },

  // Asian wok
  { re: /\b(pad thai|padthai)\b/, expand: ['pad thai'], family: 'wok', tags: ['azja', 'makaron'] },
  { re: /\b(kung pao|gong bao)\b/, expand: ['kung pao'], family: 'wok', tags: ['azja', 'kurczak'] },
  { re: /\b(gyoza|jiaozi)\b/, expand: ['gyoza'], family: 'wok', tags: ['azja'] },
  { re: /\b(kaczka po pekins|peking duck|crispy duck)\b/, expand: ['kaczka po pekińsku', 'peking duck'], family: 'meat', tags: ['kaczka', 'azja'] },
  { re: /\b(wok|stir.?fry|chow mein|lo mein|fried rice|sma[zż]ony ry[zż]|nasi goreng)\b/, expand: ['wok'], family: 'wok', tags: ['azja', 'wok'] },

  // Indian
  { re: /\b(butter chicken|murgh makhani|maslany kurczak)\b/, expand: ['butter chicken'], family: 'indian', tags: ['indyjskie', 'kurczak', 'curry'] },
  { re: /\b(tikka masala|tikka)\b/, expand: ['chicken tikka masala', 'tikka'], family: 'indian', tags: ['indyjskie', 'curry'] },
  { re: /\b(biryani)\b/, expand: ['biryani'], family: 'indian', tags: ['indyjskie', 'ryż'] },
  { re: /\b(samosa)\b/, expand: ['samosa'], family: 'indian', tags: ['indyjskie'] },
  { re: /\b(naan)\b/, expand: ['naan', 'garlic naan'], family: 'indian', tags: ['indyjskie', 'pieczywo'] },
  { re: /\b(curry|korma|rogan josh|tandoori|palak paneer|chana masala|dal |daal )\b/, expand: ['curry'], family: 'indian', tags: ['indyjskie', 'curry'] },

  // Mexican
  { re: /\b(taco|tacos)\b/, expand: ['taco'], family: 'mexican', tags: ['meksykańskie', 'taco'] },
  { re: /\b(burrito)\b/, expand: ['burrito'], family: 'mexican', tags: ['meksykańskie'] },
  { re: /\b(quesadilla)\b/, expand: ['quesadilla'], family: 'mexican', tags: ['meksykańskie'] },
  { re: /\b(nachos|nachosy)\b/, expand: ['nachos'], family: 'mexican', tags: ['meksykańskie'] },
  { re: /\b(fajita|enchilada|chimichanga|guacamole|salsa)\b/, expand: ['meksykańskie'], family: 'mexican', tags: ['meksykańskie'] },

  // Georgian / Mediterranean
  { re: /\b(chaczapuri|khachapuri)\b/, expand: ['chaczapuri', 'khachapuri'], family: 'georgian', tags: ['gruzińskie'] },
  { re: /\b(khinkali|chinkali|gruzinskie pierogi)\b/, expand: ['khinkali'], family: 'georgian', tags: ['gruzińskie', 'pierogi'] },
  { re: /\b(paella)\b/, expand: ['paella'], family: 'mediterranean', tags: ['śródziemnomorskie'] },
  { re: /\b(moussaka|musaka|pastitsio)\b/, expand: ['moussaka'], family: 'mediterranean', tags: ['śródziemnomorskie'] },
  { re: /\b(gyros|souvlaki)\b/, expand: ['gyros'], family: 'mediterranean', tags: ['śródziemnomorskie'] },
  { re: /\b(tzatziki|hummus|dolma|dolmades)\b/, expand: ['hummus'], family: 'mediterranean', tags: ['śródziemnomorskie', 'dip'] },

  // Breakfast
  { re: /\b(jajecznica|omlet|omelette|eggs benedict|szakszuka|shakshuka|jajka sadzone|cilbir)\b/, expand: ['śniadanie jajeczne'], family: 'breakfast', tags: ['śniadanie', 'jajka'] },
  { re: /\b(pancake|gofry|waffle|owsianka|granola|french toast|tost francuski)\b/, expand: ['śniadanie słodkie'], family: 'breakfast', tags: ['śniadanie'] },
  { re: /\b(avocado toast|bajgiel|croissant|english muffin|śniadanie|breakfast)\b/, expand: ['śniadanie'], family: 'breakfast', tags: ['śniadanie'] },

  // Sides
  { re: /\b(frytki belgij|frytki steakhouse|frytki grube|frytki domowe|fries|frytk)\b/, expand: ['frytki', 'french fries'], family: 'sides', tags: ['frytki', 'dodatek'] },
  { re: /\b(onion rings|krążki cebul)\b/, expand: ['onion rings'], family: 'sides', tags: ['dodatek'] },
  { re: /\b(coleslaw|surowk)\b/, expand: ['coleslaw'], family: 'sides', tags: ['dodatek'] },

  // Soup / salad / dessert / drink / coffee
  { re: /\b(zupa|rosol|barszcz|zurek|gazpacho|ramen|pho|miso|bulion|krem z )\b/, expand: ['zupa'], family: 'soup', tags: ['zupa'] },
  { re: /\b(salatk|salad)\b/, expand: ['sałatka'], family: 'salad', tags: ['sałatka'] },
  { re: /\b(tiramisu|panna cotta|creme brulee|fondant|brownie|sernik|cheesecake|mus |mousse|deser|ciasto|tort)\b/, expand: ['deser'], family: 'dessert', tags: ['deser'] },
  { re: /\b(espresso|cappuccino|latte|flat white|americano|kawa)\b/, expand: ['kawa'], family: 'coffee', tags: ['kawa', 'napój'] },
  { re: /\b(herbata|tea|matcha|lemoniad|smoothie|sok |cola|woda|piwo|wino|koktajl|mojito|aperol)\b/, expand: ['napój'], family: 'drink', tags: ['napój'] },

  // Sauce
  { re: /\b(sos |sauce|aioli|gravy|bbq sauce|ketchup|majonez|musztarda|pesto|chimichurri)\b/, expand: ['sos'], family: 'sauce', tags: ['sos'] },
];

/** Pary rodzin, których NIGDY nie wolno krzyżować (doc: pizza≠focaccia, pierogi≠kluski…). */
export const FORBIDDEN_FAMILY_PAIRS: Array<[TaxonomyFamily, TaxonomyFamily]> = [
  ['pizza', 'focaccia'],
  ['pizza', 'pasta'],
  ['pierogi', 'kluski'],
  ['pierogi', 'placki'],
  ['kluski', 'placki'],
  ['burger', 'steak'],
  ['burger', 'bbq'],
  ['steak', 'burger'],
  ['sushi', 'wok'],
  ['sushi', 'soup'],
  ['dessert', 'soup'],
  ['dessert', 'meat'],
  ['dessert', 'pizza'],
  ['drink', 'meat'],
  ['drink', 'pizza'],
  ['coffee', 'dessert'],
  ['sauce', 'pasta'],
  ['sauce', 'pizza'],
  ['kids', 'steak'],
];

export function detectTaxonomyFamily(name: string): TaxonomyFamily {
  const n = normalizeDishName(name);
  for (const rule of DISH_SYNONYM_RULES) {
    if (rule.family && rule.re.test(n)) return rule.family;
  }
  return 'other';
}

export function familiesForbidden(a: TaxonomyFamily, b: TaxonomyFamily): boolean {
  if (a === 'other' || b === 'other' || a === b) return false;
  return FORBIDDEN_FAMILY_PAIRS.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}

/**
 * Zwraca listę znormalizowanych wariantów nazwy do wyszukania
 * (oryginał + synonimy z reguł).
 */
export function expandDishQuery(name: string): string[] {
  const n = normalizeDishName(name);
  if (!n) return [];
  const out = new Set<string>([n]);
  for (const rule of DISH_SYNONYM_RULES) {
    if (!rule.re.test(n)) continue;
    for (const e of rule.expand) {
      const ne = normalizeDishName(e);
      if (ne) out.add(ne);
    }
  }
  // tokeny znaczące jako dodatkowe hinty (np. „kurczak curry” → „curry”)
  for (const t of n.split(' ')) {
    if (t.length >= 4) out.add(t);
  }
  return [...out];
}

/** Tagi kontekstowe z taksonomii (łączone z extractDishContextTags). */
export function taxonomyContextTags(name: string): string[] {
  const n = normalizeDishName(name);
  const tags = new Set<string>();
  for (const rule of DISH_SYNONYM_RULES) {
    if (!rule.re.test(n)) continue;
    for (const t of rule.tags || []) tags.add(normalizeDishName(t));
  }
  return [...tags];
}

/** Preferowane slugi placeholderów wg taksonomii (kolejność = priorytet). */
export function taxonomyPlaceholderSlugs(family: TaxonomyFamily): string[] {
  switch (family) {
    case 'pizza':
      return ['pizza_margherita', 'pizza_pepperoni', 'pizza_hawajska'];
    case 'focaccia':
      return ['veggie_focaccia', 'focaccia_pizza'];
    case 'pasta':
      return ['spaghetti_carbonara', 'spaghetti_bolognese', 'penne_arrabbiata'];
    case 'pierogi':
      return ['pierogi_ruskie', 'pierogi_z_miesem', 'pierogi_kapusta_grzyby'];
    case 'kluski':
      return ['kopytka', 'kluski_slaskie', 'kluski_leniwe'];
    case 'placki':
      return ['placki_ziemniaczane', 'racuchy_jablka', 'racuchy_z_jablkami'];
    case 'burger':
      return ['classic_cheeseburger', 'burger_bbq_board'];
    case 'kebab':
      return ['kebab_rollo', 'kebab_talerz', 'szawarma_kurczak', 'gyros_talerz'];
    case 'sushi':
      return ['california_roll', 'sake_nigiri', 'futomaki_losos', 'kappa_hosomaki'];
    case 'wok':
      return ['pad_thai_krewetki', 'pad_thai_tofu', 'egg_fried_rice', 'kurczak_kung_pao'];
    case 'bbq':
      return ['zeberka_bbq', 'pulled_pork', 'brisket'];
    case 'steak':
      return ['stek_ribeye', 'stek_tbone', 'stek_tomahawk'];
    case 'soup':
      return ['rosol', 'zupa_pomidorowa', 'zurek'];
    case 'salad':
      return ['garden_salad', 'greek_salad'];
    case 'dessert':
      return ['tiramisu_ciasto', 'sernik_nowojorski', 'panna_cotta_maliny', 'brownie_czekoladowe'];
    case 'coffee':
      return ['espresso_klasyczne', 'cappuccino', 'latte_macchiato'];
    case 'drink':
      return ['lemoniada_cytrynowa', 'espresso_klasyczne'];
    case 'breakfast':
      return ['omlet_francuski', 'pancakes_amerykanskie_maslo', 'breakfast_burrito', 'muffiny_jajeczno_warzywne'];
    case 'kids':
      return ['mini_burgery_sliders', 'chicken_nuggets', 'mini_hot_dogi', 'classic_cheeseburger'];
    case 'indian':
      return ['butter_chicken', 'chicken_tikka_masala', 'naan'];
    case 'mexican':
      return ['tacos_wolowina', 'burrito', 'nachos_supreme', 'mini_tacos'];
    case 'georgian':
      return ['chaczapuri_adzarskie', 'chinkali', 'chaczapuri_imeretynskie'];
    case 'mediterranean':
      return ['greek_salad', 'hummus_klasyczny', 'paella_owoce_morza', 'gyros_talerz'];
    case 'middle_east_veg':
      return ['falafel_chrupiace', 'hummus_klasyczny', 'falafel_tahini_kebab'];
    case 'sauce':
      return ['sos_smietankowo_ziolowy', 'sos_bbq', 'sos_aioli_pieczony_czosnek', 'sos_maslowo_czosnkowy'];
    case 'sides':
      return ['french_fries', 'warzywa_grillowane', 'coleslaw'];
    case 'fish':
      return ['dorsz_pieczony', 'losos_maslo_ziolowe', 'fish_and_chips'];
    case 'vegan':
      return ['falafel_chrupiace', 'hummus_klasyczny', 'pad_thai_tofu'];
    case 'meat':
      return ['kotlet_schabowy', 'stek_ribeye', 'kotlet_de_volaille'];
    default:
      return [];
  }
}

/** Czy obraz (po ścieżce/slug/label) należy do zakazanej rodziny względem zapytania. */
export function imageFamilyConflictsQuery(
  queryFamily: TaxonomyFamily,
  imageBlob: string,
): boolean {
  if (queryFamily === 'other') return false;
  const blob = normalizeDishName(imageBlob);
  const detectFromBlob = (): TaxonomyFamily => {
    if (/\bfocaccia\b/.test(blob)) return 'focaccia';
    if (/\bpizza|calzone\b/.test(blob)) return 'pizza';
    if (/\bpierog|uszka\b/.test(blob)) return 'pierogi';
    if (/\bkopytk|kluski|leniwe|pampuch|kartacz|cepelin\b/.test(blob)) return 'kluski';
    if (/\bplacki ziemni|racuch|baba ziemni\b/.test(blob)) return 'placki';
    if (/\bburger|slider\b/.test(blob)) return 'burger';
    if (/\bstek|ribeye|tomahawk|t.?bone\b/.test(blob)) return 'steak';
    if (/\bsushi|nigiri|maki|sashimi\b/.test(blob)) return 'sushi';
    if (/\bwok|pad thai|stir.?fry\b/.test(blob)) return 'wok';
    if (/\bdeser|ciasto|tiramisu|sernik|brownie\b/.test(blob)) return 'dessert';
    return 'other';
  };
  const imgFam = detectFromBlob();
  return familiesForbidden(queryFamily, imgFam);
}

/** Mapowanie TaxonomyFamily → stara DishFamily (dla applyFamilyAdjustments). */
export function taxonomyToLegacyFamily(
  t: TaxonomyFamily,
):
  | 'sauces'
  | 'soups'
  | 'burgers'
  | 'pasta'
  | 'pizza'
  | 'salad'
  | 'dessert'
  | 'drink'
  | 'meat'
  | 'sides'
  | 'other' {
  switch (t) {
    case 'sauce':
      return 'sauces';
    case 'soup':
      return 'soups';
    case 'burger':
    case 'kids':
      return 'burgers';
    case 'pasta':
      return 'pasta';
    case 'pizza':
    case 'focaccia':
      return 'pizza';
    case 'salad':
      return 'salad';
    case 'dessert':
      return 'dessert';
    case 'drink':
    case 'coffee':
      return 'drink';
    case 'sides':
      return 'sides';
    case 'steak':
    case 'bbq':
    case 'meat':
    case 'kebab':
      return 'meat';
    case 'fish':
    case 'sushi':
      return 'meat';
    default:
      return 'other';
  }
}

/** Pomocnicze: czy token należy uznać za synonim drugiego. */
export function tokensSynonymMatch(a: string, b: string): boolean {
  const na = stemToken(a);
  const nb = stemToken(b);
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}
