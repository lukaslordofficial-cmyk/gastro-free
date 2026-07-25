/**
 * Katalog grafik — driny / alkohole mocne (plansza 5×5).
 */
import type { DishImageEntry } from '@/lib/dishImagesCatalog';

export const SPIRITS_CATALOG: DishImageEntry[] = [
  { slug: 'whisky_on_the_rocks', category: 'kuchnia_polska', labelPl: 'Whisky na lodzie (On the rocks)', aliases: ['whisky', 'whiskey on the rocks', 'whisky na lodzie'], storagePath: 'dania/spirits/spirit_01.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_01.webp') },
  { slug: 'wodka_zmrozona', category: 'kuchnia_polska', labelPl: 'Czysta wódka w zmrożonym kieliszku', aliases: ['wódka', 'vodka', 'shot wódki'], storagePath: 'dania/spirits/spirit_02.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_02.webp') },
  { slug: 'tequila_gold', category: 'kuchnia_polska', labelPl: 'Złota Tequila (Tequila Gold)', aliases: ['tequila gold', 'złota tequila'], storagePath: 'dania/spirits/spirit_03.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_03.webp') },
  { slug: 'koniak', category: 'kuchnia_polska', labelPl: 'Koniak (Cognac)', aliases: ['koniak', 'cognac', 'snifter'], storagePath: 'dania/spirits/spirit_04.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_04.webp') },
  { slug: 'gin_rozmaryn', category: 'kuchnia_polska', labelPl: 'Gin klasyczny z rozmarynem', aliases: ['gin', 'gin rozmaryn', 'dry gin'], storagePath: 'dania/spirits/spirit_05.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_05.webp') },
  { slug: 'ciemny_rum', category: 'kuchnia_polska', labelPl: 'Ciemny rum starzony', aliases: ['ciemny rum', 'dark rum', 'rum starzony'], storagePath: 'dania/spirits/spirit_06.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_06.webp') },
  { slug: 'bourbon', category: 'kuchnia_polska', labelPl: 'Burbon (Bourbon Whiskey)', aliases: ['bourbon', 'burbon'], storagePath: 'dania/spirits/spirit_07.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_07.webp') },
  { slug: 'tequila_silver', category: 'kuchnia_polska', labelPl: 'Srebrna Tequila (Tequila Silver)', aliases: ['tequila silver', 'tequila blanca', 'srebrna tequila'], storagePath: 'dania/spirits/spirit_08.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_08.webp') },
  { slug: 'absynt', category: 'kuchnia_polska', labelPl: 'Absynt tradycyjny', aliases: ['absynt', 'absinthe'], storagePath: 'dania/spirits/spirit_09.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_09.webp') },
  { slug: 'spiced_rum', category: 'kuchnia_polska', labelPl: 'Pikantny rum (Spiced Rum)', aliases: ['spiced rum', 'rum z przyprawami'], storagePath: 'dania/spirits/spirit_10.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_10.webp') },
  { slug: 'sambuca', category: 'kuchnia_polska', labelPl: 'Sambuca z ziarnami kawy', aliases: ['sambuca', 'sambuca kawa'], storagePath: 'dania/spirits/spirit_11.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_11.webp') },
  { slug: 'single_malt', category: 'kuchnia_polska', labelPl: 'Whisky Single Malt', aliases: ['single malt', 'whisky single malt', 'glencairn'], storagePath: 'dania/spirits/spirit_12.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_12.webp') },
  { slug: 'grappa', category: 'kuchnia_polska', labelPl: 'Włoska Grappa', aliases: ['grappa'], storagePath: 'dania/spirits/spirit_13.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_13.webp') },
  { slug: 'likier_kawowy', category: 'kuchnia_polska', labelPl: 'Likier kawowy', aliases: ['likier kawowy', 'coffee liqueur', 'kahlua'], storagePath: 'dania/spirits/spirit_14.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_14.webp') },
  { slug: 'amaretto', category: 'kuchnia_polska', labelPl: 'Amaretto na lodzie', aliases: ['amaretto'], storagePath: 'dania/spirits/spirit_15.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_15.webp') },
  { slug: 'sake', category: 'kuchnia_polska', labelPl: 'Tradycyjne japońskie Sake', aliases: ['sake', 'ochoko'], storagePath: 'dania/spirits/spirit_16.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_16.webp') },
  { slug: 'jagermeister', category: 'kuchnia_polska', labelPl: 'Ziołowy likier Jägermeister', aliases: ['jägermeister', 'jagermeister', 'jäger'], storagePath: 'dania/spirits/spirit_17.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_17.webp') },
  { slug: 'gold_rum', category: 'kuchnia_polska', labelPl: 'Złoty rum (Gold Rum)', aliases: ['gold rum', 'złoty rum'], storagePath: 'dania/spirits/spirit_18.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_18.webp') },
  { slug: 'ouzo', category: 'kuchnia_polska', labelPl: 'Greckie Ouzo', aliases: ['ouzo', 'pastis'], storagePath: 'dania/spirits/spirit_19.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_19.webp') },
  { slug: 'limoncello', category: 'kuchnia_polska', labelPl: 'Włoskie Limoncello', aliases: ['limoncello'], storagePath: 'dania/spirits/spirit_20.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_20.webp') },
  { slug: 'cachaca', category: 'kuchnia_polska', labelPl: 'Cachaça z limonką', aliases: ['cachaça', 'cachaca'], storagePath: 'dania/spirits/spirit_21.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_21.webp') },
  { slug: 'pisco_shot', category: 'kuchnia_polska', labelPl: 'Pisco', aliases: ['pisco'], storagePath: 'dania/spirits/spirit_22.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_22.webp') },
  { slug: 'calvados', category: 'kuchnia_polska', labelPl: 'Brandy jabłkowe (Calvados)', aliases: ['calvados', 'brandy jabłkowe'], storagePath: 'dania/spirits/spirit_23.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_23.webp') },
  { slug: 'ice_spheres', category: 'kuchnia_polska', labelPl: 'Miseczka z lodowymi kulami', aliases: ['ice spheres', 'kule lodu'], storagePath: 'dania/spirits/spirit_24.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_24.webp'), recipeEligible: false },
  { slug: 'cytrusy_do_szotow', category: 'kuchnia_polska', labelPl: 'Miseczka z cząstkami cytrusów', aliases: ['cząstki cytrusów', 'limonka cytryna'], storagePath: 'dania/spirits/spirit_25.webp', localAsset: require('@/assets/premium/dishes/spirits/spirit_25.webp'), recipeEligible: false },
];
