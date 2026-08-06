/**
 * Plansza 25 placeholderów kategorii dań (Priority A + B).
 * Plik źródłowy: assets/premium/dish_category_placeholders_sheet_25.png
 * Cięcie na pojedyncze slugi — kolejny etap (nie Local Producers).
 *
 * Siatka 5×5, wierszami L→P:
 */
export const DISH_CATEGORY_PLACEHOLDER_SHEET = {
  path: 'assets/premium/dish_category_placeholders_sheet_25.png',
  cols: 5,
  rows: 5,
  /** Kolejność komórek (0-based index = row*5+col) → docelowy slug placeholder_*. */
  cells: [
    'placeholder_pizza',
    'placeholder_pierogi',
    'placeholder_kluski',
    'placeholder_pasta',
    'placeholder_burger',
    'placeholder_steak',
    'placeholder_kebab',
    'placeholder_sushi',
    'placeholder_soup',
    'placeholder_salad',
    'placeholder_focaccia',
    'placeholder_placki',
    'placeholder_bbq',
    'placeholder_wok',
    'placeholder_indian',
    'placeholder_mexican',
    'placeholder_breakfast',
    'placeholder_dessert',
    'placeholder_tomato_soup',
    'placeholder_sides',
    'placeholder_fish',
    'placeholder_kids',
    'placeholder_coffee',
    'placeholder_georgian',
    'placeholder_vegan',
  ] as const,
} as const;
