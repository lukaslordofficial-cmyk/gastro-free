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
