/**
 * Wskazówki pomiaru kuchni (PL) — noże, naklejki na garnki, wagowość.
 * Sklep: placeholder (bez e-commerce).
 */

export type KnifeGuideRow = {
  knife: string;
  use: string;
};

/** Krótki przewodnik: który nóż do czego. */
export const KNIFE_GUIDE: KnifeGuideRow[] = [
  { knife: 'Nóż szefa (chef)', use: 'Krojenie, siekanie, porcjowanie mięsa i warzyw' },
  { knife: 'Nóż filetowy', use: 'Filetowanie ryb, cienkie plastry, oddzielanie skóry' },
  { knife: 'Nóż do chleba', use: 'Pieczywo, miękkie owoce — ząbkowane ostrze' },
  { knife: 'Nóż boning / trybownik', use: 'Oddzielanie mięsa od kości, trybowanie' },
  { knife: 'Nóż santoku', use: 'Warzywa, zioła, precyzyjne krojenie' },
  { knife: 'Nóż obierak', use: 'Obieranie, detale, dekoracje' },
];

export const POT_STICKER_CONCEPT = {
  title: 'Naklejki na garnki / skala na ścianie',
  body:
    'Ustaw garnki w linii od małego do dużego. Na każdym zaznacz znaki objętości (np. 1 l, 2 l, 5 l) — albo jedną skalę na ścianie przy stanowisku. Przy zupach i sosach odczytujesz litraż „na oko” z garnka, bez zgadywania.',
};

export const MEASUREMENT_TIPS: string[] = [
  'Mięso porcjuj na wadze — celuj w margines 5–10 g.',
  'Waż straty przed wpisem do raportu — nie zgaduj gramatury.',
  'Płyny (zupy, sosy, buliony): używaj znaków objętości na garnku zamiast „na oko”.',
  'Przy odpadach warzyw waż też odpad — food cost lubi prawdę.',
];

/** Placeholder sklepu — jedna linia, bez e-commerce. */
export const SHOP_PLACEHOLDER =
  'Naklejki Gastro Manager — wkrótce w sklepie';

export const SHOP_AFFILIATE_NOTE =
  'Linki afiliacyjne pojawią się później — na razie tylko zapowiedź.';
