# Plan: tipy Zero Waste przy zbliżającym się terminie (T-3 / T-2 / T-1)

Dokument roboczy dla Gastro Manager. Cel: podpowiedzi operacyjne, kuchenne i marketingowe, gdy partia magazynowa lub danie z karty zbliża się do końca ważności. Powiadomienia push / auto-gry — w kolejnych fazach.

**Seed maszynowy:** `frontend/lib/expiryTipsCatalog.ts`

---

## Stan obecny w kodzie (stan na plan)

| Obszar | Co jest | Czego brak |
|--------|---------|------------|
| Partie + daty | `warehouse_inventory` (`expiration_date`, `status`, `alert_triggers` domyślnie `{7,3,1}`) | — |
| Status DB | `warning` gdy `expiration_date <= CURRENT_DATE + 3` (kalendarzowe dni) | Status ≠ tip; tipy jeszcze niepodpięte do UI |
| Cron / alerty | Edge `expiry-daily-cron` + backend scheduler: alert gdy `days_left ∈ alert_triggers` lub 0; zapis do `warehouse_expiry_alerts`; Expo push z prostym komunikatem | Treść alertu ogólna („Użyj go!”); brak tipów per kategoria |
| UI edycji | `ProductExpiryEditor`, skan dat, lokalne `scheduleExpiryReminders` (9:00, dni z `alertDays`) | Brak panelu tipów przy produkcie / alercie |
| Jarvis | Intent `list_expiring_soon` — drabina + **3 sztywne tipy** (T≤1 agresywnie, T=2 HH, T≥3 łagodnie) | Nie używa `pickExpiryTips` / katalogu / gier |
| Katalog tipów | Seed + `pickExpiryTips` + `SAFE_GAMES` + forfeity (w tym nowe gry) | **Nie podpięty** do Jarvis / push / PDF |
| HACCP | `frontend/lib/haccpTips.ts` + `_HACCP_RULES` w backendzie — przechowywanie/temp | Osobny katalog; nie fazy T-n |
| Kategorie mag. | Systemowe: m.in. `Warzywa i owoce`, `Nabiał`, `Mięso i wędliny`, `Suchy magazyn`; UI też: `Warzywa`, `Pieczywo`, `is_combo_polprodukt` | Mapowanie → 7 packów tipów (poniżej) |
| Menu | `Zupy`, `Dania główne`, `Makarony` itd. | Pack `mains` / `semi` przez kategorię menu + flagę półproduktu |

**Wniosek:** infrastruktura dat i alertów (T-7/T-3/T-1 + lokalne) jest gotowa. Seed tipów/gier jest rozbudowany. Phase 1 UI = podpięcie `pickExpiryTips` pod istniejącą drabinę / alert — **jeszcze TODO**.

---

## A. Model wyświetlania

### Definicje faz

Zgodnie z kodem (`days_left = floor((exp_date 00:00 − today 00:00) / 86400000)` — **dni kalendarzowe**, nie godziny):

| Faza | `days_left` | Znaczenie |
|------|-------------|-----------|
| **T-3** | `3` | Zostały 3 pełne dni kalendarzowe do daty na etykiecie (włącznie z dziś jako dniem 0 przy `days_left === 0`) |
| **T-2** | `2` | 2 dni |
| **T-1** | `1` | 1 dzień (jutro kończy się ważność) |
| T-0 | `0` | Kończy się **dziś** — poza tym katalogiem tipów (osobny alert krytyczny już w cronie) |

**Uwaga:** użytkownik może włączyć też alert 7 / 5 / 14 w `ProductExpiryEditor`. Tip packi T-3/T-2/T-1 uruchamiamy gdy `days_left ∈ {3,2,1}`. Przy alert_triggers bez 3 — tip T-3 nie pokazuje się automatycznie (można później dodać soft-hint w drabinie Jarvis).

Status DB `warning` obejmuje też T-0…T-3 łącznie; **tipy fazowe** i tak filtrujemy po dokładnym `days_left`.

### Priorytet typów tipu (kolejność slotów)

1. **ops** — FIFO, kontrola partii, etykiety, bezpieczeństwo żywności  
2. **kitchen** — przeróbka, danie dnia, wykorzystanie w produkcji  
3. **marketing** — promocja w lokalu / na menu (bez gry)  
4. **social** — treść do social (głównie T-2)  
5. **game_safe** — bezpieczna gra/konkurs (głównie T-1 w lokalu; T-2 social-contest / grupowe)

Przy alercie dziennym: najpierw 1× ops lub kitchen, potem opcjonalnie 1× marketing/social/game.

### Limity (caps)

| Reguła | Wartość |
|--------|---------|
| Max tipów na produkt/partię/dzień | **3** |
| Preferencja | tipy **kategorii** > `general` |
| Deduplikacja | ten sam `id` max 1× / 7 dni / restauracja (Phase 4 analytics) |
| Gry | max **1** `game_safe` na produkt/dzień |
| Social | max **1** `social` na produkt/dzień |
| Legal review | tipy z `requires_legal_review` **nie** wchodzą do `pickExpiryTips` (tylko jawny wybór) |
| Menu dish vs składnik | jeśli źródło = danie karty → pack `mains` lub `semi`; składnik magazynu → pack surowca |

### Mapowanie kategorii aplikacji → pack tipów

| Pack (`category`) | Nazwa PL | Źródła w aplikacji |
|-------------------|----------|-------------------|
| `general` | Ogólne / system | brak kategorii, `Inne`, `Ogólnospożywczy`, chemia/opakowania (tylko tipy ops bez kulinarnych) |
| `produce` | Warzywa i owoce | `Warzywa i owoce`, `Warzywa`, nazwy zawierające sałata/pomidor/owoc… |
| `dairy` | Nabiał | `Nabiał`, `Nabiał & Sery` |
| `meat_fish` | Mięso i ryby | `Mięso i wędliny`, `Mięso`, `Mrożonki` (gdy nazwa sugeruje mięso/rybę), klucze HACCP ryby/mięso |
| `dry_bread` | Pieczywo i suche | `Pieczywo`, `Suchy magazyn`, `Suche & Sypkie`, mąka/makaron/ryż/kasza |
| `mains` | Dania główne | pozycje menu: `Zupy`, `Dania główne`, `Dania obiadowe`, `Makarony`, `Burgery`, `Pizza` / `Pizze` gdy śledzimy „ważność partii dania” / gotowca |
| `semi` | Półprodukty | `is_combo_polprodukt === true`, sosy/wywary/gulasze (klucze jak HACCP `polprodukt`) |

Funkcja mapująca (Phase 1): `resolveExpiryTipCategory({ inventoryCategoryName, menuCategory, isComboPolprodukt, productName })`.

### Filtry gier: tagi i typ lokalu

Restaurator wybiera gry i **customizuje forfeity** pod charakter lokalu:

| Tag | Typowo | Przykład lokalu |
|-----|--------|-----------------|
| `#szybka` | &lt; 60 s, bar / stolik | bistro, bar |
| `#grupowa` | stół 3+ osób | pub, food hall |
| `#śmieszna` | humorystyczny forfeit | pub studencki, casual |
| `#odważna` | wyższy próg wstydu / negocjacja | pub studencki; **nie** domyślnie w eleganckim bistro |

Pola w seed (`SafeGameTemplate` / tip `game_safe`):

- `tags: string[]` — filtr UI  
- `venue_fit?: 'bar' | 'table' | 'social' | 'any'`  
- `duration_sec?`  
- `custom_forfeit_allowed: true` — restaurator może podmienić forfeit z listy / własny  
- `requires_legal_review?` — wariant nie wchodzi do auto-pick  
- `mechanic`: `skill` | `everyone_wins` | `social_contest` | `gentleman` | `negotiation`

**Eleganckie bistro:** wyłącz `#odważna` / `#śmieszna`, zostaw quiz, zgadnij wagę, kostka bonusu, social contest.  
**Pub studencki:** włącz Jenga, kciuki, Czarne/Czerwone, opcjonalnie bold forfeity za zgodą.

---

## B. Tabela triggery (skrót)

| Faza | Kategoria | Typ tipu | Kiedy | Przykład ID |
|------|-----------|----------|-------|-------------|
| T-3 | * | ops | days_left=3 | `gen-t3-ops-fifo` |
| T-3 | * | kitchen | days_left=3 | `prod-t3-kit-prep` |
| T-3 | * | marketing | days_left=3 | `gen-t3-mkt-soft` |
| T-3 | * | game_safe (negocjacja) | days_left=3 | `game-t3-blind-bid` |
| T-2 | * | kitchen / marketing | days_left=2 | `dairy-t2-kit-special` |
| T-2 | * | social | days_left=2 | `gen-t2-soc-story` |
| T-2 | * | game_safe | days_left=2 | `game-t2-jenga`, `game-t2-kalambury` |
| T-1 | * | ops / kitchen | days_left=1 | `meat-t1-kit-urgent` |
| T-1 | * | marketing | days_left=1 | `mains-t1-mkt-hh` |
| T-1 | * | game_safe (in-venue) | days_left=1 | `game-t1-rps-skill`, `game-t1-czarne-czerwone` |

Pełna lista ID: w pliku seed.

---

## C. Treści szablonów

Pola tipu: `id`, `phase` (`t3`\|`t2`\|`t1`), `category`, `kind`, `title`, `body`, `cta_label?`, `legal_note?`, `variables`, opcjonalnie `tags`, `venue_fit`, `duration_sec`, `custom_forfeit_allowed`, `requires_legal_review`.

Zmienne: `{{product_name}}`, `{{qty}}`, `{{unit}}`, `{{dish_name}}`, `{{restaurant_name}}`.

Tone: praktyczny, Zero Waste, bez straszenia karami, bez „hazardu”. Szczegółowe treści — w `expiryTipsCatalog.ts`.

### Zasady redakcyjne

- Jedna myśl na tip; konkretna akcja w 1–3 zdaniach.  
- Unikać duplikatów typu „zrób promocję” bez kontekstu kategorii.  
- Marketing: nigdy nie sugerować sprzedaży produktu po terminie lub z naruszeniem HACCP.  
- Gry: tylko warianty z sekcji D.

---

## D. Gry / promocje (legalnie bezpieczne)

### Zasady twarde

1. **Zakaz** czystego losowania z ryzykiem finansowym (moneta, kostka „kup albo nie”, loteria wśród komentarzy, **wymuszonego zakupu**).  
2. **Skill / konkurs:** P-K-N, zgadnij wagę, pytanie o danie, kciuki, stoper, kalambury, Jenga.  
3. **Everyone wins:** kostka/ruletka/kubki tylko ustalają **wielkość bonusu**; gość **nigdy nie płaci więcej niż cena z menu**.  
4. **Social:** „pierwszy komentarz z przepisem…”, „najciekawsza historia” — kryterium, **nie** losowanie.  
5. **Gentleman / forfeit:** przegrana → cena menu + **humorystyczna, niefinansowa** konsekwencja.  
6. **Negocjacja:** „licytacja w ciemno” = dobrowolna oferta, szef akceptuje/odrzuca — **nie** gra losowa.  
7. Udział zawsze **dobrowolny** — gość może odejść i kupić po cenie menu.  
8. Aplikacja **sugeruje pomysły**; restaurator odpowiada za zgodność z lokalnym prawem (gry / promocje / alkohol / RODO).

### Szablony gier (seed: `SAFE_GAMES`)

| ID | Faza | Tagi | Mechanika | Uwagi |
|----|------|------|-----------|-------|
| `game-t2-first-comment` | T-2 | `#szybka` | social_contest | Kryterium, nie los |
| `game-t2-creative-caption` | T-2 | `#grupowa` `#śmieszna` | social_contest | Jury lokalu |
| `game-t1-rps-skill` | T-1 | `#szybka` `#śmieszna` | skill | Forfeit humor |
| `game-t1-guess-weight` | T-1 | `#szybka` | skill | — |
| `game-t1-chef-quiz` | T-1 | `#szybka` | skill | — |
| `game-t1-dice-bonus` | T-1 | `#szybka` `#śmieszna` | everyone_wins | Tylko % bonusu |
| `game-t1-gentleman` | T-1 | `#śmieszna` `#odważna` | gentleman | — |
| `game-t1-czarne-czerwone` | T-1 | `#szybka` `#śmieszna` | skill | Win ~80%; lose = menu + wachlowanie podkładką (opcjonalnie) |
| `game-t1-thumb-war` | T-1 | `#szybka` `#śmieszna` | skill | Win 50–80%; lose = ogłoszenie kciuka |
| `game-t1-stopwatch` | T-1 | `#szybka` | skill | Tier rabatu; lose = salut |
| `game-t2-jenga` | T-2 | `#grupowa` `#śmieszna` | skill | Wieża = ~50% stołu; breaker = pełna cena + „Sto lat” |
| `game-t2-kalambury` | T-2 | `#grupowa` | skill | Win ~60%; lose = mime |
| `game-t1-3kubki-bonus` | T-1 | `#szybka` `#odważna` | everyone_wins | **Preferowany** wariant 3 Kubków |
| `game-t1-3kubki-shell` | T-1 | `#szybka` `#odważna` | (losowa) | `requires_legal_review` — nie w auto-pick; preferuj bonus |
| `game-t1-blind-bid` | T-3…T-1 | `#odważna` | negotiation | Tipy też jako `game-t3/t2/t1-blind-bid` |

### 3 Kubki — dwa warianty

1. **Preferowany (`game-t1-3kubki-bonus`):** pod każdym kubkiem jest bonus; gość zawsze wygrywa co najmniej minimum; nikt nie płaci powyżej menu.  
2. **Klasyczna skorupka (`game-t1-3kubki-shell`):** oznaczona `requires_legal_review`; silny disclaimer; nie rekomendować jako domyślnej promocji z obowiązkiem zakupu.

### Licytacja w ciemno

To **nie hazard**, jeśli framed jako dobrowolna oferta → akceptacja/odrzucenie przez szefa (negocjacja).  
Domyślne forfeity: łagodne z `HUMOROUS_FORFEITS` / `SAFE_FORFEITS`.  
**Nie** używać domyślnie surowych forfeitów (surowa pepperoni, lemon shot).  
`BOLD_OPTIONAL_FORFEITS` (Makarena / kaczuszki) — tylko za wyraźną zgodą gościa, osobno od domyślnej listy.

### Lista forfeitów (niefinansowe)

Źródło: `HUMOROUS_FORFEITS` (= alias `SAFE_FORFEITS`) + opcjonalnie `BOLD_OPTIONAL_FORFEITS`.

Przykłady: rymowanka, dad joke, toast Zero Waste, story IG (za zgodą), wachlowanie barmana podkładką, ogłoszenie kciuka, salut, „Sto lat”, pantomima, chef’s clap.

Restaurator **wybierá i customizuje** forfeity pod lokal (`custom_forfeit_allowed: true`).

### Zarys regulaminu (PDF — Phase 3)

Placeholdery: `{{restaurant_name}}`, `{{promo_name}}`, `{{valid_from}}`, `{{valid_to}}`, `{{prize_description}}`, `{{participation_rules}}`, `{{organizer_address}}`, `{{contact_email}}`, klauzula: to nie loteria / nie gra hazardowa; udział dobrowolny; nagroda nie przekracza wartości wskazanej; alkohol — osobne reguły 18+.

**Nie implementujemy pełnego push/PDF w tej iteracji** — tylko seed + plan.

### Disclaimer ToS (tekst do aplikacji)

> Gastro Manager podpowiada pomysły marketingowe i operacyjne związane z ograniczaniem marnowania żywności. Organizacja promocji, konkursów i komunikacja z gośćmi leży po stronie restauratora, który odpowiada za zgodność z obowiązującym prawem (w tym przepisami o grach i loteriach, ochronie konsumentów, RODO oraz sprzedażą alkoholu). Aplikacja nie stanowi porady prawnej.

Stała w kodzie: `EXPIRY_TIPS_LEGAL_DISCLAIMER`.

---

## E. Plan wdrożenia

### Phase 1 — seed + UI (seed gotowy; UI TODO)

1. ~~Import `expiryTipsCatalog.ts` + helper `pickExpiryTips`.~~ (seed)  
2. Podpięcie pod: wynik Jarvis `list_expiring_soon` (zamiast 3 sztywnych stringów) oraz opcjonalnie baner przy `ProductExpiryEditor` / liście warning.  
3. Bez nowego systemu powiadomień.  
4. Filtr tagów / `venue_fit` w UI wyboru gry (opcjonalnie w tym samym PR co wire).

### Phase 2 — powiadomienia

1. Rozszerzyć treść push w `expiry-daily-cron` / schedulerze o 1 tip (ops/kitchen) z katalogu.  
2. Payload: `{ type: 'expiry', tip_id, product_name, days_left }`.  
3. Deep-link do produktu / drabiny.

### Phase 3 — social + PDF

1. CTA „Kopiuj post” z szablonów `social`.  
2. Generator PDF regulaminu z placeholdera.  
3. Ekran „Uruchom grę” z checklistą zgodności (disclaimer) + wybór forfeitów.

### Phase 4 — analytics

1. Tabela `expiry_tip_events` (`tip_id`, `restaurant_id`, `action`: shown|copied|dismissed|used).  
2. Ranking najczęściej używanych tipów; rotacja, by nie powtarzać tych samych ID.

---

## F. Szkic schematu przyszłego (SQL / JSON)

Na później (nie migracja w tej iteracji) — szablony w DB zamiast samego seed TS:

```sql
-- Szkic — nie uruchamiać jeszcze
create table if not exists expiry_tip_templates (
  id text primary key,
  phase text not null check (phase in ('t3','t2','t1')),
  category text not null,
  kind text not null check (kind in ('ops','kitchen','marketing','social','game_safe')),
  title text not null,
  body text not null,
  cta_label text,
  legal_note text,
  variables jsonb not null default '[]',
  tags text[] not null default '{}',
  venue_fit text check (venue_fit is null or venue_fit in ('bar','table','social','any')),
  duration_sec int,
  custom_forfeit_allowed boolean not null default false,
  requires_legal_review boolean not null default false,
  active boolean not null default true
);

create table if not exists expiry_game_templates (
  id text primary key,
  phase text not null check (phase in ('t3','t2','t1')),
  phases text[] , -- np. {t3,t2,t1} dla blind-bid
  mechanic text not null,
  title text not null,
  body text not null,
  cta_label text,
  legal_note text,
  variables jsonb not null default '[]',
  tags text[] not null default '{}',
  venue_fit text,
  duration_sec int,
  custom_forfeit_allowed boolean not null default true,
  requires_legal_review boolean not null default false,
  preferred_variant_of text references expiry_game_templates(id),
  active boolean not null default true
);

-- Forfeity per restauracja (custom)
create table if not exists expiry_forfeit_templates (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid, -- null = globalny seed
  body text not null,
  is_bold_optional boolean not null default false,
  active boolean not null default true
);
```

Przykład JSON tipu gry (zgodny z seed TS):

```json
{
  "id": "game-t1-thumb-war",
  "phase": "t1",
  "kind": "game_safe",
  "mechanic": "skill",
  "tags": ["#szybka", "#śmieszna"],
  "venue_fit": "table",
  "duration_sec": 45,
  "custom_forfeit_allowed": true,
  "requires_legal_review": false,
  "title": "Pojedynek na kciuki",
  "body": "…",
  "variables": ["dish_name"]
}
```

---

## Liczniki seed

Źródło prawdy: `EXPIRY_TIPS_STATS` w `frontend/lib/expiryTipsCatalog.ts`.

| Wymiar | Wartości (po rozbudowie gier) |
|--------|-------------------------------|
| Razem tipów | **94** (w tym **17** `game_safe`) |
| Fazy | t3: **29**, t2: **33**, t1: **32** |
| Kategorie | general **28**, produce/dairy/meat_fish/dry_bread/mains/semi po **11** |
| Rodzaje | ops 20, kitchen 29, marketing 21, social 7, game_safe 17 |
| `SAFE_GAMES` | **15** szablonów (w tym **1** `requires_legal_review`) |
| Forfeity łagodne | **14** (`HUMOROUS_FORFEITS` / `SAFE_FORFEITS`) |
| Forfeity #odważna (opcjonalne) | **2** (`BOLD_OPTIONAL_FORFEITS`) |

Macierz pack × faza (bez osobnego rozbicia gier): większość packów ma **4 / 4 / 3** (t3/t2/t1); `general` ma więcej przez gry T-3/T-2/T-1.

---

## Rekomendowany następny krok implementacji

**Phase 1:** ~~podmienić sztywne stringi~~ — `pickExpiryTips` / `buildExpiryTipsForItem` w `VoiceReportModal` (`list_expiring_soon`); BE `_run_list_expiring_soon` zostawia krótki fallback + `tips_source: frontend_catalog`. Push / PDF — Phase 2–3.
