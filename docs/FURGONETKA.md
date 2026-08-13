# Furgonetka — automatyczna wysyłka LP

Jedno konto Furgonetki **platformy** (Gastro Manager) zleca InPost Kurier:
nadawca = dystrybutor, odbiorca = restauracja. Koszt etykiety schodzi ze skarbonki prepaid.
Dystrybutor **nie** płaci osobno za kuriera — restaurator już zapłacił dostawę w Stripe.

Nie budujemy osobnego OAuth per dystrybutor i nie trzymamy sekretów w Expo / WWW.

## Co musi być na Railway (backend gastro-18)

```
FURGONETKA_CLIENT_ID=
FURGONETKA_CLIENT_SECRET=
FURGONETKA_EMAIL=
FURGONETKA_PASSWORD=
```

Opcjonalnie: `FURGONETKA_INPOST_SERVICE_ID`, `FURGONETKA_LABEL_PAGE=a6`, `FURGONETKA_SANDBOX=1` (tylko testy).

**Kalkulator stawek / „Client authentication failed”:** Client ID i Secret muszą pochodzić z **tego samego** panelu co API.
Sandbox: aplikacja OAuth z [sandbox.furgonetka.pl](https://sandbox.furgonetka.pl) + `FURGONETKA_SANDBOX=1`.
Produkcja: aplikacja z furgonetka.pl, bez SANDBOX.
Albo na testy: `FURGONETKA_MOCK=1` (stawki testowe, bez OAuth).

## Integracja „Własna” (Furgonetka woła nasz sklep)

To **nie** jest REST OAuth (`/packages`). Po zapisaniu formularza Furgonetka odpytuje:

`GET {Adres URL}/orders`

z tokenem w `Authorization: Bearer …` albo `?token=`.

W sandbox.furgonetka.pl → Ustawienia → Integracje → Własne wklej:

| Pole | Wartość |
| --- | --- |
| Nazwa wyświetlana | Gastro Manager |
| Adres URL | `https://gastro-manager-api-production-21dd.up.railway.app/api/furgonetka` |
| Token | `FURGONETKA_SHOP_TOKEN` albo token sandbox `gm_furg_shop_7c9e4a2b18f04d6e9a51c3b8d0e27f14` |
| Synchronizacja zamówień | włącz |
| Wysyłaj informacje o przesyłce | włącz (stub `PUT /orders/{id}` zwraca 200) |

Na początek API zwraca `{ "orders": [] }` (HTTP 200) — test połączenia ma przejść nawet bez tokenu w GET. Token jest wymagany przy PUT (status przesyłki).
Jeśli Railway ma inny `FURGONETKA_SHOP_TOKEN`, token sandbox z tabeli powyżej nadal jest akceptowany.

Skąd wziąć:

1. Konto firmowe na [furgonetka.pl](https://furgonetka.pl) + doładowanie skarbonki prepaid.
2. Włącz **InPost Kurier** na koncie (umowa Furgonetki, nie własna umowa InPost — chyba że ustawisz `FURGONETKA_INPOST_SERVICE_ID`).
3. Zarejestruj aplikację OAuth2 w panelu Furgonetki (dokumentacja: https://furgonetka.pl/api/rest).
   - Grant: `password` (login e-mail + hasło konta platformy).
   - Client ID + Client Secret → Railway.
4. [WYMAGA KONFIGURACJI PO STRONIE FURGONETKI] marketplace: wiele różnych adresów nadania. Potwierdź z Furgonetką, że konto może nadawać z adresów dystrybutorów (to standard w API, ale umowa handlowa bywa osobna).

Po deployu: `GET /api/local-producers/commerce-status` → `furgonetka_configured: true`.

## Baza (Supabase)

Uruchom `supabase_migrations/ADD_LP_FURGONETKA_TRACKING.sql`
(pickup_date, tracking_state, label_storage_path, shipping_error, …).

## Panel WWW (gastro-manager-landing)

W Vercel:

```
GASTRO_API_URL=https://<twoj-backend>.up.railway.app
```

(plus istniejące `SUPABASE_*`). Etykieta: `/api/producent/label` — PDF z Storage albo proxy do Railway.

Przy produkcie uzupełnij **wagę jednostki (g)** albo sprzedawaj w `kg`.

Profil dystrybutora musi mieć: telefon, e-mail, ulica+numer, kod, miasto. Bez tego przesyłka **nie** powstanie (nie podstawiamy Warszawy 00-001).

## Flow po płatności

paid → waga z pozycji → validate → POST /packages → PUT /order-commands
→ PDF etykiety do Storage → POST pickup-date-proposals → PUT /pickup-commands
→ tracking GET /packages/{id}/tracking (apka odświeża przy otwarciu zamówienia).

Idempotencja: ten sam `order_id` nie tworzy drugiej przesyłki.

## Test ręczny

1. Dystrybutor: pełny adres + produkt z wagą.
2. Restaurator: zamów i zapłać (Stripe).
3. W Furgonetce pojawia się przesyłka InPost.
4. Panel dystrybutora: **Pobierz etykietę** (prawdziwy PDF, nie stub).
5. Widać okno podjazdu (data + przedział, nie „za 2 godziny”).
6. Apka: timeline Dostawa + numer przesyłki.
