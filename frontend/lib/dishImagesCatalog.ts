/**
 * Katalog grafik dań (zupy / burgery) — plansze 5×5, lokalne WebP.
 */
/** Rodzina menu do category-aware matching (1000+ assets). */
export type DishMenuFamily =
  | 'zupy'
  | 'burgery'
  | 'makarony'
  | 'pizze'
  | 'salatki'
  | 'przystawki'
  | 'miesa'
  | 'napoje'
  | 'desery'
  | 'sides'
  | 'kebab'
  | 'sushi'
  | 'bbq'
  | 'azjatycka'
  | 'indyjska'
  | 'meksykanska'
  | 'srodziemnomorska'
  | 'rybne'
  | 'wege'
  | 'sniadania'
  | 'sosy'
  | 'inne';

export type DishImageEntry = {
  slug: string;
  /** Legacy / broad tag — prefer menuFamily for matching */
  category: string;
  labelPl: string;
  aliases: string[];
  storagePath: string;
  localAsset: number;
  /** false = ukryj w module Inspiracje (dodatek / gotowiec) */
  recipeEligible?: boolean;
  /** Category-aware matching (inferred from storagePath if missing) */
  menuFamily?: DishMenuFamily;
  /** Dish plates are cooked by default */
  cooked?: boolean;
};

/** Infer menuFamily from storage path for category-aware dish matching. */
export function inferDishMenuFamily(storagePath: string, slug = ''): DishMenuFamily {
  const p = `${storagePath} ${slug}`.toLowerCase();
  if (/soup|zupa/.test(p)) return 'zupy';
  if (/burger|sandwich/.test(p)) return 'burgery';
  if (/pasta|makaron/.test(p)) return 'makarony';
  if (/pizza/.test(p)) return 'pizze';
  if (/salad|salatk/.test(p)) return 'salatki';
  if (/starter|app|przystawk|bruschett/.test(p)) return 'przystawki';
  if (/side|dodatk|surowk|coleslaw|warzywa_grill/.test(p)) return 'sides';
  if (/kebab|shawarma/.test(p)) return 'kebab';
  if (/sushi|nigiri|maki/.test(p)) return 'sushi';
  if (/bbq|ribs|grill|steak|roast|mieso|kotlet|schab/.test(p)) return 'bbq';
  if (/asian|pad_thai|ramen|wok|stir/.test(p)) return 'azjatycka';
  if (/indian|curry|tikka|butter_chicken/.test(p)) return 'indyjska';
  if (/mexican|taco|burrito/.test(p)) return 'meksykanska';
  if (/mediterr|paella|caucas|chaczapuri/.test(p)) return 'srodziemnomorska';
  if (/fish|ryb|losos|seafood/.test(p)) return 'rybne';
  if (/vegan|wege|tofu/.test(p)) return 'wege';
  if (/breakfast|sniadan|jajeczn/.test(p)) return 'sniadania';
  if (/sauce|sos|dip/.test(p)) return 'sosy';
  if (/dessert|cake|ice_cream|pancake|pastr|coffee|tea|lemonad|juice|cocktail|beer|wine|spirit|energy|napoj/.test(p)) {
    if (/coffee|tea|lemonad|juice|cocktail|beer|wine|spirit|energy/.test(p)) return 'napoje';
    return 'desery';
  }
  if (/dinner|obiad|polish|roast/.test(p)) return 'miesa';
  return 'inne';
}

export function stampDishCatalog(entries: DishImageEntry[]): DishImageEntry[] {
  return entries.map((e) => ({
    ...e,
    cooked: e.cooked ?? true,
    menuFamily: e.menuFamily ?? inferDishMenuFamily(e.storagePath, e.slug),
    category: e.menuFamily ?? inferDishMenuFamily(e.storagePath, e.slug),
  }));
}

/** Plansza 52 — zupy (poprawione, większe marginesy) */
export const SOUPS_PL_CATALOG: DishImageEntry[] = [
  { slug: 'rosol', category: 'kuchnia_polska', labelPl: 'Tradycyjny rosół z makaronem i marchewką', aliases: ['rosół', 'rosol', 'rosół z makaronem', 'tradycyjny rosół', 'rosół domowy'], storagePath: 'dania/soups_pl/soup_pl_01.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_01.webp') },
  { slug: 'zupa_pomidorowa', category: 'kuchnia_polska', labelPl: 'Zupa pomidorowa z ryżem i świeżą pietruszką', aliases: ['pomidorowa', 'tomato soup', 'krem pomidorowy', 'zupa pomidorowa z ryżem', 'zupa pomidorowa', 'tomato cream', 'krem z pomidorów', 'pomidorowa z ryżem', 'red tomato soup'], storagePath: 'dania/soups_pl/soup_pl_02.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_02.webp') },
  { slug: 'zurek', category: 'kuchnia_polska', labelPl: 'Żurek staropolski z białą kiełbasą i jajkiem', aliases: ['żurek', 'zurek', 'zur', 'barszcz biały', 'żurek staropolski'], storagePath: 'dania/soups_pl/soup_pl_03.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_03.webp') },
  { slug: 'krem_warzywny', category: 'kuchnia_polska', labelPl: 'Krem warzywny', aliases: ['krem warzywny', 'zupa krem warzywna', 'vegetable cream'], storagePath: 'dania/soups_pl/soup_pl_04.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_04.webp') },
  { slug: 'chlodnik', category: 'kuchnia_polska', labelPl: 'Chłodnik litewski z rzodkiewką i ogórkiem', aliases: ['chłodnik', 'chlodnik', 'chłodnik litewski', 'cold beet soup'], storagePath: 'dania/soups_pl/soup_pl_05.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_05.webp') },
  { slug: 'flaki', category: 'kuchnia_polska', labelPl: 'Flaki wołowe z majerankiem i przyprawami', aliases: ['flaki', 'flaczki', 'tripe soup', 'flaki wołowe'], storagePath: 'dania/soups_pl/soup_pl_06.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_06.webp') },
  { slug: 'zupa_cebulowa', category: 'kuchnia_polska', labelPl: 'Zupa cebulowa z zapieczoną grzanką serową', aliases: ['cebulowa', 'onion soup', 'zupa cebulowa'], storagePath: 'dania/soups_pl/soup_pl_07.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_07.webp') },
  { slug: 'krem_grzybowy', category: 'kuchnia_polska', labelPl: 'Krem grzybowy z leśnych grzybów z dodatkiem śmietanki', aliases: ['krem grzybowy', 'zupa grzybowa', 'mushroom cream', 'krem z grzybów'], storagePath: 'dania/soups_pl/soup_pl_08.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_08.webp') },
  { slug: 'barszcz_ukrainski', category: 'kuchnia_polska', labelPl: 'Barszcz ukraiński z fasolą i kapustą', aliases: ['barszcz ukraiński', 'barszcz ukrainski', 'borscht'], storagePath: 'dania/soups_pl/soup_pl_09.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_09.webp') },
  { slug: 'krem_brokulowy', category: 'kuchnia_polska', labelPl: 'Krem brokułowy posypany płatkami migdałów', aliases: ['krem brokułowy', 'krem brokulowy', 'broccoli cream', 'zupa brokułowa'], storagePath: 'dania/soups_pl/soup_pl_10.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_10.webp') },
  { slug: 'krem_dyniowy', category: 'kuchnia_polska', labelPl: 'Krem dyniowy z pieczonej dyni z pestkami', aliases: ['krem dyniowy', 'zupa dyniowa', 'pumpkin soup'], storagePath: 'dania/soups_pl/soup_pl_11.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_11.webp') },
  { slug: 'zupa_gulaszowa', category: 'kuchnia_polska', labelPl: 'Zupa gulaszowa z kawałkami wołowiny i papryki', aliases: ['gulaszowa', 'goulash soup', 'zupa gulaszowa'], storagePath: 'dania/soups_pl/soup_pl_12.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_12.webp') },
  { slug: 'bisque_owocow_morza', category: 'kuchnia_polska', labelPl: 'Bisque owoców morza', aliases: ['bisque', 'seafood bisque', 'krem z owoców morza'], storagePath: 'dania/soups_pl/soup_pl_13.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_13.webp') },
  { slug: 'zupa_tortilla', category: 'kuchnia_polska', labelPl: 'Zupa tortilla', aliases: ['tortilla soup', 'zupa tortilla'], storagePath: 'dania/soups_pl/soup_pl_14.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_14.webp') },
  { slug: 'minestrone', category: 'kuchnia_polska', labelPl: 'Minestrone', aliases: ['minestrone'], storagePath: 'dania/soups_pl/soup_pl_15.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_15.webp') },
  { slug: 'krem_pora_ziemniaka', category: 'kuchnia_polska', labelPl: 'Krem z pora i ziemniaka', aliases: ['krem z pora', 'leek potato', 'vichyssoise', 'zupa porowo-ziemniaczana'], storagePath: 'dania/soups_pl/soup_pl_16.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_16.webp') },
  { slug: 'zupa_grochowa', category: 'kuchnia_polska', labelPl: 'Zupa grochowa', aliases: ['grochowa', 'pea soup', 'grochówka'], storagePath: 'dania/soups_pl/soup_pl_17.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_17.webp') },
  { slug: 'tom_kha', category: 'kuchnia_polska', labelPl: 'Tom Kha', aliases: ['tom kha', 'tomka'], storagePath: 'dania/soups_pl/soup_pl_18.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_18.webp') },
  { slug: 'krem_zielonego_groszku', category: 'kuchnia_polska', labelPl: 'Krem z zielonego groszku z nutą mięty', aliases: ['krem z groszku', 'green pea cream', 'krem z zielonego groszku'], storagePath: 'dania/soups_pl/soup_pl_19.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_19.webp') },
  { slug: 'zupa_soczewicowa', category: 'kuchnia_polska', labelPl: 'Zupa soczewicowa', aliases: ['soczewicowa', 'lentil soup'], storagePath: 'dania/soups_pl/soup_pl_20.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_20.webp') },
  { slug: 'krem_szparagowy', category: 'kuchnia_polska', labelPl: 'Krem szparagowy ze świeżych zielonych szparagów', aliases: ['krem szparagowy', 'asparagus cream'], storagePath: 'dania/soups_pl/soup_pl_21.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_21.webp') },
  { slug: 'chowder_kukurydziany', category: 'kuchnia_polska', labelPl: 'Chowder kukurydziany z chrupiącym boczkiem', aliases: ['chowder', 'corn chowder', 'chowder kukurydziany'], storagePath: 'dania/soups_pl/soup_pl_22.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_22.webp') },
  { slug: 'krem_czosnkowy', category: 'kuchnia_polska', labelPl: 'Krem czosnkowy z pieczonego czosnku z grzankami', aliases: ['krem czosnkowy', 'garlic cream'], storagePath: 'dania/soups_pl/soup_pl_23.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_23.webp') },
  { slug: 'konsome_warzywne', category: 'kuchnia_polska', labelPl: 'Konsome warzywne', aliases: ['konsome', 'consomme', 'bulion warzywny'], storagePath: 'dania/soups_pl/soup_pl_24.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_24.webp') },
  { slug: 'gazpacho', category: 'kuchnia_polska', labelPl: 'Gazpacho', aliases: ['gazpacho', 'gazpacho andaluz', 'chłodnik pomidorowy', 'cold tomato soup', 'zupa gazpacho', 'hiszpańska zupa pomidorowa'], storagePath: 'dania/soups_pl/soup_pl_25.webp', localAsset: require('@/assets/premium/dishes/soups_pl/soup_pl_25.webp') },
];

export const SOUPS_ASIA_CATALOG: DishImageEntry[] = [
  { slug: 'shoyu_ramen', category: 'kuchnia_polska', labelPl: 'Shoyu Ramen', aliases: ['shoyu ramen', 'ramen shoyu', 'ramen'], storagePath: 'dania/soups_asia/soup_asia_01.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_01.webp') },
  { slug: 'tonkotsu_ramen', category: 'kuchnia_polska', labelPl: 'Tonkotsu Ramen', aliases: ['tonkotsu', 'tonkotsu ramen'], storagePath: 'dania/soups_asia/soup_asia_02.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_02.webp') },
  { slug: 'tantanmen_ramen', category: 'kuchnia_polska', labelPl: 'Tantanmen Ramen', aliases: ['tantanmen', 'spicy ramen', 'ostry ramen'], storagePath: 'dania/soups_asia/soup_asia_03.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_03.webp') },
  { slug: 'pho_bo', category: 'kuchnia_polska', labelPl: 'Pho Bo', aliases: ['pho bo', 'pho wołowina', 'pho z wołowiną'], storagePath: 'dania/soups_asia/soup_asia_04.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_04.webp') },
  { slug: 'pho_ga', category: 'kuchnia_polska', labelPl: 'Pho Ga', aliases: ['pho ga', 'pho kurczak', 'pho z kurczakiem'], storagePath: 'dania/soups_asia/soup_asia_05.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_05.webp') },
  { slug: 'tom_yum_goong', category: 'kuchnia_polska', labelPl: 'Tom Yum Goong', aliases: ['tom yum', 'tom yum goong', 'tom yam'], storagePath: 'dania/soups_asia/soup_asia_06.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_06.webp') },
  { slug: 'tom_kha_gai', category: 'kuchnia_polska', labelPl: 'Tom Kha Gai', aliases: ['tom kha gai', 'tom kha z kurczakiem'], storagePath: 'dania/soups_asia/soup_asia_07.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_07.webp') },
  { slug: 'zupa_miso', category: 'kuchnia_polska', labelPl: 'Zupa Miso', aliases: ['miso', 'zupa miso', 'miso soup'], storagePath: 'dania/soups_asia/soup_asia_08.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_08.webp') },
  { slug: 'laksa', category: 'kuchnia_polska', labelPl: 'Laksa malezyjska', aliases: ['laksa', 'laksa malezyjska'], storagePath: 'dania/soups_asia/soup_asia_09.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_09.webp') },
  { slug: 'hot_and_sour', category: 'kuchnia_polska', labelPl: 'Zupa ostro-kwaśna', aliases: ['hot and sour', 'ostro kwaśna', 'kwaśno-ostra'], storagePath: 'dania/soups_asia/soup_asia_10.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_10.webp') },
  { slug: 'wonton_soup', category: 'kuchnia_polska', labelPl: 'Zupa Wonton', aliases: ['wonton', 'zupa wonton'], storagePath: 'dania/soups_asia/soup_asia_11.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_11.webp') },
  { slug: 'egg_drop_soup', category: 'kuchnia_polska', labelPl: 'Chińska zupa jajeczna', aliases: ['egg drop', 'zupa jajeczna'], storagePath: 'dania/soups_asia/soup_asia_12.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_12.webp') },
  { slug: 'kimchi_jigae', category: 'kuchnia_polska', labelPl: 'Kimchi Jigae', aliases: ['kimchi jigae', 'kimchi jjigae'], storagePath: 'dania/soups_asia/soup_asia_13.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_13.webp') },
  { slug: 'samgyetang', category: 'kuchnia_polska', labelPl: 'Samgyetang', aliases: ['samgyetang', 'żeń-szeniem'], storagePath: 'dania/soups_asia/soup_asia_14.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_14.webp') },
  { slug: 'mulligatawny', category: 'kuchnia_polska', labelPl: 'Mulligatawny', aliases: ['mulligatawny', 'curry soup'], storagePath: 'dania/soups_asia/soup_asia_15.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_15.webp') },
  { slug: 'dal_soup', category: 'kuchnia_polska', labelPl: 'Dal', aliases: ['dal', 'daal'], storagePath: 'dania/soups_asia/soup_asia_16.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_16.webp') },
  { slug: 'taiwanese_beef_noodle', category: 'kuchnia_polska', labelPl: 'Tajwańska zupa z wołowiną i makaronem', aliases: ['tajwańska zupa', 'taiwanese beef noodle', 'niu rou mian'], storagePath: 'dania/soups_asia/soup_asia_17.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_17.webp') },
  { slug: 'udon_tempura', category: 'kuchnia_polska', labelPl: 'Udon', aliases: ['udon', 'udon tempura'], storagePath: 'dania/soups_asia/soup_asia_18.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_18.webp') },
  { slug: 'corn_chicken_soup', category: 'kuchnia_polska', labelPl: 'Chińska zupa kukurydziana z kurczakiem', aliases: ['zupa kukurydziana', 'corn chicken soup'], storagePath: 'dania/soups_asia/soup_asia_19.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_19.webp') },
  { slug: 'thukpa', category: 'kuchnia_polska', labelPl: 'Thukpa', aliases: ['thukpa', 'tybetańska zupa'], storagePath: 'dania/soups_asia/soup_asia_20.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_20.webp') },
  { slug: 'soto_ayam', category: 'kuchnia_polska', labelPl: 'Soto Ayam', aliases: ['soto ayam', 'soto'], storagePath: 'dania/soups_asia/soup_asia_21.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_21.webp') },
  { slug: 'shorbat_adas', category: 'kuchnia_polska', labelPl: 'Shorbat Adas', aliases: ['shorbat adas', 'shorba'], storagePath: 'dania/soups_asia/soup_asia_22.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_22.webp') },
  { slug: 'tom_yum_talay', category: 'kuchnia_polska', labelPl: 'Tom Yum Talay', aliases: ['tom yum talay', 'tom yum owoce morza'], storagePath: 'dania/soups_asia/soup_asia_23.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_23.webp') },
  { slug: 'soba_soup', category: 'kuchnia_polska', labelPl: 'Soba', aliases: ['soba', 'zupa soba'], storagePath: 'dania/soups_asia/soup_asia_24.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_24.webp') },
  { slug: 'congee', category: 'kuchnia_polska', labelPl: 'Congee', aliases: ['congee', 'kleik ryżowy'], storagePath: 'dania/soups_asia/soup_asia_25.webp', localAsset: require('@/assets/premium/dishes/soups_asia/soup_asia_25.webp') },
];

export const BURGERS_CATALOG: DishImageEntry[] = [
  { slug: 'classic_cheeseburger', category: 'kuchnia_polska', labelPl: 'Klasyczny cheeseburger wołowy', aliases: ['cheeseburger', 'burger wołowy', 'classic burger', 'hamburger', 'burger klasyczny', 'beef burger', 'burger'], storagePath: 'dania/burgers/burger_01.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_01.webp') },
  { slug: 'double_smash_burger', category: 'kuchnia_polska', labelPl: 'Podwójny smash burger', aliases: ['smash burger', 'double smash', 'podwójny burger', 'double burger'], storagePath: 'dania/burgers/burger_02.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_02.webp') },
  { slug: 'pulled_pork_sandwich', category: 'kuchnia_polska', labelPl: 'Kanapka z szarpaną wieprzowiną', aliases: ['pulled pork', 'szarpana wieprzowina', 'pork sandwich'], storagePath: 'dania/burgers/burger_03.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_03.webp') },
  { slug: 'chicken_avocado_burger', category: 'kuchnia_polska', labelPl: 'Burger z kurczakiem i awokado', aliases: ['burger z kurczakiem', 'chicken burger', 'kurczak awokado'], storagePath: 'dania/burgers/burger_04.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_04.webp') },
  { slug: 'fish_burger', category: 'kuchnia_polska', labelPl: 'Burger rybny', aliases: ['burger rybny', 'fish burger', 'fish sandwich'], storagePath: 'dania/burgers/burger_05.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_05.webp') },
  { slug: 'halloumi_burger', category: 'kuchnia_polska', labelPl: 'Wegetariański burger z halloumi', aliases: ['halloumi', 'burger halloumi', 'wege burger', 'vegetarian burger'], storagePath: 'dania/burgers/burger_06.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_06.webp') },
  { slug: 'vegan_burger', category: 'kuchnia_polska', labelPl: 'Wegański burger', aliases: ['vegan burger', 'beyond', 'wegański burger'], storagePath: 'dania/burgers/burger_07.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_07.webp') },
  { slug: 'bbq_brisket_sandwich', category: 'kuchnia_polska', labelPl: 'Kanapka z mostkiem BBQ', aliases: ['brisket', 'bbq brisket', 'mostek bbq'], storagePath: 'dania/burgers/burger_08.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_08.webp') },
  { slug: 'club_sandwich', category: 'kuchnia_polska', labelPl: 'Klasyczny club sandwich', aliases: ['club sandwich', 'club'], storagePath: 'dania/burgers/burger_09.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_09.webp') },
  { slug: 'reuben_sandwich', category: 'kuchnia_polska', labelPl: 'Kanapka Reuben', aliases: ['reuben', 'pastrami sandwich', 'pastrami'], storagePath: 'dania/burgers/burger_10.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_10.webp') },
  { slug: 'philly_cheesesteak', category: 'kuchnia_polska', labelPl: 'Philly cheesesteak', aliases: ['philly', 'philly cheese', 'philly sandwich'], storagePath: 'dania/burgers/burger_11.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_11.webp') },
  { slug: 'blt_sandwich', category: 'kuchnia_polska', labelPl: 'Kanapka BLT', aliases: ['blt', 'kanapka blt'], storagePath: 'dania/burgers/burger_12.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_12.webp') },
  { slug: 'salmon_bagel', category: 'kuchnia_polska', labelPl: 'Bajgiel z wędzonym łososiem', aliases: ['bagel', 'bajgiel', 'salmon bagel', 'lox'], storagePath: 'dania/burgers/burger_13.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_13.webp') },
  { slug: 'croque_monsieur', category: 'kuchnia_polska', labelPl: 'Croque monsieur', aliases: ['croque monsieur', 'croque'], storagePath: 'dania/burgers/burger_14.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_14.webp') },
  { slug: 'italian_panini', category: 'kuchnia_polska', labelPl: 'Włoskie panini', aliases: ['panini', 'panini mozzarella', 'panini pesto'], storagePath: 'dania/burgers/burger_15.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_15.webp') },
  { slug: 'cuban_sandwich', category: 'kuchnia_polska', labelPl: 'Kanapka kubańska', aliases: ['cuban', 'kubańska', 'cuban sandwich'], storagePath: 'dania/burgers/burger_16.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_16.webp') },
  { slug: 'sloppy_joe', category: 'kuchnia_polska', labelPl: 'Sloppy joe', aliases: ['sloppy joe', 'sloppy'], storagePath: 'dania/burgers/burger_17.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_17.webp') },
  { slug: 'portobello_burger', category: 'kuchnia_polska', labelPl: 'Burger z grzybem portobello', aliases: ['portobello', 'burger grzybowy', 'mushroom burger'], storagePath: 'dania/burgers/burger_18.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_18.webp') },
  { slug: 'katsu_sando', category: 'kuchnia_polska', labelPl: 'Katsu sando', aliases: ['katsu sando', 'katsu', 'tonkatsu sandwich'], storagePath: 'dania/burgers/burger_19.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_19.webp') },
  { slug: 'meatball_sub', category: 'kuchnia_polska', labelPl: 'Meatball sub', aliases: ['meatball', 'klopsiki kanapka', 'meatball sub'], storagePath: 'dania/burgers/burger_20.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_20.webp') },
  { slug: 'buffalo_chicken_sandwich', category: 'kuchnia_polska', labelPl: 'Buffalo chicken sandwich', aliases: ['buffalo', 'buffalo chicken', 'spicy chicken sandwich'], storagePath: 'dania/burgers/burger_21.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_21.webp') },
  { slug: 'turkey_club', category: 'kuchnia_polska', labelPl: 'Indyczy club sandwich', aliases: ['turkey club', 'indyczy club', 'turkey sandwich'], storagePath: 'dania/burgers/burger_22.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_22.webp') },
  { slug: 'banh_mi', category: 'kuchnia_polska', labelPl: 'Banh mi', aliases: ['banh mi', 'wietnamska bagietka'], storagePath: 'dania/burgers/burger_23.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_23.webp') },
  { slug: 'veggie_focaccia', category: 'kuchnia_polska', labelPl: 'Focaccia z pieczonymi warzywami', aliases: ['focaccia', 'focaccia warzywa'], storagePath: 'dania/burgers/burger_24.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_24.webp') },
  { slug: 'breakfast_brioche', category: 'kuchnia_polska', labelPl: 'Śniadaniowa bułka maślana', aliases: ['śniadaniowa bułka', 'breakfast brioche', 'bułka z jajkiem', 'breakfast sandwich'], storagePath: 'dania/burgers/burger_25.webp', localAsset: require('@/assets/premium/dishes/burgers/burger_25.webp') },
];

export const DISH_IMAGE_CATALOG: DishImageEntry[] = stampDishCatalog([
  ...SOUPS_PL_CATALOG,
  ...SOUPS_ASIA_CATALOG,
  ...BURGERS_CATALOG,
  // Lazy: street/apps dołączane przy pierwszym require (nie w magazynie)
  ...((): DishImageEntry[] => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('@/lib/streetAppsCatalog') as {
        STREET_FOOD_CATALOG: DishImageEntry[];
        FINE_APPS_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const s = require('@/lib/startersSaladsCatalog') as {
        STARTERS_CATALOG: DishImageEntry[];
        SALADS_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const d = require('@/lib/sidesKebabsDinnersCatalog') as {
        SIDES_CATALOG: DishImageEntry[];
        KEBABS_CATALOG: DishImageEntry[];
        DINNERS_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const p = require('@/lib/dumplingsPizzasPastasCatalog') as {
        DUMPLINGS_CATALOG: DishImageEntry[];
        PIZZAS_CATALOG: DishImageEntry[];
        PASTAS_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const b = require('@/lib/bbqSushiCatalog') as {
        BBQ_CATALOG: DishImageEntry[];
        SUSHI_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const aim = require('@/lib/asianIndianMexicanCatalog') as {
        ASIAN_CATALOG: DishImageEntry[];
        INDIAN_CATALOG: DishImageEntry[];
        MEXICAN_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mc = require('@/lib/mediterraneanCaucasianCatalog') as {
        MEDITERRANEAN_CATALOG: DishImageEntry[];
        CAUCASIAN_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fv = require('@/lib/fishVeganCatalog') as {
        FISH_CATALOG: DishImageEntry[];
        VEGAN_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const kb = require('@/lib/kidsBreakfastCatalog') as {
        BREAKFAST_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cd = require('@/lib/cakesDessertsCatalog') as {
        CAKES_CATALOG: DishImageEntry[];
        DESSERTS_CUPS_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ip = require('@/lib/iceCreamPancakesCatalog') as {
        ICE_CREAM_CATALOG: DishImageEntry[];
        PANCAKES_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fp = require('@/lib/frenchDessertsPastriesCatalog') as {
        FRENCH_DESSERTS_CATALOG: DishImageEntry[];
        PASTRIES_CATALOG: DishImageEntry[];
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cf = require('@/lib/coffeesCatalog') as { COFFEES_CATALOG: DishImageEntry[] };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tea = require('@/lib/teasCatalog') as { TEAS_CATALOG: DishImageEntry[] };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const lem = require('@/lib/lemonadesCatalog') as { LEMONADES_CATALOG: DishImageEntry[] };
      return [
        ...m.STREET_FOOD_CATALOG,
        ...s.STARTERS_CATALOG, // board 51 first — prefer over legacy fine apps
        ...m.FINE_APPS_CATALOG,
        ...s.SALADS_CATALOG,
        ...d.SIDES_CATALOG,
        ...d.KEBABS_CATALOG,
        ...d.DINNERS_CATALOG,
        ...p.DUMPLINGS_CATALOG,
        ...p.PIZZAS_CATALOG,
        ...p.PASTAS_CATALOG,
        ...b.BBQ_CATALOG,
        ...b.SUSHI_CATALOG,
        ...aim.ASIAN_CATALOG,
        ...aim.INDIAN_CATALOG,
        ...aim.MEXICAN_CATALOG,
        ...mc.MEDITERRANEAN_CATALOG,
        ...mc.CAUCASIAN_CATALOG,
        ...fv.FISH_CATALOG,
        ...fv.VEGAN_CATALOG,
        ...kb.BREAKFAST_CATALOG,
        ...cd.CAKES_CATALOG,
        ...cd.DESSERTS_CUPS_CATALOG,
        ...ip.ICE_CREAM_CATALOG,
        ...ip.PANCAKES_CATALOG,
        ...fp.FRENCH_DESSERTS_CATALOG,
        ...fp.PASTRIES_CATALOG,
        ...cf.COFFEES_CATALOG,
        ...tea.TEAS_CATALOG,
        ...lem.LEMONADES_CATALOG,
        ...((() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const j = require('@/lib/juicesCatalog') as { JUICES_CATALOG: DishImageEntry[] };
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const c = require('@/lib/cocktailsCatalog') as { COCKTAILS_CATALOG: DishImageEntry[] };
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const b2 = require('@/lib/beersCatalog') as { BEERS_CATALOG: DishImageEntry[] };
            return [...j.JUICES_CATALOG, ...c.COCKTAILS_CATALOG, ...b2.BEERS_CATALOG, ...((() => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const w = require('@/lib/winesCatalog') as { WINES_CATALOG: DishImageEntry[] };
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const sp = require('@/lib/spiritsCatalog') as { SPIRITS_CATALOG: DishImageEntry[] };
                return [...w.WINES_CATALOG, ...sp.SPIRITS_CATALOG, ...((() => {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const en = require('@/lib/energyDrinksCatalog') as { ENERGY_DRINKS_CATALOG: DishImageEntry[] };
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const cat = require('@/lib/cateringCatalog') as { CATERING_CATALOG: DishImageEntry[] };
                    return [...en.ENERGY_DRINKS_CATALOG, ...cat.CATERING_CATALOG, ...((() => {
                      try {
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const ro = require('@/lib/roastsCatalog') as { ROASTS_CATALOG: DishImageEntry[] };
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const pl = require('@/lib/polishCatalog') as { POLISH_CATALOG: DishImageEntry[] };
                        return [...ro.ROASTS_CATALOG, ...pl.POLISH_CATALOG, ...((() => {
                          try {
                            // eslint-disable-next-line @typescript-eslint/no-require-imports
                            const sauces = require('@/lib/saucesCatalog') as { SAUCES_CATALOG: DishImageEntry[] };
                            // eslint-disable-next-line @typescript-eslint/no-require-imports
                            const soupsPl2 = require('@/lib/soupsPolishCatalog') as { SOUPS_POLISH_CATALOG: DishImageEntry[] };
                            return [...sauces.SAUCES_CATALOG, ...soupsPl2.SOUPS_POLISH_CATALOG];
                          } catch {
                            return [] as DishImageEntry[];
                          }
                        })())];
                      } catch {
                        return [] as DishImageEntry[];
                      }
                    })())];
                  } catch {
                    return [] as DishImageEntry[];
                  }
                })())];
              } catch {
                return [] as DishImageEntry[];
              }
            })())];
          } catch {
            return [] as DishImageEntry[];
          }
        })()),
      ];
    } catch {
      return [];
    }
  })(),
]);
