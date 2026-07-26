/**
 * Katalog ikon produktowych (mięso, ryby, …).
 *
 * Strategia wydajności:
 * - W APK/IPA NIE pakujemy setek PNG — tylko lekki katalog (slug + URL + aliasy).
 * - Obrazki lebą w publicznym buckecie Supabase `product-icons`.
 * - expo-image cache'uje po URL; ładowanie dopiero gdy UI pokazuje produkt.
 * - Lokalne fallbacki (wymagają require) tylko dla offline/demo premium.
 */

export type ProductImageCategory =
  | 'mieso'
  | 'ryby_owoce_morza'
  | 'warzywa'
  | 'ziola_grzyby'
  | 'owoce'
  | 'nabial'
  | 'sucha_spizarnia'
  | 'plynna_spizarnia'
  | 'pieczywo'
  | 'kawa_bar'
  | 'napoje'
  | 'wino_piwo'
  | 'alkohole_mocne'
  | 'opakowania'
  | 'pasty_bazy'
  | 'korzeniowe'
  | 'kuchnia_polska'
  | 'mrozonki'
  | 'makarony_kasze'
  | 'placeholdery'
  | 'inne';

export type ProductImageEntry = {
  slug: string;
  category: ProductImageCategory;
  labelPl: string;
  /** Nazwy / fragmenty do fuzzy match przy dodawaniu do menu/magazynu */
  aliases: string[];
  /** Ścieżka w buckecie, np. mieso/antrykot_wolowy_stek.png */
  storagePath: string;
  /** Opcjonalny lokalny require (dev / offline) */
  localAsset?: number;
};

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
export const PRODUCT_ICONS_BUCKET = 'product-icons';

export function publicIconUrl(storagePath: string): string | null {
  if (!SUPABASE_URL || !storagePath) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${PRODUCT_ICONS_BUCKET}/${storagePath}`;
}

/** Mięsa — kolejność = siatka 5×5 (meat_01 … meat_25). */
export const MEAT_CATALOG: ProductImageEntry[] = [
  {
    slug: 'antrykot_wolowy_stek',
    category: 'mieso',
    labelPl: 'Antrykot wołowy / Ribeye',
    aliases: ['antrykot', 'ribeye', 'stek wołowy', 'marmurkowy stek', 'stek wolowy'],
    storagePath: 'mieso/antrykot_wolowy_stek.png',
    localAsset: require('@/assets/premium/meats/meat_01.webp'),
  },
  {
    slug: 'schab_z_koscia',
    category: 'mieso',
    labelPl: 'Schab z kością',
    aliases: ['schab z kością', 'schab z koscia', 'kotlet schabowy', 'schabowy'],
    storagePath: 'mieso/schab_z_koscia.png',
    localAsset: require('@/assets/premium/meats/meat_02.webp'),
  },
  {
    slug: 'piers_z_kurczaka',
    category: 'mieso',
    labelPl: 'Pierś z kurczaka',
    aliases: ['pierś z kurczaka', 'piers z kurczaka', 'filet z kurczaka', 'filet z piersi kurczaka', 'kurczak pierś', 'kurczak filet', 'indyk filet'],
    storagePath: 'mieso/piers_z_kurczaka.png',
    localAsset: require('@/assets/premium/meats/meat_03.webp'),
  },
  {
    slug: 'boczek_surowy_plastry',
    category: 'mieso',
    labelPl: 'Boczek surowy (plastry)',
    aliases: ['boczek surowy', 'boczek plastry', 'bacon surowy', 'boczek'],
    storagePath: 'mieso/boczek_surowy_plastry.png',
    localAsset: require('@/assets/premium/meats/meat_04.webp'),
  },
  {
    slug: 'szynka_parmenska_prosciutto',
    category: 'mieso',
    labelPl: 'Szynka parmeńska / Prosciutto',
    aliases: ['prosciutto', 'szynka parmeńska', 'szynka parmenska', 'szynka dojrzewająca'],
    storagePath: 'mieso/szynka_parmenska_prosciutto.png',
    localAsset: require('@/assets/premium/meats/meat_05.webp'),
  },
  {
    slug: 'salami_plastry',
    category: 'mieso',
    labelPl: 'Salami (plastry)',
    aliases: ['salami'],
    storagePath: 'mieso/salami_plastry.png',
    localAsset: require('@/assets/premium/meats/meat_06.webp'),
  },
  {
    slug: 'zeberka_wolowe_wieprzowe',
    category: 'mieso',
    labelPl: 'Żeberka',
    aliases: ['żeberka', 'zeberka', 'short ribs', 'żeberka wołowe', 'żeberka wieprzowe'],
    storagePath: 'mieso/zeberka_wolowe_wieprzowe.png',
    localAsset: require('@/assets/premium/meats/meat_07.webp'),
  },
  {
    slug: 'poledwiczka_surowa_kawalek',
    category: 'mieso',
    labelPl: 'Polędwiczka surowa',
    aliases: ['polędwiczka', 'poledwiczka', 'polędwiczka wieprzowa'],
    storagePath: 'mieso/poledwiczka_surowa_kawalek.png',
    localAsset: require('@/assets/premium/meats/meat_08.webp'),
  },
  {
    slug: 'poledwica_wolowa_cala',
    category: 'mieso',
    labelPl: 'Polędwica wołowa',
    aliases: ['polędwica', 'poledwica', 'polędwica wołowa', 'beef tenderloin'],
    storagePath: 'mieso/poledwica_wolowa_cala.png',
    localAsset: require('@/assets/premium/meats/meat_09.webp'),
  },
  {
    slug: 'kielbaski_surowe',
    category: 'mieso',
    labelPl: 'Kiełbaski surowe',
    aliases: ['kiełbaski', 'kielbaski', 'bratwurst', 'biała kiełbasa', 'kiełbasa surowa'],
    storagePath: 'mieso/kielbaski_surowe.png',
    localAsset: require('@/assets/premium/meats/meat_10.webp'),
  },
  {
    slug: 'stek_z_koscia_tomahawk',
    category: 'mieso',
    labelPl: 'Stek z kością / Tomahawk',
    aliases: ['tomahawk', 'prime rib', 'stek z kością', 'stek z koscia', 't-bone'],
    storagePath: 'mieso/stek_z_koscia_tomahawk.png',
    localAsset: require('@/assets/premium/meats/meat_11.webp'),
  },
  {
    slug: 'mieso_mielone_wolowe',
    category: 'mieso',
    labelPl: 'Mięso mielone wołowe',
    aliases: ['mielone', 'mięso mielone', 'mieso mielone', 'ground beef'],
    storagePath: 'mieso/mieso_mielone_wolowe.png',
    localAsset: require('@/assets/premium/meats/meat_12.webp'),
  },
  {
    slug: 'mieso_gulaszowe_kostka',
    category: 'mieso',
    labelPl: 'Mięso gulaszowe (kostka)',
    aliases: ['gulaszowe', 'gulasz', 'mięso w kostkę', 'stewing beef'],
    storagePath: 'mieso/mieso_gulaszowe_kostka.png',
    localAsset: require('@/assets/premium/meats/meat_13.webp'),
  },
  {
    slug: 'piers_z_kaczki',
    category: 'mieso',
    labelPl: 'Pierś z kaczki',
    aliases: ['pierś z kaczki', 'piers z kaczki', 'kaczka', 'duck breast'],
    storagePath: 'mieso/piers_z_kaczki.png',
    localAsset: require('@/assets/premium/meats/meat_14.webp'),
  },
  {
    slug: 'stek_wolowy_mignon',
    category: 'mieso',
    labelPl: 'Filet mignon',
    aliases: ['filet mignon', 'mignon', 'stek mignon', 'gruby stek'],
    storagePath: 'mieso/stek_wolowy_mignon.png',
    localAsset: require('@/assets/premium/meats/meat_15.webp'),
  },
  {
    slug: 'karkowka_surowa_kawalek',
    category: 'mieso',
    labelPl: 'Karkówka',
    aliases: ['karkówka', 'karkowka', 'karkówka wieprzowa'],
    storagePath: 'mieso/karkowka_surowa_kawalek.png',
    localAsset: require('@/assets/premium/meats/meat_16.webp'),
  },
  {
    slug: 'schab_bez_kosci_stek',
    category: 'mieso',
    labelPl: 'Schab bez kości / stek',
    aliases: ['schab bez kości', 'schab bez kosci', 'stek ze schabu', 'pork loin'],
    storagePath: 'mieso/schab_bez_kosci_stek.png',
    localAsset: require('@/assets/premium/meats/meat_17.webp'),
  },
  {
    slug: 'golen_z_koscia_buko',
    category: 'mieso',
    labelPl: 'Goleń / Ossobuco',
    aliases: ['goleń', 'golen', 'ossobuco', 'golonka', 'shank'],
    storagePath: 'mieso/golen_z_koscia_buko.png',
    localAsset: require('@/assets/premium/meats/meat_18.webp'),
  },
  {
    slug: 'podudzia_z_kurczaka_palki',
    category: 'mieso',
    labelPl: 'Pałki z kurczaka',
    aliases: ['pałki', 'palki', 'podudzia', 'drumsticks', 'pałki z kurczaka'],
    storagePath: 'mieso/podudzia_z_kurczaka_palki.png',
    localAsset: require('@/assets/premium/meats/meat_19.webp'),
  },
  {
    slug: 'boczek_pieczony_marynowany',
    category: 'mieso',
    labelPl: 'Boczek pieczony / marynowany',
    aliases: ['boczek pieczony', 'boczek marynowany', 'boczek bbq'],
    storagePath: 'mieso/boczek_pieczony_marynowany.png',
    localAsset: require('@/assets/premium/meats/meat_20.webp'),
  },
  {
    slug: 'szynka_w_siatce_sznurowana',
    category: 'mieso',
    labelPl: 'Szynka w siatce',
    aliases: ['szynka w siatce', 'szynka sznurowana', 'roast tied'],
    storagePath: 'mieso/szynka_w_siatce_sznurowana.png',
    localAsset: require('@/assets/premium/meats/meat_21.webp'),
  },
  {
    slug: 'boczek_ze_skora_kawalek',
    category: 'mieso',
    labelPl: 'Boczek ze skórą',
    aliases: ['boczek ze skórą', 'boczek ze skora', 'pork belly', 'boczek gruby'],
    storagePath: 'mieso/boczek_ze_skora_kawalek.png',
    localAsset: require('@/assets/premium/meats/meat_22.webp'),
  },
  {
    slug: 'mieso_wolowe_kawalek',
    category: 'mieso',
    labelPl: 'Mięso wołowe (kawałek)',
    aliases: ['pieczeń wołowa', 'udziec', 'ligawa', 'mięso wołowe', 'roast beef', 'rostbef', 'rostbeaf', 'roastbeef'],
    storagePath: 'mieso/mieso_wolowe_kawalek.png',
    localAsset: require('@/assets/premium/meats/meat_23.webp'),
  },
  {
    slug: 'mieso_drobne_kostka',
    category: 'mieso',
    labelPl: 'Mięso drobne (kostka)',
    aliases: ['mięso drobne', 'kostka wieprzowa', 'diced pork'],
    storagePath: 'mieso/mieso_drobne_kostka.png',
    localAsset: require('@/assets/premium/meats/meat_24.webp'),
  },
  {
    slug: 'chorizo_pepperoni_plastry',
    category: 'mieso',
    labelPl: 'Chorizo / Pepperoni',
    aliases: ['chorizo', 'pepperoni', 'pikantne salami'],
    storagePath: 'mieso/chorizo_pepperoni_plastry.png',
    localAsset: require('@/assets/premium/meats/meat_25.webp'),
  },
];

/** Ryby i owoce morza — siatka 5×4 (20 pozycji). Obrazki po wrzuceniu sheetu. */
export const SEAFOOD_CATALOG: ProductImageEntry[] = [
  {
    slug: 'losos_stek_fillet',
    category: 'ryby_owoce_morza',
    labelPl: 'Łosoś stek / filet',
    aliases: ['łosoś', 'losos', 'salmon', 'filet z łososia'],
    storagePath: 'ryby/losos_stek_fillet.png',
  },
  {
    slug: 'pstrag_caly_surowy',
    category: 'ryby_owoce_morza',
    labelPl: 'Pstrąg cały',
    aliases: ['pstrąg', 'pstrag', 'trout'],
    storagePath: 'ryby/pstrag_caly_surowy.png',
  },
  {
    slug: 'krewetki_szare_surowe',
    category: 'ryby_owoce_morza',
    labelPl: 'Krewetki surowe',
    aliases: ['krewetki', 'krewetki tygrysie', 'shrimp', 'prawns'],
    storagePath: 'ryby/krewetki_szare_surowe.png',
  },
  {
    slug: 'tunczyk_stek_surowy',
    category: 'ryby_owoce_morza',
    labelPl: 'Tuńczyk stek',
    aliases: ['tuńczyk', 'tunczyk', 'tuna'],
    storagePath: 'ryby/tunczyk_stek_surowy.png',
  },
  {
    slug: 'dorsz_poledwica_filet',
    category: 'ryby_owoce_morza',
    labelPl: 'Dorsz / polędwica',
    aliases: ['dorsz', 'cod', 'biała ryba', 'polędwica dorsza'],
    storagePath: 'ryby/dorsz_poledwica_filet.png',
  },
  {
    slug: 'dorada_cala_surowa',
    category: 'ryby_owoce_morza',
    labelPl: 'Dorada',
    aliases: ['dorada', 'labraks', 'sea bream', 'branzino'],
    storagePath: 'ryby/dorada_cala_surowa.png',
  },
  {
    slug: 'makrela_cala_dwie_sztuki',
    category: 'ryby_owoce_morza',
    labelPl: 'Makrela',
    aliases: ['makrela', 'mackerel'],
    storagePath: 'ryby/makrela_cala_dwie_sztuki.png',
  },
  {
    slug: 'mule_malze_czarne',
    category: 'ryby_owoce_morza',
    labelPl: 'Omułki / mule',
    aliases: ['mule', 'omułki', 'omulki', 'małże czarne', 'mussels'],
    storagePath: 'ryby/mule_malze_czarne.png',
  },
  {
    slug: 'kalmar_caly_z_mackami',
    category: 'ryby_owoce_morza',
    labelPl: 'Kalmar cały',
    aliases: ['kalmar', 'squid'],
    storagePath: 'ryby/kalmar_caly_z_mackami.png',
  },
  {
    slug: 'przegrzebki_malze_swiete',
    category: 'ryby_owoce_morza',
    labelPl: 'Przegrzebki',
    aliases: ['przegrzebki', 'scallops', 'małże świętego jakuba'],
    storagePath: 'ryby/przegrzebki_malze_swiete.png',
  },
  {
    slug: 'karmazyn_lub_dorada_rozowa',
    category: 'ryby_owoce_morza',
    labelPl: 'Karmazyn / ryba różowa',
    aliases: ['karmazyn', 'rdzawiec', 'red fish'],
    storagePath: 'ryby/karmazyn_lub_dorada_rozowa.png',
  },
  {
    slug: 'krazki_kalmarow',
    category: 'ryby_owoce_morza',
    labelPl: 'Krążki kalmarów',
    aliases: ['krążki kalmarów', 'krazki kalmarow', 'calamari rings'],
    storagePath: 'ryby/krazki_kalmarow.png',
  },
  {
    slug: 'osmiornica_macki_ugotowane',
    category: 'ryby_owoce_morza',
    labelPl: 'Ośmiornica (macki)',
    aliases: ['ośmiornica', 'osmiornica', 'octopus'],
    storagePath: 'ryby/osmiornica_macki_ugotowane.png',
  },
  {
    slug: 'wenery_malze_w_muszelkach',
    category: 'ryby_owoce_morza',
    labelPl: 'Wenery / vongole',
    aliases: ['wenery', 'vongole', 'clams', 'małże piaskowe'],
    storagePath: 'ryby/wenery_malze_w_muszelkach.png',
  },
  {
    slug: 'ostrygi_zamkniete_muszle',
    category: 'ryby_owoce_morza',
    labelPl: 'Ostrygi',
    aliases: ['ostrygi', 'oysters'],
    storagePath: 'ryby/ostrygi_zamkniete_muszle.png',
  },
  {
    slug: 'okon_morski_dwie_ryby',
    category: 'ryby_owoce_morza',
    labelPl: 'Okoń morski',
    aliases: ['okoń morski', 'okon morski', 'sea bass'],
    storagePath: 'ryby/okon_morski_dwie_ryby.png',
  },
  {
    slug: 'krewetki_gotowane_rozowe',
    category: 'ryby_owoce_morza',
    labelPl: 'Krewetki gotowane',
    aliases: ['krewetki gotowane', 'krewetki różowe', 'cooked shrimp'],
    storagePath: 'ryby/krewetki_gotowane_rozowe.png',
  },
  {
    slug: 'tilapia_filet_rozowy',
    category: 'ryby_owoce_morza',
    labelPl: 'Tilapia / filet biały',
    aliases: ['tilapia', 'panga', 'filet biały'],
    storagePath: 'ryby/tilapia_filet_rozowy.png',
  },
  {
    slug: 'szproty_lub_sardynki_starka',
    category: 'ryby_owoce_morza',
    labelPl: 'Szproty / sardynki',
    aliases: ['szproty', 'sardynki', 'anchovies', 'anchois'],
    storagePath: 'ryby/szproty_lub_sardynki_starka.png',
  },
  {
    slug: 'krab_nogi_szczypce',
    category: 'ryby_owoce_morza',
    labelPl: 'Krab (nogi)',
    aliases: ['krab', 'nogi kraba', 'crab legs'],
    storagePath: 'ryby/krab_nogi_szczypce.png',
  },
];

/** Warzywa — siatka 5×6 (30 pozycji). Preferuj URL z bucketu (bez bundlowania setek PNG). */
export const VEGETABLE_CATALOG: ProductImageEntry[] = [
  {
    slug: 'pomidor_swiezy',
    category: 'warzywa',
    labelPl: 'Pomidor',
    aliases: ['pomidor', 'pomidory', 'tomato'],
    storagePath: 'warzywa/pomidor_swiezy.png',
    localAsset: require('@/assets/premium/vegetables/pomidor_swiezy.webp'),
  },
  {
    slug: 'papryka_zielona',
    category: 'warzywa',
    labelPl: 'Papryka zielona',
    aliases: ['papryka zielona', 'zielona papryka'],
    storagePath: 'warzywa/papryka_zielona.png',
    localAsset: require('@/assets/premium/vegetables/papryka_zielona.webp'),
  },
  {
    slug: 'papryka_zolta',
    category: 'warzywa',
    labelPl: 'Papryka żółta',
    aliases: ['papryka żółta', 'papryka zolta', 'żółta papryka'],
    storagePath: 'warzywa/papryka_zolta.png',
    localAsset: require('@/assets/premium/vegetables/papryka_zolta.webp'),
  },
  {
    slug: 'cebula_czerwona',
    category: 'warzywa',
    labelPl: 'Cebula czerwona',
    aliases: ['cebula', 'cebula czerwona', 'czerwona cebula'],
    storagePath: 'warzywa/cebula_czerwona.png',
    localAsset: require('@/assets/premium/vegetables/cebula_czerwona.webp'),
  },
  {
    slug: 'czosnek_glowka',
    category: 'warzywa',
    labelPl: 'Czosnek',
    aliases: ['czosnek', 'główka czosnku'],
    storagePath: 'warzywa/czosnek_glowka.png',
    localAsset: require('@/assets/premium/vegetables/czosnek_glowka.webp'),
  },
  {
    slug: 'brokul_rozyczka',
    category: 'warzywa',
    labelPl: 'Brokuł',
    aliases: ['brokuł', 'brokul', 'broccoli'],
    storagePath: 'warzywa/brokul_rozyczka.png',
    localAsset: require('@/assets/premium/vegetables/brokul_rozyczka.webp'),
  },
  {
    slug: 'ogorek_zielony',
    category: 'warzywa',
    labelPl: 'Ogórek',
    aliases: ['ogórek', 'ogorek', 'cucumber'],
    storagePath: 'warzywa/ogorek_zielony.png',
    localAsset: require('@/assets/premium/vegetables/ogorek_zielony.webp'),
  },
  {
    slug: 'marchew_swieza',
    category: 'warzywa',
    labelPl: 'Marchew',
    aliases: ['marchew', 'marchewka', 'carrot'],
    storagePath: 'warzywa/marchew_swieza.png',
    localAsset: require('@/assets/premium/vegetables/marchew_swieza.webp'),
  },
  {
    slug: 'cukinia_zielona',
    category: 'warzywa',
    labelPl: 'Cukinia',
    aliases: ['cukinia', 'zucchini'],
    storagePath: 'warzywa/cukinia_zielona.png',
    localAsset: require('@/assets/premium/vegetables/cukinia_zielona.webp'),
  },
  {
    slug: 'baklazan',
    category: 'warzywa',
    labelPl: 'Bakłażan',
    aliases: ['bakłażan', 'baklazan', 'oberżyna', 'eggplant'],
    storagePath: 'warzywa/baklazan.png',
    localAsset: require('@/assets/premium/vegetables/baklazan.webp'),
  },
  {
    slug: 'ziemniak_stary',
    category: 'warzywa',
    labelPl: 'Ziemniak',
    aliases: ['ziemniak', 'ziemniaki', 'potato'],
    storagePath: 'warzywa/ziemniak_stary.png',
    localAsset: require('@/assets/premium/vegetables/ziemniak_stary.webp'),
  },
  {
    slug: 'batat_slodki_ziemniak',
    category: 'warzywa',
    labelPl: 'Batat',
    aliases: ['batat', 'słodki ziemniak', 'sweet potato'],
    storagePath: 'warzywa/batat_slodki_ziemniak.png',
    localAsset: require('@/assets/premium/vegetables/batat_slodki_ziemniak.webp'),
  },
  {
    slug: 'por_swiezy',
    category: 'warzywa',
    labelPl: 'Por',
    aliases: ['por', 'pory', 'leek'],
    storagePath: 'warzywa/por_swiezy.png',
    localAsset: require('@/assets/premium/vegetables/por_swiezy.webp'),
  },
  {
    slug: 'rzodkiewka_peczek',
    category: 'warzywa',
    labelPl: 'Rzodkiewka',
    aliases: ['rzodkiewka', 'rzodkiewki', 'radish'],
    storagePath: 'warzywa/rzodkiewka_peczek.png',
    localAsset: require('@/assets/premium/vegetables/rzodkiewka_peczek.webp'),
  },
  {
    slug: 'papryczka_chili',
    category: 'warzywa',
    labelPl: 'Papryczka chili',
    aliases: ['chili', 'papryczka chili', 'papryka chili'],
    storagePath: 'warzywa/papryczka_chili.png',
    localAsset: require('@/assets/premium/vegetables/papryczka_chili.webp'),
  },
  {
    slug: 'salata_karbowana_zielona',
    category: 'warzywa',
    labelPl: 'Sałata',
    aliases: ['sałata', 'salata', 'lettuce'],
    storagePath: 'warzywa/salata_karbowana_zielona.png',
    localAsset: require('@/assets/premium/vegetables/salata_karbowana_zielona.webp'),
  },
  {
    slug: 'kalafior_swiezy',
    category: 'warzywa',
    labelPl: 'Kalafior',
    aliases: ['kalafior', 'cauliflower'],
    storagePath: 'warzywa/kalafior_swiezy.png',
    localAsset: require('@/assets/premium/vegetables/kalafior_swiezy.webp'),
  },
  {
    slug: 'kapusta_biala',
    category: 'warzywa',
    labelPl: 'Kapusta',
    aliases: ['kapusta', 'kapusta biała', 'cabbage'],
    storagePath: 'warzywa/kapusta_biala.png',
    localAsset: require('@/assets/premium/vegetables/kapusta_biala.webp'),
  },
  {
    slug: 'szpinak_swiezy_liscie',
    category: 'warzywa',
    labelPl: 'Szpinak',
    aliases: ['szpinak', 'spinach'],
    storagePath: 'warzywa/szpinak_swiezy_liscie.png',
    localAsset: require('@/assets/premium/vegetables/szpinak_swiezy_liscie.webp'),
  },
  {
    slug: 'kalarepa_zielona',
    category: 'warzywa',
    labelPl: 'Kalarepa',
    aliases: ['kalarepa', 'kohlrabi'],
    storagePath: 'warzywa/kalarepa_zielona.png',
    localAsset: require('@/assets/premium/vegetables/kalarepa_zielona.webp'),
  },
  {
    slug: 'rzepa_biala_lub_rzodkiew',
    category: 'warzywa',
    labelPl: 'Rzepa',
    aliases: ['rzepa', 'rzodkiew biała', 'turnip'],
    storagePath: 'warzywa/rzepa_biala_lub_rzodkiew.png',
    localAsset: require('@/assets/premium/vegetables/rzepa_biala_lub_rzodkiew.webp'),
  },
  {
    slug: 'fasolka_szparagowa_zielona',
    category: 'warzywa',
    labelPl: 'Fasolka szparagowa',
    aliases: ['fasolka', 'fasolka szparagowa', 'green beans'],
    storagePath: 'warzywa/fasolka_szparagowa_zielona.png',
    localAsset: require('@/assets/premium/vegetables/fasolka_szparagowa_zielona.webp'),
  },
  {
    slug: 'kukurydza_kolba',
    category: 'warzywa',
    labelPl: 'Kukurydza',
    aliases: ['kukurydza', 'kolba kukurydzy', 'corn'],
    storagePath: 'warzywa/kukurydza_kolba.png',
    localAsset: require('@/assets/premium/vegetables/kukurydza_kolba.webp'),
  },
  {
    slug: 'seler_naciowy',
    category: 'warzywa',
    labelPl: 'Seler naciowy',
    aliases: ['seler', 'seler naciowy', 'celery'],
    storagePath: 'warzywa/seler_naciowy.png',
    localAsset: require('@/assets/premium/vegetables/seler_naciowy.webp'),
  },
  {
    slug: 'dynia_zielona_hokkaido',
    category: 'warzywa',
    labelPl: 'Dynia',
    aliases: ['dynia', 'kabaczek', 'hokkaido', 'pumpkin'],
    storagePath: 'warzywa/dynia_zielona_hokkaido.png',
    localAsset: require('@/assets/premium/vegetables/dynia_zielona_hokkaido.webp'),
  },
  {
    slug: 'papryka_czerwona',
    category: 'warzywa',
    labelPl: 'Papryka czerwona',
    aliases: ['papryka czerwona', 'czerwona papryka', 'papryka'],
    storagePath: 'warzywa/papryka_czerwona.png',
    localAsset: require('@/assets/premium/vegetables/papryka_czerwona.webp'),
  },
  {
    slug: 'pieczarka_biala',
    category: 'warzywa',
    labelPl: 'Pieczarka',
    aliases: ['pieczarka', 'pieczarki', 'grzyb', 'mushroom'],
    storagePath: 'warzywa/pieczarka_biala.png',
    localAsset: require('@/assets/premium/vegetables/pieczarka_biala.webp'),
  },
  {
    slug: 'awokado_hass',
    category: 'warzywa',
    labelPl: 'Awokado',
    aliases: ['awokado', 'avocado'],
    storagePath: 'warzywa/awokado_hass.png',
    localAsset: require('@/assets/premium/vegetables/awokado_hass.webp'),
  },
  {
    slug: 'szparagi_zielone',
    category: 'warzywa',
    labelPl: 'Szparagi',
    aliases: ['szparagi', 'asparagus'],
    storagePath: 'warzywa/szparagi_zielone.png',
    localAsset: require('@/assets/premium/vegetables/szparagi_zielone.webp'),
  },
  {
    slug: 'brukselka_kilka_sztuk',
    category: 'warzywa',
    labelPl: 'Brukselka',
    aliases: ['brukselka', 'brussels'],
    storagePath: 'warzywa/brukselka_kilka_sztuk.png',
    localAsset: require('@/assets/premium/vegetables/brukselka_kilka_sztuk.webp'),
  },
];

/** Zioła, liście i grzyby — siatka 5×5. */
export const HERBS_CATALOG: ProductImageEntry[] = [
  { slug: 'bazylia_swieza_liscie', category: 'ziola_grzyby', labelPl: 'Bazylia', aliases: ['bazylia', 'basil'], storagePath: 'ziola/bazylia_swieza_liscie.png', localAsset: require('@/assets/premium/herbs/bazylia_swieza_liscie.webp') },
  { slug: 'koledra_peczek', category: 'ziola_grzyby', labelPl: 'Kolendra', aliases: ['kolendra', 'koledra', 'cilantro'], storagePath: 'ziola/koledra_peczek.png', localAsset: require('@/assets/premium/herbs/koledra_peczek.webp') },
  { slug: 'rozmaryn_galazka', category: 'ziola_grzyby', labelPl: 'Rozmaryn', aliases: ['rozmaryn', 'rosemary'], storagePath: 'ziola/rozmaryn_galazka.png', localAsset: require('@/assets/premium/herbs/rozmaryn_galazka.webp') },
  { slug: 'tymianek_peczek', category: 'ziola_grzyby', labelPl: 'Tymianek', aliases: ['tymianek', 'thyme'], storagePath: 'ziola/tymianek_peczek.png', localAsset: require('@/assets/premium/herbs/tymianek_peczek.webp') },
  { slug: 'mieta_swieza', category: 'ziola_grzyby', labelPl: 'Mięta', aliases: ['mięta', 'mieta', 'mint'], storagePath: 'ziola/mieta_swieza.png', localAsset: require('@/assets/premium/herbs/mieta_swieza.webp') },
  { slug: 'koperek_swiezy', category: 'ziola_grzyby', labelPl: 'Koperek', aliases: ['koperek', 'dill'], storagePath: 'ziola/koperek_swiezy.png', localAsset: require('@/assets/premium/herbs/koperek_swiezy.webp') },
  { slug: 'pietruszka_karbowana', category: 'ziola_grzyby', labelPl: 'Pietruszka karbowana', aliases: ['pietruszka karbowana'], storagePath: 'ziola/pietruszka_karbowana.png', localAsset: require('@/assets/premium/herbs/pietruszka_karbowana.webp') },
  { slug: 'rukola_peczek', category: 'ziola_grzyby', labelPl: 'Rukola', aliases: ['rukola', 'rokietta', 'arugula'], storagePath: 'ziola/rukola_peczek.png', localAsset: require('@/assets/premium/herbs/rukola_peczek.webp') },
  { slug: 'salata_rzymska_mini', category: 'ziola_grzyby', labelPl: 'Sałata rzymska', aliases: ['sałata rzymska', 'romaine'], storagePath: 'ziola/salata_rzymska_mini.png', localAsset: require('@/assets/premium/herbs/salata_rzymska_mini.webp') },
  { slug: 'cykoria_radicchio', category: 'ziola_grzyby', labelPl: 'Radicchio', aliases: ['radicchio', 'cykoria'], storagePath: 'ziola/cykoria_radicchio.png', localAsset: require('@/assets/premium/herbs/cykoria_radicchio.webp') },
  { slug: 'rzerzucha_lub_kielki', category: 'ziola_grzyby', labelPl: 'Rzeżucha / kiełki', aliases: ['rzeżucha', 'kiełki', 'cress'], storagePath: 'ziola/rzerzucha_lub_kielki.png', localAsset: require('@/assets/premium/herbs/rzerzucha_lub_kielki.webp') },
  { slug: 'szpinak_baby_liscie', category: 'ziola_grzyby', labelPl: 'Szpinak baby', aliases: ['szpinak baby', 'baby spinach'], storagePath: 'ziola/szpinak_baby_liscie.png', localAsset: require('@/assets/premium/herbs/szpinak_baby_liscie.webp') },
  { slug: 'salata_frisee', category: 'ziola_grzyby', labelPl: 'Sałata frisée', aliases: ['frisee', 'endywia'], storagePath: 'ziola/salata_frisee.png', localAsset: require('@/assets/premium/herbs/salata_frisee.webp') },
  { slug: 'roszponka', category: 'ziola_grzyby', labelPl: 'Roszponka', aliases: ['roszponka'], storagePath: 'ziola/roszponka.png', localAsset: require('@/assets/premium/herbs/roszponka.webp') },
  { slug: 'rzezucha_wodna_lub_rukiew', category: 'ziola_grzyby', labelPl: 'Rukiew wodna', aliases: ['rukiew', 'watercress'], storagePath: 'ziola/rzezucha_wodna_lub_rukiew.png', localAsset: require('@/assets/premium/herbs/rzezucha_wodna_lub_rukiew.webp') },
  { slug: 'szczypiorek_cienki', category: 'ziola_grzyby', labelPl: 'Szczypiorek', aliases: ['szczypiorek', 'chives'], storagePath: 'ziola/szczypiorek_cienki.png', localAsset: require('@/assets/premium/herbs/szczypiorek_cienki.webp') },
  { slug: 'pietruszka_gladka', category: 'ziola_grzyby', labelPl: 'Pietruszka płaska', aliases: ['pietruszka', 'natka pietruszki', 'parsley'], storagePath: 'ziola/pietruszka_gladka.png', localAsset: require('@/assets/premium/herbs/pietruszka_gladka.webp') },
  { slug: 'szalwia_swieza', category: 'ziola_grzyby', labelPl: 'Szałwia', aliases: ['szałwia', 'szalwia', 'sage'], storagePath: 'ziola/szalwia_swieza.png', localAsset: require('@/assets/premium/herbs/szalwia_swieza.webp') },
  { slug: 'liscie_laurowe_swieze', category: 'ziola_grzyby', labelPl: 'Liść laurowy', aliases: ['liść laurowy', 'liście laurowe', 'bay'], storagePath: 'ziola/liscie_laurowe_swieze.png', localAsset: require('@/assets/premium/herbs/liscie_laurowe_swieze.webp') },
  { slug: 'estragon_lub_czaber', category: 'ziola_grzyby', labelPl: 'Estragon', aliases: ['estragon', 'cząber', 'tarragon'], storagePath: 'ziola/estragon_lub_czaber.png', localAsset: require('@/assets/premium/herbs/estragon_lub_czaber.webp') },
  { slug: 'borowik_grzyby_lesne', category: 'ziola_grzyby', labelPl: 'Borowik', aliases: ['borowik', 'prawdziwek', 'porcini'], storagePath: 'ziola/borowik_grzyby_lesne.png', localAsset: require('@/assets/premium/herbs/borowik_grzyby_lesne.webp') },
  { slug: 'kurki_grzyby_lesne', category: 'ziola_grzyby', labelPl: 'Kurki', aliases: ['kurki', 'chanterelle'], storagePath: 'ziola/kurki_grzyby_lesne.png', localAsset: require('@/assets/premium/herbs/kurki_grzyby_lesne.webp') },
  { slug: 'grzyby_shiitake', category: 'ziola_grzyby', labelPl: 'Shiitake', aliases: ['shiitake'], storagePath: 'ziola/grzyby_shiitake.png', localAsset: require('@/assets/premium/herbs/grzyby_shiitake.webp') },
  { slug: 'boczniak_ostrygowaty', category: 'ziola_grzyby', labelPl: 'Boczniak', aliases: ['boczniak'], storagePath: 'ziola/boczniak_ostrygowaty.png', localAsset: require('@/assets/premium/herbs/boczniak_ostrygowaty.webp') },
  { slug: 'smergiel_smardz_premium', category: 'ziola_grzyby', labelPl: 'Smardz', aliases: ['smardz', 'smardze', 'morel'], storagePath: 'ziola/smergiel_smardz_premium.png', localAsset: require('@/assets/premium/herbs/smergiel_smardz_premium.webp') },
];

/** Owoce i cytrusy — siatka 5×5 (bez awokado — jest w warzywach). */
export const FRUIT_CATALOG: ProductImageEntry[] = [
  { slug: 'cytryna_cala', category: 'owoce', labelPl: 'Cytryna', aliases: ['cytryna', 'cytryny', 'lemon'], storagePath: 'owoce/cytryna_cala.png', localAsset: require('@/assets/premium/fruits/cytryna_cala.webp') },
  { slug: 'limonka_cala', category: 'owoce', labelPl: 'Limonka', aliases: ['limonka', 'limetta', 'lime'], storagePath: 'owoce/limonka_cala.png', localAsset: require('@/assets/premium/fruits/limonka_cala.webp') },
  { slug: 'pomarancza_cala', category: 'owoce', labelPl: 'Pomarańcza', aliases: ['pomarańcza', 'pomarancza', 'orange'], storagePath: 'owoce/pomarancza_cala.png', localAsset: require('@/assets/premium/fruits/pomarancza_cala.webp') },
  { slug: 'grejpfrut_rozowy', category: 'owoce', labelPl: 'Grejpfrut', aliases: ['grejpfrut', 'grapefruit'], storagePath: 'owoce/grejpfrut_rozowy.png', localAsset: require('@/assets/premium/fruits/grejpfrut_rozowy.webp') },
  { slug: 'jablko_czerwone', category: 'owoce', labelPl: 'Jabłko', aliases: ['jabłko', 'jablko', 'apple'], storagePath: 'owoce/jablko_czerwone.png', localAsset: require('@/assets/premium/fruits/jablko_czerwone.webp') },
  { slug: 'gruszka_zielona', category: 'owoce', labelPl: 'Gruszka', aliases: ['gruszka', 'gruszki', 'pear'], storagePath: 'owoce/gruszka_zielona.png', localAsset: require('@/assets/premium/fruits/gruszka_zielona.webp') },
  { slug: 'banan_zolty', category: 'owoce', labelPl: 'Banan', aliases: ['banan', 'banany', 'banana'], storagePath: 'owoce/banan_zolty.png', localAsset: require('@/assets/premium/fruits/banan_zolty.webp') },
  { slug: 'ananas_caly', category: 'owoce', labelPl: 'Ananas', aliases: ['ananas', 'pineapple'], storagePath: 'owoce/ananas_caly.png', localAsset: require('@/assets/premium/fruits/ananas_caly.webp') },
  { slug: 'mango_swieze', category: 'owoce', labelPl: 'Mango', aliases: ['mango'], storagePath: 'owoce/mango_swieze.png', localAsset: require('@/assets/premium/fruits/mango_swieze.webp') },
  { slug: 'winogrona_zielone', category: 'owoce', labelPl: 'Winogrona zielone', aliases: ['winogrona', 'winogrono', 'green grapes'], storagePath: 'owoce/winogrona_zielone.png', localAsset: require('@/assets/premium/fruits/winogrona_zielone.webp') },
  { slug: 'truskawka_swieza', category: 'owoce', labelPl: 'Truskawka', aliases: ['truskawka', 'truskawki', 'strawberry'], storagePath: 'owoce/truskawka_swieza.png', localAsset: require('@/assets/premium/fruits/truskawka_swieza.webp') },
  { slug: 'borowki_amerykanskie', category: 'owoce', labelPl: 'Borówki', aliases: ['borówki', 'borowki', 'jagody', 'blueberry'], storagePath: 'owoce/borowki_amerykanskie.png', localAsset: require('@/assets/premium/fruits/borowki_amerykanskie.webp') },
  { slug: 'maliny_swieze', category: 'owoce', labelPl: 'Maliny', aliases: ['malina', 'maliny', 'raspberry'], storagePath: 'owoce/maliny_swieze.png', localAsset: require('@/assets/premium/fruits/maliny_swieze.webp') },
  { slug: 'winogrona_ciemne', category: 'owoce', labelPl: 'Winogrona ciemne', aliases: ['winogrona ciemne', 'ciemne winogrona', 'red grapes'], storagePath: 'owoce/winogrona_ciemne.png', localAsset: require('@/assets/premium/fruits/winogrona_ciemne.webp') },
  { slug: 'kiwi_owoc', category: 'owoce', labelPl: 'Kiwi', aliases: ['kiwi'], storagePath: 'owoce/kiwi_owoc.png', localAsset: require('@/assets/premium/fruits/kiwi_owoc.webp') },
  { slug: 'brzoskwinia_swieza', category: 'owoce', labelPl: 'Brzoskwinia', aliases: ['brzoskwinia', 'brzoskwinie', 'morela', 'peach'], storagePath: 'owoce/brzoskwinia_swieza.png', localAsset: require('@/assets/premium/fruits/brzoskwinia_swieza.webp') },
  { slug: 'nektarynka', category: 'owoce', labelPl: 'Nektarynka', aliases: ['nektarynka', 'nektarynki', 'nectarine'], storagePath: 'owoce/nektarynka.png', localAsset: require('@/assets/premium/fruits/nektarynka.webp') },
  { slug: 'sliwka_ciemna', category: 'owoce', labelPl: 'Śliwka', aliases: ['śliwka', 'sliwka', 'śliwki', 'plum'], storagePath: 'owoce/sliwka_ciemna.png', localAsset: require('@/assets/premium/fruits/sliwka_ciemna.webp') },
  { slug: 'melon_galia', category: 'owoce', labelPl: 'Melon', aliases: ['melon', 'galia', 'cantaloupe'], storagePath: 'owoce/melon_galia.png', localAsset: require('@/assets/premium/fruits/melon_galia.webp') },
  { slug: 'granat_owoc', category: 'owoce', labelPl: 'Granat', aliases: ['granat', 'pomegranate'], storagePath: 'owoce/granat_owoc.png', localAsset: require('@/assets/premium/fruits/granat_owoc.webp') },
  { slug: 'karambola_gwiezdny_owoc', category: 'owoce', labelPl: 'Karambola', aliases: ['karambola', 'starfruit'], storagePath: 'owoce/karambola_gwiezdny_owoc.png', localAsset: require('@/assets/premium/fruits/karambola_gwiezdny_owoc.webp') },
  { slug: 'pitaja_smoczy_owoc', category: 'owoce', labelPl: 'Pitaja', aliases: ['pitaja', 'smoczy owoc', 'dragon fruit'], storagePath: 'owoce/pitaja_smoczy_owoc.png', localAsset: require('@/assets/premium/fruits/pitaja_smoczy_owoc.webp') },
  { slug: 'marakuja_passiflora', category: 'owoce', labelPl: 'Marakuja', aliases: ['marakuja', 'passion fruit', 'passiflora'], storagePath: 'owoce/marakuja_passiflora.png', localAsset: require('@/assets/premium/fruits/marakuja_passiflora.webp') },
  { slug: 'kaki_persymona', category: 'owoce', labelPl: 'Kaki', aliases: ['kaki', 'persymona', 'sharon'], storagePath: 'owoce/kaki_persymona.png', localAsset: require('@/assets/premium/fruits/kaki_persymona.webp') },
];

/** Nabiał — siatka 5×5. */
export const DAIRY_CATALOG: ProductImageEntry[] = [
  { slug: 'parmezan_blok_gourmet', category: 'nabial', labelPl: 'Parmezan', aliases: ['parmezan', 'parmesan', 'grana padano'], storagePath: 'nabial/parmezan_blok_gourmet.png', localAsset: require('@/assets/premium/dairy/parmezan_blok_gourmet.webp') },
  { slug: 'cheddar_kostki', category: 'nabial', labelPl: 'Cheddar', aliases: ['cheddar'], storagePath: 'nabial/cheddar_kostki.png', localAsset: require('@/assets/premium/dairy/cheddar_kostki.webp') },
  { slug: 'mozzarella_kulka', category: 'nabial', labelPl: 'Mozzarella', aliases: ['mozzarella', 'mozarella'], storagePath: 'nabial/mozzarella_kulka.png', localAsset: require('@/assets/premium/dairy/mozzarella_kulka.webp') },
  { slug: 'ser_szwajcarski_dziury', category: 'nabial', labelPl: 'Ser szwajcarski', aliases: ['emmental', 'ser szwajcarski', 'szwajcarski'], storagePath: 'nabial/ser_szwajcarski_dziury.png', localAsset: require('@/assets/premium/dairy/ser_szwajcarski_dziury.webp') },
  { slug: 'brie_ser_trojkat', category: 'nabial', labelPl: 'Brie', aliases: ['brie'], storagePath: 'nabial/brie_ser_trojkat.png', localAsset: require('@/assets/premium/dairy/brie_ser_trojkat.webp') },
  { slug: 'ser_gorgonzola_blok', category: 'nabial', labelPl: 'Gorgonzola', aliases: ['gorgonzola', 'blue cheese', 'ser pleśniowy'], storagePath: 'nabial/ser_gorgonzola_blok.png', localAsset: require('@/assets/premium/dairy/ser_gorgonzola_blok.webp') },
  { slug: 'maslo_kostka_osolka', category: 'nabial', labelPl: 'Masło', aliases: ['masło', 'maslo', 'butter'], storagePath: 'nabial/maslo_kostka_osolka.png', localAsset: require('@/assets/premium/dairy/maslo_kostka_osolka.webp') },
  { slug: 'mleko_dzbanek_szklany', category: 'nabial', labelPl: 'Mleko', aliases: ['mleko', 'milk'], storagePath: 'nabial/mleko_dzbanek_szklany.png', localAsset: require('@/assets/premium/dairy/mleko_dzbanek_szklany.webp') },
  { slug: 'smietana_jogurt_miska', category: 'nabial', labelPl: 'Śmietana / jogurt', aliases: ['śmietana', 'smietana', 'jogurt grecki', 'greek yogurt'], storagePath: 'nabial/smietana_jogurt_miska.png', localAsset: require('@/assets/premium/dairy/smietana_jogurt_miska.webp') },
  { slug: 'jajko_kurze_brazowe', category: 'nabial', labelPl: 'Jajko brązowe', aliases: ['jajko', 'jajka', 'jajko brązowe', 'egg', 'żółtko', 'zoltko', 'żółtka', 'zoltka', 'yolk', 'całe jajko', 'cale jajko'], storagePath: 'nabial/jajko_kurze_brazowe.png', localAsset: require('@/assets/premium/dairy/jajko_kurze_brazowe.webp') },
  { slug: 'jajko_kurze_biale', category: 'nabial', labelPl: 'Jajko białe', aliases: ['jajko białe', 'jajko biale', 'białe jajko'], storagePath: 'nabial/jajko_kurze_biale.png', localAsset: require('@/assets/premium/dairy/jajko_kurze_biale.webp') },
  { slug: 'jajko_kurze_bezowe', category: 'nabial', labelPl: 'Jajko beżowe', aliases: ['jajko beżowe', 'jajko bezowe'], storagePath: 'nabial/jajko_kurze_bezowe.png', localAsset: require('@/assets/premium/dairy/jajko_kurze_bezowe.webp') },
  { slug: 'twarog_twarozek_miska', category: 'nabial', labelPl: 'Twaróg', aliases: ['twaróg', 'twarog', 'twarożek', 'cottage cheese'], storagePath: 'nabial/twarog_twarozek_miska.png', localAsset: require('@/assets/premium/dairy/twarog_twarozek_miska.webp') },
  { slug: 'grana_padano_trojkat', category: 'nabial', labelPl: 'Grana Padano', aliases: ['grana', 'pecorino'], storagePath: 'nabial/grana_padano_trojkat.png', localAsset: require('@/assets/premium/dairy/grana_padano_trojkat.webp') },
  { slug: 'ser_tarty_mozzarella', category: 'nabial', labelPl: 'Ser tarty', aliases: ['ser tarty', 'tarta mozzarella', 'starty ser'], storagePath: 'nabial/ser_tarty_mozzarella.png', localAsset: require('@/assets/premium/dairy/ser_tarty_mozzarella.webp') },
  { slug: 'ser_ricotta_oscypek', category: 'nabial', labelPl: 'Ricotta / bundz', aliases: ['ricotta', 'bundz', 'oscypek'], storagePath: 'nabial/ser_ricotta_oscypek.png', localAsset: require('@/assets/premium/dairy/ser_ricotta_oscypek.webp') },
  { slug: 'ser_camembert_kawalek', category: 'nabial', labelPl: 'Camembert', aliases: ['camembert'], storagePath: 'nabial/ser_camembert_kawalek.png', localAsset: require('@/assets/premium/dairy/ser_camembert_kawalek.webp') },
  { slug: 'smietanka_plynna_miseczka', category: 'nabial', labelPl: 'Śmietanka', aliases: ['śmietanka', 'smietanka', 'cream 30%', 'cream 36%'], storagePath: 'nabial/smietanka_plynna_miseczka.png', localAsset: require('@/assets/premium/dairy/smietanka_plynna_miseczka.webp') },
  { slug: 'ser_feta_blok', category: 'nabial', labelPl: 'Feta', aliases: ['feta', 'ser sałatkowy'], storagePath: 'nabial/ser_feta_blok.png', localAsset: require('@/assets/premium/dairy/ser_feta_blok.webp') },
  { slug: 'ser_burrata_sakiewka', category: 'nabial', labelPl: 'Burrata', aliases: ['burrata'], storagePath: 'nabial/ser_burrata_sakiewka.png', localAsset: require('@/assets/premium/dairy/ser_burrata_sakiewka.webp') },
  { slug: 'ser_guda_kawalek', category: 'nabial', labelPl: 'Gouda', aliases: ['gouda', 'guda', 'edamski', 'edam'], storagePath: 'nabial/ser_guda_kawalek.png', localAsset: require('@/assets/premium/dairy/ser_guda_kawalek.webp') },
  { slug: 'jogurt_naturalny_sloik', category: 'nabial', labelPl: 'Jogurt naturalny', aliases: ['jogurt', 'kefir', 'yogurt'], storagePath: 'nabial/jogurt_naturalny_sloik.png', localAsset: require('@/assets/premium/dairy/jogurt_naturalny_sloik.webp') },
  { slug: 'ser_feta_kostki', category: 'nabial', labelPl: 'Feta kostki', aliases: ['feta kostki', 'kostki fety'], storagePath: 'nabial/ser_feta_kostki.png', localAsset: require('@/assets/premium/dairy/ser_feta_kostki.webp') },
  { slug: 'ser_rokpol_trojkat', category: 'nabial', labelPl: 'Rokpol', aliases: ['rokpol', 'rokfort', 'roquefort'], storagePath: 'nabial/ser_rokpol_trojkat.png', localAsset: require('@/assets/premium/dairy/ser_rokpol_trojkat.webp') },
  { slug: 'ser_twarogowy_okragly', category: 'nabial', labelPl: 'Ser twarogowy', aliases: ['ser twarogowy', 'biały ser'], storagePath: 'nabial/ser_twarogowy_okragly.png', localAsset: require('@/assets/premium/dairy/ser_twarogowy_okragly.webp') },
];

/** Sucha spiżarnia — siatka 5×5. */
export const DRY_PANTRY_CATALOG: ProductImageEntry[] = [
  { slug: 'maka_pszenna_kopiec', category: 'sucha_spizarnia', labelPl: 'Mąka pszenna', aliases: ['mąka', 'maka', 'mąka pszenna', 'flour'], storagePath: 'sucha/maka_pszenna_kopiec.png', localAsset: require('@/assets/premium/dry/maka_pszenna_kopiec.webp') },
  { slug: 'ryz_bialy_jasminowy', category: 'sucha_spizarnia', labelPl: 'Ryż biały', aliases: ['ryż', 'ryz', 'jasminowy', 'rice'], storagePath: 'sucha/ryz_bialy_jasminowy.png', localAsset: require('@/assets/premium/dry/ryz_bialy_jasminowy.webp') },
  { slug: 'platki_owsiane', category: 'sucha_spizarnia', labelPl: 'Płatki owsiane', aliases: ['płatki owsiane', 'platki', 'owies', 'oats'], storagePath: 'sucha/platki_owsiane.png', localAsset: require('@/assets/premium/dry/platki_owsiane.webp') },
  { slug: 'sol_morska_gruba', category: 'sucha_spizarnia', labelPl: 'Sól', aliases: ['sól', 'sol', 'sól morska', 'salt'], storagePath: 'sucha/sol_morska_gruba.png', localAsset: require('@/assets/premium/dry/sol_morska_gruba.webp') },
  { slug: 'pieprz_czarny_ziarna', category: 'sucha_spizarnia', labelPl: 'Pieprz czarny', aliases: ['pieprz', 'pieprz czarny', 'pepper'], storagePath: 'sucha/pieprz_czarny_ziarna.png', localAsset: require('@/assets/premium/dry/pieprz_czarny_ziarna.webp') },
  { slug: 'cukier_brazowy_kostki', category: 'sucha_spizarnia', labelPl: 'Cukier brązowy', aliases: ['cukier brązowy', 'cukier brazowy', 'brown sugar'], storagePath: 'sucha/cukier_brazowy_kostki.png', localAsset: require('@/assets/premium/dry/cukier_brazowy_kostki.webp') },
  { slug: 'cukier_bialy_kopiec', category: 'sucha_spizarnia', labelPl: 'Cukier biały', aliases: ['cukier', 'cukier biały', 'sugar'], storagePath: 'sucha/cukier_bialy_kopiec.png', localAsset: require('@/assets/premium/dry/cukier_bialy_kopiec.webp') },
  { slug: 'makaron_spaghetti_wiazka', category: 'sucha_spizarnia', labelPl: 'Spaghetti', aliases: ['spaghetti', 'makaron spaghetti'], storagePath: 'sucha/makaron_spaghetti_wiazka.png', localAsset: require('@/assets/premium/dry/makaron_spaghetti_wiazka.webp') },
  { slug: 'makaron_penne_rurki', category: 'sucha_spizarnia', labelPl: 'Penne', aliases: ['penne', 'rurki', 'makaron'], storagePath: 'sucha/makaron_penne_rurki.png', localAsset: require('@/assets/premium/dry/makaron_penne_rurki.webp') },
  { slug: 'fasola_czerwona_sucha', category: 'sucha_spizarnia', labelPl: 'Fasola czerwona', aliases: ['fasola', 'kidney', 'fasola czerwona'], storagePath: 'sucha/fasola_czerwona_sucha.png', localAsset: require('@/assets/premium/dry/fasola_czerwona_sucha.webp') },
  { slug: 'kasza_kukurydziana_polenta', category: 'sucha_spizarnia', labelPl: 'Polenta', aliases: ['polenta', 'kasza kukurydziana'], storagePath: 'sucha/kasza_kukurydziana_polenta.png', localAsset: require('@/assets/premium/dry/kasza_kukurydziana_polenta.webp') },
  { slug: 'maka_ziemniaczana_skrobia', category: 'sucha_spizarnia', labelPl: 'Mąka ziemniaczana', aliases: ['skrobia', 'mąka ziemniaczana', 'proszek do pieczenia'], storagePath: 'sucha/maka_ziemniaczana_skrobia.png', localAsset: require('@/assets/premium/dry/maka_ziemniaczana_skrobia.webp') },
  { slug: 'drozdze_suche_instant', category: 'sucha_spizarnia', labelPl: 'Drożdże', aliases: ['drożdże', 'drozdzze', 'yeast'], storagePath: 'sucha/drozdze_suche_instant.png', localAsset: require('@/assets/premium/dry/drozdze_suche_instant.webp') },
  { slug: 'bulka_tarta_breadcrumbs', category: 'sucha_spizarnia', labelPl: 'Bułka tarta', aliases: ['bułka tarta', 'panko', 'breadcrumbs'], storagePath: 'sucha/bulka_tarta_breadcrumbs.png', localAsset: require('@/assets/premium/dry/bulka_tarta_breadcrumbs.webp') },
  { slug: 'groch_zielony_luskany', category: 'sucha_spizarnia', labelPl: 'Groch', aliases: ['groch', 'groszek'], storagePath: 'sucha/groch_zielony_luskany.png', localAsset: require('@/assets/premium/dry/groch_zielony_luskany.webp') },
  { slug: 'soczewica_czerwona', category: 'sucha_spizarnia', labelPl: 'Soczewica', aliases: ['soczewica', 'lentils'], storagePath: 'sucha/soczewica_czerwona.png', localAsset: require('@/assets/premium/dry/soczewica_czerwona.webp') },
  { slug: 'ciecierzyca_sucha', category: 'sucha_spizarnia', labelPl: 'Ciecierzyca', aliases: ['ciecierzyca', 'cieciorka', 'chickpea'], storagePath: 'sucha/ciecierzyca_sucha.png', localAsset: require('@/assets/premium/dry/ciecierzyca_sucha.webp') },
  { slug: 'wiorki_kokosowe', category: 'sucha_spizarnia', labelPl: 'Wiórki kokosowe', aliases: ['wiórki', 'kokos', 'coconut'], storagePath: 'sucha/wiorki_kokosowe.png', localAsset: require('@/assets/premium/dry/wiorki_kokosowe.webp') },
  { slug: 'kasza_jaglana', category: 'sucha_spizarnia', labelPl: 'Kasza jaglana', aliases: ['jaglana', 'kasza', 'millet'], storagePath: 'sucha/kasza_jaglana.png', localAsset: require('@/assets/premium/dry/kasza_jaglana.webp') },
  { slug: 'siemie_lniane_len', category: 'sucha_spizarnia', labelPl: 'Siemię lniane', aliases: ['siemię', 'len', 'flax'], storagePath: 'sucha/siemie_lniane_len.png', localAsset: require('@/assets/premium/dry/siemie_lniane_len.webp') },
  { slug: 'nasiona_chia', category: 'sucha_spizarnia', labelPl: 'Chia', aliases: ['chia', 'nasiona chia'], storagePath: 'sucha/nasiona_chia.png', localAsset: require('@/assets/premium/dry/nasiona_chia.webp') },
  { slug: 'sezam_bialy', category: 'sucha_spizarnia', labelPl: 'Sezam', aliases: ['sezam', 'sesame'], storagePath: 'sucha/sezam_bialy.png', localAsset: require('@/assets/premium/dry/sezam_bialy.webp') },
  { slug: 'kukurydza_ziarna_popcorn', category: 'sucha_spizarnia', labelPl: 'Kukurydza', aliases: ['kukurydza', 'popcorn', 'corn'], storagePath: 'sucha/kukurydza_ziarna_popcorn.png', localAsset: require('@/assets/premium/dry/kukurydza_ziarna_popcorn.webp') },
  { slug: 'migdaly_cale', category: 'sucha_spizarnia', labelPl: 'Migdały', aliases: ['migdały', 'migdaly', 'almond'], storagePath: 'sucha/migdaly_cale.png', localAsset: require('@/assets/premium/dry/migdaly_cale.webp') },
  { slug: 'orzechy_wloskie', category: 'sucha_spizarnia', labelPl: 'Orzechy włoskie', aliases: ['orzechy włoskie', 'orzechy', 'walnut'], storagePath: 'sucha/orzechy_wloskie.png', localAsset: require('@/assets/premium/dry/orzechy_wloskie.webp') },
];

/** Płynna spiżarnia i sosy — siatka 5×5. */
export const LIQUID_PANTRY_CATALOG: ProductImageEntry[] = [
  { slug: 'oliwa_z_oliwek_extra_virgin', category: 'plynna_spizarnia', labelPl: 'Oliwa z oliwek', aliases: ['oliwa', 'olive oil', 'extra virgin'], storagePath: 'plynne/oliwa_z_oliwek_extra_virgin.png', localAsset: require('@/assets/premium/liquids/oliwa_z_oliwek_extra_virgin.webp') },
  { slug: 'olej_slonecznikowy', category: 'plynna_spizarnia', labelPl: 'Olej słonecznikowy', aliases: ['olej', 'słonecznikowy', 'slonecznikowy'], storagePath: 'plynne/olej_slonecznikowy.png', localAsset: require('@/assets/premium/liquids/olej_slonecznikowy.webp') },
  { slug: 'ocet_balsamiczny', category: 'plynna_spizarnia', labelPl: 'Ocet balsamiczny', aliases: ['balsamiczny', 'balsamico'], storagePath: 'plynne/ocet_balsamiczny.png', localAsset: require('@/assets/premium/liquids/ocet_balsamiczny.webp') },
  { slug: 'sos_sojowy_jasny', category: 'plynna_spizarnia', labelPl: 'Sos sojowy', aliases: ['sos sojowy', 'soy sauce'], storagePath: 'plynne/sos_sojowy_jasny.png', localAsset: require('@/assets/premium/liquids/sos_sojowy_jasny.webp') },
  { slug: 'ketchup_miska', category: 'plynna_spizarnia', labelPl: 'Ketchup', aliases: ['ketchup'], storagePath: 'plynne/ketchup_miska.png', localAsset: require('@/assets/premium/liquids/ketchup_miska.webp') },
  { slug: 'majonez_miska', category: 'plynna_spizarnia', labelPl: 'Majonez', aliases: ['majonez', 'mayo'], storagePath: 'plynne/majonez_miska.png', localAsset: require('@/assets/premium/liquids/majonez_miska.webp') },
  { slug: 'musztarda_miska', category: 'plynna_spizarnia', labelPl: 'Musztarda', aliases: ['musztarda', 'mustard'], storagePath: 'plynne/musztarda_miska.png', localAsset: require('@/assets/premium/liquids/musztarda_miska.webp') },
  { slug: 'passata_pomidorowa_jar', category: 'plynna_spizarnia', labelPl: 'Passata', aliases: ['passata', 'przecier', 'przecier pomidorowy'], storagePath: 'plynne/passata_pomidorowa_jar.png', localAsset: require('@/assets/premium/liquids/passata_pomidorowa_jar.webp') },
  { slug: 'sos_sriracha_chili', category: 'plynna_spizarnia', labelPl: 'Sriracha', aliases: ['sriracha', 'sos chili'], storagePath: 'plynne/sos_sriracha_chili.png', localAsset: require('@/assets/premium/liquids/sos_sriracha_chili.webp') },
  { slug: 'mleczko_kokosowe_puszka', category: 'plynna_spizarnia', labelPl: 'Mleczko kokosowe', aliases: ['mleczko kokosowe', 'coconut milk'], storagePath: 'plynne/mleczko_kokosowe_puszka.png', localAsset: require('@/assets/premium/liquids/mleczko_kokosowe_puszka.webp') },
  { slug: 'ocet_jablkowy', category: 'plynna_spizarnia', labelPl: 'Ocet jabłkowy', aliases: ['ocet jabłkowy', 'apple cider'], storagePath: 'plynne/ocet_jablkowy.png', localAsset: require('@/assets/premium/liquids/ocet_jablkowy.webp') },
  { slug: 'ocet_z_bialego_wina', category: 'plynna_spizarnia', labelPl: 'Ocet winny biały', aliases: ['ocet z białego wina', 'white wine vinegar'], storagePath: 'plynne/ocet_z_bialego_wina.png', localAsset: require('@/assets/premium/liquids/ocet_z_bialego_wina.webp') },
  { slug: 'ocet_z_czerwonego_wina', category: 'plynna_spizarnia', labelPl: 'Ocet winny czerwony', aliases: ['ocet z czerwonego wina', 'red wine vinegar'], storagePath: 'plynne/ocet_z_czerwonego_wina.png', localAsset: require('@/assets/premium/liquids/ocet_z_czerwonego_wina.webp') },
  { slug: 'ocet_ryzowy', category: 'plynna_spizarnia', labelPl: 'Ocet ryżowy', aliases: ['ocet ryżowy', 'rice vinegar'], storagePath: 'plynne/ocet_ryzowy.png', localAsset: require('@/assets/premium/liquids/ocet_ryzowy.webp') },
  { slug: 'sos_worcestershire', category: 'plynna_spizarnia', labelPl: 'Worcestershire', aliases: ['worcestershire', 'worcester'], storagePath: 'plynne/sos_worcestershire.png', localAsset: require('@/assets/premium/liquids/sos_worcestershire.webp') },
  { slug: 'sos_ostrygowy', category: 'plynna_spizarnia', labelPl: 'Sos ostrygowy', aliases: ['ostrygowy', 'oyster sauce'], storagePath: 'plynne/sos_ostrygowy.png', localAsset: require('@/assets/premium/liquids/sos_ostrygowy.webp') },
  { slug: 'sos_rybny', category: 'plynna_spizarnia', labelPl: 'Sos rybny', aliases: ['sos rybny', 'fish sauce'], storagePath: 'plynne/sos_rybny.png', localAsset: require('@/assets/premium/liquids/sos_rybny.webp') },
  { slug: 'olej_sezamowy', category: 'plynna_spizarnia', labelPl: 'Olej sezamowy', aliases: ['olej sezamowy', 'sesame oil'], storagePath: 'plynne/olej_sezamowy.png', localAsset: require('@/assets/premium/liquids/olej_sezamowy.webp') },
  { slug: 'olej_z_pestek_winogron', category: 'plynna_spizarnia', labelPl: 'Olej z pestek winogron', aliases: ['pestki winogron', 'grape seed'], storagePath: 'plynne/olej_z_pestek_winogron.png', localAsset: require('@/assets/premium/liquids/olej_z_pestek_winogron.webp') },
  { slug: 'olej_arachidowy_orzechowy', category: 'plynna_spizarnia', labelPl: 'Olej arachidowy', aliases: ['arachidowy', 'peanut oil'], storagePath: 'plynne/olej_arachidowy_orzechowy.png', localAsset: require('@/assets/premium/liquids/olej_arachidowy_orzechowy.webp') },
  { slug: 'sos_hoisin', category: 'plynna_spizarnia', labelPl: 'Hoisin', aliases: ['hoisin'], storagePath: 'plynne/sos_hoisin.png', localAsset: require('@/assets/premium/liquids/sos_hoisin.webp') },
  { slug: 'sos_slodki_chili', category: 'plynna_spizarnia', labelPl: 'Słodki chili', aliases: ['słodki chili', 'sweet chili'], storagePath: 'plynne/sos_slodki_chili.png', localAsset: require('@/assets/premium/liquids/sos_slodki_chili.webp') },
  { slug: 'sos_teriyaki', category: 'plynna_spizarnia', labelPl: 'Teriyaki', aliases: ['teriyaki'], storagePath: 'plynne/sos_teriyaki.png', localAsset: require('@/assets/premium/liquids/sos_teriyaki.webp') },
  { slug: 'sos_ponzu', category: 'plynna_spizarnia', labelPl: 'Ponzu', aliases: ['ponzu'], storagePath: 'plynne/sos_ponzu.png', localAsset: require('@/assets/premium/liquids/sos_ponzu.webp') },
  { slug: 'syrop_klonowy', category: 'plynna_spizarnia', labelPl: 'Syrop klonowy', aliases: ['syrop klonowy', 'maple'], storagePath: 'plynne/syrop_klonowy.png', localAsset: require('@/assets/premium/liquids/syrop_klonowy.webp') },
];

/** Pieczywo — siatka 5×5. */
export const BREAD_CATALOG: ProductImageEntry[] = [
  { slug: 'chleb_rzemieslniczy_bochenek', category: 'pieczywo', labelPl: 'Chleb rzemieślniczy', aliases: ['chleb', 'zakwas', 'sourdough'], storagePath: 'pieczywo/chleb_rzemieslniczy_bochenek.png', localAsset: require('@/assets/premium/bread/chleb_rzemieslniczy_bochenek.webp') },
  { slug: 'bagietka_francuska', category: 'pieczywo', labelPl: 'Bagietka', aliases: ['bagietka', 'baguette'], storagePath: 'pieczywo/bagietka_francuska.png', localAsset: require('@/assets/premium/bread/bagietka_francuska.webp') },
  { slug: 'chleb_biale_bochenek_okragly', category: 'pieczywo', labelPl: 'Chleb biały', aliases: ['chleb biały', 'chleb pszenny'], storagePath: 'pieczywo/chleb_biale_bochenek_okragly.png', localAsset: require('@/assets/premium/bread/chleb_biale_bochenek_okragly.webp') },
  { slug: 'bulka_brioche_burger', category: 'pieczywo', labelPl: 'Bułka brioche', aliases: ['brioche', 'bułka burger', 'bulka burger'], storagePath: 'pieczywo/bulka_brioche_burger.png', localAsset: require('@/assets/premium/bread/bulka_brioche_burger.webp') },
  { slug: 'chleb_tostowy_pelnoziarnisty', category: 'pieczywo', labelPl: 'Chleb tostowy', aliases: ['tostowy', 'tost', 'pełnoziarnisty', 'grzanki', 'grzanka', 'tosty', 'croutons'], storagePath: 'pieczywo/chleb_tostowy_pelnoziarnisty.png', localAsset: require('@/assets/premium/bread/chleb_tostowy_pelnoziarnisty.webp') },
  { slug: 'tortilla_wraps_stos', category: 'pieczywo', labelPl: 'Tortilla', aliases: ['tortilla', 'wrap'], storagePath: 'pieczywo/tortilla_wraps_stos.png', localAsset: require('@/assets/premium/bread/tortilla_wraps_stos.webp') },
  { slug: 'croissant_maslany', category: 'pieczywo', labelPl: 'Croissant', aliases: ['croissant', 'rogalik'], storagePath: 'pieczywo/croissant_maslany.png', localAsset: require('@/assets/premium/bread/croissant_maslany.webp') },
  { slug: 'chlebek_pita', category: 'pieczywo', labelPl: 'Pita', aliases: ['pita', 'chlebek pita'], storagePath: 'pieczywo/chlebek_pita.png', localAsset: require('@/assets/premium/bread/chlebek_pita.webp') },
  { slug: 'bajgiel_z_sezamem', category: 'pieczywo', labelPl: 'Bajgiel z sezamem', aliases: ['bajgiel', 'bagel'], storagePath: 'pieczywo/bajgiel_z_sezamem.png', localAsset: require('@/assets/premium/bread/bajgiel_z_sezamem.webp') },
  { slug: 'ciasto_na_pizze_kulka', category: 'pieczywo', labelPl: 'Ciasto na pizzę', aliases: ['ciasto pizza', 'pizza dough'], storagePath: 'pieczywo/ciasto_na_pizze_kulka.png', localAsset: require('@/assets/premium/bread/ciasto_na_pizze_kulka.webp') },
  { slug: 'cinnamon_roll_cynamonka', category: 'pieczywo', labelPl: 'Cynamonka', aliases: ['cynamonka', 'cinnamon roll'], storagePath: 'pieczywo/cinnamon_roll_cynamonka.png', localAsset: require('@/assets/premium/bread/cinnamon_roll_cynamonka.webp') },
  { slug: 'muffin_z_czekolada', category: 'pieczywo', labelPl: 'Muffin', aliases: ['muffin', 'babeczka', 'biszkopt', 'biszkopty', 'biszkopcik', 'sponge cake'], storagePath: 'pieczywo/muffin_z_czekolada.png', localAsset: require('@/assets/premium/bread/muffin_z_czekolada.webp') },
  { slug: 'bulka_pszenna_klasyczna', category: 'pieczywo', labelPl: 'Bułka pszenna', aliases: ['bułka', 'bulka', 'kajzerka'], storagePath: 'pieczywo/bulka_pszenna_klasyczna.png', localAsset: require('@/assets/premium/bread/bulka_pszenna_klasyczna.webp') },
  { slug: 'pain_au_chocolat', category: 'pieczywo', labelPl: 'Pain au chocolat', aliases: ['pain au chocolat', 'rogalik czekoladowy'], storagePath: 'pieczywo/pain_au_chocolat.png', localAsset: require('@/assets/premium/bread/pain_au_chocolat.webp') },
  { slug: 'precel_bawarski', category: 'pieczywo', labelPl: 'Precel', aliases: ['precel', 'pretzel'], storagePath: 'pieczywo/precel_bawarski.png', localAsset: require('@/assets/premium/bread/precel_bawarski.webp') },
  { slug: 'chleb_z_ziarnami_maly', category: 'pieczywo', labelPl: 'Chleb z ziarnami', aliases: ['chleb z ziarnami', 'ziarnisty'], storagePath: 'pieczywo/chleb_z_ziarnami_maly.png', localAsset: require('@/assets/premium/bread/chleb_z_ziarnami_maly.webp') },
  { slug: 'bajgiel_klasyczny', category: 'pieczywo', labelPl: 'Bajgiel', aliases: ['bajgiel klasyczny'], storagePath: 'pieczywo/bajgiel_klasyczny.png', localAsset: require('@/assets/premium/bread/bajgiel_klasyczny.webp') },
  { slug: 'bulka_serowa', category: 'pieczywo', labelPl: 'Bułka serowa', aliases: ['bułka serowa', 'serowa'], storagePath: 'pieczywo/bulka_serowa.png', localAsset: require('@/assets/premium/bread/bulka_serowa.webp') },
  { slug: 'chalka_drozdzowa', category: 'pieczywo', labelPl: 'Chałka', aliases: ['chałka', 'chalka', 'challah'], storagePath: 'pieczywo/chalka_drozdzowa.png', localAsset: require('@/assets/premium/bread/chalka_drozdzowa.webp') },
  { slug: 'chleb_zytni_bochenek', category: 'pieczywo', labelPl: 'Chleb żytni', aliases: ['żytni', 'zytni', 'razowy'], storagePath: 'pieczywo/chleb_zytni_bochenek.png', localAsset: require('@/assets/premium/bread/chleb_zytni_bochenek.webp') },
  { slug: 'focaccia_kawalek', category: 'pieczywo', labelPl: 'Focaccia', aliases: ['focaccia'], storagePath: 'pieczywo/focaccia_kawalek.png', localAsset: require('@/assets/premium/bread/focaccia_kawalek.webp') },
  { slug: 'english_muffin', category: 'pieczywo', labelPl: 'English muffin', aliases: ['english muffin', 'muffin angielski'], storagePath: 'pieczywo/english_muffin.png', localAsset: require('@/assets/premium/bread/english_muffin.webp') },
  { slug: 'bulka_grahamka_ziarna', category: 'pieczywo', labelPl: 'Grahamka', aliases: ['grahamka', 'graham'], storagePath: 'pieczywo/bulka_grahamka_ziarna.png', localAsset: require('@/assets/premium/bread/bulka_grahamka_ziarna.webp') },
  { slug: 'bulka_z_rodzynkami', category: 'pieczywo', labelPl: 'Bułka z rodzynkami', aliases: ['rodzynki', 'drożdżówka'], storagePath: 'pieczywo/bulka_z_rodzynkami.png', localAsset: require('@/assets/premium/bread/bulka_z_rodzynkami.webp') },
  { slug: 'chleb_wieloziarnisty_owalny', category: 'pieczywo', labelPl: 'Chleb wieloziarnisty', aliases: ['wieloziarnisty', 'fitness'], storagePath: 'pieczywo/chleb_wieloziarnisty_owalny.png', localAsset: require('@/assets/premium/bread/chleb_wieloziarnisty_owalny.webp') },
];

/** Kawa / herbata / dodatki barowe — siatka 5×5. */
export const CAFE_CATALOG: ProductImageEntry[] = [
  { slug: 'kawa_ziarnista_palona', category: 'kawa_bar', labelPl: 'Kawa ziarnista', aliases: ['kawa', 'espresso', 'ziarna kawy'], storagePath: 'kawa/kawa_ziarnista_palona.png', localAsset: require('@/assets/premium/cafe/kawa_ziarnista_palona.webp') },
  { slug: 'kawa_ziarnista_zielona', category: 'kawa_bar', labelPl: 'Kawa zielona', aliases: ['kawa zielona', 'zielone ziarna'], storagePath: 'kawa/kawa_ziarnista_zielona.png', localAsset: require('@/assets/premium/cafe/kawa_ziarnista_zielona.webp') },
  { slug: 'herbata_zielona_liscie', category: 'kawa_bar', labelPl: 'Herbata zielona', aliases: ['herbata zielona', 'green tea'], storagePath: 'kawa/herbata_zielona_liscie.png', localAsset: require('@/assets/premium/cafe/herbata_zielona_liscie.webp') },
  { slug: 'herbata_czarna_liscie', category: 'kawa_bar', labelPl: 'Herbata czarna', aliases: ['herbata czarna', 'black tea', 'herbata'], storagePath: 'kawa/herbata_czarna_liscie.png', localAsset: require('@/assets/premium/cafe/herbata_czarna_liscie.webp') },
  { slug: 'matcha_proszek_premium', category: 'kawa_bar', labelPl: 'Matcha', aliases: ['matcha'], storagePath: 'kawa/matcha_proszek_premium.png', localAsset: require('@/assets/premium/cafe/matcha_proszek_premium.webp') },
  { slug: 'syrop_barowy_grenadina', category: 'kawa_bar', labelPl: 'Grenadina', aliases: ['grenadina', 'grenadine'], storagePath: 'kawa/syrop_barowy_grenadina.png', localAsset: require('@/assets/premium/cafe/syrop_barowy_grenadina.webp') },
  { slug: 'syrop_barowy_wanilia', category: 'kawa_bar', labelPl: 'Syrop waniliowy', aliases: ['syrop wanilia', 'vanilla syrup'], storagePath: 'kawa/syrop_barowy_wanilia.png', localAsset: require('@/assets/premium/cafe/syrop_barowy_wanilia.webp') },
  { slug: 'syrop_barowy_karmel', category: 'kawa_bar', labelPl: 'Syrop karmelowy', aliases: ['syrop karmel', 'caramel syrup'], storagePath: 'kawa/syrop_barowy_karmel.png', localAsset: require('@/assets/premium/cafe/syrop_barowy_karmel.webp') },
  { slug: 'cynamon_laski', category: 'kawa_bar', labelPl: 'Cynamon', aliases: ['cynamon', 'cinnamon'], storagePath: 'kawa/cynamon_laski.png', localAsset: require('@/assets/premium/cafe/cynamon_laski.webp') },
  { slug: 'kakao_proszek_naturalny', category: 'kawa_bar', labelPl: 'Kakao', aliases: ['kakao', 'cocoa'], storagePath: 'kawa/kakao_proszek_naturalny.png', localAsset: require('@/assets/premium/cafe/kakao_proszek_naturalny.webp') },
  { slug: 'orzechy_migdaly', category: 'kawa_bar', labelPl: 'Migdały', aliases: ['migdały', 'migdaly'], storagePath: 'kawa/orzechy_migdaly.png', localAsset: require('@/assets/premium/cafe/orzechy_migdaly.webp') },
  { slug: 'orzechy_laskowe', category: 'kawa_bar', labelPl: 'Orzechy laskowe', aliases: ['laskowe', 'hazelnut'], storagePath: 'kawa/orzechy_laskowe.png', localAsset: require('@/assets/premium/cafe/orzechy_laskowe.webp') },
  { slug: 'orzechy_wloskie_kawiarnia', category: 'kawa_bar', labelPl: 'Orzechy włoskie', aliases: ['orzechy włoskie'], storagePath: 'kawa/orzechy_wloskie_kawiarnia.png', localAsset: require('@/assets/premium/cafe/orzechy_wloskie_kawiarnia.webp') },
  { slug: 'pestki_dyni', category: 'kawa_bar', labelPl: 'Pestki dyni', aliases: ['pestki dyni', 'dynia'], storagePath: 'kawa/pestki_dyni.png', localAsset: require('@/assets/premium/cafe/pestki_dyni.webp') },
  { slug: 'pestki_slonecznika', category: 'kawa_bar', labelPl: 'Pestki słonecznika', aliases: ['słonecznik', 'slonecznik'], storagePath: 'kawa/pestki_slonecznika.png', localAsset: require('@/assets/premium/cafe/pestki_slonecznika.webp') },
  { slug: 'czekolada_gorzka_kostki', category: 'kawa_bar', labelPl: 'Czekolada gorzka', aliases: ['czekolada', 'gorzka'], storagePath: 'kawa/czekolada_gorzka_kostki.png', localAsset: require('@/assets/premium/cafe/czekolada_gorzka_kostki.webp') },
  { slug: 'czekolada_biala_kostki', category: 'kawa_bar', labelPl: 'Czekolada biała', aliases: ['czekolada biała', 'biała czekolada'], storagePath: 'kawa/czekolada_biala_kostki.png', localAsset: require('@/assets/premium/cafe/czekolada_biala_kostki.webp') },
  { slug: 'platki_rozy_suszone', category: 'kawa_bar', labelPl: 'Płatki róży', aliases: ['płatki róży', 'róża'], storagePath: 'kawa/platki_rozy_suszone.png', localAsset: require('@/assets/premium/cafe/platki_rozy_suszone.webp') },
  { slug: 'rumianek_susz_kwiaty', category: 'kawa_bar', labelPl: 'Rumianek', aliases: ['rumianek', 'chamomile'], storagePath: 'kawa/rumianek_susz_kwiaty.png', localAsset: require('@/assets/premium/cafe/rumianek_susz_kwiaty.webp') },
  { slug: 'hibiskus_susz_kwiaty', category: 'kawa_bar', labelPl: 'Hibiskus', aliases: ['hibiskus', 'karkade'], storagePath: 'kawa/hibiskus_susz_kwiaty.png', localAsset: require('@/assets/premium/cafe/hibiskus_susz_kwiaty.webp') },
  { slug: 'cukier_trzcinowy_brazowy', category: 'kawa_bar', labelPl: 'Cukier trzcinowy', aliases: ['cukier trzcinowy'], storagePath: 'kawa/cukier_trzcinowy_brazowy.png', localAsset: require('@/assets/premium/cafe/cukier_trzcinowy_brazowy.webp') },
  { slug: 'cukier_puder', category: 'kawa_bar', labelPl: 'Cukier puder', aliases: ['cukier puder', 'puder'], storagePath: 'kawa/cukier_puder.png', localAsset: require('@/assets/premium/cafe/cukier_puder.webp') },
  { slug: 'cukier_bialy_krysztal', category: 'kawa_bar', labelPl: 'Cukier kryształ', aliases: ['cukier kryształ'], storagePath: 'kawa/cukier_bialy_krysztal.png', localAsset: require('@/assets/premium/cafe/cukier_bialy_krysztal.webp') },
  { slug: 'sol_himalajska_rozowa', category: 'kawa_bar', labelPl: 'Sól himalajska', aliases: ['sól himalajska', 'himalayan'], storagePath: 'kawa/sol_himalajska_rozowa.png', localAsset: require('@/assets/premium/cafe/sol_himalajska_rozowa.webp') },
  { slug: 'pieprz_czarny_ziarna_bar', category: 'kawa_bar', labelPl: 'Pieprz czarny', aliases: ['pieprz'], storagePath: 'kawa/pieprz_czarny_ziarna_bar.png', localAsset: require('@/assets/premium/cafe/pieprz_czarny_ziarna_bar.webp') },
];

/** Napoje bezalkoholowe — siatka 5×5. */
export const DRINKS_CATALOG: ProductImageEntry[] = [
  { slug: 'cola_butelka_szklana', category: 'napoje', labelPl: 'Cola', aliases: ['cola', 'coca-cola', 'coca cola'], storagePath: 'napoje/cola_butelka_szklana.png', localAsset: require('@/assets/premium/drinks/cola_butelka_szklana.webp') },
  { slug: 'pepsi_puszka', category: 'napoje', labelPl: 'Pepsi', aliases: ['pepsi'], storagePath: 'napoje/pepsi_puszka.png', localAsset: require('@/assets/premium/drinks/pepsi_puszka.webp') },
  { slug: 'sprite_puszka', category: 'napoje', labelPl: 'Sprite', aliases: ['sprite'], storagePath: 'napoje/sprite_puszka.png', localAsset: require('@/assets/premium/drinks/sprite_puszka.webp') },
  { slug: 'fanta_puszka', category: 'napoje', labelPl: 'Fanta', aliases: ['fanta'], storagePath: 'napoje/fanta_puszka.png', localAsset: require('@/assets/premium/drinks/fanta_puszka.webp') },
  { slug: 'dr_pepper_puszka', category: 'napoje', labelPl: 'Dr Pepper', aliases: ['dr pepper', 'drpepper'], storagePath: 'napoje/dr_pepper_puszka.png', localAsset: require('@/assets/premium/drinks/dr_pepper_puszka.webp') },
  { slug: 'schweppes_tonic_puszka', category: 'napoje', labelPl: 'Tonic', aliases: ['tonic', 'schweppes tonic'], storagePath: 'napoje/schweppes_tonic_puszka.png', localAsset: require('@/assets/premium/drinks/schweppes_tonic_puszka.webp') },
  { slug: '7up_puszka', category: 'napoje', labelPl: '7Up', aliases: ['7up', 'seven up'], storagePath: 'napoje/7up_puszka.png', localAsset: require('@/assets/premium/drinks/7up_puszka.webp') },
  { slug: 'mountain_dew_puszka', category: 'napoje', labelPl: 'Mountain Dew', aliases: ['mountain dew', 'dew'], storagePath: 'napoje/mountain_dew_puszka.png', localAsset: require('@/assets/premium/drinks/mountain_dew_puszka.webp') },
  { slug: 'schweppes_ginger_ale_puszka', category: 'napoje', labelPl: 'Ginger Ale', aliases: ['ginger ale', 'schweppes ginger'], storagePath: 'napoje/schweppes_ginger_ale_puszka.png', localAsset: require('@/assets/premium/drinks/schweppes_ginger_ale_puszka.webp') },
  { slug: 'pepsi_zero_puszka', category: 'napoje', labelPl: 'Pepsi Zero', aliases: ['pepsi zero'], storagePath: 'napoje/pepsi_zero_puszka.png', localAsset: require('@/assets/premium/drinks/pepsi_zero_puszka.webp') },
  { slug: 'fever_tree_tonic_butelka', category: 'napoje', labelPl: 'Fever-Tree Tonic', aliases: ['fever-tree', 'fever tree'], storagePath: 'napoje/fever_tree_tonic_butelka.png', localAsset: require('@/assets/premium/drinks/fever_tree_tonic_butelka.webp') },
  { slug: 'fentimans_ginger_beer_butelka', category: 'napoje', labelPl: 'Ginger Beer', aliases: ['ginger beer', 'fentimans'], storagePath: 'napoje/fentimans_ginger_beer_butelka.png', localAsset: require('@/assets/premium/drinks/fentimans_ginger_beer_butelka.webp') },
  { slug: 'sok_pomaranczowy_karafka', category: 'napoje', labelPl: 'Sok pomarańczowy', aliases: ['sok pomarańczowy', 'orange juice'], storagePath: 'napoje/sok_pomaranczowy_karafka.png', localAsset: require('@/assets/premium/drinks/sok_pomaranczowy_karafka.webp') },
  { slug: 'sok_jablkowy_szklanka', category: 'napoje', labelPl: 'Sok jabłkowy', aliases: ['sok jabłkowy', 'apple juice'], storagePath: 'napoje/sok_jablkowy_szklanka.png', localAsset: require('@/assets/premium/drinks/sok_jablkowy_szklanka.webp') },
  { slug: 'san_pellegrino_woda_butelka', category: 'napoje', labelPl: 'San Pellegrino', aliases: ['san pellegrino', 'pellegrino'], storagePath: 'napoje/san_pellegrino_woda_butelka.png', localAsset: require('@/assets/premium/drinks/san_pellegrino_woda_butelka.webp') },
  { slug: 'red_bull_energetyk_puszka', category: 'napoje', labelPl: 'Red Bull', aliases: ['red bull', 'redbull'], storagePath: 'napoje/red_bull_energetyk_puszka.png', localAsset: require('@/assets/premium/drinks/red_bull_energetyk_puszka.webp') },
  { slug: 'monster_energetyk_puszka', category: 'napoje', labelPl: 'Monster', aliases: ['monster', 'monster energy'], storagePath: 'napoje/monster_energetyk_puszka.png', localAsset: require('@/assets/premium/drinks/monster_energetyk_puszka.webp') },
  { slug: 'sok_pomidorowy_szklanka', category: 'napoje', labelPl: 'Sok pomidorowy', aliases: ['sok pomidorowy', 'tomato juice'], storagePath: 'napoje/sok_pomidorowy_szklanka.png', localAsset: require('@/assets/premium/drinks/sok_pomidorowy_szklanka.webp') },
  { slug: 'lemoniada_dzbanek', category: 'napoje', labelPl: 'Lemoniada', aliases: ['lemoniada', 'lemonade'], storagePath: 'napoje/lemoniada_dzbanek.png', localAsset: require('@/assets/premium/drinks/lemoniada_dzbanek.webp') },
  { slug: 'somersby_cydr_butelka', category: 'napoje', labelPl: 'Cydr', aliases: ['somersby', 'cydr', 'cider'], storagePath: 'napoje/somersby_cydr_butelka.png', localAsset: require('@/assets/premium/drinks/somersby_cydr_butelka.webp') },
  { slug: 'snapple_lemoniada_butelka', category: 'napoje', labelPl: 'Snapple', aliases: ['snapple'], storagePath: 'napoje/snapple_lemoniada_butelka.png', localAsset: require('@/assets/premium/drinks/snapple_lemoniada_butelka.webp') },
  { slug: 'tropicana_sok_butelka', category: 'napoje', labelPl: 'Tropicana', aliases: ['tropicana'], storagePath: 'napoje/tropicana_sok_butelka.png', localAsset: require('@/assets/premium/drinks/tropicana_sok_butelka.webp') },
  { slug: 'minute_maid_sok_jablkowy', category: 'napoje', labelPl: 'Minute Maid', aliases: ['minute maid'], storagePath: 'napoje/minute_maid_sok_jablkowy.png', localAsset: require('@/assets/premium/drinks/minute_maid_sok_jablkowy.webp') },
  { slug: 'ocean_spray_sok_zurawinowy', category: 'napoje', labelPl: 'Ocean Spray', aliases: ['ocean spray', 'żurawina', 'zurawina'], storagePath: 'napoje/ocean_spray_sok_zurawinowy.png', localAsset: require('@/assets/premium/drinks/ocean_spray_sok_zurawinowy.webp') },
  { slug: 'fiji_woda_butelka', category: 'napoje', labelPl: 'Fiji Water', aliases: ['fiji', 'woda fiji'], storagePath: 'napoje/fiji_woda_butelka.png', localAsset: require('@/assets/premium/drinks/fiji_woda_butelka.webp') },
];

export const WINE_BEER_CATALOG: ProductImageEntry[] = [
  { slug: 'wino_czerwone_bordeaux', category: 'wino_piwo', labelPl: 'Wino Bordeaux', aliases: ['bordeaux', 'wino czerwone', 'cabernet'], storagePath: 'wino/wino_czerwone_bordeaux.png', localAsset: require('@/assets/premium/wine/wino_czerwone_bordeaux.webp') },
  { slug: 'wino_biale_sancerre', category: 'wino_piwo', labelPl: 'Sancerre', aliases: ['sancerre', 'wino białe', 'wino biale'], storagePath: 'wino/wino_biale_sancerre.png', localAsset: require('@/assets/premium/wine/wino_biale_sancerre.webp') },
  { slug: 'prosecco_freixenet', category: 'wino_piwo', labelPl: 'Freixenet', aliases: ['freixenet', 'cava', 'prosecco'], storagePath: 'wino/prosecco_freixenet.png', localAsset: require('@/assets/premium/wine/prosecco_freixenet.webp') },
  { slug: 'piwo_sierra_nevada_pale_ale', category: 'wino_piwo', labelPl: 'Sierra Nevada', aliases: ['sierra nevada', 'pale ale'], storagePath: 'wino/piwo_sierra_nevada_pale_ale.png', localAsset: require('@/assets/premium/wine/piwo_sierra_nevada_pale_ale.webp') },
  { slug: 'piwo_brewdog_punk_ipa_puszka', category: 'wino_piwo', labelPl: 'Punk IPA', aliases: ['punk ipa', 'brewdog punk'], storagePath: 'wino/piwo_brewdog_punk_ipa_puszka.png', localAsset: require('@/assets/premium/wine/piwo_brewdog_punk_ipa_puszka.webp') },
  { slug: 'wino_biale_chablis', category: 'wino_piwo', labelPl: 'Chablis', aliases: ['chablis'], storagePath: 'wino/wino_biale_chablis.png', localAsset: require('@/assets/premium/wine/wino_biale_chablis.webp') },
  { slug: 'wino_czerwone_penfolds', category: 'wino_piwo', labelPl: 'Penfolds', aliases: ['penfolds'], storagePath: 'wino/wino_czerwone_penfolds.png', localAsset: require('@/assets/premium/wine/wino_czerwone_penfolds.webp') },
  { slug: 'szampan_moet_chandon', category: 'wino_piwo', labelPl: 'Moët & Chandon', aliases: ['moet', 'moët', 'chandon', 'szampan'], storagePath: 'wino/szampan_moet_chandon.png', localAsset: require('@/assets/premium/wine/szampan_moet_chandon.webp') },
  { slug: 'piwo_lagunitas_ipa', category: 'wino_piwo', labelPl: 'Lagunitas IPA', aliases: ['lagunitas'], storagePath: 'wino/piwo_lagunitas_ipa.png', localAsset: require('@/assets/premium/wine/piwo_lagunitas_ipa.webp') },
  { slug: 'piwo_greene_king_ipa_puszka', category: 'wino_piwo', labelPl: 'Greene King IPA', aliases: ['greene king'], storagePath: 'wino/piwo_greene_king_ipa_puszka.png', localAsset: require('@/assets/premium/wine/piwo_greene_king_ipa_puszka.webp') },
  { slug: 'wino_rozowe_rose', category: 'wino_piwo', labelPl: 'Wino różowe', aliases: ['rosé', 'rose', 'wino różowe', 'wino rozowe'], storagePath: 'wino/wino_rozowe_rose.png', localAsset: require('@/assets/premium/wine/wino_rozowe_rose.webp') },
  { slug: 'wino_czerwone_19_crimes', category: 'wino_piwo', labelPl: '19 Crimes', aliases: ['19 crimes', 'nineteen crimes'], storagePath: 'wino/wino_czerwone_19_crimes.png', localAsset: require('@/assets/premium/wine/wino_czerwone_19_crimes.webp') },
  { slug: 'prosecco_zonin_czarne', category: 'wino_piwo', labelPl: 'Prosecco Zonin', aliases: ['zonin', 'prosecco zonin'], storagePath: 'wino/prosecco_zonin_czarne.png', localAsset: require('@/assets/premium/wine/prosecco_zonin_czarne.webp') },
  { slug: 'piwo_camden_hells_lager', category: 'wino_piwo', labelPl: 'Camden Hells', aliases: ['camden', 'hells', 'lager'], storagePath: 'wino/piwo_camden_hells_lager.png', localAsset: require('@/assets/premium/wine/piwo_camden_hells_lager.webp') },
  { slug: 'piwo_birra_moretti_puszka', category: 'wino_piwo', labelPl: 'Birra Moretti', aliases: ['moretti', 'birra moretti'], storagePath: 'wino/piwo_birra_moretti_puszka.png', localAsset: require('@/assets/premium/wine/piwo_birra_moretti_puszka.webp') },
  { slug: 'wino_czerwone_tignanello', category: 'wino_piwo', labelPl: 'Tignanello', aliases: ['tignanello'], storagePath: 'wino/wino_czerwone_tignanello.png', localAsset: require('@/assets/premium/wine/wino_czerwone_tignanello.webp') },
  { slug: 'wino_biale_cloudy_bay', category: 'wino_piwo', labelPl: 'Cloudy Bay', aliases: ['cloudy bay', 'sauvignon blanc'], storagePath: 'wino/wino_biale_cloudy_bay.png', localAsset: require('@/assets/premium/wine/wino_biale_cloudy_bay.webp') },
  { slug: 'szampan_veuve_clicquot', category: 'wino_piwo', labelPl: 'Veuve Clicquot', aliases: ['veuve', 'clicquot', 'veuve clicquot'], storagePath: 'wino/szampan_veuve_clicquot.png', localAsset: require('@/assets/premium/wine/szampan_veuve_clicquot.webp') },
  { slug: 'piwo_brewdog_hazy_jane', category: 'wino_piwo', labelPl: 'Hazy Jane', aliases: ['hazy jane', 'brewdog hazy'], storagePath: 'wino/piwo_brewdog_hazy_jane.png', localAsset: require('@/assets/premium/wine/piwo_brewdog_hazy_jane.webp') },
  { slug: 'piwo_guinness_draught_puszka', category: 'wino_piwo', labelPl: 'Guinness', aliases: ['guinness', 'stout'], storagePath: 'wino/piwo_guinness_draught_puszka.png', localAsset: require('@/assets/premium/wine/piwo_guinness_draught_puszka.webp') },
  { slug: 'wino_czerwone_barolo', category: 'wino_piwo', labelPl: 'Barolo', aliases: ['barolo'], storagePath: 'wino/wino_czerwone_barolo.png', localAsset: require('@/assets/premium/wine/wino_czerwone_barolo.webp') },
  { slug: 'wino_biale_oyster_bay', category: 'wino_piwo', labelPl: 'Oyster Bay', aliases: ['oyster bay'], storagePath: 'wino/wino_biale_oyster_bay.png', localAsset: require('@/assets/premium/wine/wino_biale_oyster_bay.webp') },
  { slug: 'wino_rozowe_prosecco_zonin', category: 'wino_piwo', labelPl: 'Prosecco Rose Zonin', aliases: ['prosecco rose', 'prosecco różowe', 'zonin rose'], storagePath: 'wino/wino_rozowe_prosecco_zonin.png', localAsset: require('@/assets/premium/wine/wino_rozowe_prosecco_zonin.webp') },
  { slug: 'piwo_beavertown_neck_oil_butelka', category: 'wino_piwo', labelPl: 'Neck Oil', aliases: ['neck oil', 'beavertown'], storagePath: 'wino/piwo_beavertown_neck_oil_butelka.png', localAsset: require('@/assets/premium/wine/piwo_beavertown_neck_oil_butelka.webp') },
  { slug: 'keg_piwo_metalowy', category: 'wino_piwo', labelPl: 'Keg piwny', aliases: ['keg', 'beczka', 'kegstar'], storagePath: 'wino/keg_piwo_metalowy.png', localAsset: require('@/assets/premium/wine/keg_piwo_metalowy.webp') },
];

export const SPIRITS_CATALOG: ProductImageEntry[] = [
  { slug: 'whisky_johnnie_walker_blue_label', category: 'alkohole_mocne', labelPl: 'Johnnie Walker Blue', aliases: ['johnnie walker', 'blue label', 'jw blue'], storagePath: 'alkohole/whisky_johnnie_walker_blue_label.png', localAsset: require('@/assets/premium/spirits/whisky_johnnie_walker_blue_label.webp') },
  { slug: 'gin_the_botanist', category: 'alkohole_mocne', labelPl: 'The Botanist', aliases: ['botanist', 'the botanist'], storagePath: 'alkohole/gin_the_botanist.png', localAsset: require('@/assets/premium/spirits/gin_the_botanist.webp') },
  { slug: 'wodka_belvedere', category: 'alkohole_mocne', labelPl: 'Belvedere', aliases: ['belvedere', 'wódka belvedere', 'wodka belvedere'], storagePath: 'alkohole/wodka_belvedere.png', localAsset: require('@/assets/premium/spirits/wodka_belvedere.webp') },
  { slug: 'koniak_hennessy', category: 'alkohole_mocne', labelPl: 'Hennessy', aliases: ['hennessy', 'koniak', 'cognac'], storagePath: 'alkohole/koniak_hennessy.png', localAsset: require('@/assets/premium/spirits/koniak_hennessy.webp') },
  { slug: 'tequila_patron_silver', category: 'alkohole_mocne', labelPl: 'Patrón Silver', aliases: ['patron', 'patrón', 'tequila patron'], storagePath: 'alkohole/tequila_patron_silver.png', localAsset: require('@/assets/premium/spirits/tequila_patron_silver.webp') },
  { slug: 'rum_zacapa_23', category: 'alkohole_mocne', labelPl: 'Zacapa 23', aliases: ['zacapa', 'ron zacapa'], storagePath: 'alkohole/rum_zacapa_23.png', localAsset: require('@/assets/premium/spirits/rum_zacapa_23.webp') },
  { slug: 'whisky_the_macallan_18', category: 'alkohole_mocne', labelPl: 'Macallan 18', aliases: ['macallan', 'the macallan'], storagePath: 'alkohole/whisky_the_macallan_18.png', localAsset: require('@/assets/premium/spirits/whisky_the_macallan_18.webp') },
  { slug: 'gin_tanqueray_london_dry', category: 'alkohole_mocne', labelPl: 'Tanqueray', aliases: ['tanqueray'], storagePath: 'alkohole/gin_tanqueray_london_dry.png', localAsset: require('@/assets/premium/spirits/gin_tanqueray_london_dry.webp') },
  { slug: 'wodka_grey_goose', category: 'alkohole_mocne', labelPl: 'Grey Goose', aliases: ['grey goose', 'gray goose'], storagePath: 'alkohole/wodka_grey_goose.png', localAsset: require('@/assets/premium/spirits/wodka_grey_goose.webp') },
  { slug: 'bourbon_woodford_reserve', category: 'alkohole_mocne', labelPl: 'Woodford Reserve', aliases: ['woodford', 'bourbon'], storagePath: 'alkohole/bourbon_woodford_reserve.png', localAsset: require('@/assets/premium/spirits/bourbon_woodford_reserve.webp') },
  { slug: 'wodka_absolut', category: 'alkohole_mocne', labelPl: 'Absolut', aliases: ['absolut', 'wódka absolut', 'wodka absolut'], storagePath: 'alkohole/wodka_absolut.png', localAsset: require('@/assets/premium/spirits/wodka_absolut.webp') },
  { slug: 'likier_baileys_irish_cream', category: 'alkohole_mocne', labelPl: 'Baileys', aliases: ['baileys', 'bailey'], storagePath: 'alkohole/likier_baileys_irish_cream.png', localAsset: require('@/assets/premium/spirits/likier_baileys_irish_cream.webp') },
  { slug: 'gin_bombay_sapphire', category: 'alkohole_mocne', labelPl: 'Bombay Sapphire', aliases: ['bombay', 'sapphire'], storagePath: 'alkohole/gin_bombay_sapphire.png', localAsset: require('@/assets/premium/spirits/gin_bombay_sapphire.webp') },
  { slug: 'likier_jagermeister', category: 'alkohole_mocne', labelPl: 'Jägermeister', aliases: ['jagermeister', 'jäger', 'jager', 'jägermeister'], storagePath: 'alkohole/likier_jagermeister.png', localAsset: require('@/assets/premium/spirits/likier_jagermeister.webp') },
  { slug: 'likier_cointreau_triple_sec', category: 'alkohole_mocne', labelPl: 'Cointreau', aliases: ['cointreau', 'triple sec'], storagePath: 'alkohole/likier_cointreau_triple_sec.png', localAsset: require('@/assets/premium/spirits/likier_cointreau_triple_sec.webp') },
  { slug: 'likier_chartreuse_zielony', category: 'alkohole_mocne', labelPl: 'Chartreuse', aliases: ['chartreuse'], storagePath: 'alkohole/likier_chartreuse_zielony.png', localAsset: require('@/assets/premium/spirits/likier_chartreuse_zielony.webp') },
  { slug: 'rum_bacardi_carta_blanca', category: 'alkohole_mocne', labelPl: 'Bacardi', aliases: ['bacardi', 'carta blanca'], storagePath: 'alkohole/rum_bacardi_carta_blanca.png', localAsset: require('@/assets/premium/spirits/rum_bacardi_carta_blanca.webp') },
  { slug: 'whisky_chivas_regal_18', category: 'alkohole_mocne', labelPl: 'Chivas Regal 18', aliases: ['chivas', 'chivas regal'], storagePath: 'alkohole/whisky_chivas_regal_18.png', localAsset: require('@/assets/premium/spirits/whisky_chivas_regal_18.webp') },
  { slug: 'tequila_don_julio_blanco', category: 'alkohole_mocne', labelPl: 'Don Julio', aliases: ['don julio', 'julio'], storagePath: 'alkohole/tequila_don_julio_blanco.png', localAsset: require('@/assets/premium/spirits/tequila_don_julio_blanco.webp') },
  { slug: 'likier_kahlua_kawiarniany', category: 'alkohole_mocne', labelPl: 'Kahlúa', aliases: ['kahlua', 'kahlúa'], storagePath: 'alkohole/likier_kahlua_kawiarniany.png', localAsset: require('@/assets/premium/spirits/likier_kahlua_kawiarniany.webp') },
  { slug: 'gin_hendricks', category: 'alkohole_mocne', labelPl: "Hendrick's", aliases: ['hendricks', "hendrick's"], storagePath: 'alkohole/gin_hendricks.png', localAsset: require('@/assets/premium/spirits/gin_hendricks.webp') },
  { slug: 'wodka_smirnoff', category: 'alkohole_mocne', labelPl: 'Smirnoff', aliases: ['smirnoff'], storagePath: 'alkohole/wodka_smirnoff.png', localAsset: require('@/assets/premium/spirits/wodka_smirnoff.webp') },
  { slug: 'rum_captain_morgan_black', category: 'alkohole_mocne', labelPl: 'Captain Morgan', aliases: ['captain morgan', 'morgan'], storagePath: 'alkohole/rum_captain_morgan_black.png', localAsset: require('@/assets/premium/spirits/rum_captain_morgan_black.webp') },
  { slug: 'whiskey_jack_daniels', category: 'alkohole_mocne', labelPl: "Jack Daniel's", aliases: ['jack daniels', "jack daniel's", 'jack'], storagePath: 'alkohole/whiskey_jack_daniels.png', localAsset: require('@/assets/premium/spirits/whiskey_jack_daniels.webp') },
  { slug: 'likier_campari_bitter', category: 'alkohole_mocne', labelPl: 'Campari', aliases: ['campari'], storagePath: 'alkohole/likier_campari_bitter.png', localAsset: require('@/assets/premium/spirits/likier_campari_bitter.webp') },
];

export const PACKAGING_CATALOG: ProductImageEntry[] = [
  { slug: 'pudelko_na_pizze_kraft', category: 'opakowania', labelPl: 'Pudełko na pizzę', aliases: ['pizza box', 'pudełko pizza', 'pudelko pizza'], storagePath: 'opakowania/pudelko_na_pizze_kraft.png', localAsset: require('@/assets/premium/packaging/pudelko_na_pizze_kraft.webp') },
  { slug: 'pudelko_box_biale_oriental', category: 'opakowania', labelPl: 'Box orientalny biały', aliases: ['box orientalny', 'pudełko azjatyckie', 'chinese box'], storagePath: 'opakowania/pudelko_box_biale_oriental.png', localAsset: require('@/assets/premium/packaging/pudelko_box_biale_oriental.webp') },
  { slug: 'pudelko_z_raczka_kraft', category: 'opakowania', labelPl: 'Lunchbox z rączką', aliases: ['lunchbox', 'pudełko z rączką', 'catering box'], storagePath: 'opakowania/pudelko_z_raczka_kraft.png', localAsset: require('@/assets/premium/packaging/pudelko_z_raczka_kraft.webp') },
  { slug: 'pojemnik_okragly_plastik_lid', category: 'opakowania', labelPl: 'Pojemnik okrągły', aliases: ['pojemnik okrągły', 'miska z pokrywką', 'garmażeria'], storagePath: 'opakowania/pojemnik_okragly_plastik_lid.png', localAsset: require('@/assets/premium/packaging/pojemnik_okragly_plastik_lid.webp') },
  { slug: 'pudelko_box_kraft_oriental', category: 'opakowania', labelPl: 'Box kraft orientalny', aliases: ['box kraft', 'kubełek makaron'], storagePath: 'opakowania/pudelko_box_kraft_oriental.png', localAsset: require('@/assets/premium/packaging/pudelko_box_kraft_oriental.webp') },
  { slug: 'pudelko_na_burgera_kraft', category: 'opakowania', labelPl: 'Pudełko na burgera', aliases: ['burger box', 'pudełko burger'], storagePath: 'opakowania/pudelko_na_burgera_kraft.png', localAsset: require('@/assets/premium/packaging/pudelko_na_burgera_kraft.webp') },
  { slug: 'pojemnik_cukierniczy_plastik', category: 'opakowania', labelPl: 'Pojemnik cukierniczy', aliases: ['pojemnik cukierniczy', 'na ciasto'], storagePath: 'opakowania/pojemnik_cukierniczy_plastik.png', localAsset: require('@/assets/premium/packaging/pojemnik_cukierniczy_plastik.webp') },
  { slug: 'kubek_na_wynos_papierowy', category: 'opakowania', labelPl: 'Kubek na wynos', aliases: ['kubek na wynos', 'kubek papierowy', 'coffee cup'], storagePath: 'opakowania/kubek_na_wynos_papierowy.png', localAsset: require('@/assets/premium/packaging/kubek_na_wynos_papierowy.webp') },
  { slug: 'opakowanie_na_frytki_kraft', category: 'opakowania', labelPl: 'Opakowanie na frytki', aliases: ['frytki', 'pudełko frytki', 'fry box'], storagePath: 'opakowania/opakowanie_na_frytki_kraft.png', localAsset: require('@/assets/premium/packaging/opakowanie_na_frytki_kraft.webp') },
  { slug: 'wytlaczanka_na_kubki_wytlok', category: 'opakowania', labelPl: 'Wytłaczanka na kubki', aliases: ['wytłaczanka', 'nosidełko kubki', 'cup holder'], storagePath: 'opakowania/wytlaczanka_na_kubki_wytlok.png', localAsset: require('@/assets/premium/packaging/wytlaczanka_na_kubki_wytlok.webp') },
  { slug: 'torba_papierowa_z_uchwytem', category: 'opakowania', labelPl: 'Torba papierowa', aliases: ['torba papierowa', 'torba kraft'], storagePath: 'opakowania/torba_papierowa_z_uchwytem.png', localAsset: require('@/assets/premium/packaging/torba_papierowa_z_uchwytem.webp') },
  { slug: 'torebka_papierowa_faldowa', category: 'opakowania', labelPl: 'Torebka papierowa', aliases: ['torebka', 'torebka papierowa'], storagePath: 'opakowania/torebka_papierowa_faldowa.png', localAsset: require('@/assets/premium/packaging/torebka_papierowa_faldowa.webp') },
  { slug: 'serwetki_papierowe_szare', category: 'opakowania', labelPl: 'Serwetki szare', aliases: ['serwetki szare', 'serwetki eko'], storagePath: 'opakowania/serwetki_papierowe_szare.png', localAsset: require('@/assets/premium/packaging/serwetki_papierowe_szare.webp') },
  { slug: 'serwetki_papierowe_biale', category: 'opakowania', labelPl: 'Serwetki białe', aliases: ['serwetki', 'serwetki białe'], storagePath: 'opakowania/serwetki_papierowe_biale.png', localAsset: require('@/assets/premium/packaging/serwetki_papierowe_biale.webp') },
  { slug: 'sztucce_drewniane_zestaw', category: 'opakowania', labelPl: 'Sztućce drewniane', aliases: ['sztućce', 'sztućce drewniane', 'widelec drewniany'], storagePath: 'opakowania/sztucce_drewniane_zestaw.png', localAsset: require('@/assets/premium/packaging/sztucce_drewniane_zestaw.webp') },
  { slug: 'talerz_papierowy_brazowy', category: 'opakowania', labelPl: 'Talerz papierowy', aliases: ['talerz papierowy', 'talerz eko'], storagePath: 'opakowania/talerz_papierowy_brazowy.png', localAsset: require('@/assets/premium/packaging/talerz_papierowy_brazowy.webp') },
  { slug: 'talerz_trzysekcyjny_eko', category: 'opakowania', labelPl: 'Talerz trzysekcyjny', aliases: ['talerz trzysekcyjny', 'talerz z przegródkami'], storagePath: 'opakowania/talerz_trzysekcyjny_eko.png', localAsset: require('@/assets/premium/packaging/talerz_trzysekcyjny_eko.webp') },
  { slug: 'pudelko_styropianowe_obiadowe', category: 'opakowania', labelPl: 'Menu box', aliases: ['menu box', 'styropian', 'pudełko obiadowe'], storagePath: 'opakowania/pudelko_styropianowe_obiadowe.png', localAsset: require('@/assets/premium/packaging/pudelko_styropianowe_obiadowe.webp') },
  { slug: 'miska_zupa_papierowa', category: 'opakowania', labelPl: 'Miska na zupę', aliases: ['miska zupa', 'pojemnik na zupę'], storagePath: 'opakowania/miska_zupa_papierowa.png', localAsset: require('@/assets/premium/packaging/miska_zupa_papierowa.webp') },
  { slug: 'miska_salatkowa_papierowa', category: 'opakowania', labelPl: 'Miska sałatkowa', aliases: ['miska sałatka', 'bowl papierowy'], storagePath: 'opakowania/miska_salatkowa_papierowa.png', localAsset: require('@/assets/premium/packaging/miska_salatkowa_papierowa.webp') },
  { slug: 'folia_aluminiowa_rolka', category: 'opakowania', labelPl: 'Folia aluminiowa', aliases: ['folia aluminiowa', 'aluminium'], storagePath: 'opakowania/folia_aluminiowa_rolka.png', localAsset: require('@/assets/premium/packaging/folia_aluminiowa_rolka.webp') },
  { slug: 'folia_spozywcza_stretch_rolka', category: 'opakowania', labelPl: 'Folia spożywcza', aliases: ['folia spożywcza', 'stretch'], storagePath: 'opakowania/folia_spozywcza_stretch_rolka.png', localAsset: require('@/assets/premium/packaging/folia_spozywcza_stretch_rolka.webp') },
  { slug: 'worki_na_smieci_rolka', category: 'opakowania', labelPl: 'Worki na śmieci', aliases: ['worki', 'worki na śmieci'], storagePath: 'opakowania/worki_na_smieci_rolka.png', localAsset: require('@/assets/premium/packaging/worki_na_smieci_rolka.webp') },
  { slug: 'papier_do_pieczenia_pergamin', category: 'opakowania', labelPl: 'Papier do pieczenia', aliases: ['pergamin', 'papier do pieczenia'], storagePath: 'opakowania/papier_do_pieczenia_pergamin.png', localAsset: require('@/assets/premium/packaging/papier_do_pieczenia_pergamin.webp') },
  { slug: 'pudelko_na_jajka_wytlaczanka', category: 'opakowania', labelPl: 'Wytłaczanka na jajka', aliases: ['wytłaczanka jajka', 'pudełko jajka', 'egg carton'], storagePath: 'opakowania/pudelko_na_jajka_wytlaczanka.png', localAsset: require('@/assets/premium/packaging/pudelko_na_jajka_wytlaczanka.webp') },
];
export const PASTES_CATALOG: ProductImageEntry[] = [
  { slug: 'pasta_curry_czerwona_jar', category: 'pasty_bazy', labelPl: 'Pasta curry czerwona', aliases: ['curry czerwone', 'red curry', 'pasta curry'], storagePath: 'pasty/pasta_curry_czerwona_jar.png', localAsset: require('@/assets/premium/pastes/pasta_curry_czerwona_jar.webp') },
  { slug: 'pasta_curry_zielona_jar', category: 'pasty_bazy', labelPl: 'Pasta curry zielona', aliases: ['curry zielone', 'green curry'], storagePath: 'pasty/pasta_curry_zielona_jar.png', localAsset: require('@/assets/premium/pastes/pasta_curry_zielona_jar.webp') },
  { slug: 'sos_chili_bean_toban_djan', category: 'pasty_bazy', labelPl: 'Sos chili bean', aliases: ['toban djan', 'chili bean', 'sos chili'], storagePath: 'pasty/sos_chili_bean_toban_djan.png', localAsset: require('@/assets/premium/pastes/sos_chili_bean_toban_djan.webp') },
  { slug: 'baza_pieczony_czosnek_paste', category: 'pasty_bazy', labelPl: 'Baza pieczony czosnek', aliases: ['pieczony czosnek', 'garlic base'], storagePath: 'pasty/baza_pieczony_czosnek_paste.png', localAsset: require('@/assets/premium/pastes/baza_pieczony_czosnek_paste.webp') },
  { slug: 'baza_bulion_drobiowy_premium_paste', category: 'pasty_bazy', labelPl: 'Baza drobiowa', aliases: ['baza drobiowa', 'chicken base'], storagePath: 'pasty/baza_bulion_drobiowy_premium_paste.png', localAsset: require('@/assets/premium/pastes/baza_bulion_drobiowy_premium_paste.webp') },
  { slug: 'pasta_grzybowa_shiitake_jar', category: 'pasty_bazy', labelPl: 'Pasta shiitake', aliases: ['shiitake', 'pasta grzybowa'], storagePath: 'pasty/pasta_grzybowa_shiitake_jar.png', localAsset: require('@/assets/premium/pastes/pasta_grzybowa_shiitake_jar.webp') },
  { slug: 'baza_ramen_tonkotsu', category: 'pasty_bazy', labelPl: 'Baza tonkotsu', aliases: ['tonkotsu', 'ramen base'], storagePath: 'pasty/baza_ramen_tonkotsu.png', localAsset: require('@/assets/premium/pastes/baza_ramen_tonkotsu.webp') },
  { slug: 'baza_sos_demi_glace', category: 'pasty_bazy', labelPl: 'Demi-glace', aliases: ['demi glace', 'demi-glace'], storagePath: 'pasty/baza_sos_demi_glace.png', localAsset: require('@/assets/premium/pastes/baza_sos_demi_glace.webp') },
  { slug: 'bulion_warzywny_proszek_knorr', category: 'pasty_bazy', labelPl: 'Bulion warzywny', aliases: ['bulion warzywny', 'knorr warzywny'], storagePath: 'pasty/bulion_warzywny_proszek_knorr.png', localAsset: require('@/assets/premium/pastes/bulion_warzywny_proszek_knorr.webp') },
  { slug: 'bulion_drobiowy_proszek_knorr', category: 'pasty_bazy', labelPl: 'Bulion drobiowy', aliases: ['bulion drobiowy', 'rosół proszek', 'knorr drobiowy'], storagePath: 'pasty/bulion_drobiowy_proszek_knorr.png', localAsset: require('@/assets/premium/pastes/bulion_drobiowy_proszek_knorr.webp') },
  { slug: 'koncentrat_pomidorowy_mutti', category: 'pasty_bazy', labelPl: 'Koncentrat pomidorowy', aliases: ['koncentrat', 'mutti', 'tomato paste'], storagePath: 'pasty/koncentrat_pomidorowy_mutti.png', localAsset: require('@/assets/premium/pastes/koncentrat_pomidorowy_mutti.webp') },
  { slug: 'przecier_pomidorowy_organic', category: 'pasty_bazy', labelPl: 'Przecier pomidorowy', aliases: ['przecier', 'passata'], storagePath: 'pasty/przecier_pomidorowy_organic.png', localAsset: require('@/assets/premium/pastes/przecier_pomidorowy_organic.webp') },
  { slug: 'pasta_sezamowa_tahini', category: 'pasty_bazy', labelPl: 'Tahini', aliases: ['tahini', 'pasta sezamowa'], storagePath: 'pasty/pasta_sezamowa_tahini.png', localAsset: require('@/assets/premium/pastes/pasta_sezamowa_tahini.webp') },
  { slug: 'pasta_orzechowa_arachidowa_miska', category: 'pasty_bazy', labelPl: 'Pasta orzechowa', aliases: ['pasta orzechowa', 'satay', 'peanut butter'], storagePath: 'pasty/pasta_orzechowa_arachidowa_miska.png', localAsset: require('@/assets/premium/pastes/pasta_orzechowa_arachidowa_miska.webp') },
  { slug: 'pasta_miso_aka_ciemna', category: 'pasty_bazy', labelPl: 'Miso aka', aliases: ['miso', 'aka miso'], storagePath: 'pasty/pasta_miso_aka_ciemna.png', localAsset: require('@/assets/premium/pastes/pasta_miso_aka_ciemna.webp') },
  { slug: 'kostki_rosolowe_warzywne', category: 'pasty_bazy', labelPl: 'Kostki warzywne', aliases: ['kostki rosołowe', 'kostka warzywna'], storagePath: 'pasty/kostki_rosolowe_warzywne.png', localAsset: require('@/assets/premium/pastes/kostki_rosolowe_warzywne.webp') },
  { slug: 'kostki_rosolowe_wolowe', category: 'pasty_bazy', labelPl: 'Kostki wołowe', aliases: ['kostka wołowa', 'bulion wołowy kostki'], storagePath: 'pasty/kostki_rosolowe_wolowe.png', localAsset: require('@/assets/premium/pastes/kostki_rosolowe_wolowe.webp') },
  { slug: 'kostki_rosolowe_drobiowe', category: 'pasty_bazy', labelPl: 'Kostki drobiowe', aliases: ['kostka drobiowa', 'rosół kostki'], storagePath: 'pasty/kostki_rosolowe_drobiowe.png', localAsset: require('@/assets/premium/pastes/kostki_rosolowe_drobiowe.webp') },
  { slug: 'kostki_rosolowe_grzybowe', category: 'pasty_bazy', labelPl: 'Kostki grzybowe', aliases: ['kostka grzybowa'], storagePath: 'pasty/kostki_rosolowe_grzybowe.png', localAsset: require('@/assets/premium/pastes/kostki_rosolowe_grzybowe.webp') },
  { slug: 'kostki_rosolowe_miesne_barbecue', category: 'pasty_bazy', labelPl: 'Kostki barbecue', aliases: ['kostka barbecue', 'pork flavor'], storagePath: 'pasty/kostki_rosolowe_miesne_barbecue.png', localAsset: require('@/assets/premium/pastes/kostki_rosolowe_miesne_barbecue.webp') },
  { slug: 'pasta_musztardowa_colmans', category: 'pasty_bazy', labelPl: "Musztarda Colman's", aliases: ['colmans', 'musztarda angielska', 'mustard'], storagePath: 'pasty/pasta_musztardowa_colmans.png', localAsset: require('@/assets/premium/pastes/pasta_musztardowa_colmans.webp') },
  { slug: 'pasta_trawa_cytrynowa', category: 'pasty_bazy', labelPl: 'Pasta trawa cytrynowa', aliases: ['lemongrass', 'trawa cytrynowa'], storagePath: 'pasty/pasta_trawa_cytrynowa.png', localAsset: require('@/assets/premium/pastes/pasta_trawa_cytrynowa.webp') },
  { slug: 'pasta_tikka_masala', category: 'pasty_bazy', labelPl: 'Tikka masala', aliases: ['tikka', 'tikka masala'], storagePath: 'pasty/pasta_tikka_masala.png', localAsset: require('@/assets/premium/pastes/pasta_tikka_masala.webp') },
  { slug: 'pasta_wasabi_tubka', category: 'pasty_bazy', labelPl: 'Wasabi', aliases: ['wasabi'], storagePath: 'pasty/pasta_wasabi_tubka.png', localAsset: require('@/assets/premium/pastes/pasta_wasabi_tubka.webp') },
  { slug: 'sos_hoisin_gesty', category: 'pasty_bazy', labelPl: 'Sos hoisin', aliases: ['hoisin'], storagePath: 'pasty/sos_hoisin_gesty.png', localAsset: require('@/assets/premium/pastes/sos_hoisin_gesty.webp') },
];
export const ROOTS_CATALOG: ProductImageEntry[] = [
  { slug: 'burak_czerwony_swiezy', category: 'korzeniowe', labelPl: 'Burak', aliases: ['burak', 'buraki', 'beetroot'], storagePath: 'korzeniowe/burak_czerwony_swiezy.png', localAsset: require('@/assets/premium/roots/burak_czerwony_swiezy.webp') },
  { slug: 'seler_korzen_swiezy', category: 'korzeniowe', labelPl: 'Seler korzeniowy', aliases: ['seler korzeniowy', 'celeriac'], storagePath: 'korzeniowe/seler_korzen_swiezy.png', localAsset: require('@/assets/premium/roots/seler_korzen_swiezy.webp') },
  { slug: 'pietruszka_korzen_natka', category: 'korzeniowe', labelPl: 'Pietruszka korzeń', aliases: ['pietruszka korzeń', 'korzeń pietruszki'], storagePath: 'korzeniowe/pietruszka_korzen_natka.png', localAsset: require('@/assets/premium/roots/pietruszka_korzen_natka.webp') },
  { slug: 'pasternak_korzen', category: 'korzeniowe', labelPl: 'Pasternak', aliases: ['pasternak', 'parsnip'], storagePath: 'korzeniowe/pasternak_korzen.png', localAsset: require('@/assets/premium/roots/pasternak_korzen.webp') },
  { slug: 'imbir_korzen_swiezy', category: 'korzeniowe', labelPl: 'Imbir', aliases: ['imbir', 'ginger'], storagePath: 'korzeniowe/imbir_korzen_swiezy.png', localAsset: require('@/assets/premium/roots/imbir_korzen_swiezy.webp') },
  { slug: 'chrzan_korzen_tarty', category: 'korzeniowe', labelPl: 'Chrzan', aliases: ['chrzan', 'horseradish'], storagePath: 'korzeniowe/chrzan_korzen_tarty.png', localAsset: require('@/assets/premium/roots/chrzan_korzen_tarty.webp') },
  { slug: 'ciecierzyca_sucha_ziarna', category: 'korzeniowe', labelPl: 'Ciecierzyca', aliases: ['ciecierzyca', 'chickpea'], storagePath: 'korzeniowe/ciecierzyca_sucha_ziarna.png', localAsset: require('@/assets/premium/roots/ciecierzyca_sucha_ziarna.webp') },
  { slug: 'soczewica_zielona_sucha', category: 'korzeniowe', labelPl: 'Soczewica', aliases: ['soczewica', 'lentils'], storagePath: 'korzeniowe/soczewica_zielona_sucha.png', localAsset: require('@/assets/premium/roots/soczewica_zielona_sucha.webp') },
  { slug: 'grzyby_mun_suszone', category: 'korzeniowe', labelPl: 'Grzyby mun', aliases: ['mun', 'ucho bzowe', 'wood ear'], storagePath: 'korzeniowe/grzyby_mun_suszone.png', localAsset: require('@/assets/premium/roots/grzyby_mun_suszone.webp') },
  { slug: 'taro_bulwa_przekroj', category: 'korzeniowe', labelPl: 'Taro', aliases: ['taro', 'kolokazja'], storagePath: 'korzeniowe/taro_bulwa_przekroj.png', localAsset: require('@/assets/premium/roots/taro_bulwa_przekroj.webp') },
  { slug: 'batat_slodki_ziemniak_plastry', category: 'korzeniowe', labelPl: 'Batat plastry', aliases: ['batat plastry'], storagePath: 'korzeniowe/batat_slodki_ziemniak_plastry.png', localAsset: require('@/assets/premium/roots/batat_slodki_ziemniak_plastry.webp') },
  { slug: 'ziemniaki_biale_przekroj', category: 'korzeniowe', labelPl: 'Ziemniaki', aliases: ['ziemniak biały', 'white potato'], storagePath: 'korzeniowe/ziemniaki_biale_przekroj.png', localAsset: require('@/assets/premium/roots/ziemniaki_biale_przekroj.webp') },
  { slug: 'fioletowy_ziemniak_trifle', category: 'korzeniowe', labelPl: 'Ziemniak fioletowy', aliases: ['ziemniak fioletowy', 'purple potato'], storagePath: 'korzeniowe/fioletowy_ziemniak_trifle.png', localAsset: require('@/assets/premium/roots/fioletowy_ziemniak_trifle.webp') },
  { slug: 'maniok_korzen_yuca', category: 'korzeniowe', labelPl: 'Maniok', aliases: ['maniok', 'yuca', 'cassava'], storagePath: 'korzeniowe/maniok_korzen_yuca.png', localAsset: require('@/assets/premium/roots/maniok_korzen_yuca.webp') },
  { slug: 'korzen_lotosu_plastry', category: 'korzeniowe', labelPl: 'Korzeń lotosu', aliases: ['lotos', 'lotus root'], storagePath: 'korzeniowe/korzen_lotosu_plastry.png', localAsset: require('@/assets/premium/roots/korzen_lotosu_plastry.webp') },
  { slug: 'rzepa_fioletowa_biala_przekroj', category: 'korzeniowe', labelPl: 'Rzepa', aliases: ['rzepa', 'turnip'], storagePath: 'korzeniowe/rzepa_fioletowa_biala_przekroj.png', localAsset: require('@/assets/premium/roots/rzepa_fioletowa_biala_przekroj.webp') },
  { slug: 'brukiew_swieza_przekroj', category: 'korzeniowe', labelPl: 'Brukiew', aliases: ['brukiew', 'rutabaga'], storagePath: 'korzeniowe/brukiew_swieza_przekroj.png', localAsset: require('@/assets/premium/roots/brukiew_swieza_przekroj.webp') },
  { slug: 'rzodkiew_biala_daikon', category: 'korzeniowe', labelPl: 'Daikon', aliases: ['daikon', 'rzodkiew biała'], storagePath: 'korzeniowe/rzodkiew_biala_daikon.png', localAsset: require('@/assets/premium/roots/rzodkiew_biala_daikon.webp') },
  { slug: 'gopbobo_korzen_lopianu', category: 'korzeniowe', labelPl: 'Gobo / łopian', aliases: ['gobo', 'łopian', 'lopian', 'burdock'], storagePath: 'korzeniowe/gopbobo_korzen_lopianu.png', localAsset: require('@/assets/premium/roots/gopbobo_korzen_lopianu.webp') },
  { slug: 'jicama_rzepa_meksykanska', category: 'korzeniowe', labelPl: 'Jicama', aliases: ['jicama'], storagePath: 'korzeniowe/jicama_rzepa_meksykanska.png', localAsset: require('@/assets/premium/roots/jicama_rzepa_meksykanska.webp') },
  { slug: 'topinambur_slonecznik_bulwiasty', category: 'korzeniowe', labelPl: 'Topinambur', aliases: ['topinambur', 'jerusalem artichoke'], storagePath: 'korzeniowe/topinambur_slonecznik_bulwiasty.png', localAsset: require('@/assets/premium/roots/topinambur_slonecznik_bulwiasty.webp') },
  { slug: 'galangal_korzen_klacze', category: 'korzeniowe', labelPl: 'Galangal', aliases: ['galangal', 'galanga'], storagePath: 'korzeniowe/galangal_korzen_klacze.png', localAsset: require('@/assets/premium/roots/galangal_korzen_klacze.webp') },
  { slug: 'kurkuma_swiezy_korzen_plastry', category: 'korzeniowe', labelPl: 'Kurkuma', aliases: ['kurkuma', 'turmeric'], storagePath: 'korzeniowe/kurkuma_swiezy_korzen_plastry.png', localAsset: require('@/assets/premium/roots/kurkuma_swiezy_korzen_plastry.webp') },
  { slug: 'szalotka_cebula_przekroj', category: 'korzeniowe', labelPl: 'Szalotka', aliases: ['szalotka', 'shallot'], storagePath: 'korzeniowe/szalotka_cebula_przekroj.png', localAsset: require('@/assets/premium/roots/szalotka_cebula_przekroj.webp') },
  { slug: 'czosnek_glowka_zabki', category: 'korzeniowe', labelPl: 'Czosnek ząbki', aliases: ['ząbki czosnku', 'czosnek ząbki'], storagePath: 'korzeniowe/czosnek_glowka_zabki.png', localAsset: require('@/assets/premium/roots/czosnek_glowka_zabki.webp') },
];
export const POLISH_CATALOG: ProductImageEntry[] = [
  { slug: 'kapusta_kiszona_miska', category: 'kuchnia_polska', labelPl: 'Kapusta kiszona', aliases: ['kapusta kiszona', 'kiszonka', 'sauerkraut'], storagePath: 'polska/kapusta_kiszona_miska.png', localAsset: require('@/assets/premium/polish/kapusta_kiszona_miska.webp') },
  { slug: 'ogorki_kiszone_miska', category: 'kuchnia_polska', labelPl: 'Ogórki kiszone', aliases: ['ogórki kiszone', 'ogorki kiszone', 'kwaszaki'], storagePath: 'polska/ogorki_kiszone_miska.png', localAsset: require('@/assets/premium/polish/ogorki_kiszone_miska.webp') },
  { slug: 'kapusta_biala_glowka', category: 'kuchnia_polska', labelPl: 'Kapusta biała', aliases: ['kapusta biała', 'kapusta biala'], storagePath: 'polska/kapusta_biala_glowka.png', localAsset: require('@/assets/premium/polish/kapusta_biala_glowka.webp') },
  { slug: 'kapusta_czerwona_glowka', category: 'kuchnia_polska', labelPl: 'Kapusta czerwona', aliases: ['kapusta czerwona', 'kapusta modra'], storagePath: 'polska/kapusta_czerwona_glowka.png', localAsset: require('@/assets/premium/polish/kapusta_czerwona_glowka.webp') },
  { slug: 'koperek_swiezy_peczek', category: 'kuchnia_polska', labelPl: 'Koperek', aliases: ['koperek', 'koper', 'dill'], storagePath: 'polska/koperek_swiezy_peczek.png', localAsset: require('@/assets/premium/polish/koperek_swiezy_peczek.webp') },
  { slug: 'natka_pietruszki_peczek', category: 'kuchnia_polska', labelPl: 'Natka pietruszki', aliases: ['natka', 'natka pietruszki', 'pietruszka natka'], storagePath: 'polska/natka_pietruszki_peczek.png', localAsset: require('@/assets/premium/polish/natka_pietruszki_peczek.webp') },
  { slug: 'burak_czerwony_z_botwina', category: 'kuchnia_polska', labelPl: 'Burak z botwiną', aliases: ['botwina', 'burak z botwiną', 'botwinka'], storagePath: 'polska/burak_czerwony_z_botwina.png', localAsset: require('@/assets/premium/polish/burak_czerwony_z_botwina.webp') },
  { slug: 'seler_korzen_rosol', category: 'kuchnia_polska', labelPl: 'Seler korzeniowy', aliases: ['seler', 'seler korzeniowy'], storagePath: 'polska/seler_korzen_rosol.png', localAsset: require('@/assets/premium/polish/seler_korzen_rosol.webp') },
  { slug: 'pietruszka_korzen_pasternak', category: 'kuchnia_polska', labelPl: 'Pietruszka korzeń', aliases: ['pietruszka korzeń', 'korzeń pietruszki'], storagePath: 'polska/pietruszka_korzen_pasternak.png', localAsset: require('@/assets/premium/polish/pietruszka_korzen_pasternak.webp') },
  { slug: 'chrzan_tart_sloik', category: 'kuchnia_polska', labelPl: 'Chrzan tarty', aliases: ['chrzan', 'chrzan tarty'], storagePath: 'polska/chrzan_tart_sloik.png', localAsset: require('@/assets/premium/polish/chrzan_tart_sloik.webp') },
  { slug: 'musztarda_sloik_gastro', category: 'kuchnia_polska', labelPl: 'Musztarda', aliases: ['musztarda', 'mustard'], storagePath: 'polska/musztarda_sloik_gastro.png', localAsset: require('@/assets/premium/polish/musztarda_sloik_gastro.webp') },
  { slug: 'ziemniaki_rosol_przekroj', category: 'kuchnia_polska', labelPl: 'Ziemniaki', aliases: ['ziemniaki', 'ziemniak'], storagePath: 'polska/ziemniaki_rosol_przekroj.png', localAsset: require('@/assets/premium/polish/ziemniaki_rosol_przekroj.webp') },
  { slug: 'batat_slodki_plastry_polska', category: 'kuchnia_polska', labelPl: 'Batat', aliases: ['batat', 'słodki ziemniak'], storagePath: 'polska/batat_slodki_plastry_polska.png', localAsset: require('@/assets/premium/polish/batat_slodki_plastry_polska.webp') },
  { slug: 'rzepa_fioletowa_przekroj_rosol', category: 'kuchnia_polska', labelPl: 'Rzepa', aliases: ['rzepa'], storagePath: 'polska/rzepa_fioletowa_przekroj_rosol.png', localAsset: require('@/assets/premium/polish/rzepa_fioletowa_przekroj_rosol.webp') },
  { slug: 'marchew_swieza_rosol', category: 'kuchnia_polska', labelPl: 'Marchew', aliases: ['marchew', 'marchewka', 'włoszczyzna'], storagePath: 'polska/marchew_swieza_rosol.png', localAsset: require('@/assets/premium/polish/marchew_swieza_rosol.webp') },
  { slug: 'cebula_zwykla_przekroj', category: 'kuchnia_polska', labelPl: 'Cebula', aliases: ['cebula', 'cebula żółta'], storagePath: 'polska/cebula_zwykla_przekroj.png', localAsset: require('@/assets/premium/polish/cebula_zwykla_przekroj.webp') },
  { slug: 'czosnek_glowki_zabki_polska', category: 'kuchnia_polska', labelPl: 'Czosnek', aliases: ['czosnek'], storagePath: 'polska/czosnek_glowki_zabki_polska.png', localAsset: require('@/assets/premium/polish/czosnek_glowki_zabki_polska.webp') },
  { slug: 'ogorki_zielone_gruntowe', category: 'kuchnia_polska', labelPl: 'Ogórki gruntowe', aliases: ['ogórek gruntowy', 'ogorki gruntowe', 'ogórek świeży'], storagePath: 'polska/ogorki_zielone_gruntowe.png', localAsset: require('@/assets/premium/polish/ogorki_zielone_gruntowe.webp') },
  { slug: 'maka_pszenna_miska_drewno', category: 'kuchnia_polska', labelPl: 'Mąka pszenna', aliases: ['mąka', 'maka', 'mąka pszenna'], storagePath: 'polska/maka_pszenna_miska_drewno.png', localAsset: require('@/assets/premium/polish/maka_pszenna_miska_drewno.webp') },
  { slug: 'kasza_jeczmienna_worek', category: 'kuchnia_polska', labelPl: 'Kasza jęczmienna', aliases: ['kasza jęczmienna', 'pęczak'], storagePath: 'polska/kasza_jeczmienna_worek.png', localAsset: require('@/assets/premium/polish/kasza_jeczmienna_worek.webp') },
  { slug: 'chleb_razowy_ciemny_kromka', category: 'kuchnia_polska', labelPl: 'Chleb razowy', aliases: ['chleb razowy', 'chleb ciemny'], storagePath: 'polska/chleb_razowy_ciemny_kromka.png', localAsset: require('@/assets/premium/polish/chleb_razowy_ciemny_kromka.webp') },
  { slug: 'twarog_bialy_ser_kostka', category: 'kuchnia_polska', labelPl: 'Twaróg', aliases: ['twaróg', 'twarog', 'ser biały'], storagePath: 'polska/twarog_bialy_ser_kostka.png', localAsset: require('@/assets/premium/polish/twarog_bialy_ser_kostka.webp') },
  { slug: 'twarog_sypki_miska', category: 'kuchnia_polska', labelPl: 'Twaróg sypki', aliases: ['twaróg sypki', 'twarog sypki'], storagePath: 'polska/twarog_sypki_miska.png', localAsset: require('@/assets/premium/polish/twarog_sypki_miska.webp') },
  { slug: 'mleko_plynne_dzbanek_szklanka', category: 'kuchnia_polska', labelPl: 'Mleko', aliases: ['mleko'], storagePath: 'polska/mleko_plynne_dzbanek_szklanka.png', localAsset: require('@/assets/premium/polish/mleko_plynne_dzbanek_szklanka.webp') },
  { slug: 'jajka_kurze_wytlaczanka_eko', category: 'kuchnia_polska', labelPl: 'Jajka w wytłaczance', aliases: ['jajka', 'jajko', 'wytłaczanka jaj'], storagePath: 'polska/jajka_kurze_wytlaczanka_eko.png', localAsset: require('@/assets/premium/polish/jajka_kurze_wytlaczanka_eko.webp') },
];
export const FROZEN_CATALOG: ProductImageEntry[] = [
  { slug: 'frytki_mrozone_proste', category: 'mrozonki', labelPl: 'Frytki mrożone', aliases: ['frytki', 'frytki mrożone'], storagePath: 'mrozonki/frytki_mrozone_proste.png', localAsset: require('@/assets/premium/frozen/frytki_mrozone_proste.webp') },
  { slug: 'frytki_mrozone_karbowane', category: 'mrozonki', labelPl: 'Frytki karbowane', aliases: ['frytki karbowane', 'crinkle'], storagePath: 'mrozonki/frytki_mrozone_karbowane.png', localAsset: require('@/assets/premium/frozen/frytki_mrozone_karbowane.webp') },
  { slug: 'pierogi_mrozone_tradycyjne', category: 'mrozonki', labelPl: 'Pierogi mrożone', aliases: ['pierogi', 'pierogi mrożone'], storagePath: 'mrozonki/pierogi_mrozone_tradycyjne.png', localAsset: require('@/assets/premium/frozen/pierogi_mrozone_tradycyjne.webp') },
  { slug: 'warzywa_na_patelnie_mieszanka', category: 'mrozonki', labelPl: 'Warzywa na patelnię', aliases: ['warzywa na patelnię', 'mieszanka warzyw'], storagePath: 'mrozonki/warzywa_na_patelnie_mieszanka.png', localAsset: require('@/assets/premium/frozen/warzywa_na_patelnie_mieszanka.webp') },
  { slug: 'groszek_zielony_mrozony', category: 'mrozonki', labelPl: 'Groszek mrożony', aliases: ['groszek', 'groszek mrożony'], storagePath: 'mrozonki/groszek_zielony_mrozony.png', localAsset: require('@/assets/premium/frozen/groszek_zielony_mrozony.webp') },
  { slug: 'kukurydza_mrozona_ziarna', category: 'mrozonki', labelPl: 'Kukurydza mrożona', aliases: ['kukurydza mrożona', 'kukurydza ziarna'], storagePath: 'mrozonki/kukurydza_mrozona_ziarna.png', localAsset: require('@/assets/premium/frozen/kukurydza_mrozona_ziarna.webp') },
  { slug: 'truskawki_mrozone', category: 'mrozonki', labelPl: 'Truskawki mrożone', aliases: ['truskawki mrożone'], storagePath: 'mrozonki/truskawki_mrozone.png', localAsset: require('@/assets/premium/frozen/truskawki_mrozone.webp') },
  { slug: 'borowki_jagody_mrozone', category: 'mrozonki', labelPl: 'Borówki mrożone', aliases: ['borówki mrożone', 'jagody mrożone'], storagePath: 'mrozonki/borowki_jagody_mrozone.png', localAsset: require('@/assets/premium/frozen/borowki_jagody_mrozone.webp') },
  { slug: 'ziemniaczki_czastki_wedges', category: 'mrozonki', labelPl: 'Cząstki ziemniaków', aliases: ['wedges', 'cząstki ziemniaków'], storagePath: 'mrozonki/ziemniaczki_czastki_wedges.png', localAsset: require('@/assets/premium/frozen/ziemniaczki_czastki_wedges.webp') },
  { slug: 'paluszki_rybne_panierowane', category: 'mrozonki', labelPl: 'Paluszki rybne', aliases: ['paluszki rybne', 'fish fingers'], storagePath: 'mrozonki/paluszki_rybne_panierowane.png', localAsset: require('@/assets/premium/frozen/paluszki_rybne_panierowane.webp') },
  { slug: 'nuggetsy_z_kurczaka_mrozone', category: 'mrozonki', labelPl: 'Nuggetsy', aliases: ['nuggetsy', 'nuggets'], storagePath: 'mrozonki/nuggetsy_z_kurczaka_mrozone.png', localAsset: require('@/assets/premium/frozen/nuggetsy_z_kurczaka_mrozone.webp') },
  { slug: 'szpinak_mrozony_kostki', category: 'mrozonki', labelPl: 'Szpinak mrożony', aliases: ['szpinak mrożony', 'szpinak kostki'], storagePath: 'mrozonki/szpinak_mrozony_kostki.png', localAsset: require('@/assets/premium/frozen/szpinak_mrozony_kostki.webp') },
  { slug: 'paluszki_krabowe_surimi', category: 'mrozonki', labelPl: 'Surimi', aliases: ['surimi', 'paluszki krabowe'], storagePath: 'mrozonki/paluszki_krabowe_surimi.png', localAsset: require('@/assets/premium/frozen/paluszki_krabowe_surimi.webp') },
  { slug: 'kalafior_mrozony_rozyczki', category: 'mrozonki', labelPl: 'Kalafior mrożony', aliases: ['kalafior mrożony'], storagePath: 'mrozonki/kalafior_mrozony_rozyczki.png', localAsset: require('@/assets/premium/frozen/kalafior_mrozony_rozyczki.webp') },
  { slug: 'fasolka_szparagowa_mrozona_cieta', category: 'mrozonki', labelPl: 'Fasolka szparagowa', aliases: ['fasolka szparagowa', 'fasolka mrożona'], storagePath: 'mrozonki/fasolka_szparagowa_mrozona_cieta.png', localAsset: require('@/assets/premium/frozen/fasolka_szparagowa_mrozona_cieta.webp') },
  { slug: 'mieszanka_chinska_z_ryzem', category: 'mrozonki', labelPl: 'Mieszanka chińska', aliases: ['mieszanka chińska', 'chinese mix'], storagePath: 'mrozonki/mieszanka_chinska_z_ryzem.png', localAsset: require('@/assets/premium/frozen/mieszanka_chinska_z_ryzem.webp') },
  { slug: 'krewetki_mrozone_rozowe', category: 'mrozonki', labelPl: 'Krewetki mrożone', aliases: ['krewetki mrożone'], storagePath: 'mrozonki/krewetki_mrozone_rozowe.png', localAsset: require('@/assets/premium/frozen/krewetki_mrozone_rozowe.webp') },
  { slug: 'brokuly_mrozone_rozyczki', category: 'mrozonki', labelPl: 'Brokuły mrożone', aliases: ['brokuły mrożone', 'brokuly mrozone'], storagePath: 'mrozonki/brokuly_mrozone_rozyczki.png', localAsset: require('@/assets/premium/frozen/brokuly_mrozone_rozyczki.webp') },
  { slug: 'tortellini_uszka_mrozone', category: 'mrozonki', labelPl: 'Tortellini / uszka', aliases: ['tortellini', 'uszka mrożone'], storagePath: 'mrozonki/tortellini_uszka_mrozone.png', localAsset: require('@/assets/premium/frozen/tortellini_uszka_mrozone.webp') },
  { slug: 'warzywa_w_kostke_marchew_groszek', category: 'mrozonki', labelPl: 'Warzywa w kostkę', aliases: ['warzywa w kostkę', 'marchew groszek'], storagePath: 'mrozonki/warzywa_w_kostke_marchew_groszek.png', localAsset: require('@/assets/premium/frozen/warzywa_w_kostke_marchew_groszek.webp') },
  { slug: 'krazki_cebulowe_onion_rings', category: 'mrozonki', labelPl: 'Krążki cebulowe', aliases: ['onion rings', 'krążki cebulowe'], storagePath: 'mrozonki/krazki_cebulowe_onion_rings.png', localAsset: require('@/assets/premium/frozen/krazki_cebulowe_onion_rings.webp') },
  { slug: 'pieczarki_mrozone_plastry', category: 'mrozonki', labelPl: 'Pieczarki mrożone', aliases: ['pieczarki mrożone'], storagePath: 'mrozonki/pieczarki_mrozone_plastry.png', localAsset: require('@/assets/premium/frozen/pieczarki_mrozone_plastry.webp') },
  { slug: 'sajgonki_spring_rolls_mrozone', category: 'mrozonki', labelPl: 'Sajgonki', aliases: ['sajgonki', 'spring rolls'], storagePath: 'mrozonki/sajgonki_spring_rolls_mrozone.png', localAsset: require('@/assets/premium/frozen/sajgonki_spring_rolls_mrozone.webp') },
  { slug: 'maliny_mrozone', category: 'mrozonki', labelPl: 'Maliny mrożone', aliases: ['maliny mrożone'], storagePath: 'mrozonki/maliny_mrozone.png', localAsset: require('@/assets/premium/frozen/maliny_mrozone.webp') },
  { slug: 'owoce_morza_mieszanka_mrozona', category: 'mrozonki', labelPl: 'Owoce morza mrożone', aliases: ['owoce morza mrożone', 'seafood mix'], storagePath: 'mrozonki/owoce_morza_mieszanka_mrozona.png', localAsset: require('@/assets/premium/frozen/owoce_morza_mieszanka_mrozona.webp') },
];
export const GRAINS_CATALOG: ProductImageEntry[] = [
  { slug: 'makaron_penne', category: 'makarony_kasze', labelPl: 'Penne', aliases: ['penne', 'pióra', 'rurki'], storagePath: 'makarony/makaron_penne.png', localAsset: require('@/assets/premium/grains/makaron_penne.webp') },
  { slug: 'makaron_fusilli', category: 'makarony_kasze', labelPl: 'Fusilli', aliases: ['fusilli', 'świderki', 'swiderki'], storagePath: 'makarony/makaron_fusilli.png', localAsset: require('@/assets/premium/grains/makaron_fusilli.webp') },
  { slug: 'makaron_farfalle', category: 'makarony_kasze', labelPl: 'Farfalle', aliases: ['farfalle', 'kokardki'], storagePath: 'makarony/makaron_farfalle.png', localAsset: require('@/assets/premium/grains/makaron_farfalle.webp') },
  { slug: 'makaron_lasagne', category: 'makarony_kasze', labelPl: 'Lasagne', aliases: ['lasagne', 'lasagna'], storagePath: 'makarony/makaron_lasagne.png', localAsset: require('@/assets/premium/grains/makaron_lasagne.webp') },
  { slug: 'makaron_ramen_instant', category: 'makarony_kasze', labelPl: 'Ramen instant', aliases: ['ramen', 'instant noodles', 'zupka chińska'], storagePath: 'makarony/makaron_ramen_instant.png', localAsset: require('@/assets/premium/grains/makaron_ramen_instant.webp') },
  { slug: 'makaron_ryzowy_vermicelli', category: 'makarony_kasze', labelPl: 'Makaron ryżowy', aliases: ['makaron ryżowy', 'vermicelli', 'rice noodles'], storagePath: 'makarony/makaron_ryzowy_vermicelli.png', localAsset: require('@/assets/premium/grains/makaron_ryzowy_vermicelli.webp') },
  { slug: 'makaron_tagliatelle', category: 'makarony_kasze', labelPl: 'Tagliatelle', aliases: ['tagliatelle', 'fettuccine', 'wstążki'], storagePath: 'makarony/makaron_tagliatelle.png', localAsset: require('@/assets/premium/grains/makaron_tagliatelle.webp') },
  { slug: 'makaron_conchiglie', category: 'makarony_kasze', labelPl: 'Muszelki', aliases: ['conchiglie', 'muszelki'], storagePath: 'makarony/makaron_conchiglie.png', localAsset: require('@/assets/premium/grains/makaron_conchiglie.webp') },
  { slug: 'makaron_rigatoni', category: 'makarony_kasze', labelPl: 'Rigatoni', aliases: ['rigatoni', 'tortiglioni'], storagePath: 'makarony/makaron_rigatoni.png', localAsset: require('@/assets/premium/grains/makaron_rigatoni.webp') },
  { slug: 'makaron_macaroni', category: 'makarony_kasze', labelPl: 'Kolanka', aliases: ['macaroni', 'kolanka', 'elbow'], storagePath: 'makarony/makaron_macaroni.png', localAsset: require('@/assets/premium/grains/makaron_macaroni.webp') },
  { slug: 'kasza_jeczmienna_perlowa', category: 'makarony_kasze', labelPl: 'Kasza jęczmienna', aliases: ['kasza jęczmienna', 'perłowa'], storagePath: 'makarony/kasza_jeczmienna_perlowa.png', localAsset: require('@/assets/premium/grains/kasza_jeczmienna_perlowa.webp') },
  { slug: 'kuskus', category: 'makarony_kasze', labelPl: 'Kuskus', aliases: ['kuskus', 'couscous'], storagePath: 'makarony/kuskus.png', localAsset: require('@/assets/premium/grains/kuskus.webp') },
  { slug: 'kasza_jaglana', category: 'makarony_kasze', labelPl: 'Kasza jaglana', aliases: ['jaglana', 'millet'], storagePath: 'makarony/kasza_jaglana.png', localAsset: require('@/assets/premium/grains/kasza_jaglana.webp') },
  { slug: 'makaron_stelline', category: 'makarony_kasze', labelPl: 'Gwiazdki', aliases: ['stelline', 'gwiazdki makaron'], storagePath: 'makarony/makaron_stelline.png', localAsset: require('@/assets/premium/grains/makaron_stelline.webp') },
  { slug: 'makaron_orzo_risoni', category: 'makarony_kasze', labelPl: 'Orzo', aliases: ['orzo', 'risoni'], storagePath: 'makarony/makaron_orzo_risoni.png', localAsset: require('@/assets/premium/grains/makaron_orzo_risoni.webp') },
  { slug: 'kasza_gryczana_palona', category: 'makarony_kasze', labelPl: 'Kasza gryczana', aliases: ['gryczana', 'buckwheat'], storagePath: 'makarony/kasza_gryczana_palona.png', localAsset: require('@/assets/premium/grains/kasza_gryczana_palona.webp') },
  { slug: 'fasola_biala_groch', category: 'makarony_kasze', labelPl: 'Fasola / groch', aliases: ['fasola biała', 'groch'], storagePath: 'makarony/fasola_biala_groch.png', localAsset: require('@/assets/premium/grains/fasola_biala_groch.webp') },
  { slug: 'kasza_bulgur', category: 'makarony_kasze', labelPl: 'Bulgur', aliases: ['bulgur'], storagePath: 'makarony/kasza_bulgur.png', localAsset: require('@/assets/premium/grains/kasza_bulgur.webp') },
  { slug: 'quinoa_trojkolorowa', category: 'makarony_kasze', labelPl: 'Quinoa', aliases: ['quinoa', 'komosa'], storagePath: 'makarony/quinoa_trojkolorowa.png', localAsset: require('@/assets/premium/grains/quinoa_trojkolorowa.webp') },
  { slug: 'ryz_bialy_ziarna', category: 'makarony_kasze', labelPl: 'Ryż biały', aliases: ['ryż', 'ryz', 'ryż biały'], storagePath: 'makarony/ryz_bialy_ziarna.png', localAsset: require('@/assets/premium/grains/ryz_bialy_ziarna.webp') },
  { slug: 'peczak_ziarna_pszenicy', category: 'makarony_kasze', labelPl: 'Pęczak', aliases: ['pęczak', 'peczak'], storagePath: 'makarony/peczak_ziarna_pszenicy.png', localAsset: require('@/assets/premium/grains/peczak_ziarna_pszenicy.webp') },
  { slug: 'ciecierzyca_zolty_groch', category: 'makarony_kasze', labelPl: 'Ciecierzyca', aliases: ['ciecierzyca', 'żółty groch'], storagePath: 'makarony/ciecierzyca_zolty_groch.png', localAsset: require('@/assets/premium/grains/ciecierzyca_zolty_groch.webp') },
  { slug: 'orkisz_zyto_ziarna', category: 'makarony_kasze', labelPl: 'Orkisz / żyto', aliases: ['orkisz', 'żyto'], storagePath: 'makarony/orkisz_zyto_ziarna.png', localAsset: require('@/assets/premium/grains/orkisz_zyto_ziarna.webp') },
  { slug: 'amarantus_kuskus', category: 'makarony_kasze', labelPl: 'Amarantus', aliases: ['amarantus', 'amaranth'], storagePath: 'makarony/amarantus_kuskus.png', localAsset: require('@/assets/premium/grains/amarantus_kuskus.webp') },
  { slug: 'kasza_kukurydziana_polenta', category: 'makarony_kasze', labelPl: 'Polenta', aliases: ['polenta', 'kasza kukurydziana'], storagePath: 'makarony/kasza_kukurydziana_polenta.png', localAsset: require('@/assets/premium/grains/kasza_kukurydziana_polenta.webp') },
];
export const PLACEHOLDER_CATALOG: ProductImageEntry[] = [
  { slug: 'ph_butelki_dozujace_sosy', category: 'placeholdery', labelPl: 'Placeholder sosy', aliases: ['sos', 'ketchup', 'majonez', 'dressing', 'sos cytrynowy', 'sos malinowy', 'sos autorski'], storagePath: 'placeholdery/ph_butelki_dozujace_sosy.png', localAsset: require('@/assets/premium/placeholders/ph_butelki_dozujace_sosy.webp') },
  { slug: 'ph_kartony_brazowe', category: 'placeholdery', labelPl: 'Placeholder kartony', aliases: ['karton', 'opakowanie zbiorcze'], storagePath: 'placeholdery/ph_kartony_brazowe.png', localAsset: require('@/assets/premium/placeholders/ph_kartony_brazowe.webp') },
  { slug: 'ph_garnki_metalowe', category: 'placeholdery', labelPl: 'Placeholder zupy', aliases: ['zupa', 'krem', 'bulion', 'gulasz', 'danie jednogarnkowe'], storagePath: 'placeholdery/ph_garnki_metalowe.png', localAsset: require('@/assets/premium/placeholders/ph_garnki_metalowe.webp') },
  { slug: 'ph_karafki_oliwa_ocet', category: 'placeholdery', labelPl: 'Placeholder oliwa/ocet', aliases: ['oliwa', 'ocet', 'ocet balsamiczny'], storagePath: 'placeholdery/ph_karafki_oliwa_ocet.png', localAsset: require('@/assets/premium/placeholders/ph_karafki_oliwa_ocet.webp') },
  { slug: 'ph_sloiczki_przyprawy', category: 'placeholdery', labelPl: 'Placeholder przyprawy', aliases: ['przyprawa', 'sól', 'pieprz', 'zioła suszone', 'posypka'], storagePath: 'placeholdery/ph_sloiczki_przyprawy.png', localAsset: require('@/assets/premium/placeholders/ph_sloiczki_przyprawy.webp') },
  { slug: 'ph_pojemniki_plastik_bialy', category: 'placeholdery', labelPl: 'Placeholder pojemniki', aliases: ['pojemnik', 'lunchbox', 'na wynos'], storagePath: 'placeholdery/ph_pojemniki_plastik_bialy.png', localAsset: require('@/assets/premium/placeholders/ph_pojemniki_plastik_bialy.webp') },
  { slug: 'ph_czapka_kucharska', category: 'placeholdery', labelPl: 'Placeholder odzież kuchnia', aliases: ['czapka', 'szef kuchni', 'odzież kuchenna'], storagePath: 'placeholdery/ph_czapka_kucharska.png', localAsset: require('@/assets/premium/placeholders/ph_czapka_kucharska.webp') },
  { slug: 'ph_fartuch_czarny', category: 'placeholdery', labelPl: 'Placeholder fartuch', aliases: ['fartuch', 'kelner', 'barista'], storagePath: 'placeholdery/ph_fartuch_czarny.png', localAsset: require('@/assets/premium/placeholders/ph_fartuch_czarny.webp') },
  { slug: 'ph_karta_menu', category: 'placeholdery', labelPl: 'Placeholder menu', aliases: ['menu', 'karta dań', 'druk'], storagePath: 'placeholdery/ph_karta_menu.png', localAsset: require('@/assets/premium/placeholders/ph_karta_menu.webp') },
  { slug: 'ph_waga_kuchenna', category: 'placeholdery', labelPl: 'Placeholder waga', aliases: ['waga', 'sprzęt agd'], storagePath: 'placeholdery/ph_waga_kuchenna.png', localAsset: require('@/assets/premium/placeholders/ph_waga_kuchenna.webp') },
  { slug: 'ph_chemia_spray', category: 'placeholdery', labelPl: 'Placeholder chemia', aliases: ['chemia', 'dezynfekcja', 'środek czystości', 'haccp'], storagePath: 'placeholdery/ph_chemia_spray.png', localAsset: require('@/assets/premium/placeholders/ph_chemia_spray.webp') },
  { slug: 'ph_kubki_kawa_papier', category: 'placeholdery', labelPl: 'Placeholder kawa', aliases: ['kawa na wynos', 'herbata na wynos'], storagePath: 'placeholdery/ph_kubki_kawa_papier.png', localAsset: require('@/assets/premium/placeholders/ph_kubki_kawa_papier.webp') },
  { slug: 'ph_sery_kregi', category: 'placeholdery', labelPl: 'Placeholder sery', aliases: ['ser', 'sery', 'cheddar', 'gouda'], storagePath: 'placeholdery/ph_sery_kregi.png', localAsset: require('@/assets/premium/placeholders/ph_sery_kregi.webp') },
  { slug: 'ph_mieso_surowe_stek', category: 'placeholdery', labelPl: 'Placeholder mięso', aliases: ['mięso', 'wędliny', 'wieprzowina', 'wołowina', 'drób'], storagePath: 'placeholdery/ph_mieso_surowe_stek.png', localAsset: require('@/assets/premium/placeholders/ph_mieso_surowe_stek.webp') },
  { slug: 'ph_ryby_swieze', category: 'placeholdery', labelPl: 'Placeholder ryby', aliases: ['ryba', 'ryby', 'owoce morza'], storagePath: 'placeholdery/ph_ryby_swieze.png', localAsset: require('@/assets/premium/placeholders/ph_ryby_swieze.webp') },
  { slug: 'ph_torby_papier_kraft', category: 'placeholdery', labelPl: 'Placeholder torby', aliases: ['torba', 'torba papierowa'], storagePath: 'placeholdery/ph_torby_papier_kraft.png', localAsset: require('@/assets/premium/placeholders/ph_torby_papier_kraft.webp') },
  { slug: 'ph_skrzynka_warzywa', category: 'placeholdery', labelPl: 'Placeholder warzywa', aliases: ['warzywa', 'nowalijki', 'warzywo'], storagePath: 'placeholdery/ph_skrzynka_warzywa.png', localAsset: require('@/assets/premium/placeholders/ph_skrzynka_warzywa.webp') },
  { slug: 'ph_kosz_owoce', category: 'placeholdery', labelPl: 'Placeholder owoce', aliases: ['owoce', 'owoc', 'cytrus', 'sezonowe'], storagePath: 'placeholdery/ph_kosz_owoce.png', localAsset: require('@/assets/premium/placeholders/ph_kosz_owoce.webp') },
  { slug: 'ph_mleko_karton_nabial', category: 'placeholdery', labelPl: 'Placeholder nabiał', aliases: ['nabiał', 'śmietana', 'jogurt', 'napój roślinny'], storagePath: 'placeholdery/ph_mleko_karton_nabial.png', localAsset: require('@/assets/premium/placeholders/ph_mleko_karton_nabial.webp') },
  { slug: 'ph_jajka_wytlaczanka', category: 'placeholdery', labelPl: 'Placeholder jajka', aliases: ['jajka', 'jajko', 'melanż'], storagePath: 'placeholdery/ph_jajka_wytlaczanka.png', localAsset: require('@/assets/premium/placeholders/ph_jajka_wytlaczanka.webp') },
  { slug: 'ph_ziola_doniczki', category: 'placeholdery', labelPl: 'Placeholder zioła', aliases: ['zioła', 'bazylia', 'mięta', 'rozmaryn', 'kiełki'], storagePath: 'placeholdery/ph_ziola_doniczki.png', localAsset: require('@/assets/premium/placeholders/ph_ziola_doniczki.webp') },
  { slug: 'ph_scierki_kuchenne', category: 'placeholdery', labelPl: 'Placeholder tekstylia', aliases: ['ścierka', 'ręcznik', 'obrus', 'serweta'], storagePath: 'placeholdery/ph_scierki_kuchenne.png', localAsset: require('@/assets/premium/placeholders/ph_scierki_kuchenne.webp') },
  { slug: 'ph_sztucce_zestaw', category: 'placeholdery', labelPl: 'Placeholder sztućce', aliases: ['sztućce', 'widelec', 'łyżka', 'nóż stołowy'], storagePath: 'placeholdery/ph_sztucce_zestaw.png', localAsset: require('@/assets/premium/placeholders/ph_sztucce_zestaw.webp') },
  { slug: 'ph_patelnie', category: 'placeholdery', labelPl: 'Placeholder patelnie', aliases: ['patelnia', 'smażenie'], storagePath: 'placeholdery/ph_patelnie.png', localAsset: require('@/assets/premium/placeholders/ph_patelnie.webp') },
  { slug: 'ph_torby_eko_logo', category: 'placeholdery', labelPl: 'Placeholder torby eko', aliases: ['eko', 'branding', 'torba premium'], storagePath: 'placeholdery/ph_torby_eko_logo.png', localAsset: require('@/assets/premium/placeholders/ph_torby_eko_logo.webp') },
];
export const PRODUCT_IMAGE_CATALOG: ProductImageEntry[] = [
  ...MEAT_CATALOG,
  ...SEAFOOD_CATALOG,
  ...VEGETABLE_CATALOG,
  ...HERBS_CATALOG,
  ...FRUIT_CATALOG,
  ...DAIRY_CATALOG,
  ...DRY_PANTRY_CATALOG,
  ...LIQUID_PANTRY_CATALOG,
  ...BREAD_CATALOG,
  ...CAFE_CATALOG,
  ...DRINKS_CATALOG,
  ...WINE_BEER_CATALOG,
  ...SPIRITS_CATALOG,
  ...PACKAGING_CATALOG,
  ...PASTES_CATALOG,
  ...ROOTS_CATALOG,
  ...POLISH_CATALOG,
  ...FROZEN_CATALOG,
  ...GRAINS_CATALOG,
  ...PLACEHOLDER_CATALOG,
];

/** Magazyn / składniki — BEZ grafik dań (dań szukamy tylko w Menu, żeby nie dusić startu aplikacji). */
function catalogAll(): ProductImageEntry[] {
  return PRODUCT_IMAGE_CATALOG;
}

function dishCatalog(): ProductImageEntry[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DISH_IMAGE_CATALOG } = require('@/lib/dishImagesCatalog') as {
      DISH_IMAGE_CATALOG: ProductImageEntry[];
    };
    return DISH_IMAGE_CATALOG as ProductImageEntry[];
  } catch {
    return [];
  }
}

/** Poziom 2: luksusowy placeholder kategorii (reprezentatywne WebP z plansz dań). */
function resolveDishCategoryPlaceholder(
  q: string,
  menuCategory?: string,
): ProductImageEntry | null {
  const dish = dishCatalog();
  if (!dish.length) return null;
  const pick = (slug: string) => dish.find((e) => e.slug === slug) ?? null;
  const hay = normalizeName(`${menuCategory ?? ''} ${q}`);

  const rules: { keys: string[]; slug: string }[] = [
    { keys: ['ramen', 'pho', 'miso', 'tom yum', 'tom kha', 'udon', 'soba', 'laksa', 'wonton', 'kimchi', 'congee', 'asia'], slug: 'shoyu_ramen' },
    { keys: ['sos', 'sauce', 'aioli', 'gravy', 'demi glace', 'bearnaise', 'hollandaise', 'satay', 'bbq glaze'], slug: 'sos_smietankowo_ziolowy' },
    // Zupy — tylko gdy nazwa/kategoria ma kontekst zupy (nie „kurczak” sam)
    { keys: ['zupa', 'rosol', 'barszcz', 'zurek', 'flaki', 'chowder', 'bisque', 'gazpacho', 'bulion', 'zupy', 'krupnik', 'kapusniak', 'chlodnik'], slug: 'rosol' },
    { keys: ['krem z ', 'kremem'], slug: 'rosol' },
    // Mięsa / filety / piersi — PRZED ogólnymi regułami
    { keys: ['filet', 'piers', 'kurczak', 'schab', 'kotlet', 'de volaille', 'udziec', 'skrzyde', 'indyk', 'kaczka', 'poledwic', 'antrykot', 'karkow'], slug: 'kotlet_schabowy' },
    { keys: ['burger', 'smash', 'cheeseburger', 'hamburger', 'sandwich', 'kanapka', 'burgery'], slug: 'classic_cheeseburger' },
    { keys: ['frytk', 'nachos', 'hot dog', 'nugget', 'taco', 'zapiekank', 'street', 'wings', 'onion ring', 'quesadilla'], slug: 'french_fries' },
    { keys: ['tatar', 'carpaccio', 'ceviche', 'ostrygi', 'foie', 'gravlax', 'przystawk', 'tataki', 'krewet', 'starter'], slug: 'beef_tartare' },
    { keys: ['makaron', 'pasta', 'spaghetti', 'tagliatelle', 'makarony', 'mac and cheese', 'lasagne', 'lasagna', 'gnocchi', 'ravioli', 'penne', 'linguine'], slug: 'spaghetti_carbonara' },
    { keys: ['salatk', 'salad', 'salatki', 'cezar', 'grecka', 'cobb', 'waldorf'], slug: 'garden_salad' },
    { keys: ['przystawk', 'bruschetta', 'hummus', 'falafel', 'camembert', 'deska ser', 'charcuterie'], slug: 'cheese_board_brie' },
    { keys: ['surowk', 'coleslaw', 'mizeria', 'buraczk', 'dodatki', 'sides'], slug: 'coleslaw' },
    { keys: ['kebab', 'szawarma', 'shawarma', 'falafel', 'lahmacun', 'kofta', 'toum'], slug: 'kebab_rollo' },
    { keys: ['obiad', 'schabow', 'gołąb', 'golab', 'bigos', 'golonk', 'de volaille', 'dinners'], slug: 'kotlet_schabowy' },
    { keys: ['pierog', 'kopytk', 'kluski', 'nalesnik', 'naleśnik', 'knedle', 'pampuchy', 'racuchy', 'kartacz', 'cepelin'], slug: 'pierogi_ruskie' },
    { keys: ['pizza', 'calzone', 'focaccia', 'pizzetta', 'margherit'], slug: 'pizza_margherita' },
    { keys: ['stek', 'steak', 'ribeye', 'tomahawk', 't-bone', 'tbone', 'rostbef', 'roast beef', 'brisket', 'zeberk', 'żeberk', 'bbq', 'pulled pork', 'antrikot', 'antrykot'], slug: 'stek_ribeye' },
    { keys: ['sushi', 'nigiri', 'sashimi', 'maki', 'uramaki', 'hosomaki', 'futomaki', 'gunkan', 'wasabi', 'wakame', 'edamame'], slug: 'sake_nigiri' },
    { keys: ['pad thai', 'kung pao', 'chow mein', 'gyoza', 'dim sum', 'mapo', 'teriyaki', 'sriracha', 'tempura', 'nasi goreng', 'azjat', 'oriental', 'stir fry', 'woka'], slug: 'pad_thai_krewetki' },
    { keys: ['butter chicken', 'tikka', 'biryani', 'paneer', 'tandoori', 'samosa', 'naan', 'korma', 'curry', 'lassi', 'indyj', 'masala', 'rogan'], slug: 'butter_chicken' },
    { keys: ['taco', 'burrito', 'quesadilla', 'enchilada', 'fajita', 'nachos', 'guacamole', 'chimichanga', 'churros', 'meksyk', 'salsa', 'elote'], slug: 'tacos_wolowina' },
    { keys: ['paella', 'gyros', 'souvlaki', 'moussaka', 'musaka', 'tzatziki', 'halloumi', 'dolmades', 'srodziem', 'śródziem', 'mediterranean', 'grec'], slug: 'paella_owoce_morza' },
    { keys: ['chaczapuri', 'khachapuri', 'chinkali', 'khinkali', 'charczo', 'tkemali', 'churchkhela', 'kaukask', 'gruzin', 'szkmeruli', 'lobio'], slug: 'chaczapuri_adzarskie' },
    { keys: ['łosoś', 'losos', 'dorsz', 'pstrąg', 'pstrag', 'tuńczyk', 'tunczyk', 'labraks', 'halibut', 'miecznik', 'sandacz', 'dorada', 'makrela', 'sardynk', 'fish and chips', 'rybne', 'dania rybne', 'fish'], slug: 'losos_maslo_ziolowe' },
    { keys: ['wege', 'wegań', 'wegan', 'vegan', 'tofu', 'tempeh', 'jackfruit', 'buddha', 'ratatouille', 'chimichurri', 'roślin', 'roslin'], slug: 'stek_kalafior_chimichurri' },
    { keys: ['jajecznica', 'szakszuka', 'shakshuka', 'benedykt', 'owsianka', 'french toast', 'avocado toast', 'śniadan', 'sniadan', 'breakfast', 'pancakes', 'omlet'], slug: 'jajecznica_klasyczna' },
    { keys: ['dania glowne', 'danie glowne'], slug: 'kotlet_schabowy' },
  ];
  for (const r of rules) {
    if (r.keys.some((k) => hay.includes(normalizeName(k)))) {
      const hit = pick(r.slug);
      if (hit) return hit;
    }
  }

  const catMap: Record<string, string> = {
    zupy: 'rosol',
    burgery: 'classic_cheeseburger',
    'dania glowne': 'kotlet_schabowy',
    makarony: 'spaghetti_carbonara',
    salatki: 'garden_salad',
    przystawki: 'cheese_board_brie',
    surowki: 'coleslaw',
    dodatki: 'coleslaw',
    kebaby: 'kebab_rollo',
    obiady: 'kotlet_schabowy',
    pierogi: 'pierogi_ruskie',
    pizze: 'pizza_margherita',
    pizza: 'pizza_margherita',
    sushi: 'sake_nigiri',
    bbq: 'stek_ribeye',
    miesa: 'stek_ribeye',
    'miesa grillowane': 'stek_ribeye',
    azjatycka: 'pad_thai_krewetki',
    'kuchnia azjatycka': 'pad_thai_krewetki',
    asia: 'pad_thai_krewetki',
    indyjska: 'butter_chicken',
    'kuchnia indyjska': 'butter_chicken',
    india: 'butter_chicken',
    meksykanska: 'tacos_wolowina',
    meksykańska: 'tacos_wolowina',
    'dania meksykanskie': 'tacos_wolowina',
    'dania meksykańskie': 'tacos_wolowina',
    mexico: 'tacos_wolowina',
    srodziemnomorska: 'paella_owoce_morza',
    'kuchnia srodziemnomorska': 'paella_owoce_morza',
    mediterranean: 'paella_owoce_morza',
    kaukaska: 'chaczapuri_adzarskie',
    gruzinska: 'chaczapuri_adzarskie',
    'kuchnia gruzinska': 'chaczapuri_adzarskie',
    caucasian: 'chaczapuri_adzarskie',
    rybne: 'losos_maslo_ziolowe',
    'dania rybne': 'losos_maslo_ziolowe',
    ryby: 'losos_maslo_ziolowe',
    fish: 'losos_maslo_ziolowe',
    wege: 'stek_kalafior_chimichurri',
    wegańskie: 'stek_kalafior_chimichurri',
    wegetarianskie: 'stek_kalafior_chimichurri',
    wegetariańskie: 'stek_kalafior_chimichurri',
    'dania wege': 'stek_kalafior_chimichurri',
    vegan: 'stek_kalafior_chimichurri',
    roslinne: 'stek_kalafior_chimichurri',
    roślinne: 'stek_kalafior_chimichurri',
    sniadania: 'jajecznica_klasyczna',
    śniadania: 'jajecznica_klasyczna',
    breakfast: 'jajecznica_klasyczna',
  };
  if (menuCategory) {
    const slug = catMap[normalizeName(menuCategory)];
    if (slug) return pick(slug);
  }
  return null;
}

function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ResolvedProductImage = {
  slug: string;
  labelPl: string;
  /** Preferuj remote (bucket); localAsset jako fallback offline */
  uri: string | null;
  localAsset?: number;
  score: number;
};

/** Cache dopasowań bez exclude — Menu/Magazyn nie skanują katalogu przy każdym wierszu. */
const RESOLVE_CACHE = new Map<string, ResolvedProductImage | null>();
const SOURCE_CACHE = new Map<string, number | { uri: string }>();
const RESOLVE_CACHE_MAX = 1200;

function rememberResolve(key: string, value: ResolvedProductImage | null): ResolvedProductImage | null {
  if (RESOLVE_CACHE.size >= RESOLVE_CACHE_MAX) {
    const drop = Math.floor(RESOLVE_CACHE_MAX / 3);
    let i = 0;
    for (const k of RESOLVE_CACHE.keys()) {
      RESOLVE_CACHE.delete(k);
      if (++i >= drop) break;
    }
  }
  RESOLVE_CACHE.set(key, value);
  return value;
}

function toImageSource(r: ResolvedProductImage | null): number | { uri: string } {
  if (r?.localAsset != null) return r.localAsset;
  if (r?.uri) return { uri: r.uri };
  try {
    return require('@/assets/premium/placeholders/ph_pojemniki_plastik_bialy.webp');
  } catch {
    return require('@/assets/premium/placeholders/ph_kartony_brazowe.webp');
  }
}

/**
 * Podgrzej lekki katalog składników po starcie UI.
 * Katalog dań (setki WebP) ładujemy leniwie przy pierwszym matchu Menu / Inspiracji —
 * nie ciągnij go przy cold start.
 */
export function warmProductImageIndexes(): void {
  void catalogAll();
}

/**
 * Dopasuj nazwę z menu/magazynu do ikony katalogu.
 * Zwraca najlepsze trafienie albo null — NIGDY nie podstawiaj „domyślnego mięsa”.
 * @param excludeSlugs — slugi już użyte u użytkownika (luźne dopasowanie unika duplikatów)
 * @param preferDishes — szukaj najpierw w katalogu dań (Menu), potem składniki
 * @param menuCategory — kategoria z karty dań (fallback poziom 2)
 *
 * Schodkowe zdjęcia (Menu):
 * 1) dedykowane WebP dania → 2) placeholder kategorii → 3) uniwersalny ph_*
 */
export function resolveProductImage(
  productName: string,
  excludeSlugs?: Set<string> | string[],
  preferDishes = false,
  menuCategory?: string,
): ResolvedProductImage | null {
  const q = normalizeName(productName);
  if (!q) return null;
  const excluded = excludeSlugs
    ? excludeSlugs instanceof Set
      ? excludeSlugs
      : new Set(excludeSlugs)
    : null;
  const hasExclude = !!(excluded && excluded.size > 0);
  const cacheKey = `${preferDishes ? 'd' : 'i'}|${q}|${normalizeName(menuCategory ?? '')}`;
  if (!hasExclude) {
    const hit = RESOLVE_CACHE.get(cacheKey);
    if (hit !== undefined) return hit;
  }

  const pools = preferDishes
    ? [dishCatalog(), catalogAll()]
    : [catalogAll()];

  // Menu / receptury: najpierw ścisły matcher dań (unikaj hummus dla sosów itd.)
  if (preferDishes) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { findDishImageMatch } = require('@/lib/dishImageMatch') as {
        findDishImageMatch: (
          name: string,
          catalog: ProductImageEntry[],
        ) => { slug: string; score: number; entry: ProductImageEntry } | undefined;
      };
      const strict = findDishImageMatch(productName, dishCatalog());
      if (strict && strict.score >= 85 && (!excluded || !excluded.has(strict.slug))) {
        const resolved = {
          slug: strict.entry.slug,
          labelPl: strict.entry.labelPl,
          uri: publicIconUrl(strict.entry.storagePath),
          localAsset: strict.entry.localAsset,
          score: strict.score,
        };
        return hasExclude ? resolved : rememberResolve(cacheKey, resolved);
      }
    } catch {
      /* matcher optional */
    }
  }

  const ranked: { entry: ProductImageEntry; score: number }[] = [];

  // Prefer dishes: użyj family z dishImageMatch gdy dostępne
  let wantFamily: string | null = null;
  if (preferDishes) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { detectDishFamily } = require('@/lib/dishImageMatch') as {
        detectDishFamily: (name: string) => string;
      };
      wantFamily = detectDishFamily(productName);
    } catch {
      wantFamily = null;
    }
  }

  for (const pool of pools) {
    for (const entry of pool) {
      const candidates = [entry.slug.replace(/_/g, ' '), entry.labelPl, ...entry.aliases].map(normalizeName);
      let score = 0;
      for (const c of candidates) {
        if (!c) continue;
        if (q === c) score = Math.max(score, 100);
        else if (c.length >= 5 && q.length >= 5 && (q.includes(c) || c.includes(q))) {
          // Unikaj „stek” ⊆ „cheesesteak” / krótkich podciągów
          // Pełne zawieranie nazwy — tylko gdy kandydat ma ≥2 tokeny lub jest długi
          const cTok = c.split(' ').filter((t) => t.length > 2);
          if (cTok.length >= 2 || c.length >= 10) {
            score = Math.max(score, 85 + Math.min(c.length, 10));
          } else {
            score = Math.max(score, 62);
          }
        } else {
          const qTokens = q.split(' ').filter((t) => t.length > 2);
          const cTokens = c.split(' ').filter((t) => t.length > 2);
          const hit = qTokens.filter((t) =>
            cTokens.some((ct) => {
              if (ct === t) return true;
              // Podciąg tylko dla dłuższych tokenów (≥5), żeby stek ≠ cheesesteak
              if (t.length >= 5 && ct.length >= 5 && (ct.includes(t) || t.includes(ct))) return true;
              return false;
            }),
          ).length;
          if (hit > 0) {
            let s = 50 + hit * 18;
            // Sam jeden wspólny token przy 2+ w zapytaniu — słabe (kurczak ≠ rosół/burger)
            if (hit === 1 && qTokens.length >= 2) s = Math.min(s, 54);
            score = Math.max(score, s);
          }
        }
      }
      // Kara za odległą kategorię (np. zupa vs mięso)
      if (preferDishes && wantFamily && wantFamily !== 'other' && score > 0) {
        const path = `${entry.storagePath} ${entry.slug} ${entry.category}`.toLowerCase();
        const isSoup = /soup|zupa/.test(path);
        const isMeat = /mieso|steak|grill|kotlet|schab|kurczak|beef|pork/.test(path) && !isSoup;
        if (wantFamily === 'meat' && isSoup) score = Math.max(0, score - 45);
        else if (wantFamily === 'soups' && isMeat) score = Math.max(0, score - 45);
        else if (wantFamily === 'meat' && isMeat) score = Math.min(100, score + 8);
      }
      if (score > 0) ranked.push({ entry, score });
    }
    // Jeśli w katalogu dań jest MOCNE trafienie — nie mieszaj ze składnikami
    if (preferDishes && ranked.some((r) => r.score >= 75)) break;
  }

  ranked.sort((a, b) => b.score - a.score);

  const exact = ranked.find((r) => r.score >= 95);
  const pick =
    exact ||
    ranked.find((r) => r.score >= 70 && (!excluded || !excluded.has(r.entry.slug))) ||
    ranked.find((r) => r.score >= 70) ||
    null;

  if (pick && pick.score >= 70) {
    const resolved = {
      slug: pick.entry.slug,
      labelPl: pick.entry.labelPl,
      uri: publicIconUrl(pick.entry.storagePath),
      localAsset: pick.entry.localAsset,
      score: pick.score,
    };
    return hasExclude ? resolved : rememberResolve(cacheKey, resolved);
  }

  const best = ranked[0] ?? null;

  // Poziom 2 — kategoria premium (tylko Menu)
  if (preferDishes) {
    const catPh = resolveDishCategoryPlaceholder(q, menuCategory);
    if (catPh) {
      const resolved = {
        slug: catPh.slug,
        labelPl: catPh.labelPl,
        uri: publicIconUrl(catPh.storagePath),
        localAsset: catPh.localAsset,
        score: 45,
      };
      return hasExclude ? resolved : rememberResolve(cacheKey, resolved);
    }
    // Menu: NIGDY nie wrzucaj opakowań / losowych ph_* — lepszy placeholder kategorii
    const soft = resolvePlaceholderByKeywords(q);
    if (soft && !String(soft.slug).startsWith('ph_pojemniki') && !String(soft.slug).startsWith('ph_kartony')) {
      const resolved = {
        slug: soft.slug,
        labelPl: soft.labelPl,
        uri: publicIconUrl(soft.storagePath),
        localAsset: soft.localAsset,
        score: 40,
      };
      return hasExclude ? resolved : rememberResolve(cacheKey, resolved);
    }
    return hasExclude ? null : rememberResolve(cacheKey, null);
  }

  // Poziom 3 — uniwersalny placeholder (magazyn / składniki)
  const ph = resolvePlaceholderByKeywords(q);
  if (ph) {
    const resolved = {
      slug: ph.slug,
      labelPl: ph.labelPl,
      uri: publicIconUrl(ph.storagePath),
      localAsset: ph.localAsset,
      score: best?.score ?? 40,
    };
    return hasExclude ? resolved : rememberResolve(cacheKey, resolved);
  }

  const fallback =
    catalogAll().find((e) => e.slug === 'ph_skrzynka_warzywa') ||
    catalogAll().find((e) => e.slug === 'ph_mieso_surowe_stek') ||
    catalogAll()[0];
  if (!fallback) return hasExclude ? null : rememberResolve(cacheKey, null);
  const resolved = {
    slug: fallback.slug,
    labelPl: fallback.labelPl,
    uri: publicIconUrl(fallback.storagePath),
    localAsset: fallback.localAsset,
    score: 1,
  };
  return hasExclude ? resolved : rememberResolve(cacheKey, resolved);
}

/** Mapowanie słów kluczowych → placeholder (sos ≠ mięso). */
function resolvePlaceholderByKeywords(q: string): ProductImageEntry | null {
  const rules: { keys: string[]; slug: string }[] = [
    // Specyficzne produkty — PRZED ogólnymi regułami (mięso / warzywa)
    { keys: ['lod ', 'lody', 'lodów', 'lodow', 'ice cream', 'gelato', 'sorbet'], slug: 'ph_mleko_karton_nabial' },
    { keys: ['biszkopt', 'babeczk', 'ciastk', 'tiramisu', 'deser', 'ciast', 'tort ', 'pudding', 'ciasto'], slug: 'ph_mleko_karton_nabial' },
    { keys: ['grzank', 'crouton', 'tost '], slug: 'ph_kartony_brazowe' },
    { keys: ['rostbef', 'roast beef', 'pieczen', 'pieczeń'], slug: 'ph_mieso_surowe_stek' },
    { keys: ['trufel', 'trufl'], slug: 'ph_ziola_doniczki' },
    { keys: ['tunczyk', 'tuńczyk', 'tuna'], slug: 'ph_ryby_swieze' },
    { keys: ['malz', 'małż', 'omul', 'ostry'], slug: 'ph_ryby_swieze' },
    { keys: ['sos', 'ketchup', 'majonez', 'dressing', 'musztarda', 'cytrynowy', 'malinowy'], slug: 'ph_butelki_dozujace_sosy' },
    { keys: ['zupa', 'krem', 'bulion', 'gulasz', 'rosol', 'rosoł'], slug: 'ph_garnki_metalowe' },
    { keys: ['oliwa', 'ocet', 'olej'], slug: 'ph_karafki_oliwa_ocet' },
    { keys: ['przypraw', 'sol ', 'sól', 'pieprz', 'posyp'], slug: 'ph_sloiczki_przyprawy' },
    { keys: ['deser', 'ciast', 'tort ', 'pudding'], slug: 'ph_mleko_karton_nabial' },
    { keys: ['pieczyw', 'chleb', 'bulka', 'bułka', 'bagiet'], slug: 'ph_kartony_brazowe' },
    { keys: ['owoc', 'cytrus', 'sezonow', 'jablk', 'gruszk', 'malin', 'truskawk'], slug: 'ph_kosz_owoce' },
    { keys: ['warzyw', 'nowalijk', 'ziemniak', 'korzen'], slug: 'ph_skrzynka_warzywa' },
    { keys: ['ser ', 'sery', 'twarog', 'twaróg'], slug: 'ph_sery_kregi' },
    { keys: ['mleko', 'smietan', 'śmietan', 'jogurt', 'nabial', 'nabiał'], slug: 'ph_mleko_karton_nabial' },
    { keys: ['jajk', 'jaj ', 'melanz'], slug: 'ph_jajka_wytlaczanka' },
    { keys: ['mies', 'mięso', 'stek', 'wedlin', 'kurczak', 'wolow', 'wieprz'], slug: 'ph_mieso_surowe_stek' },
    { keys: ['ryb', 'krewet', 'owoc morza'], slug: 'ph_ryby_swieze' },
    { keys: ['ziol', 'bazyl', 'miet', 'rozmaryn', 'kielk'], slug: 'ph_ziola_doniczki' },
    { keys: ['chemia', 'dezynfek', 'haccp', 'czystosc'], slug: 'ph_chemia_spray' },
    { keys: ['kawa', 'herbata'], slug: 'ph_kubki_kawa_papier' },
    { keys: ['torba', 'opakowan'], slug: 'ph_torby_papier_kraft' },
    { keys: ['karton', 'pudelk'], slug: 'ph_kartony_brazowe' },
    { keys: ['pateln'], slug: 'ph_patelnie' },
    { keys: ['sztucc', 'widelc', 'lyzk', 'noż stoł'], slug: 'ph_sztucce_zestaw' },
    { keys: ['menu', 'karta dan'], slug: 'ph_karta_menu' },
    { keys: ['fartuch', 'kelner'], slug: 'ph_fartuch_czarny' },
    { keys: ['czapka', 'kucharz'], slug: 'ph_czapka_kucharska' },
  ];
  for (const r of rules) {
    if (r.keys.some((k) => q.includes(normalizeName(k)))) {
      const hit = catalogAll().find((e) => e.slug === r.slug);
      if (hit) return hit;
    }
  }
  return null;
}

/** Źródło dla <Image /> — lokalny asset jeśli jest, inaczej remote URL. Zawsze coś zwraca (closest placeholder). */
export function imageSourceForProduct(
  productName: string,
  excludeSlugs?: Set<string> | string[],
): number | { uri: string } {
  const hasExclude = !!(excludeSlugs && (excludeSlugs instanceof Set ? excludeSlugs.size : excludeSlugs.length));
  const srcKey = `i|${normalizeName(productName)}`;
  if (!hasExclude) {
    const cached = SOURCE_CACHE.get(srcKey);
    if (cached !== undefined) return cached;
  }
  const src = toImageSource(resolveProductImage(productName, excludeSlugs, false));
  if (!hasExclude) {
    if (SOURCE_CACHE.size >= RESOLVE_CACHE_MAX) SOURCE_CACHE.clear();
    SOURCE_CACHE.set(srcKey, src);
  }
  return src;
}

/**
 * Jednorazowo przypisz unikalne grafiki do listy dań (O(n) resolve zamiast O(n²) per karta).
 */
export function assignUniqueDishImageSources(
  items: ReadonlyArray<{ name: string; category?: string }>,
): Map<string, number | { uri: string }> {
  const used = new Set<string>();
  const out = new Map<string, number | { uri: string }>();
  for (const item of items) {
    if (out.has(item.name)) continue;
    const r = resolveProductImage(item.name, used, true, item.category);
    if (r?.slug) used.add(r.slug);
    out.set(item.name, toImageSource(r));
  }
  return out;
}

/**
 * Dobierz grafikę dania (Menu) unikając slugów już użytych.
 * Preferuj `assignUniqueDishImageSources` dla list — ta funkcja zostaje dla pojedynczych kart.
 */
export function imageSourceForProductUnique(
  productName: string,
  alreadyUsedNames: string[],
  menuCategory?: string,
): number | { uri: string } {
  const used = new Set<string>();
  for (const n of alreadyUsedNames) {
    if (normalizeName(n) === normalizeName(productName)) continue;
    const r = resolveProductImage(n, undefined, true);
    if (r?.slug) used.add(r.slug);
  }
  return toImageSource(resolveProductImage(productName, used, true, menuCategory));
}
