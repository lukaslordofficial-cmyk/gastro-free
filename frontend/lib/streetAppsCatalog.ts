/**
 * Street food + przystawki fine dining — plansze 4 i 5.
 */
type DishImageEntry = {
  slug: string;
  category: 'kuchnia_polska';
  labelPl: string;
  aliases: string[];
  storagePath: string;
  localAsset: number;
};

export const STREET_FOOD_CATALOG: DishImageEntry[] = [
  { slug: 'french_fries', category: 'kuchnia_polska', labelPl: 'Frytki klasyczne', aliases: ['frytki', 'french fries', 'fries'], storagePath: 'dania/street/street_01.webp', localAsset: require('@/assets/premium/dishes/street/street_01.webp') },
  { slug: 'sweet_potato_fries', category: 'kuchnia_polska', labelPl: 'Frytki z batata', aliases: ['bataty', 'sweet potato fries', 'frytki batat'], storagePath: 'dania/street/street_02.webp', localAsset: require('@/assets/premium/dishes/street/street_02.webp') },
  { slug: 'loaded_fries', category: 'kuchnia_polska', labelPl: 'Loaded fries', aliases: ['loaded fries', 'frytki z serem', 'frytki z boczkiem'], storagePath: 'dania/street/street_03.webp', localAsset: require('@/assets/premium/dishes/street/street_03.webp') },
  { slug: 'hot_dog', category: 'kuchnia_polska', labelPl: 'Hot dog', aliases: ['hot dog', 'hotdog', 'parówka w bułce'], storagePath: 'dania/street/street_04.webp', localAsset: require('@/assets/premium/dishes/street/street_04.webp') },
  { slug: 'zapiekanka', category: 'kuchnia_polska', labelPl: 'Zapiekanka', aliases: ['zapiekanka', 'zapiekanka z pieczarkami'], storagePath: 'dania/street/street_05.webp', localAsset: require('@/assets/premium/dishes/street/street_05.webp') },
  { slug: 'buffalo_wings', category: 'kuchnia_polska', labelPl: 'Skrzydełka Buffalo', aliases: ['skrzydełka', 'buffalo wings', 'chicken wings', 'skrzydełka buffalo'], storagePath: 'dania/street/street_06.webp', localAsset: require('@/assets/premium/dishes/street/street_06.webp') },
  { slug: 'corn_dogs', category: 'kuchnia_polska', labelPl: 'Corn dogi', aliases: ['corn dog', 'corn dogi', 'corndog'], storagePath: 'dania/street/street_07.webp', localAsset: require('@/assets/premium/dishes/street/street_07.webp') },
  { slug: 'mozzarella_sticks', category: 'kuchnia_polska', labelPl: 'Paluszki mozzarella', aliases: ['mozzarella sticks', 'paluszki mozzarella', 'serowe paluszki'], storagePath: 'dania/street/street_08.webp', localAsset: require('@/assets/premium/dishes/street/street_08.webp') },
  { slug: 'chicken_nuggets', category: 'kuchnia_polska', labelPl: 'Nuggetsy z kurczaka', aliases: ['nuggetsy', 'chicken nuggets', 'nuggets'], storagePath: 'dania/street/street_09.webp', localAsset: require('@/assets/premium/dishes/street/street_09.webp') },
  { slug: 'nachos', category: 'kuchnia_polska', labelPl: 'Nachosy', aliases: ['nachos', 'nachosy', 'guacamole jalapeno'], storagePath: 'dania/street/street_10.webp', localAsset: require('@/assets/premium/dishes/street/street_10.webp') },
  { slug: 'onion_rings', category: 'kuchnia_polska', labelPl: 'Krążki cebulowe', aliases: ['onion rings', 'krążki cebulowe', 'cebula panierowana'], storagePath: 'dania/street/street_11.webp', localAsset: require('@/assets/premium/dishes/street/street_11.webp') },
  { slug: 'soft_pretzel', category: 'kuchnia_polska', labelPl: 'Precel solony', aliases: ['precel', 'pretzel', 'miękki precel'], storagePath: 'dania/street/street_12.webp', localAsset: require('@/assets/premium/dishes/street/street_12.webp') },
  { slug: 'quesadilla', category: 'kuchnia_polska', labelPl: 'Quesadilla', aliases: ['quesadilla', 'quesadillas'], storagePath: 'dania/street/street_13.webp', localAsset: require('@/assets/premium/dishes/street/street_13.webp') },
  { slug: 'churros', category: 'kuchnia_polska', labelPl: 'Churros', aliases: ['churros', 'churro', 'gofry churros'], storagePath: 'dania/street/street_14.webp', localAsset: require('@/assets/premium/dishes/street/street_14.webp') },
  { slug: 'fish_and_chips', category: 'kuchnia_polska', labelPl: 'Fish and chips', aliases: ['fish and chips', 'ryba z frytkami'], storagePath: 'dania/street/street_15.webp', localAsset: require('@/assets/premium/dishes/street/street_15.webp') },
  { slug: 'calamari', category: 'kuchnia_polska', labelPl: 'Smażone kalmary', aliases: ['calamari', 'kalmary', 'krążki kalmarów'], storagePath: 'dania/street/street_16.webp', localAsset: require('@/assets/premium/dishes/street/street_16.webp') },
  { slug: 'tater_tots', category: 'kuchnia_polska', labelPl: 'Tater tots', aliases: ['tater tots', 'kuleczki ziemniaczane'], storagePath: 'dania/street/street_17.webp', localAsset: require('@/assets/premium/dishes/street/street_17.webp') },
  { slug: 'spring_rolls', category: 'kuchnia_polska', labelPl: 'Sajgonki', aliases: ['sajgonki', 'spring rolls'], storagePath: 'dania/street/street_18.webp', localAsset: require('@/assets/premium/dishes/street/street_18.webp') },
  { slug: 'pepperoni_pizza_slice', category: 'kuchnia_polska', labelPl: 'Pizza pepperoni', aliases: ['pepperoni', 'kawałek pizzy', 'pizza pepperoni', 'pizza'], storagePath: 'dania/street/street_19.webp', localAsset: require('@/assets/premium/dishes/street/street_19.webp') },
  { slug: 'empanada', category: 'kuchnia_polska', labelPl: 'Empanada', aliases: ['empanada', 'pierożek empanada'], storagePath: 'dania/street/street_20.webp', localAsset: require('@/assets/premium/dishes/street/street_20.webp') },
  { slug: 'mini_churros', category: 'kuchnia_polska', labelPl: 'Mini churros', aliases: ['mini churros', 'miniaturowe churros'], storagePath: 'dania/street/street_21.webp', localAsset: require('@/assets/premium/dishes/street/street_21.webp') },
  { slug: 'mac_cheese_bites', category: 'kuchnia_polska', labelPl: 'Mac and cheese bites', aliases: ['mac and cheese', 'mac cheese bites', 'kąski z makaronu'], storagePath: 'dania/street/street_22.webp', localAsset: require('@/assets/premium/dishes/street/street_22.webp') },
  { slug: 'chili_cheese_tots', category: 'kuchnia_polska', labelPl: 'Chili cheese tots', aliases: ['chili cheese tots', 'tots z chili'], storagePath: 'dania/street/street_23.webp', localAsset: require('@/assets/premium/dishes/street/street_23.webp') },
  { slug: 'pulled_pork_tacos', category: 'kuchnia_polska', labelPl: 'Tacos pulled pork', aliases: ['tacos', 'pulled pork tacos', 'tacos z szarpaną'], storagePath: 'dania/street/street_24.webp', localAsset: require('@/assets/premium/dishes/street/street_24.webp') },
  { slug: 'fried_pickles', category: 'kuchnia_polska', labelPl: 'Smażone ogórki', aliases: ['fried pickles', 'smażone ogórki', 'ogórki kiszone panierowane'], storagePath: 'dania/street/street_25.webp', localAsset: require('@/assets/premium/dishes/street/street_25.webp') },
];

export const FINE_APPS_CATALOG: DishImageEntry[] = [
  { slug: 'beef_tartare', category: 'kuchnia_polska', labelPl: 'Tatar wołowy', aliases: ['tatar', 'tatar wołowy', 'beef tartare'], storagePath: 'dania/apps/app_01.webp', localAsset: require('@/assets/premium/dishes/apps/app_01.webp') },
  { slug: 'tuna_tataki', category: 'kuchnia_polska', labelPl: 'Tataki z tuńczyka', aliases: ['tataki', 'tuna tataki', 'tuńczyk tataki'], storagePath: 'dania/apps/app_02.webp', localAsset: require('@/assets/premium/dishes/apps/app_02.webp') },
  { slug: 'salmon_tartare', category: 'kuchnia_polska', labelPl: 'Tatar z łososia', aliases: ['tatar z łososia', 'salmon tartare', 'tatar łosoś'], storagePath: 'dania/apps/app_03.webp', localAsset: require('@/assets/premium/dishes/apps/app_03.webp') },
  { slug: 'beef_carpaccio', category: 'kuchnia_polska', labelPl: 'Carpaccio wołowe', aliases: ['carpaccio', 'carpaccio wołowe', 'beef carpaccio'], storagePath: 'dania/apps/app_04.webp', localAsset: require('@/assets/premium/dishes/apps/app_04.webp') },
  { slug: 'seared_scallops', category: 'kuchnia_polska', labelPl: 'Małże św. Jakuba', aliases: ['scallops', 'małże św jakuba', 'przegrzebki', 'pan-seared scallops'], storagePath: 'dania/apps/app_05.webp', localAsset: require('@/assets/premium/dishes/apps/app_05.webp') },
  { slug: 'king_prawns', category: 'kuchnia_polska', labelPl: 'Krewetki królewskie', aliases: ['krewetki królewskie', 'king prawns', 'garlic butter prawns'], storagePath: 'dania/apps/app_06.webp', localAsset: require('@/assets/premium/dishes/apps/app_06.webp') },
  { slug: 'octopus_carpaccio', category: 'kuchnia_polska', labelPl: 'Carpaccio z ośmiornicy', aliases: ['ośmiornica', 'octopus carpaccio'], storagePath: 'dania/apps/app_07.webp', localAsset: require('@/assets/premium/dishes/apps/app_07.webp') },
  { slug: 'duck_prosciutto', category: 'kuchnia_polska', labelPl: 'Szynka z kaczki', aliases: ['duck prosciutto', 'szynka z kaczki', 'dojrzewająca kaczka'], storagePath: 'dania/apps/app_08.webp', localAsset: require('@/assets/premium/dishes/apps/app_08.webp') },
  { slug: 'foie_gras', category: 'kuchnia_polska', labelPl: 'Foie gras', aliases: ['foie gras', 'pasztet z gęsiej wątróbki'], storagePath: 'dania/apps/app_09.webp', localAsset: require('@/assets/premium/dishes/apps/app_09.webp') },
  { slug: 'herring_sour_cream', category: 'kuchnia_polska', labelPl: 'Śledź w śmietanie', aliases: ['śledź', 'herring', 'śledź w śmietanie'], storagePath: 'dania/apps/app_10.webp', localAsset: require('@/assets/premium/dishes/apps/app_10.webp') },
  { slug: 'sea_bass_ceviche', category: 'kuchnia_polska', labelPl: 'Ceviche', aliases: ['ceviche', 'ceviche z okonia'], storagePath: 'dania/apps/app_11.webp', localAsset: require('@/assets/premium/dishes/apps/app_11.webp') },
  { slug: 'vitello_tonnato', category: 'kuchnia_polska', labelPl: 'Vitello tonnato', aliases: ['vitello tonnato', 'cielęcina tuńczyk'], storagePath: 'dania/apps/app_12.webp', localAsset: require('@/assets/premium/dishes/apps/app_12.webp') },
  { slug: 'oysters_rockefeller', category: 'kuchnia_polska', labelPl: 'Ostrygi Rockefeller', aliases: ['ostrygi', 'oysters rockefeller', 'oysters'], storagePath: 'dania/apps/app_13.webp', localAsset: require('@/assets/premium/dishes/apps/app_13.webp') },
  { slug: 'smoked_eel', category: 'kuchnia_polska', labelPl: 'Wędzony węgorz', aliases: ['węgorz', 'smoked eel', 'unagi'], storagePath: 'dania/apps/app_14.webp', localAsset: require('@/assets/premium/dishes/apps/app_14.webp') },
  { slug: 'venison_carpaccio', category: 'kuchnia_polska', labelPl: 'Carpaccio z jelenia', aliases: ['jeleń', 'venison carpaccio', 'carpaccio jelenia'], storagePath: 'dania/apps/app_15.webp', localAsset: require('@/assets/premium/dishes/apps/app_15.webp') },
  { slug: 'mussels_white_wine', category: 'kuchnia_polska', labelPl: 'Mule w białym winie', aliases: ['mule', 'mussels', 'ostrygi mule'], storagePath: 'dania/apps/app_16.webp', localAsset: require('@/assets/premium/dishes/apps/app_16.webp') },
  { slug: 'crispy_pork_belly', category: 'kuchnia_polska', labelPl: 'Chrupiący boczek', aliases: ['pork belly', 'boczek glazurowany', 'crispy pork belly'], storagePath: 'dania/apps/app_17.webp', localAsset: require('@/assets/premium/dishes/apps/app_17.webp') },
  { slug: 'cod_croquettes', category: 'kuchnia_polska', labelPl: 'Krokiety z dorsza', aliases: ['krokiety', 'cod croquettes', 'krokiety z dorsza'], storagePath: 'dania/apps/app_18.webp', localAsset: require('@/assets/premium/dishes/apps/app_18.webp') },
  { slug: 'cured_goose_breast', category: 'kuchnia_polska', labelPl: 'Pierś gęsia dojrzewająca', aliases: ['gęś', 'goose breast', 'pierś gęsia'], storagePath: 'dania/apps/app_19.webp', localAsset: require('@/assets/premium/dishes/apps/app_19.webp') },
  { slug: 'shrimp_cocktail', category: 'kuchnia_polska', labelPl: 'Koktajl krewetkowy', aliases: ['shrimp cocktail', 'koktajl krewetkowy', 'krewetki koktajl'], storagePath: 'dania/apps/app_20.webp', localAsset: require('@/assets/premium/dishes/apps/app_20.webp') },
  { slug: 'caviar_blini', category: 'kuchnia_polska', labelPl: 'Kawior na blinie', aliases: ['kawior', 'caviar', 'blini', 'blin'], storagePath: 'dania/apps/app_21.webp', localAsset: require('@/assets/premium/dishes/apps/app_21.webp') },
  { slug: 'chicken_liver_parfait', category: 'kuchnia_polska', labelPl: 'Parfait z wątróbek', aliases: ['parfait', 'wątróbki', 'chicken liver parfait', 'pasztet wątróbkowy'], storagePath: 'dania/apps/app_22.webp', localAsset: require('@/assets/premium/dishes/apps/app_22.webp') },
  { slug: 'smoked_duck_magret', category: 'kuchnia_polska', labelPl: 'Magret z kaczki', aliases: ['magret', 'smoked duck', 'kaczka wędzona'], storagePath: 'dania/apps/app_23.webp', localAsset: require('@/assets/premium/dishes/apps/app_23.webp') },
  { slug: 'lobster_medallions', category: 'kuchnia_polska', labelPl: 'Medaliony z homara', aliases: ['homar', 'lobster', 'lobster medallions'], storagePath: 'dania/apps/app_24.webp', localAsset: require('@/assets/premium/dishes/apps/app_24.webp') },
  { slug: 'salmon_gravlax', category: 'kuchnia_polska', labelPl: 'Gravlax', aliases: ['gravlax', 'łosoś marynowany', 'salmon gravlax'], storagePath: 'dania/apps/app_25.webp', localAsset: require('@/assets/premium/dishes/apps/app_25.webp') },
];
