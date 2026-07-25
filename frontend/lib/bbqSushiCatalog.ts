/**
 * Katalog grafik — BBQ/mięsa grillowane + sushi (plansze 5×5, WebP, padding przy cropie).
 */
type DishImageEntry = {
  slug: string;
  category: 'kuchnia_polska';
  labelPl: string;
  aliases: string[];
  storagePath: string;
  localAsset: number;
};

export const BBQ_CATALOG: DishImageEntry[] = [
  { slug: 'zeberka_bbq', category: 'kuchnia_polska', labelPl: 'Żeberka wieprzowe BBQ', aliases: ['żeberka', 'zeberka', 'bbq ribs', 'pork ribs', 'żeberka bbq'], storagePath: 'dania/bbq/bbq_01.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_01.webp') },
  { slug: 'stek_tbone', category: 'kuchnia_polska', labelPl: 'Stek T-bone', aliases: ['t-bone', 'tbone', 'stek t-bone', 'stek tbone'], storagePath: 'dania/bbq/bbq_02.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_02.webp') },
  { slug: 'stek_tomahawk', category: 'kuchnia_polska', labelPl: 'Stek Tomahawk', aliases: ['tomahawk', 'stek tomahawk'], storagePath: 'dania/bbq/bbq_03.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_03.webp') },
  { slug: 'stek_ribeye', category: 'kuchnia_polska', labelPl: 'Stek Ribeye', aliases: ['ribeye', 'stek ribeye', 'stek', 'steak', 'rostbef', 'roast beef', 'antrykot', 'antrikot'], storagePath: 'dania/bbq/bbq_04.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_04.webp') },
  { slug: 'pulled_pork', category: 'kuchnia_polska', labelPl: 'Szarpana wieprzowina', aliases: ['pulled pork', 'szarpana wieprzowina'], storagePath: 'dania/bbq/bbq_05.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_05.webp') },
  { slug: 'brisket', category: 'kuchnia_polska', labelPl: 'Wędzony mostek wołowy', aliases: ['brisket', 'mostek wołowy', 'wędzony mostek'], storagePath: 'dania/bbq/bbq_06.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_06.webp') },
  { slug: 'burger_bbq_board', category: 'kuchnia_polska', labelPl: 'Klasyczny burger wołowy', aliases: ['burger wołowy', 'classic burger'], storagePath: 'dania/bbq/bbq_07.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_07.webp') },
  { slug: 'buffalo_wings', category: 'kuchnia_polska', labelPl: 'Skrzydełka Buffalo', aliases: ['buffalo', 'skrzydełka', 'chicken wings'], storagePath: 'dania/bbq/bbq_08.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_08.webp') },
  { slug: 'palki_bbq', category: 'kuchnia_polska', labelPl: 'Pałki z kurczaka BBQ', aliases: ['pałki z kurczaka', 'pałki bbq', 'drumsticks'], storagePath: 'dania/bbq/bbq_09.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_09.webp') },
  { slug: 'kukurydza_grill', category: 'kuchnia_polska', labelPl: 'Grillowane kolby kukurydzy', aliases: ['kukurydza grill', 'corn on the cob', 'kolby kukurydzy'], storagePath: 'dania/bbq/bbq_10.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_10.webp') },
  { slug: 'ziemniak_faszerowany', category: 'kuchnia_polska', labelPl: 'Faszerowany pieczony ziemniak', aliases: ['faszerowany ziemniak', 'baked potato', 'ziemniak pieczony'], storagePath: 'dania/bbq/bbq_11.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_11.webp') },
  { slug: 'frytki_bataty', category: 'kuchnia_polska', labelPl: 'Frytki z batatów', aliases: ['frytki z batatów', 'sweet potato fries', 'bataty frytki'], storagePath: 'dania/bbq/bbq_12.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_12.webp') },
  { slug: 'onion_rings_tower', category: 'kuchnia_polska', labelPl: 'Wieża z krążków cebulowych', aliases: ['krążki cebulowe', 'onion rings', 'wieża cebulowa'], storagePath: 'dania/bbq/bbq_13.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_13.webp') },
  { slug: 'burnt_ends', category: 'kuchnia_polska', labelPl: 'Burnt ends', aliases: ['burnt ends', 'burnt end'], storagePath: 'dania/bbq/bbq_14.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_14.webp') },
  { slug: 'hot_links', category: 'kuchnia_polska', labelPl: 'Wędzone kiełbaski', aliases: ['hot links', 'kiełbaski grill', 'wędzone kiełbaski'], storagePath: 'dania/bbq/bbq_15.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_15.webp') },
  { slug: 'udko_indyka', category: 'kuchnia_polska', labelPl: 'Wędzone udko indyka', aliases: ['udko indyka', 'turkey leg', 'indyka wędzone'], storagePath: 'dania/bbq/bbq_16.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_16.webp') },
  { slug: 'sliders', category: 'kuchnia_polska', labelPl: 'Mini burgery', aliases: ['sliders', 'mini burgery', 'mini burger'], storagePath: 'dania/bbq/bbq_17.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_17.webp') },
  { slug: 'cornbread', category: 'kuchnia_polska', labelPl: 'Chlebek kukurydziany', aliases: ['cornbread', 'chlebek kukurydziany'], storagePath: 'dania/bbq/bbq_18.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_18.webp') },
  { slug: 'baked_beans', category: 'kuchnia_polska', labelPl: 'Pieczona fasola', aliases: ['baked beans', 'pieczona fasola', 'fasola w sosie'], storagePath: 'dania/bbq/bbq_19.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_19.webp') },
  { slug: 'coleslaw_bbq', category: 'kuchnia_polska', labelPl: 'Sałatka Coleslaw', aliases: ['coleslaw'], storagePath: 'dania/bbq/bbq_20.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_20.webp') },
  { slug: 'mac_cheese_bites_bbq', category: 'kuchnia_polska', labelPl: 'Kulki Mac and Cheese', aliases: ['mac and cheese bites', 'kulki mac and cheese'], storagePath: 'dania/bbq/bbq_21.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_21.webp') },
  { slug: 'szparagi_grill', category: 'kuchnia_polska', labelPl: 'Grillowane szparagi', aliases: ['szparagi grill', 'grillowane szparagi', 'asparagus'], storagePath: 'dania/bbq/bbq_22.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_22.webp') },
  { slug: 'sos_bbq', category: 'kuchnia_polska', labelPl: 'Sos BBQ', aliases: ['sos bbq', 'bbq sauce'], storagePath: 'dania/bbq/bbq_23.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_23.webp') },
  { slug: 'sos_miodowo_musztardowy', category: 'kuchnia_polska', labelPl: 'Sos miodowo-musztardowy', aliases: ['miodowo-musztardowy', 'honey mustard'], storagePath: 'dania/bbq/bbq_24.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_24.webp') },
  { slug: 'sos_blue_cheese', category: 'kuchnia_polska', labelPl: 'Sos z sera pleśniowego', aliases: ['blue cheese', 'sos blue cheese', 'sos z sera pleśniowego'], storagePath: 'dania/bbq/bbq_25.webp', localAsset: require('@/assets/premium/dishes/bbq/bbq_25.webp') },
];

export const SUSHI_CATALOG: DishImageEntry[] = [
  { slug: 'sake_nigiri', category: 'kuchnia_polska', labelPl: 'Sake Nigiri', aliases: ['sake nigiri', 'nigiri łosoś', 'nigiri losos'], storagePath: 'dania/sushi/sushi_01.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_01.webp') },
  { slug: 'maguro_nigiri', category: 'kuchnia_polska', labelPl: 'Maguro Nigiri', aliases: ['maguro nigiri', 'nigiri tuńczyk', 'nigiri tunczyk'], storagePath: 'dania/sushi/sushi_02.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_02.webp') },
  { slug: 'ebi_nigiri', category: 'kuchnia_polska', labelPl: 'Ebi Nigiri', aliases: ['ebi nigiri', 'nigiri krewetka'], storagePath: 'dania/sushi/sushi_03.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_03.webp') },
  { slug: 'kappa_hosomaki', category: 'kuchnia_polska', labelPl: 'Kappa Hosomaki', aliases: ['kappa', 'hosomaki ogórek', 'kappa hosomaki'], storagePath: 'dania/sushi/sushi_04.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_04.webp') },
  { slug: 'sake_hosomaki', category: 'kuchnia_polska', labelPl: 'Sake Hosomaki', aliases: ['sake hosomaki', 'hosomaki łosoś'], storagePath: 'dania/sushi/sushi_05.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_05.webp') },
  { slug: 'futomaki_losos', category: 'kuchnia_polska', labelPl: 'Futomaki z łososiem', aliases: ['futomaki', 'futomaki łosoś'], storagePath: 'dania/sushi/sushi_06.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_06.webp') },
  { slug: 'california_roll', category: 'kuchnia_polska', labelPl: 'California Roll', aliases: ['california', 'california roll'], storagePath: 'dania/sushi/sushi_07.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_07.webp') },
  { slug: 'ebi_ten_uramaki', category: 'kuchnia_polska', labelPl: 'Ebi Ten Uramaki', aliases: ['ebi ten', 'uramaki krewetka', 'ebi ten uramaki'], storagePath: 'dania/sushi/sushi_08.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_08.webp') },
  { slug: 'philadelphia_roll', category: 'kuchnia_polska', labelPl: 'Philadelphia Roll', aliases: ['philadelphia', 'philadelphia roll'], storagePath: 'dania/sushi/sushi_09.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_09.webp') },
  { slug: 'dragon_roll', category: 'kuchnia_polska', labelPl: 'Dragon Roll', aliases: ['dragon roll', 'dragon'], storagePath: 'dania/sushi/sushi_10.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_10.webp') },
  { slug: 'rainbow_roll', category: 'kuchnia_polska', labelPl: 'Rainbow Roll', aliases: ['rainbow', 'rainbow roll'], storagePath: 'dania/sushi/sushi_11.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_11.webp') },
  { slug: 'spicy_tuna', category: 'kuchnia_polska', labelPl: 'Spicy Tuna Uramaki', aliases: ['spicy tuna', 'pikantny tuńczyk'], storagePath: 'dania/sushi/sushi_12.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_12.webp') },
  { slug: 'panko_fried_maki', category: 'kuchnia_polska', labelPl: 'Panko Fried Maki', aliases: ['panko', 'panko fried', 'smażone maki'], storagePath: 'dania/sushi/sushi_13.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_13.webp') },
  { slug: 'gunkan_sake', category: 'kuchnia_polska', labelPl: 'Gunkan z tatarem z łososia', aliases: ['gunkan łosoś', 'gunkan sake'], storagePath: 'dania/sushi/sushi_14.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_14.webp') },
  { slug: 'gunkan_tuna', category: 'kuchnia_polska', labelPl: 'Gunkan z tatarem z tuńczyka', aliases: ['gunkan tuńczyk', 'gunkan tuna'], storagePath: 'dania/sushi/sushi_15.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_15.webp') },
  { slug: 'sake_sashimi', category: 'kuchnia_polska', labelPl: 'Sake Sashimi', aliases: ['sashimi łosoś', 'sake sashimi', 'sashimi'], storagePath: 'dania/sushi/sushi_16.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_16.webp') },
  { slug: 'maguro_sashimi', category: 'kuchnia_polska', labelPl: 'Maguro Sashimi', aliases: ['sashimi tuńczyk', 'maguro sashimi'], storagePath: 'dania/sushi/sushi_17.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_17.webp') },
  { slug: 'goma_wakame', category: 'kuchnia_polska', labelPl: 'Sałatka Goma Wakame', aliases: ['wakame', 'goma wakame', 'sałatka alg'], storagePath: 'dania/sushi/sushi_18.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_18.webp') },
  { slug: 'edamame', category: 'kuchnia_polska', labelPl: 'Edamame', aliases: ['edamame'], storagePath: 'dania/sushi/sushi_19.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_19.webp') },
  { slug: 'miso_soup_sushi', category: 'kuchnia_polska', labelPl: 'Zupa Miso', aliases: ['miso', 'zupa miso'], storagePath: 'dania/sushi/sushi_20.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_20.webp') },
  { slug: 'wasabi', category: 'kuchnia_polska', labelPl: 'Wasabi', aliases: ['wasabi'], storagePath: 'dania/sushi/sushi_21.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_21.webp') },
  { slug: 'gari', category: 'kuchnia_polska', labelPl: 'Imbir marynowany', aliases: ['gari', 'imbir marynowany', 'pickled ginger'], storagePath: 'dania/sushi/sushi_22.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_22.webp') },
  { slug: 'sos_sojowy', category: 'kuchnia_polska', labelPl: 'Sos sojowy', aliases: ['sos sojowy', 'soy sauce', 'shoyu'], storagePath: 'dania/sushi/sushi_23.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_23.webp') },
  { slug: 'spicy_mayo', category: 'kuchnia_polska', labelPl: 'Spicy Mayo', aliases: ['spicy mayo'], storagePath: 'dania/sushi/sushi_24.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_24.webp') },
  { slug: 'sos_unagi', category: 'kuchnia_polska', labelPl: 'Sos Unagi', aliases: ['unagi', 'sos unagi', 'eel sauce'], storagePath: 'dania/sushi/sushi_25.webp', localAsset: require('@/assets/premium/dishes/sushi/sushi_25.webp') },
];
