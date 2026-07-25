# Raport multi-env Łowca Okazji

Wygenerowano: 2026-07-22 12:40 UTC

## Wskaźniki oceny

| Metryka | Znaczenie |
|---|---|
| `naive_lower_bound` | Suma najtańszych ofert per SKU (ignoruje min) — dolna granica |
| `oracle_total` | Najtańsze przypisanie **spełniające minima** (enumeracja/beam) |
| `hunter_total` | Koszt rekomendowanego scenariusza Łowcy (produkty+dostawa) |
| `optimality_gap` | hunter − oracle (≈0 = optymalny przy meets-min) |
| `PASS_OPTIMAL` | gap ≤ 1 zł |
| `PASS_NEAR_OPTIMAL` | gap ≤ max(25 zł, 5% oracle) |
| `PASS_NO_FEASIBLE` | brak wykonalnego koszyka — Łowca nie forsuje |
| `REVIEW_*` / `FAIL_*` | wymaga analizy / złamanie reguł |

## Podsumowanie

| Środowisko | Zadanie | Werdykt | Hunter | Oracle | Gap | Dostawcy |
|---|---|---|---:|---:|---:|---:|
| full_coverage | weekly_restock | **PASS_OPTIMAL** | 1037.0 | 1037.0 | 0.0 | 1 |
| full_coverage | meat_only | **PASS_OPTIMAL** | 489.0 | 489.0 | 0.0 | 1 |
| full_coverage | dairy_bulk | **PASS_OPTIMAL** | 402.2 | 402.2 | 0.0 | 1 |
| full_coverage | veg_pantry | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| full_coverage | single_category_meat | **PASS_OPTIMAL** | 901.0 | 901.0 | 0.0 | 1 |
| full_coverage | mixed_small | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| sparse_catalog | full_menu_restock | **PASS_OPTIMAL** | 621.8 | 621.8 | 0.0 | 1 |
| sparse_catalog | specialty_trap | **PASS_NO_FEASIBLE** | 122.0 | None | None | 1 |
| sparse_catalog | veg_heavy | **PASS_OPTIMAL** | 293.5 | 293.5 | 0.0 | 1 |
| sparse_catalog | missing_product | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| sparse_catalog | meat_vs_carry | **PASS_OPTIMAL** | 752.0 | 752.0 | 0.0 | 1 |
| sparse_catalog | specialty_only_order | **PASS_OPTIMAL** | 249.0 | 249.0 | 0.0 | 1 |
| sparse_catalog | dairy_dry_combo | **PASS_OPTIMAL** | 272.3 | 272.3 | 0.0 | 1 |
| uneven_mins | small_order_avoid_bigmin | **PASS_OPTIMAL** | 128.0 | 128.0 | 0.0 | 1 |
| uneven_mins | large_order_use_cheap | **PASS_OPTIMAL** | 1155.0 | 1155.0 | 0.0 | 1 |
| uneven_mins | forced_local_sku | **PASS_OPTIMAL** | 231.8 | 231.8 | 0.0 | 1 |
| uneven_mins | mid_threshold | **PASS_OPTIMAL** | 311.0 | 311.0 | 0.0 | 1 |
| uneven_mins | almost_bigmin | **PASS_OPTIMAL** | 827.0 | 827.0 | 0.0 | 1 |
| single_supplier | enough_for_min | **PASS_OPTIMAL** | 463.0 | 463.0 | 0.0 | 1 |
| single_supplier | below_min_hard | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| single_supplier | below_min_soft | **PASS_NO_FEASIBLE** | 257.0 | None | None | 1 |
| single_supplier | all_items_small | **PASS_NO_FEASIBLE** | 258.0 | None | None | 1 |
| zero_mins | cheapest_per_sku | **PASS_OPTIMAL** | 523.0 | 523.0 | 0.0 | 1 |
| zero_mins | free_shipping_threshold | **PASS_OPTIMAL** | 650.0 | 650.0 | 0.0 | 1 |
| zero_mins | single_cheap_item | **PASS_OPTIMAL** | 83.0 | 83.0 | 0.0 | 1 |
| all_high_mins | consolidate_one | **PASS_OPTIMAL** | 1005.0 | 1005.0 | 0.0 | 1 |
| all_high_mins | too_small | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| all_high_mins | one_fill_basket | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| exclusive_partition | full_partition | **PASS_OPTIMAL** | 429.0 | 429.0 | 0.0 | 1 |
| exclusive_partition | meat_only_gap | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| exclusive_partition | veg_dry_combo | **PASS_NO_FEASIBLE** | 159.5 | None | None | 1 |
| exclusive_partition | dry_heavy | **PASS_OPTIMAL** | 284.8 | 284.8 | 0.0 | 1 |
| shipping_dominates | small_local_wins | **PASS_NO_FEASIBLE** | 108.4 | None | None | 1 |
| shipping_dominates | large_far_wins | **PASS_OPTIMAL** | 1044.5 | 1044.5 | 0.0 | 1 |
| shipping_dominates | mixed_shipping_tradeoff | **PASS_OPTIMAL** | 410.5 | 410.5 | 0.0 | 1 |
| gap_boundary | gap_95_soft | **PASS_NO_FEASIBLE** | 316.0 | None | None | 1 |
| gap_boundary | gap_105_hard | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| gap_boundary | fill_to_min | **PASS_OPTIMAL** | 386.8 | 386.8 | 0.0 | 1 |
| gap_boundary | exact_boundary | **PASS_NO_FEASIBLE** | 310.0 | None | None | 1 |
| price_ties | all_tied_split | **PASS_OPTIMAL** | 439.0 | 439.0 | 0.0 | 1 |
| price_ties | monolith_preferred | **PASS_OPTIMAL** | 550.0 | 550.0 | 0.0 | 1 |
| price_ties | tie_small_order | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| expensive_monopolist | meat_budget_only | **PASS_OPTIMAL** | 526.0 | 526.0 | 0.0 | 1 |
| expensive_monopolist | veg_monopolist_only | **PASS_NO_FEASIBLE** | 192.5 | None | None | 1 |
| expensive_monopolist | full_menu_split | **PASS_OPTIMAL** | 515.0 | 515.0 | 0.0 | 2 |
| expensive_monopolist | avoid_monopolist_if_possible | **PASS_OPTIMAL** | 325.0 | 325.0 | 0.0 | 1 |
| fine_dining | tasting_menu | **PASS_OPTIMAL** | 994.0 | 994.0 | 0.0 | 2 |
| fine_dining | luxury_trap | **PASS_NO_FEASIBLE** | 135.0 | None | None | 1 |
| fine_dining | single_premium | **PASS_OPTIMAL** | 942.0 | 942.0 | 0.0 | 2 |
| fast_volume | weekly_volume | **PASS_OPTIMAL** | 1162.0 | 1162.0 | 0.0 | 1 |
| fast_volume | sauce_packaging | **PASS_OPTIMAL** | 460.0 | 460.0 | 0.0 | 1 |
| fast_volume | burger_day | **PASS_OPTIMAL** | 860.5 | 860.5 | 0.0 | 1 |
| many_suppliers_chaos | chaos_full | **PASS_OPTIMAL** | 294.5 | 294.5 | 0.0 | 1 |
| many_suppliers_chaos | limit_suppliers | **PASS_NO_FEASIBLE** | 158.0 | None | None | 1 |
| many_suppliers_chaos | s3_s5_overlap | **PASS_OPTIMAL** | 419.4 | 419.4 | 0.0 | 1 |
| many_suppliers_chaos | orphan_skus | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| scarce | all_missing | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| scarce | partial_one_offer | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| scarce | two_items_feasible | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
| scarce | ghost_product_in_list | **PASS_NO_FEASIBLE** | 0.0 | None | None | 0 |
