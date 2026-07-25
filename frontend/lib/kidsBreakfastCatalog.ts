/**
 * Katalog grafik — śniadania (plansza 48, 5×5).
 * Dania „dla dzieci” — nazwy gotowe; grafiki po dostarczeniu planszy.
 */
type DishImageEntry = {
  slug: string;
  category: 'kuchnia_polska';
  labelPl: string;
  aliases: string[];
  storagePath: string;
  localAsset: number;
  /** false = dodatek/gotowiec — ukryty w Inspiracjach (bez przepisu od zera) */
  recipeEligible?: boolean;
};

export const BREAKFAST_CATALOG: DishImageEntry[] = [
  { slug: 'omlet_francuski', category: 'kuchnia_polska', labelPl: 'Omlet francuski', aliases: ['omlet francuski', 'french omelette', 'omlet', 'omelette', 'puszysty omlet'], storagePath: 'dania/breakfast/breakfast_01.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_01.webp') },
  { slug: 'sniadanie_angielskie', category: 'kuchnia_polska', labelPl: 'Pełne śniadanie angielskie', aliases: ['śniadanie angielskie', 'full english', 'english breakfast', 'pełne śniadanie'], storagePath: 'dania/breakfast/breakfast_02.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_02.webp') },
  { slug: 'placuszki_ricotta', category: 'kuchnia_polska', labelPl: 'Placuszki z serem ricotta', aliases: ['placuszki ricotta', 'ricotta pancakes', 'hotcakes ricotta', 'placuszki z serem'], storagePath: 'dania/breakfast/breakfast_03.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_03.webp') },
  { slug: 'gofr_wytrawny_sniadanie', category: 'kuchnia_polska', labelPl: 'Wytrawny gofr śniadaniowy', aliases: ['wytrawny gofr', 'gofr śniadaniowy', 'savory waffle', 'gofr z boczkiem'], storagePath: 'dania/breakfast/breakfast_04.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_04.webp') },
  { slug: 'szakszuka', category: 'kuchnia_polska', labelPl: 'Szakszuka (Shakshuka)', aliases: ['szakszuka', 'shakshuka'], storagePath: 'dania/breakfast/breakfast_05.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_05.webp') },
  { slug: 'pieczona_owsianka', category: 'kuchnia_polska', labelPl: 'Pieczona owsianka', aliases: ['pieczona owsianka', 'baked oatmeal', 'owsianka z owocami', 'ciepła owsianka', 'owsianka'], storagePath: 'dania/breakfast/breakfast_06.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_06.webp') },
  { slug: 'quesadilla_sniadaniowa', category: 'kuchnia_polska', labelPl: 'Śniadaniowa quesadilla', aliases: ['śniadaniowa quesadilla', 'breakfast quesadilla', 'quesadilla śniadanie'], storagePath: 'dania/breakfast/breakfast_07.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_07.webp') },
  { slug: 'bajgiel_losos_sniadanie', category: 'kuchnia_polska', labelPl: 'Bajgiel z łososiem', aliases: ['bajgiel z łososiem', 'salmon bagel', 'bagel łosoś'], storagePath: 'dania/breakfast/breakfast_08.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_08.webp') },
  { slug: 'awokado_tost_zakwas', category: 'kuchnia_polska', labelPl: 'Awokado tost na zakwasie', aliases: ['awokado tost', 'avocado toast', 'tost z awokado', 'tost na zakwasie'], storagePath: 'dania/breakfast/breakfast_09.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_09.webp') },
  { slug: 'jajka_po_turecku_cilbir', category: 'kuchnia_polska', labelPl: 'Jajka po turecku (Cilbir)', aliases: ['jajka po turecku', 'cilbir', 'çılbır', 'turkish eggs'], storagePath: 'dania/breakfast/breakfast_10.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_10.webp') },
  { slug: 'hash_bataty_sniadanie', category: 'kuchnia_polska', labelPl: 'Śniadaniowy hash z batatów', aliases: ['hash z batatów', 'sweet potato hash', 'śniadaniowy hash', 'hash browns bataty'], storagePath: 'dania/breakfast/breakfast_11.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_11.webp') },
  { slug: 'pudding_chia_mango', category: 'kuchnia_polska', labelPl: 'Pudding chia z mango', aliases: ['pudding chia', 'chia pudding', 'pudding chia mango'], storagePath: 'dania/breakfast/breakfast_12.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_12.webp') },
  { slug: 'mini_burgery_sniadaniowe', category: 'kuchnia_polska', labelPl: 'Mini-burgery śniadaniowe (Sliders)', aliases: ['mini-burgery śniadaniowe', 'breakfast sliders', 'śniadaniowe sliders', 'mini burgery'], storagePath: 'dania/breakfast/breakfast_13.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_13.webp') },
  { slug: 'scones_borowki', category: 'kuchnia_polska', labelPl: 'Scones z borówkami', aliases: ['scones', 'scones z borówkami', 'blueberry scones'], storagePath: 'dania/breakfast/breakfast_14.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_14.webp') },
  { slug: 'muffiny_jajeczno_warzywne', category: 'kuchnia_polska', labelPl: 'Muffiny jajeczno-warzywne', aliases: ['muffiny jajeczne', 'egg muffins', 'muffiny warzywne', 'muffiny jajeczno-warzywne'], storagePath: 'dania/breakfast/breakfast_15.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_15.webp') },
  { slug: 'nalesnik_dutch_baby', category: 'kuchnia_polska', labelPl: 'Naleśnik Dutch Baby', aliases: ['dutch baby', 'naleśnik dutch baby', 'german pancake'], storagePath: 'dania/breakfast/breakfast_16.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_16.webp') },
  { slug: 'tost_croque_monsieur', category: 'kuchnia_polska', labelPl: 'Tost Croque Monsieur', aliases: ['croque monsieur', 'croque', 'tost croque'], storagePath: 'dania/breakfast/breakfast_17.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_17.webp') },
  { slug: 'breakfast_burrito', category: 'kuchnia_polska', labelPl: 'Breakfast Burrito', aliases: ['breakfast burrito', 'burrito śniadaniowe'], storagePath: 'dania/breakfast/breakfast_18.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_18.webp') },
  { slug: 'granola_jogurt_grecki', category: 'kuchnia_polska', labelPl: 'Granola z jogurtem greckim', aliases: ['granola', 'jogurt grecki', 'greek yogurt granola', 'jogurt grecki z granolą'], storagePath: 'dania/breakfast/breakfast_19.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_19.webp') },
  { slug: 'tost_jajko_chili_crisp', category: 'kuchnia_polska', labelPl: 'Tost z jajkiem i chili crisp', aliases: ['tost z jajkiem', 'chili crisp toast', 'jajko chili crisp'], storagePath: 'dania/breakfast/breakfast_20.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_20.webp') },
  { slug: 'cynamonka_sniadaniowa', category: 'kuchnia_polska', labelPl: 'Cynamonka śniadaniowa', aliases: ['cynamonka', 'cinnamon roll', 'drożdżówka cynamonowa'], storagePath: 'dania/breakfast/breakfast_21.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_21.webp') },
  { slug: 'placki_kukurydziane_salsa', category: 'kuchnia_polska', labelPl: 'Placki kukurydziane z salsą', aliases: ['placki kukurydziane', 'corn fritters', 'placki z kukurydzy'], storagePath: 'dania/breakfast/breakfast_22.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_22.webp') },
  { slug: 'paluszki_tosty_francuskie', category: 'kuchnia_polska', labelPl: 'Paluszki z tostów francuskich', aliases: ['paluszki tosty francuskie', 'french toast sticks', 'tosty francuskie paluszki'], storagePath: 'dania/breakfast/breakfast_23.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_23.webp') },
  { slug: 'jajka_w_gniezdzie_ziemniaczanym', category: 'kuchnia_polska', labelPl: 'Jajka w gnieździe ziemniaczanym', aliases: ['jajka w gnieździe', 'potato nest eggs', 'hash browns jajka'], storagePath: 'dania/breakfast/breakfast_24.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_24.webp') },
  { slug: 'maslo_ziolowe_sniadanie', category: 'kuchnia_polska', labelPl: 'Masło ziołowe', aliases: ['masło ziołowe', 'herb butter', 'masło ze świeżymi ziołami'], storagePath: 'dania/breakfast/breakfast_25.webp', localAsset: require('@/assets/premium/dishes/breakfast/breakfast_25.webp'), recipeEligible: false },
];

/** Nazwy „dla dzieci” — podpięcie grafik po planszy Midjourney. */
export const KIDS_DISH_NAMES: { slug: string; labelPl: string; recipeEligible: boolean }[] = [
  { slug: 'nuggetsy_kurczak', labelPl: 'Nuggetsy z kurczaka', recipeEligible: true },
  { slug: 'mini_pizza_pepperoni', labelPl: 'Mini-pizza Pepperoni', recipeEligible: true },
  { slug: 'racuchy_jablka', labelPl: 'Puszyste racuchy z jabłkami', recipeEligible: true },
  { slug: 'klopsiki_sos_pomidorowy', labelPl: 'Klopsiki w sosie pomidorowym', recipeEligible: true },
  { slug: 'pancakes_usmiechniete', labelPl: 'Uśmiechnięte pancakes', recipeEligible: true },
  { slug: 'mini_burgery_sliders', labelPl: 'Mini-burgery (Sliders)', recipeEligible: true },
  { slug: 'usmiechniete_frytki', labelPl: 'Uśmiechnięte frytki', recipeEligible: false },
  { slug: 'mac_and_cheese_dzieci', labelPl: 'Mac and Cheese', recipeEligible: true },
  { slug: 'polędwiczki_kurczak_tenders', labelPl: 'Polędwiczki z kurczaka (Tenders)', recipeEligible: true },
  { slug: 'nalesniki_slodkie', labelPl: 'Słodkie naleśniki', recipeEligible: true },
  { slug: 'mini_hot_dogi', labelPl: 'Mini hot-dogi', recipeEligible: true },
  { slug: 'szaszlyki_owocowe', labelPl: 'Kolorowe szaszłyki owocowe', recipeEligible: true },
  { slug: 'gwiazdki_bataty', labelPl: 'Gwiazdki z batatów', recipeEligible: true },
  { slug: 'paluszki_rybne_dzieci', labelPl: 'Paluszki rybne', recipeEligible: true },
  { slug: 'spaghetti_bolognese_dzieci', labelPl: 'Mała porcja Spaghetti Bolognese', recipeEligible: true },
  { slug: 'tosty_ser_grilled_cheese', labelPl: 'Tosty z serem (Grilled Cheese)', recipeEligible: true },
  { slug: 'mini_quesadilla', labelPl: 'Mini-quesadilla', recipeEligible: true },
  { slug: 'gofry_babelkowe', labelPl: 'Gofry bąbelkowe (Bubble Waffles)', recipeEligible: true },
  { slug: 'zupka_literki', labelPl: 'Zupka z makaronem literkami', recipeEligible: true },
  { slug: 'mini_corn_dogi', labelPl: 'Mini corn-dogi', recipeEligible: true },
  { slug: 'slupki_warzywne', labelPl: 'Słupki warzywne z dipem', recipeEligible: true },
  { slug: 'parfait_jogurtowy', labelPl: 'Deserek jogurtowy z owocami (Parfait)', recipeEligible: true },
  { slug: 'frytki_kratki', labelPl: 'Frytki kratki (Waffle fries)', recipeEligible: false },
  { slug: 'mini_tacos_kurczak', labelPl: 'Mini-tacos z kurczakiem', recipeEligible: true },
  { slug: 'szklanka_mleka', labelPl: 'Szklanka mleka', recipeEligible: false },
];
