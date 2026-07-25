# Symulacja strat produktowych 2025

Envs: 4
**Wynik: 4 PASS / 0 FAIL**


## PASS: march_2025_mixed
- Marzec 2025 — mieszane straty (składniki + dania)
- Okno: 2025-03-01 → 2025-03-31
- Zdarzenia strat: 16, suma PLN: **184.18 zł**
- P&L: przychód 52000 − stałe 27800 − straty 184.18 − zmienne_netto 15415.82 = **zysk 8600.00 zł**
- Równoważnie (bez podwójnego liczenia): przychód − stałe − zmienne_brutto = 8600.00 zł
- Błędne podwójne odejmowanie (stara formuła): 8415.82 zł
- Checks: {'net_equals_rev_minus_fixed_minus_var_gross': True, 'not_double_counting_waste': True, 'waste_events_costed': True}

| Data | Typ | Nazwa | Ilość | Jedn. | Koszt PLN |
|------|-----|-------|------:|-------|----------:|
| 2025-03-03 | ingredient | Kurczak filet | 1.2 | kg | 33.60 |
| 2025-03-05 | ingredient | Smietana 30% | 0.5 | l | 6.25 |
| 2025-03-07 | ingredient | Pomidory | 800 | g | 5.20 |
| 2025-03-10 | ingredient | Bulki hamburgerowe | 6 | szt | 10.80 |
| 2025-03-12 | ingredient | Losos | 350 | g | 29.75 |
| 2025-03-15 | ingredient | Oliwa | 250 | ml | 5.50 |
| 2025-03-18 | ingredient | Mleko | 1.0 | l | 4.20 |
| 2025-03-20 | ingredient | Makaron | 0.4 | kg | 3.20 |
| 2025-03-04 | dish | Zupa pomidorowa | 3 | porcja | 5.73 |
| 2025-03-08 | dish | Zupa pomidorowa | 1.5 | l | 8.19 |
| 2025-03-11 | dish | Pasta carbonara | 2 | porcja | 7.65 |
| 2025-03-14 | dish | Burger klasik | 4 | porcja | 25.08 |
| 2025-03-17 | dish | Losos grillowany | 1 | porcja | 15.97 |
| 2025-03-22 | dish | Pasta carbonara | 0.6 | kg | 5.74 |
| 2025-03-25 | ingredient | Salata lodowa | 1.5 | kg | 13.50 |
| 2025-03-28 | dish | Zupa pomidorowa | 2 | porcja | 3.82 |

## PASS: july_2025_peak
- Lipiec 2025 — szczyt sezonu, straty zup/sosów
- Okno: 2025-07-01 → 2025-07-31
- Zdarzenia strat: 12, suma PLN: **562.80 zł**
- P&L: przychód 68500 − stałe 29200 − straty 562.80 − zmienne_netto 19987.20 = **zysk 18750.00 zł**
- Równoważnie (bez podwójnego liczenia): przychód − stałe − zmienne_brutto = 18750.00 zł
- Błędne podwójne odejmowanie (stara formuła): 18187.20 zł
- Checks: {'net_equals_rev_minus_fixed_minus_var_gross': True, 'not_double_counting_waste': True, 'waste_events_costed': True}

| Data | Typ | Nazwa | Ilość | Jedn. | Koszt PLN |
|------|-----|-------|------:|-------|----------:|
| 2025-07-02 | ingredient | Losos | 2.0 | kg | 170.00 |
| 2025-07-05 | ingredient | Smietana 30% | 2.0 | l | 25.00 |
| 2025-07-08 | dish | Zupa pomidorowa | 4.0 | l | 21.83 |
| 2025-07-10 | dish | Sos hollandaise porcja | 12 | porcja | 43.70 |
| 2025-07-12 | ingredient | Sos hollandaise | 1.2 | l | 54.00 |
| 2025-07-15 | dish | Burger klasik | 8 | porcja | 50.16 |
| 2025-07-18 | ingredient | Kurczak filet | 3.5 | kg | 98.00 |
| 2025-07-20 | ingredient | Pomidory | 2500 | g | 16.25 |
| 2025-07-22 | dish | Pasta carbonara | 5 | porcja | 19.12 |
| 2025-07-25 | ingredient | Bulion warzywny | 3.0 | l | 24.00 |
| 2025-07-28 | dish | Losos grillowany | 2 | porcja | 31.94 |
| 2025-07-30 | ingredient | Oliwa | 0.4 | l | 8.80 |

## PASS: year_2025_sample
- Rok 2025 — próbka strat po kwartałach
- Okno: 2025-01-01 → 2025-12-31
- Zdarzenia strat: 20, suma PLN: **413.24 zł**
- P&L: przychód 620000 − stałe 340000 − straty 413.24 − zmienne_netto 185586.76 = **zysk 94000.00 zł**
- Równoważnie (bez podwójnego liczenia): przychód − stałe − zmienne_brutto = 94000.00 zł
- Błędne podwójne odejmowanie (stara formuła): 93586.76 zł
- Checks: {'net_equals_rev_minus_fixed_minus_var_gross': True, 'not_double_counting_waste': True, 'waste_events_costed': True}

| Data | Typ | Nazwa | Ilość | Jedn. | Koszt PLN |
|------|-----|-------|------:|-------|----------:|
| 2025-01-12 | ingredient | Kurczak filet | 0.8 | kg | 22.40 |
| 2025-01-20 | dish | Zupa pomidorowa | 2 | porcja | 3.82 |
| 2025-02-08 | ingredient | Smietana 30% | 750 | ml | 9.38 |
| 2025-02-18 | dish | Burger klasik | 3 | porcja | 18.81 |
| 2025-04-03 | ingredient | Losos | 1.1 | kg | 93.50 |
| 2025-04-15 | dish | Pasta carbonara | 1.2 | l | 11.47 |
| 2025-05-09 | ingredient | Pomidory | 1.0 | kg | 6.50 |
| 2025-05-22 | dish | Losos grillowany | 2 | porcja | 31.94 |
| 2025-06-11 | ingredient | Oliwa | 300 | ml | 6.60 |
| 2025-06-27 | dish | Zupa pomidorowa | 2.5 | l | 13.64 |
| 2025-08-04 | ingredient | Makaron | 2.0 | kg | 16.00 |
| 2025-08-19 | dish | Burger klasik | 6 | porcja | 37.62 |
| 2025-09-07 | ingredient | Salata lodowa | 2.2 | kg | 19.80 |
| 2025-09-21 | dish | Pasta carbonara | 4 | porcja | 15.30 |
| 2025-10-14 | ingredient | Mleko | 2.0 | l | 8.40 |
| 2025-10-28 | dish | Zupa pomidorowa | 5 | porcja | 9.55 |
| 2025-11-09 | ingredient | Kurczak filet | 1.5 | kg | 42.00 |
| 2025-11-23 | dish | Losos grillowany | 1 | porcja | 15.97 |
| 2025-12-12 | ingredient | Bulki hamburgerowe | 10 | szt | 18.00 |
| 2025-12-28 | dish | Burger klasik | 2 | porcja | 12.54 |

## PASS: units_edge_2025
- Krawędzie jednostek g/kg/ml/l/porcja
- Okno: 2025-03-01 → 2025-03-03
- Zdarzenia strat: 5, suma PLN: **24.35 zł**
- P&L: przychód 9000 − stałe 2700 − straty 24.35 − zmienne_netto 2475.65 = **zysk 3800.00 zł**
- Równoważnie (bez podwójnego liczenia): przychód − stałe − zmienne_brutto = 3800.00 zł
- Błędne podwójne odejmowanie (stara formuła): 3775.65 zł
- Checks: {'net_equals_rev_minus_fixed_minus_var_gross': True, 'not_double_counting_waste': True, 'waste_events_costed': True}

| Data | Typ | Nazwa | Ilość | Jedn. | Koszt PLN |
|------|-----|-------|------:|-------|----------:|
| 2025-03-01 | ingredient | Pomidory | 1000 | g | 6.50 |
| 2025-03-01 | ingredient | Smietana 30% | 1000 | ml | 12.50 |
| 2025-03-02 | dish | Zupa pomidorowa | 350 | ml | 1.80 |
| 2025-03-02 | dish | Zupa pomidorowa | 1 | porcja | 1.80 |
| 2025-03-03 | ingredient | Maka | 500 | g | 1.75 |
