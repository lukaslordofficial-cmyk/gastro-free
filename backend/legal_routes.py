"""Publiczne /privacy i /terms — URL-e do Google Play i linków w apce."""
from __future__ import annotations

import os
from html import escape

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["legal"])

_UPDATED = "27 sierpnia 2026"


def _operator() -> dict[str, str]:
    name = (os.getenv("LEGAL_OPERATOR_NAME") or "Gastro Manager").strip() or "Gastro Manager"
    email = (os.getenv("LEGAL_CONTACT_EMAIL") or os.getenv("RESEND_FROM_EMAIL") or "").strip()
    address = (os.getenv("LEGAL_OPERATOR_ADDRESS") or "").strip()
    nip = (os.getenv("LEGAL_OPERATOR_NIP") or "").strip()
    return {"name": name, "email": email, "address": address, "nip": nip}


def _shell(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{escape(title)}</title>
<style>
body{{font-family:system-ui,Segoe UI,sans-serif;max-width:42rem;margin:0 auto;padding:24px 18px 64px;
background:#0A120E;color:#F5F5F5;line-height:1.55}}
a{{color:#7CFFB2}} h1{{font-size:1.45rem}} h2{{font-size:1.05rem;margin-top:1.6rem}}
p,li{{color:#D5DDD8}} .muted{{color:#9AA89F;font-size:.9rem}}
</style>
</head>
<body>
{body}
<p class="muted">Gastro Manager · aktualizacja: {_UPDATED}</p>
</body></html>"""


def privacy_html() -> str:
    op = _operator()
    email = escape(op["email"]) if op["email"] else "adres z wizytówki aplikacji w Google Play"
    extra = ""
    if op["address"]:
        extra += f"<p>Adres: {escape(op['address'])}</p>"
    if op["nip"]:
        extra += f"<p>NIP: {escape(op['nip'])}</p>"
    body = f"""
<h1>Polityka prywatności</h1>
<p>Niniejsza polityka opisuje, jak aplikacja <strong>Gastro Manager</strong> przetwarza dane
osobowe użytkowników (restauracje / gastronomia) zgodnie z RODO.</p>
<h2>1. Administrator</h2>
<p>Administratorem jest {escape(op["name"])}.</p>
<p>Kontakt: {email}</p>
{extra}
<h2>2. Jakie dane zbieramy</h2>
<ul>
<li><strong>Konto:</strong> adres e-mail, hasło (haszowane przez dostawcę logowania), klucz konta restauracji.</li>
<li><strong>Profil lokalu:</strong> nazwa, dane do faktur i dostaw (adres, NIP, telefon, e-mail, konto bankowe — jeśli je podasz).</li>
<li><strong>Dane operacyjne restauracji:</strong> magazyn, menu, receptury, dostawcy, zamówienia, raporty strat, finanse.</li>
<li><strong>Płatności:</strong> subskrypcja i doładowania kredytów AI przez Stripe (my nie przechowujemy numeru karty). Zamówienia u lokalnych przetwórców — Stripe Connect.</li>
<li><strong>AI / głos / skany:</strong> nagrania i zdjęcia (cenniki, faktury, etykiety) wysyłane do OpenAI w celu transkrypcji i odczytu; nie używamy ich do trenowania własnych modeli.</li>
<li><strong>Reklamy (plan darmowy po okresie próbnym):</strong> Google AdMob (identyfikator reklamy, przybliżone dane urządzenia, zgoda UMP/RODO).</li>
<li><strong>Powiadomienia:</strong> token urządzenia, jeśli włączysz alerty (np. daty ważności).</li>
<li><strong>Logi techniczne:</strong> adres IP, czas żądania, identyfikator żądania — do bezpieczeństwa i diagnostyki.</li>
</ul>
<p>Lokalizacja GPS <strong>nie jest obecnie zbierana</strong> (odległość od producentów pokazuje się bez GPS).</p>
<h2>3. Cele i podstawy</h2>
<ul>
<li>Świadczenie usługi SaaS (umowa / art. 6 ust. 1 lit. b RODO).</li>
<li>Płatności i rozliczenia (umowa oraz obowiązek prawny).</li>
<li>Bezpieczeństwo, nadużycia, rozliczenie kredytów AI (prawnie uzasadniony interes).</li>
<li>Reklamy w planie darmowym — tylko po zgodzie, gdy jest wymagana (UMP).</li>
</ul>
<h2>4. Odbiorcy / podmioty przetwarzające</h2>
<ul>
<li>Supabase (baza, logowanie, pliki).</li>
<li>Stripe (płatności).</li>
<li>OpenAI (głos, skany, asystent).</li>
<li>Railway (hosting API).</li>
<li>Google (AdMob, Play, w planie darmowym).</li>
<li>Expo / EAS (dystrybucja buildów).</li>
<li>Opcjonalnie: Resend (e-mail zamówień), InPost / Furgonetka (przesyłki marketplace).</li>
</ul>
<p>Transfer poza EOG (np. OpenAI, Google) odbywa się na podstawie standardowych klauzul umownych dostawców.</p>
<h2>5. Okres przechowywania</h2>
<p>Dane konta trzymamy dopóki konto istnieje. Po usunięciu konta w aplikacji kasujemy login i profil
oraz anulujemy subskrypcję Stripe; dane operacyjne restauracji usuwamy w miarę możliwości od razu,
a pozostałości — w ciągu 30 dni, o ile nie blokuje tego obowiązek księgowy (faktury).</p>
<h2>6. Twoje prawa</h2>
<p>Masz prawo dostępu, sprostowania, usunięcia, ograniczenia, przenoszenia i sprzeciwu.
Usunięcie konta: <strong>Ustawienia → Usuń konto</strong> w aplikacji.
Skargę możesz złożyć do PUODO.</p>
<h2>7. Dzieci</h2>
<p>Aplikacja jest przeznaczona dla działalności gastronomicznej, nie dla dzieci poniżej 16 lat.</p>
<h2>8. Zmiany</h2>
<p>O istotnych zmianach poinformujemy w aplikacji lub na tej stronie. Data aktualizacji: {_UPDATED}.</p>
<p><a href="/terms">Regulamin</a></p>
"""
    return _shell("Polityka prywatności — Gastro Manager", body)


def terms_html() -> str:
    op = _operator()
    email = escape(op["email"]) if op["email"] else "kontakt z wizytówki Google Play"
    body = f"""
<h1>Regulamin</h1>
<p>Korzystając z aplikacji Gastro Manager, akceptujesz poniższe zasady. Usługodawca: {escape(op["name"])}
({email}).</p>
<h2>1. Usługa</h2>
<p>Gastro Manager to narzędzie dla gastronomii: magazyn, menu, dostawcy, głosowy asystent, raporty
oraz marketplace lokalnych przetwórców. Wymaga konta i połączenia z internetem.</p>
<h2>2. Plany i kredyty AI</h2>
<p>Plan darmowy (po okresie próbnym) może wyświetlać reklamy. Plany płatne i doładowania kredytów
są rozliczane przez Stripe. Kredyty zużywają się przy funkcjach AI (głos, skany, Łowca okazji itd.)
i nie stanowią środka płatniczego. Niewykorzystane kredyty nie podlegają zwrotowi, o ile bezwzględnie
przepis prawa nie stanowi inaczej (odstąpienie / reklamacja).</p>
<h2>3. Marketplace (żywność)</h2>
<p>Zamówienia u lokalnych przetwórców to towary fizyczne. Płatność i dostawa są realizowane zgodnie
z ofertą przetwórcy (Stripe Connect, kurier). Gastro Manager nie jest stroną umowy sprzedaży żywności
— pośredniczy w zamówieniu i płatności.</p>
<h2>4. Twoje obowiązki</h2>
<p>Podajesz prawdziwe dane lokalu. Nie wgrywasz treści niezgodnych z prawem. Jesteś odpowiedzialny
za HACCP / etykiety we własnej kuchni — podpowiedzi AI nie zastępują prawa żywnościowego.</p>
<h2>5. Dostępność i AI</h2>
<p>Usługa może mieć przerwy (hosting, OpenAI, Stripe). Wyniki AI mogą być błędne — weryfikuj skany
i receptury przed użyciem.</p>
<h2>6. Konto</h2>
<p>Możesz w każdej chwili wylogować się lub <strong>usunąć konto w Ustawieniach</strong>.
Usunięcie kasuje dostęp i w miarę możliwości dane restauracji.</p>
<h2>7. Prawo</h2>
<p>Prawem właściwym jest prawo polskie. Spory — sądy właściwe według siedziby usługodawcy,
z zastrzeżeniem bezwzględnych praw konsumenta / przedsiębiorcy na prawach konsumenta.</p>
<p><a href="/privacy">Polityka prywatności</a></p>
"""
    return _shell("Regulamin — Gastro Manager", body)


@router.get("/privacy")
@router.get("/api/privacy")
async def privacy():
    return HTMLResponse(content=privacy_html())


@router.get("/terms")
@router.get("/api/terms")
async def terms():
    return HTMLResponse(content=terms_html())
