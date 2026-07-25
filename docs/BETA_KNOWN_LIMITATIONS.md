# Znane ograniczenia — closed beta

Krótka lista rzeczy, o których warto powiedzieć testerom (restauratorzy / LAN).  
Data: 2026-07-25.

---

## Infrastruktura / dystrybucja

| Ograniczenie | Szczegół |
|--------------|----------|
| **Backend publiczny vs LAN** | APK wymaga `EXPO_PUBLIC_BACKEND_URL` = publiczny HTTPS. Adres LAN działa tylko w tej samej Wi‑Fi. Patrz [`BETA_PRODUCTION_BACKEND.md`](./BETA_PRODUCTION_BACKEND.md). |
| **Tunel ≠ produkcja** | Quick tunnel (localtunnel / cloudflared / serveo) wystarczy na smoke kilku testerów; URL pada po restarcie PC. Na skalę → Railway/Render/Fly + Docker z repo. |
| **Auth + tenant** | Po migracji `ADD_TENANT_ISOLATION.sql` magazyn/menu/dostawcy są per `account_key`. Bez tej migracji dane mogą być wspólne. Patrz [`BETA_AUTH.md`](./BETA_AUTH.md). |
| **Push zdalny** | Lokalne przypomnienia dat ważności OK; Expo Push wymaga `projectId` (EAS) + tokenów w DB + crona. Web zwykle bez tokena. |
| **GitHub / Railway** | Po pushu do `Gastro-Manager-15` podłącz Railway (Root = `backend` lub root `railway.toml`). |

## Płatności / kredyty

| Ograniczenie | Szczegół |
|--------------|----------|
| **Stripe = Test mode** | Tylko `sk_test_` / `pk_test_`. Karta: `4242…`. Live keys dopiero przy płatnych pilotach. |
| **Kredyty beta = 1000** | Free / startowy pakiet: **1000** kredytów AI na nowe konto (trigger + fallback w appce). |
| **Legacy `default`** | Stary portfel `account_key='default'` zostaje dla seedów / fallbacku backendu bez nagłówka. |

## Produkt (świadomie niedokończone)

| Ograniczenie | Szczegół |
|--------------|----------|
| **Reliability Score** | Karta dostawcy: „brak danych / wstępna”. Brak formularza ocen dostaw (Faza 4). Łowca nie karze TCO bez historii. |
| **Tipy Zero Waste** | Pełne tipy/gry tylko dla horyzontu **T−3…T−1** (dziś / jutro / za 2–3 dni). Poza tym drabina pokazuje pozycję + komunikat bez tipów. |
| **Gry / loterie** | Tylko warianty `game_safe` + disclaimer; brak PDF regulaminu / „uruchom grę”. |
| **`ExpirationScanModal`** | Plik w repo, **niepodpięty**. Magazyn → FAB „Jak dodać daty?” tłumaczy flow (faktura / głos), bez skanu Vision. |
| **Soft-delete magazynu** | UI + Jarvis usuwają przez `is_active=false` (wymaga migracji `ADD_SOFT_DELETE.sql`). Bez migracji — fallback hard-delete. |
| **OCR / Inspiracje AI** | Wymagają backendu + OpenAI + kredytów; bez tego wpis ręczny. |
| **Dane demo** | Finance/PnL sensowne po seedzie lub realnych wpisach. |

## Co nie jest blokerem smoke’a w LAN

- Lead time NULL → optymalizer używa **2 dni** (bez zapisu do DB).
- Pusty katalog Łowcy → komunikat / wynik pusty, nie crash.
- Stripe checkout w Test mode na urządzeniach z dostępem do API.

Szczegóły gotowości: [`BETA_READINESS_CHECKLIST.md`](./BETA_READINESS_CHECKLIST.md) · smoke: [`BETA_SMOKE_TEST.md`](./BETA_SMOKE_TEST.md) · APK: [`BETA_APK_DISTRIBUTION.md`](./BETA_APK_DISTRIBUTION.md).
