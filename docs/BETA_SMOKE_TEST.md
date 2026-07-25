# Smoke test — zamknięta beta dla restauratorów

**Smoke test** = krótki, ręczny przebieg „happy path”: sprawdzasz, że główne ścieżki działają od końca do końca. To **nie** jest pełne QA (brak przypadków brzegowych, regresji, obciążenia).

Czas: ok. **10–15 minut**. Środowisko: APK z backendem dostępnym publicznie (lub ta sama sieć LAN + `EXPO_PUBLIC_BACKEND_URL`).

---

## Checklist (5–8 kroków)

1. **Logowanie / start** — otwórz aplikację, zaloguj się (lub wejdź na konto restauracji). Sesja powinna trzymać się po zamknięciu i ponownym otwarciu.
2. **Magazyn** — dodaj produkt (lub otwórz istniejący), ustaw ilość; opcjonalnie dodaj partię z datą ważności (T−1 / T−2 / T−3).
3. **Menu** — otwórz zakładkę Menu, dodaj lub edytuj danie (nazwa + cena). Sprawdź, że lista się odświeża.
4. **Expiry / tipy Jarvis** — w Jarvisie zapytaj o produkty kończące się wkrótce (np. „co kończy się wkrótce?”). Powinna pojawić się drabina z tipami (nie sam pusty komunikat błędu).
5. **Dostawcy** — otwórz Dostawcy, sprawdź listę; uzupełnij **czas dostawy** u co najmniej jednego dostawcy (lub dodaj nowego).
6. **Łowca Okazji** — uruchom porównanie / optymalizację zamówienia (nawet na małym zestawie braków). Aplikacja nie powinna się crashować; wynik lub komunikat o braku danych jest OK.
7. **Receptury (opcjonalnie)** — otwórz recepturę dania: wpis ręczny albo skan OCR (wymaga kredytów AI + backendu).
8. **Płatności (opcjonalnie)** — jeśli testujesz subskrypcję: Stripe **Test mode**, karta `4242 4242 4242 4242`. **Nie używaj prawdziwej karty.**

---

## Co zgłosić, jeśli coś nie działa

- Krok numer + zrzut ekranu / dokładny komunikat błędu  
- Czy masz internet i czy backend odpowiada (funkcje AI / głos / Łowca wymagają API)  
- Wersja APK / data otrzymania linku  

Pełniejsza checklista techniczna (dla zespołu): `docs/BETA_READINESS_CHECKLIST.md`.
