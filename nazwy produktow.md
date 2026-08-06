

# **PROMPT 1 — Architektura systemu inteligentnego dopasowywania obrazów potraw**

Jesteś doświadczonym architektem oprogramowania oraz specjalistą AI zajmującym się semantycznym wyszukiwaniem obrazów dla systemów gastronomicznych.

Projekt dotyczy aplikacji SaaS dla restauracji.

Każda restauracja może dodawać własne menu.

Podczas dodawania nowej potrawy system powinien automatycznie dobrać najbardziej odpowiednie zdjęcie z biblioteki ponad 1250 profesjonalnych fotografii potraw.

Najważniejszym celem jest osiągnięcie możliwie najwyższej trafności dopasowania.

Nie wolno wybierać przypadkowych zdjęć.

Jeżeli system nie znajdzie odpowiednio podobnego obrazu, powinien wyświetlić estetyczny placeholder odpowiadający danej kategorii potraw.

## **Główne założenia**

System nie może opierać się wyłącznie na nazwie potrawy.

Powinien analizować znaczenie kulinarne potrawy.

Każda potrawa musi zostać opisana zestawem cech semantycznych.

Przykładowe cechy:

- typ potrawy
- kuchnia świata
- główne białko
- główny składnik
- sposób przygotowania
- temperatura podania
- dieta
- styl restauracyjny
- najważniejsze składniki
- grupa semantyczna

Każdy obraz w bibliotece również powinien posiadać identyczny zestaw cech.

System powinien porównywać profile semantyczne, a nie jedynie tekst.



---



## **Kolejność dopasowania**

Algorytm powinien wykonywać następujące kroki:

1. Analiza nazwy potrawy.
2. Analiza opisu (jeżeli został podany).
3. Rozpoznanie rodzaju potrawy.
4. Rozpoznanie kuchni świata.
5. Rozpoznanie głównego składnika.
6. Rozpoznanie metody przygotowania.
7. Przypisanie do odpowiedniej grupy semantycznej.
8. Wyszukanie kandydatów wyłącznie z tej grupy.
9. Obliczenie wyniku podobieństwa.
10. Wybór najlepszego zdjęcia.
11. Jeżeli wynik podobieństwa jest zbyt niski — wyświetlenie placeholdera.

Nigdy nie wybieraj zdjęcia z innej kategorii tylko dlatego, że nazwy są częściowo podobne.



---



## **Ranking dopasowania**

Dla każdego zdjęcia oblicz wynik podobieństwa.

Przykładowe kryteria:

- zgodność nazwy
- zgodność typu potrawy
- zgodność głównego składnika
- zgodność kuchni
- zgodność sposobu przygotowania
- zgodność temperatury podania
- zgodność diety
- zgodność składników charakterystycznych
- zgodność grupy semantycznej

Każde kryterium powinno posiadać własną wagę.

Jeżeli końcowy wynik będzie poniżej ustalonego progu, nie wybieraj zdjęcia.

Zastosuj placeholder.



---



## **Placeholdery**

Każda grupa semantyczna posiada własny placeholder.

Przykłady:

- zupy krem
- zupy klarowne
- ramen
- burgery
- pizza
- makarony
- sałatki
- steki
- ryby
- owoce morza
- desery
- kawa
- napoje
- śniadania
- dodatki
- sosy

Placeholder powinien być używany wyłącznie wtedy, gdy żadne zdjęcie nie osiągnie wymaganego poziomu podobieństwa.



---



## **Rozszerzalność**

Architektura ma być przygotowana do rozbudowy.

Docelowo biblioteka może zawierać:

- ponad 20 000 zdjęć,
- kuchnie z całego świata,
- wiele języków,
- synonimy,
- regionalne nazwy potraw.

Dodawanie nowych zdjęć nie powinno wymagać przebudowy systemu.



---



## **Samouczenie (na przyszłość)**

Architektura powinna umożliwiać zapis informacji o ręcznych zmianach zdjęć wykonywanych przez restauratorów.

Jeżeli wielu użytkowników zmienia automatycznie dobrane zdjęcie na inne, system powinien umożliwiać wykorzystanie tych danych do przyszłego zwiększania trafności dopasowania.

Na tym etapie należy jedynie przygotować architekturę pod taką możliwość.

  


# **Zadanie**

Budujesz system inteligentnego dopasowywania obrazów produktów gastronomicznych.

Każdy produkt posiada:

- nazwę
- opis wizualny
- kategorię
- grupę produktów
- listę produktów podobnych
- tagi AI

System nie ma dopasowywać obrazów wyłącznie po nazwie.

Ma analizować również:

- wygląd produktu
- sposób podania
- składniki widoczne na zdjęciu
- kolor
- naczynie
- dekoracje
- rodzaj kuchni
- zastosowanie gastronomiczne

Jeżeli dokładny obraz nie istnieje, system powinien znaleźć najbardziej podobny placeholder.



---



# **Priorytet dopasowania**

1. identyczna nazwa
2. synonimy
3. podobna potrawa
4. podobny wygląd
5. ta sama grupa produktów
6. ta sama kuchnia
7. placeholder kategorii



---



# **Synonimy**

Agent powinien budować słownik synonimów.

Przykład:

- frytki belgijskie
- frytki steakhouse
- frytki grube
- frytki domowe

→ mogą używać jednego placeholdera.



---



# **Produkty podobne**

Przykład

Pizza Pepperoni

Produkty podobne

- Pizza Salami
- Pizza Chorizo
- Pizza Diavola
- Pizza Mięsna

Jeżeli nie istnieje zdjęcie Pepperoni,  
 użyj najbardziej podobnej pizzy.



---



# **Hierarchia**

Produkt

↓

Grupa

↓

Kategoria

↓

Placeholder

Przykład

Pizza Hawajska

↓

Pizze klasyczne

↓

Pizza

↓

placeholder_pizza.jpg



---



# **Opis**

Opis nie służy użytkownikowi.

Opis służy wyłącznie AI do analizy obrazów.

Powinien zawierać:

- kolor
- teksturę
- kształt
- składniki widoczne na zdjęciu
- dekoracje
- rodzaj talerza
- typ naczynia
- styl fotografii



---



# **Tagi**

Tagi służą wyłącznie wyszukiwaniu podobnych obrazów.

Przykład

pizza,  
 italian,  
 cheese,  
 tomato,  
 pepperoni,  
 restaurant,  
 food,  
 italian cuisine,  
 flat lay,  
 close up,  
 wooden board



---



## **Dodałbym jeszcze jedną rzecz**

To jest coś, czego jeszcze nie było w dokumencie, a bardzo pomoże agentowi.

Każdy produkt powinien mieć również pole:

PlaceholderLevel

  


exact

similar

category

generic

Przykład:

Pizza Pepperoni

  


exact:

Pizza Pepperoni

  


similar:

Pizza Salami

Pizza Chorizo

Pizza Mięsna

  


category:

Pizza

  


generic:

Fast Food

Dzięki temu agent nie będzie losował zdjęć, tylko będzie wiedział, jak daleko może zejść z dopasowaniem.

  


# **PROMPT 2 – Budowa taksonomii gastronomicznej i grup semantycznych**

Kontynuujemy budowę systemu inteligentnego dopasowywania obrazów.

## **Bardzo ważna zasada**

Nie twórz nowych grup semantycznych, jeżeli potrawa może zostać przypisana do istniejącej grupy.

Najpierw sprawdzaj, czy dana potrawa pasuje do już utworzonej taksonomii.

Twórz nowe grupy wyłącznie wtedy, gdy żadna istniejąca grupa nie opisuje poprawnie nowego rodzaju potraw.

Biblioteka ma być możliwie spójna i pozbawiona duplikatów.



---



# **Nowe grupy semantyczne do utworzenia**

Na podstawie poniższych potraw utwórz lub rozszerz następujące grupy:

## **middle_eastern_kebab**

Obejmuje między innymi:

- Kebab w rollo
- Kebab na talerzu
- Shawarma
- Adana kebab
- Shish Taouk
- Kofta
- Pita z mięsem

Przykładowe synonimy:

- kebab
- döner
- doner
- shawarma
- gyro (jeżeli występuje w podobnym kontekście)
- grillowane mięso w picie
- grillowane mięso w tortilli

Placeholder:

placeholder_middle_eastern_kebab.webp



---



## **middle_eastern_vegetarian**

Obejmuje:

- Falafel
- Hummus
- Baba Ghanoush
- Muhammara
- Dolma
- Halloumi
- Tabbouleh
- Fattoush
- Chipsy z pity
- Pieczona ciecierzyca
- Grillowane papryczki

Placeholder

placeholder_middle_eastern_vegetarian.webp



---



## **middle_eastern_bread**

Obejmuje:

- Naan
- Fatayer
- Lahmacun

Nie należy mieszać tej grupy z pizzą włoską.

Placeholder

placeholder_middle_eastern_bread.webp



---



# **Rozszerzenie istniejących grup**

Jeżeli któraś z poniższych potraw pasuje do wcześniej utworzonej grupy, dopisz ją do istniejącej listy canRepresent, zamiast tworzyć nową grupę.

Dotyczy między innymi:

- hummus
- halloumi
- bruschetta
- mozzarella sticks
- onion rings
- nachosy
- falafel



---



# **Kuchnia polska**

Dodaj kolejną gałąź taksonomii.

## **polish_main_courses**

Obejmuje:

- kotlet schabowy
- kotlet mielony
- rolada śląska
- pieczona kaczka
- gulasz
- gołąbki
- de volaille
- bitki
- golonka
- karkówka
- pieczeń rzymska

Placeholder

placeholder_polish_main_course.webp



---



## **polish_soups**

Rozszerz wcześniej utworzoną grupę zup o:

- barszcz czerwony z uszkami
- żurek
- rosół
- flaki
- chłodnik litewski

Jeżeli grupa już istnieje, nie twórz nowej.



---



## **polish_side_dishes**

Obejmuje:

- młode ziemniaki
- kapusta zasmażana
- mizeria

Placeholder

placeholder_polish_side_dish.webp



---



## **polish_mushroom_dishes**

Obejmuje:

- gulasz grzybowy

Nie należy łączyć tej grupy z klasyczymi daniami mięsnymi.



---



# **Reguły budowania grup**

Każda grupa powinna zawierać:

- unikalny identyfikator (taxonomy)
- nazwę
- kategorię nadrzędną
- placeholder
- listę canRepresent
- listę cannotRepresent
- listę synonimów
- dominujące składniki
- dominujące metody przygotowania
- dominujący sposób podania
- dominującą kuchnię świata
- typ potrawy



---



# **Bardzo ważna zasada**

Jedna potrawa może należeć do wielu poziomów klasyfikacji.

Przykład:

Kebab

  


↓

  


mealType = main_course

  


↓

  


cuisine = middle_eastern

  


↓

  


taxonomy = middle_eastern_kebab

  


↓

  


protein = beef

Nie ograniczaj potraw do jednej etykiety. Buduj pełny profil semantyczny, który będzie później wykorzystywany przez algorytm dopasowania zdjęć.

# **PROMPT DLA AGENTA AI — CZĘŚĆ 4**

## **Rozszerzenie słownika obrazów – Kuchnia Polska (Mączne) + Pizza**

Do istniejącej bazy imageLibrary.json dodaj kolejne wpisy.

Dla każdego obrazu wygeneruj:

- primaryName
- category
- fallbackTags
- forbiddenTags
- placeholderCategory

Nie zmieniaj poprzednich wpisów.



---



# **KATEGORIA**

## **Kuchnia Polska → Pierogi, kluski, naleśniki i dania mączne**

### **Pierogi**

Do jednej grupy "Pierogi" powinny należeć między innymi:

- pierogi ruskie
- pierogi z mięsem
- pierogi z serem
- pierogi z twarogiem
- pierogi z ziemniakami
- pierogi z cebulką
- pierogi z boczkiem
- pierogi z kapustą
- pierogi z grzybami
- pierogi z kapustą i grzybami
- pierogi z jagodami
- pierogi z truskawkami
- pierogi z malinami
- pierogi z wiśniami
- pierogi z owocami
- pierogi pieczone
- pierogi smażone
- pierogi domowe
- pierogi tradycyjne
- pierogi staropolskie
- uszka
- pielmieni
- wareniki

### **fallbackTags**

pierogi

kluski

danie mączne

polskie

ciasto

domowe

placeholderCategory

Pierogi



---



## **Kopytka**

Alias:

- kopytka
- mini kopytka
- gnocchi polskie
- kluski ziemniaczane

fallbackTags

kopytka

kluski

ziemniaki

placeholderCategory

Kluski ziemniaczane



---



## **Kluski śląskie**

Alias

- kluski śląskie
- kluski z dziurką

fallbackTags

kluski

śląskie

ziemniaki



---



## **Leniwe**

Alias

- leniwe
- kluski leniwe

fallbackTags

kluski

ser

mączne



---



## **Pampuchy**

Alias

- pampuchy
- pyzy na parze
- buchty
- kluski na parze

fallbackTags

kluski

na parze

drożdżowe



---



## **Kartacze**

Alias

- kartacze
- cepeliny
- kartacz

fallbackTags

kartacze

kluski

ziemniaki

mięso



---



## **Baba ziemniaczana**

Alias

- baba ziemniaczana
- babka ziemniaczana

fallbackTags

ziemniaki

zapiekanka

polskie



---



## **Placki ziemniaczane**

Alias

- placki ziemniaczane
- placki z ziemniaków

fallbackTags

placki

ziemniaki



---



## **Naleśniki**

Do jednej grupy należą:

- naleśniki
- pancakes polskie
- naleśniki z serem
- naleśniki ze szpinakiem
- naleśniki z dżemem
- naleśniki z owocami

fallbackTags

naleśniki

crepes

mączne



---



## **Racuchy**

Alias

- racuchy
- racuszki

fallbackTags

racuchy

jabłka

placuszki



---



# **KATEGORIA**

## **Pizza**

Każda pizza otrzymuje własny wpis, ale wszystkie należą do wspólnej rodziny.

Globalne fallbackTags dla każdej pizzy

pizza

włoskie

ciasto

mozzarella



---



### **Margherita**

Alias

- margherita
- margarita pizza



---



### **Pepperoni**

Alias

- pepperoni
- pizza pepperoni
- salami pizza



---



### **Parma**

Alias

- prosciutto
- prosciutto di parma
- pizza parma



---



### **Quattro Formaggi**

Alias

- cztery sery
- quatro formaggi
- 4 sery



---



### **Bianca**

Alias

- pizza bianca
- biała pizza



---



### **Calzone**

Alias

- calzone
- pizza składana



---



### **Frutti di Mare**

Alias

- owoce morza
- seafood pizza



---



### **Diavola**

Alias

- diavola
- pikantna pizza



---



### **Capricciosa**

Alias

- capriciosa
- capricciosa



---



### **Hawajska**

Alias

- hawajska
- pizza z ananasem
- hawaiian pizza



---



### **Verdure**

Alias

- pizza wegetariańska
- vegetarian pizza



---



### **Quattro Stagioni**

Alias

- cztery pory roku
- quattro stagioni



---



### **Marinara**

Alias

- marinara



---



### **Funghi**

Alias

- pizza grzybowa
- funghi



---



### **Tonno**

Alias

- pizza z tuńczykiem
- tonno



---



### **Pizza z figami**

Alias

- pizza figi
- fig pizza
- gorgonzola fig



---



### **Napoletana**

Alias

- neapolitańska
- napoletana



---



### **Chicago Deep Dish**

Alias

- deep dish
- chicago pizza



---



### **Truflowa**

Alias

- pizza truflowa
- truffle pizza



---



### **Carbonara**

Alias

- pizza carbonara



---



### **Regina**

Alias

- pizza regina



---



### **Nduja**

Alias

- nduja pizza



---



### **Kurczak i pesto**

Alias

- chicken pesto pizza
- pizza pesto



---



### **Mini pizzetta**

Alias

- pizzetta
- mini pizza
- finger pizza



---



## **Focaccia**

Nie jest pizzą.

To osobna kategoria.

Alias

- focaccia
- focaccia rozmaryn
- focaccia z pomidorami

fallbackTags

pieczywo

włoskie

rozmaryn

oliwa

placeholderCategory

Pieczywo włoskie



---



## **Reguły dopasowania dla tej części**

Agent powinien najpierw próbować dopasowania konkretnej odmiany (np. **Pizza Diavola**). Jeśli jej nie znajdzie, powinien przejść do grupy **Pizza**, a dopiero później użyć placeholdera **Pizza klasyczna**.

Analogicznie dla pierogów:

- **Pierogi z jagodami** → jeśli brak, użyj zdjęcia dowolnych pierogów owocowych.
- Jeśli brak pierogów owocowych → użyj ogólnego placeholdera **Pierogi**.

Nigdy nie zamieniaj:

- pizzy na focaccię,
- focaccii na pizzę,
- naleśników na pierogi,
- pierogów na kluski,
- klusek na placki ziemniaczane.

To pozwala zachować wysoką trafność nawet wtedy, gdy konkretnego wariantu zdjęcia nie ma w bibliotece.

# **PROMPT DLA AGENTA AI — CZĘŚĆ 5**

## **Rozszerzenie słownika obrazów – Makarony + Kuchnia Amerykańska BBQ**

Rozszerz istniejący imageLibrary.json.

Dla każdego obrazu wygeneruj:

- primaryName
- category
- fallbackTags
- forbiddenTags
- placeholderCategory
- aliases

Nie modyfikuj wcześniej dodanych wpisów.



---



# **KATEGORIA**

## **Kuchnia Włoska → Makarony**

Najpierw agent próbuje dopasować konkretny makaron.

Jeżeli go nie znajdzie:

→ wyszukuje po rodzaju makaronu

Jeżeli nadal nie znajdzie:

→ wyszukuje po sosie

Jeżeli nadal nie znajdzie:

→ używa placeholdera

**Makaron włoski**



---



# **SPAGHETTI CARBONARA**

Aliases

- carbonara
- spaghetti carbonara
- pasta carbonara
- carbonara pasta

fallbackTags

makaron

spaghetti

boczek

parmezan

jajko

włoskie

placeholderCategory

Makaron włoski



---



# **SPAGHETTI BOLOGNESE**

Aliases

- bolognese
- spaghetti bolognese
- ragu

fallbackTags

makaron

spaghetti

wołowina

sos mięsny



---



# **TAGLIATELLE OWOCE MORZA**

Aliases

- seafood pasta
- tagliatelle seafood
- owoce morza

fallbackTags

makaron

krewetki

mule

kalmary



---



# **LASAGNE**

Aliases

- lasagna
- lasagne
- lazania

fallbackTags

zapiekanka

makaron

wołowina

beszamel



---



# **GNOCCHI**

Do jednej grupy należą

- gnocchi
- gnocchi pomidorowe
- gnocchi gorgonzola
- gnocchi serowe

fallbackTags

gnocchi

kluski

ziemniaki



---



# **RAVIOLI**

Aliases

- ravioli
- ravioli ricotta
- ravioli szpinak

fallbackTags

makaron

faszerowany

ricotta



---



# **PENNE ARRABBIATA**

Aliases

- arrabbiata
- penne arrabbiata

fallbackTags

makaron

pomidory

chili



---



# **FETTUCCINE ALFREDO**

Aliases

- alfredo
- fettuccine alfredo

fallbackTags

makaron

śmietana

masło

parmezan



---



# **AGLIO E OLIO**

Aliases

- aglio e olio

fallbackTags

makaron

czosnek

oliwa



---



# **TROFIE PESTO**

Aliases

- pesto pasta
- trofie pesto

fallbackTags

makaron

pesto

bazylia



---



# **ORECCHIETTE**

Aliases

- orecchiette

fallbackTags

makaron

brokuły

rzepa



---



# **MATRICIANA**

Aliases

- amatriciana
- matriciana

fallbackTags

makaron

boczek

pomidory

pecorino



---



# **FUSILLI**

Aliases

- świderki
- fusilli

fallbackTags

makaron

warzywa



---



# **PAPPARDELLE**

Aliases

- pappardelle
- trufle
- grzyby

fallbackTags

makaron

grzyby

trufle



---



# **LINGUINE VONGOLE**

Aliases

- alle vongole
- linguine vongole

fallbackTags

makaron

małże

wino



---



# **TORTELLINI**

Aliases

- tortellini

fallbackTags

makaron

bulion



---



# **FARFALLE**

Aliases

- kokardki
- farfalle

fallbackTags

makaron

łosoś



---



# **CACIO E PEPE**

Aliases

- cacio pepe

fallbackTags

makaron

pecorino

pieprz



---



# **BAKED ZITI**

Aliases

- baked ziti
- zapiekanka makaronowa

fallbackTags

makaron

zapiekany

mozzarella



---



# **CANNELLONI**

Aliases

- cannelloni

fallbackTags

makaron

faszerowany

wołowina



---



# **POMODORO**

Aliases

- al pomodoro

fallbackTags

makaron

pomidor

bazylia



---



# **BUCATINI**

Aliases

- bucatini

fallbackTags

makaron

ser



---



# **CZARNY MAKARON**

Aliases

- squid ink pasta
- black pasta
- czarny makaron

fallbackTags

makaron

krewetki

atrament



---



# **MAC AND CHEESE**

Do jednej grupy należą

- mac and cheese
- macaroni cheese
- makaron serowy

fallbackTags

makaron

ser

cheddar

placeholderCategory

Makaron serowy



---



# **REGUŁY DOPASOWYWANIA MAKARONÓW**

Najpierw:

rodzaj makaronu

potem:

rodzaj sosu

dopiero później:

placeholder

Nigdy nie zamieniaj:

Carbonary na Bolognese

Owoców morza na mięso

Makaronów z pesto na sos pomidorowy

Makaronów na pizzę



---



# **KATEGORIA**

## **Kuchnia Amerykańska → BBQ**

Placeholder główny

BBQ



---



# **ŻEBERKA BBQ**

Aliases

- ribs
- bbq ribs
- żeberka

fallbackTags

żeberka

bbq

wieprzowina

grill



---



# **STEK T-BONE**

Aliases

- t bone
- tbone

fallbackTags

stek

wołowina

grill



---



# **TOMAHAWK**

Aliases

- tomahawk steak

fallbackTags

stek

wołowina

kość



---



# **RIBEYE**

Aliases

- rib eye
- ribeye steak

fallbackTags

stek

wołowina



---



# **PULLED PORK**

Aliases

- szarpana wieprzowina
- pulled pork

fallbackTags

wieprzowina

bbq



---



# **BRISKET**

Aliases

- smoked brisket
- mostek wołowy

fallbackTags

wołowina

wędzone

bbq



---



# **BURGER**

Do jednej grupy należą

- burger
- cheeseburger
- hamburger
- burger premium
- burger wołowy

fallbackTags

burger

wołowina

kanapka

placeholderCategory

Burger



---



# **BUFFALO WINGS**

Aliases

- buffalo wings
- skrzydełka buffalo

fallbackTags

kurczak

skrzydełka



---



# **BBQ CHICKEN**

Aliases

- bbq chicken
- pałki bbq

fallbackTags

kurczak

bbq



---



# **CORN ON THE COB**

Aliases

- kolba kukurydzy
- grilled corn

fallbackTags

kukurydza

grill



---



# **BAKED POTATO**

Aliases

- jacket potato
- baked potato

fallbackTags

ziemniak

ser



---



# **SWEET POTATO FRIES**

Alias

- frytki z batatów



---



# **ONION RINGS**

Alias

- onion rings



---



# **BURNT ENDS**

Alias

- burnt ends

fallbackTags

wołowina

bbq

karmelizowane



---



# **HOT LINKS**

Alias

- hot links
- kiełbaski bbq



---



# **TURKEY LEG**

Alias

- turkey leg
- udko indyka



---



# **SLIDERS**

Alias

- mini burger
- sliders



---



# **CORNBREAD**

Alias

- cornbread



---



# **BAKED BEANS**

Alias

- baked beans



---



# **SOSY**

Każdy z poniższych ma własny wpis:

- BBQ sauce
- Honey mustard
- Blue cheese dressing

placeholderCategory

Sosy



---



## **REGUŁY DOPASOWANIA BBQ**

Jeżeli restaurator wpisze:

- „Stek sezonowany”
- „Stek premium”
- „Antrykot”
- „Stek wołowy”

to system powinien preferować:

1. Ribeye
2. T-Bone
3. Tomahawk
4. Placeholder „Stek”

Analogicznie:

- Pulled pork → dowolna szarpana wieprzowina.
- Brisket → dowolny wędzony mostek wołowy.
- Burger BBQ → dowolny burger premium.
- Mini burger → Sliders.

Nie wolno zamieniać:

- steków na burgery,
- burgerów na pulled pork,
- żeber na brisket,
- kurczaka BBQ na żeberka,
- sosów na dania główne.

To zachowuje logiczne i estetyczne dopasowanie obrazów nawet przy częściowo niezgodnych nazwach menu.

# **PROMPT DLA AGENTA AI — CZĘŚĆ 6**

## **Rozszerzenie słownika obrazów – Sushi i Kuchnia Azjatycka (Wok / Stir Fry)**

Rozszerz istniejący imageLibrary.json.

Dla każdego wpisu wygeneruj:

- primaryName
- aliases
- category
- fallbackTags
- forbiddenTags
- placeholderCategory

Nie modyfikuj wcześniejszych wpisów.



---



# **KATEGORIA**

## **Sushi**

Hierarchia dopasowania:

konkretna rolka

  


↓

  


typ sushi

  


↓

  


placeholder Sushi



---



## **Nigiri**

Do jednej rodziny należą

- sake nigiri
- salmon nigiri
- maguro nigiri
- tuna nigiri
- ebi nigiri
- nigiri łosoś
- nigiri tuńczyk
- nigiri krewetka

fallbackTags

nigiri

sushi

ryż

surowa ryba

placeholderCategory

Nigiri



---



## **Hosomaki**

Alias

- hosomaki
- thin roll
- cienka rolka

Dodatkowo

- kappa maki
- sake maki
- avocado maki
- cucumber maki

fallbackTags

hosomaki

maki

sushi



---



## **Futomaki**

Alias

- futomaki
- gruba rolka

fallbackTags

futomaki

maki



---



## **California Roll**

Alias

- california
- california roll

fallbackTags

uramaki

krab

awokado



---



## **Philadelphia Roll**

Alias

- philadelphia
- philadelphia roll

fallbackTags

łosoś

serek

awokado



---



## **Dragon Roll**

Alias

- dragon
- dragon roll

fallbackTags

unagi

węgorz

awokado



---



## **Rainbow Roll**

Alias

- rainbow
- rainbow roll

fallbackTags

różne ryby

awokado



---



## **Spicy Tuna**

Alias

- spicy tuna
- tuna roll

fallbackTags

tuńczyk

pikantne



---



## **Tempura Roll**

Do jednej grupy należą

- ebi ten
- tempura roll
- shrimp tempura roll

fallbackTags

tempura

krewetka



---



## **Panko Roll**

Alias

- panko maki
- fried sushi
- sushi smażone

fallbackTags

panko

smażone



---



## **Gunkan**

Alias

- gunkan
- battleship sushi

fallbackTags

gunkan

tatar



---



## **Sashimi**

Do jednej rodziny należą

- salmon sashimi
- sake sashimi
- tuna sashimi
- maguro sashimi
- sashimi

fallbackTags

sashimi

surowa ryba

placeholderCategory

Sashimi



---



## **Edamame**

Alias

- edamame



---



## **Wakame**

Alias

- goma wakame
- wakame



---



## **Miso**

Alias

- miso
- zupa miso

Jeżeli użytkownik wpisze:

- misoshiru

również dopasuj.



---



## **Wasabi**

Alias

- wasabi



---



## **Gari**

Alias

- imbir
- gari



---



## **Soy Sauce**

Alias

- soy sauce
- sos sojowy



---



## **Spicy Mayo**

Alias

- spicy mayo



---



## **Unagi Sauce**

Alias

- unagi sauce



---



## **GLOBALNE TAGI DLA SUSHI**

Każdy wpis sushi otrzymuje dodatkowo

japonia

azja

sushi



---



## **ZABRONIONE DOPASOWANIA**

Nigdy nie zamieniaj

Nigiri → sashimi

Hosomaki → futomaki

California → dragon

Sushi → poke bowl

Sushi → ramen

Sushi → wok



---



# **KATEGORIA**

## **Kuchnia Azjatycka**

Hierarchia

dokładna potrawa

  


↓

  


rodzaj dania

  


↓

  


placeholder Wok



---



## **Pad Thai**

Alias

- pad thai
- thai noodles

fallbackTags

makaron

tajskie

krewetki



---



## **Kung Pao**

Alias

- kung pao
- gong bao

fallbackTags

kurczak

orzeszki



---



## **Beef Oyster**

Alias

- beef oyster sauce
- wołowina ostrygowa

fallbackTags

wołowina

brokuły



---



## **Fried Rice**

Alias

- fried rice
- egg fried rice
- smażony ryż

fallbackTags

ryż

jajko



---



## **Chow Mein**

Alias

- chow mein

fallbackTags

makaron

wok



---



## **Sweet Sour Chicken**

Alias

- sweet and sour
- kurczak słodko kwaśny



---



## **Crispy Duck**

Alias

- crispy duck
- duck strips



---



## **Black Pepper Beef**

Alias

- black pepper beef



---



## **Cashew Chicken**

Alias

- cashew chicken



---



## **Dim Sum**

Alias

- dim sum



---



## **Gyoza**

Alias

- gyoza
- jiaozi



---



## **Green Beans**

Alias

- garlic beans
- fasolka wok



---



## **Mapo Tofu**

Alias

- mapo tofu



---



## **General Tso**

Alias

- general tso
- generała tso



---



## **Beef Lo Mein**

Alias

- lo mein
- beef lo mein



---



## **Wok Shrimp**

Alias

- shrimp stir fry



---



## **Kaczka po pekińsku**

To jest bardzo ważny wpis.

Alias

- peking duck
- roast duck
- duck
- duck breast
- crispy duck
- duck slices

fallbackTags

kaczka

drób

pieczone

placeholderCategory

Drób

Jeżeli restaurator wpisze

- pierś z kaczki
- udko z kaczki
- confit z kaczki
- pieczona kaczka

system może wykorzystać również ten obraz.



---



## **Tempura**

Do jednej grupy należą

- tempura
- shrimp tempura
- vegetable tempura



---



## **Wonton**

Alias

- wonton
- fried wonton



---



## **Nasi Goreng**

Alias

- nasi goreng



---



## **Sriracha**

Alias

- sriracha



---



## **Sweet Chili**

Alias

- sweet chili



---



## **Teriyaki**

Alias

- teriyaki



---



## **GLOBALNE TAGI**

Każda potrawa otrzymuje dodatkowo

azja

wok

stir fry



---



## **REGUŁY DOPASOWANIA**

1. Najpierw dopasuj konkretną potrawę (np. Pad Thai, Gyoza, Kung Pao).
2. Jeśli brak — dopasuj po głównym składniku (kurczak, wołowina, kaczka, krewetki, tofu).
3. Jeśli nadal brak — dopasuj po technice przygotowania (wok, tempura, grill, smażone).
4. Dopiero na końcu użyj placeholdera odpowiedniej kategorii (np. **Sushi**, **Wok**, **Drób azjatycki**).

**Dodatkowa sugestia:** kiedy skończymy wszystkie plansze (około 1250 obrazów), przygotuję jeszcze jeden końcowy moduł dla agenta: **„Globalny słownik synonimów gastronomicznych”** z 1000–2000 najczęściej spotykanych nazw i wariantów (np. „frytki belgijskie” = „frytki”, „americano” = „kawa czarna”, „pierś z kurczaka supreme” = „kurczak”). To znacznie zwiększy skuteczność dopasowania nawet przy bardzo nietypowych nazwach używanych przez restauratorów.

# **ETAP 2 – Rozszerzenie biblioteki obrazów (Kuchnia Indyjska + Meksykańska)**

Rozszerz bibliotekę imageLibrary.json o kolejne obrazy.

Dla KAŻDEGO obrazu wygeneruj:

{

  "primaryName":"",

  "aliases":[],

  "category":"",

  "subcategory":"",

  "protein":"",

  "cuisine":"",

  "course":"",

  "cookingMethods":[],

  "ingredients":[],

  "visualGroup":"",

  "tags":[],

  "fallbackTags":[],

  "forbiddenTags":[]

}



---



# **KUCHNIA INDYJSKA**

Dla wszystkich obrazów dodaj odpowiednie aliasy.

Przykład:

Butter Chicken

alias:

Murgh Makhani

Butter Chicken Curry

Maślany kurczak

Kurczak w maślanym sosie

Chicken in Butter Sauce

fallback:

kurczak curry

curry

kurczak

danie indyjskie

sos pomidorowy



---



Chicken Tikka Masala

alias:

Tikka Masala

Chicken Curry

Kurczak Tikka

Grillowany kurczak curry

fallback:

kurczak

curry

sos pomidorowy



---



Lamb Rogan Josh

fallback:

jagnięcina

baranina

gulasz

mięso duszone

curry



---



Vegetable Biryani

fallback:

ryż

biryani

warzywa

danie ryżowe



---



Chana Masala

fallback:

ciecierzyca

wege

vegan

curry



---



Palak Paneer

fallback:

paneer

ser indyjski

szpinak

wege



---



Chicken Tandoori

fallback:

kurczak

grill

pieczony kurczak

tandoor



---



Samosa

fallback:

pierożki

przekąska

indyjska przekąska



---



Onion Bhaji

fallback:

cebula

frytura

przystawka



---



Garlic Naan

fallback:

naan

pieczywo

chleb



---



Papadum

fallback:

chipsy

chrupiące pieczywo

papad



---



Daal Makhani

fallback:

soczewica

fasola

wege

curry



---



Aloo Gobi

fallback:

ziemniaki

kalafior

wege



---



Prawn Malai Curry

fallback:

krewetki

owoce morza

curry



---



Chicken Korma

fallback:

kurczak

łagodne curry

sos śmietanowy



---



Mattar Paneer

fallback:

paneer

groszek

wege



---



Seekh Kebab

fallback:

kebab

szaszłyk

grill

mięso mielone



---



Mango Chutney

visualGroup:

dip

fallback:

sos

chutney

mango



---



Raita

visualGroup:

dip

fallback:

sos jogurtowy

jogurt

dip



---



Achar

visualGroup:

dodatki

fallback:

pikle

marynowane warzywa



---



Basmati Rice

fallback:

ryż

dodatek



---



Gulab Jamun

category:

dessert

fallback:

deser

indyjski deser

słodycze



---



Medu Vada

fallback:

smażone

przekąska

wege



---



Idli

fallback:

placuszki

śniadanie

wege



---



Mango Lassi

category:

drink

fallback:

napój

koktajl

mango

jogurt



---



# **KUCHNIA MEKSYKAŃSKA**

Dla wszystkich pozycji dodaj aliasy angielskie oraz popularne nazwy.



---



Beef Taco

alias:

Taco

Tacos

Tacos z wołowiną

fallback:

meksykańskie

tortilla

wołowina

street food



---



Fish Taco

fallback:

ryba

tortilla

owoce morza



---



Burrito

fallback:

tortilla

ryż

fasola

meksykańskie



---



Chicken Quesadilla

fallback:

ser

tortilla

kurczak



---



Enchiladas

fallback:

zapiekana tortilla

kurczak

meksykańskie



---



Chicken Fajitas

fallback:

kurczak

papryka

cebula

grill



---



Chili con Carne

fallback:

wołowina

fasola

gulasz



---



Nachos Supreme

fallback:

nachosy

ser

jalapeno



---



Tamale

fallback:

mąka kukurydziana

meksykańskie



---



Taquitos

alias:

Flautas

fallback:

tortilla

chrupiące

mięso



---



Torta

fallback:

kanapka

burger

pieczywo



---



Elote

fallback:

kukurydza

grillowane warzywa



---



Mexican Rice

fallback:

ryż

dodatek



---



Frijoles Charros

fallback:

fasola

gulasz



---



Taco Salad

fallback:

sałatka

meksykańska

tortilla



---



Chimichanga

fallback:

burrito

smażone



---



Shrimp Ceviche

fallback:

krewetki

ceviche

owoce morza



---



Jalapeno Poppers

fallback:

papryczki

ser

przystawka



---



Churros

category:

dessert

fallback:

deser

słodycze

ciasto smażone



---



Guacamole

visualGroup:

dip

fallback:

awokado

dip



---



Pico de Gallo

visualGroup:

dip

fallback:

salsa

pomidory



---



Chipotle Salsa

visualGroup:

dip

fallback:

sos

pikantny



---



Salsa Verde

visualGroup:

dip

fallback:

zielona salsa



---



Tortilla Soup

category:

soup

fallback:

zupa

meksykańska



---



Tres Leches

category:

dessert

fallback:

ciasto

deser

mleczny deser



---



# **Nowe reguły dopasowania**

Po dodaniu tej biblioteki agent ma rozpoznawać również nazwy wpisane przez restauratorów takie jak:

- curry z kurczakiem
- curry wegańskie
- butter curry
- tikka
- naan czosnkowy
- grillowany naan
- burrito bowl
- wrap meksykański
- taco z kurczakiem
- tacos pulled pork
- quesadilla z serem
- chili
- nachosy
- salsa
- guacamole
- dip meksykański
- sos chipotle
- ryż meksykański
- kebab indyjski
- seekh
- samosa
- lassi
- mango shake
- chutney

Jeżeli restaurator wpisze nazwę nieidentyczną z biblioteką (np. „kurczak curry”, „burrito z wołowiną”, „meksykańska tortilla z kurczakiem”), agent powinien dopasować obraz na podstawie aliasów, tagów, kuchni oraz głównego składnika, a nie wyłącznie po nazwie.

# **ETAP 2 – Rozszerzenie biblioteki obrazów (Kuchnia Gruzińska / Kaukaska + Śródziemnomorska)**

Rozszerz bibliotekę imageLibrary.json.

Dla każdego nowego obrazu wygeneruj:

{

  "primaryName":"",

  "aliases":[],

  "category":"",

  "subcategory":"",

  "protein":"",

  "cuisine":"",

  "course":"",

  "cookingMethods":[],

  "ingredients":[],

  "visualGroup":"",

  "tags":[],

  "fallbackTags":[],

  "forbiddenTags":[]

}



---



# **KUCHNIA GRUZIŃSKA / KAUKASKA**

Dodaj wszystkie poniższe obrazy wraz z aliasami angielskimi i najczęściej spotykanymi nazwami.



---



### **Adjarian Khachapuri**

alias:

- Chaczapuri adżarskie
- Khachapuri Adjaruli
- Georgian Cheese Boat

fallback:

- chaczapuri
- ser
- pieczywo
- kuchnia gruzińska
- wypiek



---



### **Imeretian Khachapuri**

fallback:

- chaczapuri
- placek z serem
- pieczywo



---



### **Khinkali**

fallback:

- gruzińskie pierogi
- pierogi
- sakiewki
- mięso



---



### **Caucasian Shashlik**

fallback:

- szaszłyk
- grill
- mięso
- barbecue



---



### **Lula Kebab**

fallback:

- kebab
- grill
- mięso mielone
- szaszłyk



---



### **Kharcho Soup**

category:

soup

fallback:

- zupa
- wołowina
- ryż
- gruzińska zupa



---



### **Chashushuli**

fallback:

- gulasz
- wołowina
- duszone mięso



---



### **Lobio**

fallback:

- fasola
- wege
- garnek
- danie gruzińskie



---



### **Pkhali**

fallback:

- pasta warzywna
- szpinak
- burak
- orzechy
- wege



---



### **Badrijani**

fallback:

- bakłażan
- roladki
- pasta orzechowa



---



### **Shkmeruli**

fallback:

- kurczak
- sos czosnkowy
- śmietana



---



### **Shotis Puri**

fallback:

- chleb
- pieczywo
- gruzińskie pieczywo



---



### **Mchadi**

fallback:

- placki kukurydziane
- pieczywo



---



### **Whole Trout**

fallback:

- pstrąg
- ryba
- pieczona ryba



---



### **Chakhokhbili**

fallback:

- kurczak
- gulasz
- pomidory



---



### **Ajapsandali**

fallback:

- warzywa
- bakłażan
- wege



---



### **Kubdari**

fallback:

- placek
- mięso
- pieczywo



---



### **Satsivi**

fallback:

- kurczak
- sos orzechowy



---



### **Adjika**

visualGroup:

dip

fallback:

- sos
- pasta
- pikantny sos



---



### **Tkemali**

visualGroup:

dip

fallback:

- sos śliwkowy
- śliwki
- dip



---



### **Georgian Salad**

fallback:

- sałatka
- pomidory
- ogórki



---



### **Jonjoli**

fallback:

- pikle
- marynowane warzywa



---



### **Caucasian Rice**

fallback:

- ryż
- dodatek



---



### **Churchkhela**

category:

dessert

fallback:

- deser
- słodycze
- orzechy



---



### **Georgian Red Wine**

category:

drink

fallback:

- wino
- czerwone wino
- alkohol



---



# **KUCHNIA ŚRÓDZIEMNOMORSKA**



---



### **Seafood Paella**

fallback:

- paella
- ryż
- owoce morza



---



### **Gyros Plate**

fallback:

- gyros
- mięso
- pita



---



### **Chicken Souvlaki**

fallback:

- szaszłyk
- kurczak
- grill



---



### **Fried Calamari**

fallback:

- kalmary
- owoce morza
- smażone



---



### **Mussels in White Wine**

fallback:

- mule
- małże
- owoce morza



---



### **Grilled Octopus**

fallback:

- ośmiornica
- grill
- owoce morza



---



### **Moussaka**

fallback:

- zapiekanka
- bakłażan
- mięso mielone



---



### **Pastitsio**

fallback:

- makaron
- zapiekanka
- mięso



---



### **Spanakopita**

fallback:

- filo
- szpinak
- feta



---



### **Greek Salad**

fallback:

- feta
- pomidor
- oliwki
- sałatka



---



### **Tzatziki**

visualGroup:

dip

fallback:

- sos jogurtowy
- ogórek
- czosnek



---



### **Mixed Olives**

fallback:

- oliwki
- przekąska



---



### **Caprese Skewers**

fallback:

- mozzarella
- pomidor
- pesto



---



### **Dolmades**

fallback:

- liście winogron
- ryż



---



### **Grilled Halloumi**

fallback:

- halloumi
- grillowany ser



---



### **Patatas Bravas**

fallback:

- ziemniaki
- frytki
- tapas



---



### **Gambas al Ajillo**

fallback:

- krewetki
- czosnek
- owoce morza



---



### **Gemista**

fallback:

- faszerowany pomidor
- warzywa



---



### **Grilled Sardines**

fallback:

- sardynki
- ryba
- grill



---



### **Classic Hummus**

fallback:

- hummus
- ciecierzyca
- dip



---



### **Tirokafteri**

visualGroup:

dip

fallback:

- feta
- pikantny dip



---



### **Falafel**

fallback:

- falafel
- ciecierzyca
- wege



---



### **Pita Bread**

fallback:

- pita
- pieczywo



---



### **Taramasalata**

visualGroup:

dip

fallback:

- dip
- ikra
- ryby



---



### **White Wine**

category:

drink

fallback:

- wino
- białe wino
- alkohol



---



# **Nowe reguły semantyczne**

Po dodaniu tej biblioteki system powinien automatycznie rozpoznawać również wpisy restauratorów takie jak:

- gruzińskie pierogi
- pierogi z bulionem
- sakiewki gruzińskie
- gruziński placek
- placek z serem
- kaukaski kebab
- szaszłyk z grilla
- danie gruzińskie
- kuchnia kaukaska
- hummus
- tzatziki
- halloumi
- grecki ser
- pita
- paella
- musaka
- grecka zapiekanka
- owoce morza
- mule
- kalmary
- grillowana ośmiornica
- tapas
- śródziemnomorskie
- grecka sałatka
- caprese
- oliwki
- dip grecki
- sos feta

## **Dodatkowa reguła**

Jeżeli restaurator wpisze np.:

- „kurczak po gruzińsku”
- „gruziński placek z mięsem”
- „grecki talerz”
- „ryż z owocami morza”
- „grillowany ser”

agent powinien korzystać z analizy składników, kuchni, sposobu przygotowania i visualGroup, a nie tylko z dokładnej nazwy. Dzięki temu nowe nazwy będą poprawnie mapowane na istniejące obrazy bez konieczności ręcznego dodawania każdego wariantu.

# **ETAP 2D – Rozszerzenie biblioteki mapowania obrazków (Kuchnia Bliskiego Wschodu, Polska, Włoska, BBQ, Sushi, Azja, Indie, Meksyk, Gruzja, Śródziemnomorska, Ryby, Wege)**

Do biblioteki imageLibrary.json dodano kolejne kilkaset obrazków.

Agent ma automatycznie utworzyć dla KAŻDEGO z nich bogaty opis semantyczny.

Każdy rekord powinien posiadać strukturę:

{

"id":"",

"fileName":"",

"primaryName":"",

"category":"",

"cuisine":"",

"mealType":"",

"protein":"",

"ingredients":[],

"cookingMethods":[],

"fallbackTags":[],

"forbiddenTags":[],

"placeholderCategory":""

}



---



## **1. category**

Jedna główna kategoria.

Przykładowo:

- Zupa
- Pizza
- Makaron
- Burger
- BBQ
- Sushi
- Danie główne
- Danie rybne
- Danie wegańskie
- Danie wegetariańskie
- Przystawka
- Sałatka
- Dodatek
- Sos
- Napój
- Deser



---



## **2. cuisine**

Przykładowo:

- Polska
- Włoska
- Amerykańska BBQ
- Azjatycka
- Japońska
- Koreańska
- Chińska
- Tajska
- Indyjska
- Meksykańska
- Gruzińska
- Śródziemnomorska
- Bliskowschodnia
- Europejska
- Uniwersalna



---



## **3. mealType**

Przykładowo:

main_course

starter

soup

salad

dessert

snack

side_dish

breakfast

drink

sauce



---



## **4. protein**

Może zawierać wiele wartości.

Przykład:

duck

beef

veal

lamb

pork

chicken

turkey

fish

salmon

tuna

shrimp

seafood

vegetarian

vegan

tofu

paneer

beans

mushrooms



---



## **5. ingredients**

Lista najważniejszych składników.

Np.

Butter Chicken

kurczak

masło

śmietanka

pomidory

garam masala

imbir

czosnek



---



## **6. cookingMethods**

Np.

grill

fried

deep_fried

baked

steamed

boiled

roasted

smoked

stir_fry

tempura

raw

slow_cooked



---



## **7. fallbackTags**

To najważniejsze pole.

Ma zawierać WSZYSTKIE możliwe synonimy.

Przykład:

Kaczka po pekińsku

kaczka

drób

pieczona kaczka

azja

chińskie

danie z kaczki

mięso pieczone



---



Butter Chicken

kurczak

curry

indie

danie indyjskie

sos curry

kurczak w sosie



---



Fish and Chips

ryba

dorsz

panierka

smażona ryba

fish

fish and chips

frytki



---



Pizza Carbonara

pizza

pizza biała

pizza z boczkiem

pizza włoska

carbonara



---



## **8. forbiddenTags**

Obowiązkowo.

Np.

Butter Chicken

wege

wegan

ryba

deser



---



Pizza Pepperoni

wege

wegan

ryba

deser



---



Falafel

wołowina

wieprzowina

kurczak

ryba



---



## **9. placeholderCategory**

Każdy obrazek ma należeć do jednej głównej grupy placeholderów.

Przykładowo:

polish_meat

  


polish_soup

  


asian_noodles

  


asian_soup

  


pizza

  


pasta

  


burger

  


bbq

  


fish

  


vegan

  


vegetarian

  


salad

  


dessert

  


drink

  


breakfast

  


side_dish

  


sauce

  


street_food

  


middle_east

  


mexican

  


indian

  


georgian

  


mediterranean

  


sushi



---



# **Zasady dopasowania**

Agent nie może szukać wyłącznie po nazwie.

Najpierw analizuje nazwę potrawy.

Wyciąga:

- kuchnię
- główny składnik
- rodzaj mięsa
- sposób przygotowania
- kategorię
- dodatki
- czy danie jest wege
- czy jest rybą
- czy jest deserem

Następnie liczy podobieństwo z rekordami imageLibrary.

Kolejność:

1. Exact Match
2. Synonimy (fallbackTags)
3. Składniki
4. Kuchnia
5. Typ dania
6. Metoda przygotowania
7. Placeholder tej samej kategorii

Nigdy nie wolno wybierać obrazka z kategorią sprzeczną z forbiddenTags.

# **ETAP 2E – Rozszerzenie biblioteki o Menu Dziecięce i Śniadaniowe**

Do biblioteki obrazków dodano kolejne zestawy zdjęć:

- Kids Menu
- Breakfast Menu

Agent ma automatycznie wygenerować komplet danych semantycznych dla każdego nowego obrazka zgodnie z wcześniej opisaną strukturą (primaryName, category, cuisine, mealType, protein, ingredients, cookingMethods, fallbackTags, forbiddenTags, placeholderCategory).



---



## **Szczególna logika dla Kids Menu**

Menu dziecięce nie powinno być traktowane jako osobna kuchnia.

Każdy obrazek powinien posiadać dwa poziomy klasyfikacji.

Przykład:

{

  "mealType": "kids",

  "category": "burger",

  "placeholderCategory": "kids_menu"

}

lub

{

  "mealType":"kids",

  "category":"pizza",

  "placeholderCategory":"kids_menu"

}

Dzięki temu:

- Mini Pizza może być użyta jako zdjęcie dla Pizza Dziecięca.
- Mini Burger dla Burger Junior.
- Nuggetsy dla Nuggets Kids.
- Pancakes dla Pancakes Kids.

Jednocześnie nie należy proponować zdjęć z menu dziecięcego do zwykłych pozycji premium, jeżeli istnieją lepsze odpowiedniki.



---



## **Rozpoznawanie wersji dziecięcych**

Agent powinien automatycznie wykrywać słowa:

kids

junior

dziecięce

dla dzieci

mini

kids menu

happy meal

junior menu

Jeżeli występują, priorytet mają obrazki z placeholderCategory:

kids_menu



---



## **Śniadania**

Śniadania powinny zostać potraktowane jako osobna grupa.

Nowe placeholderCategory:

breakfast_eggs

breakfast_sweet

breakfast_sandwich

breakfast_pancakes

breakfast_cereal

breakfast_drinks

breakfast_pastry



---



## **Śniadania jajeczne**

Przykłady:

- jajecznica
- omlet
- eggs benedict
- szakszuka
- jajka sadzone
- breakfast burrito
- egg muffin

Powinny posiadać wspólne fallbackTags:

jajka

śniadanie

breakfast

egg

morning



---



## **Śniadania słodkie**

Dotyczy:

- pancakes
- gofry
- owsianka
- pudding
- chia
- kasza manna
- naleśniki śniadaniowe

Wspólne fallbackTags:

śniadanie

na słodko

sweet breakfast

pancakes

waffles

dessert breakfast



---



## **Pieczywo śniadaniowe**

Dotyczy:

- avocado toast
- bajgle
- croissanty
- english muffin
- croque madame

Wspólne fallbackTags:

pieczywo

kanapka

toast

breakfast

bagel

croissant



---



## **Napoje śniadaniowe**

Dotyczy:

- sok pomarańczowy
- smoothie bowl
- jogurt
- mleko

Nie powinny być dopasowywane do napojów gazowanych ani koktajli alkoholowych.



---



## **Dodatkowa reguła**

Jeżeli restaurator wpisze nazwę:

- "Śniadanie Firmowe"
- "Breakfast Set"
- "Śniadanie Szefa"
- "Zestaw śniadaniowy"

i nie istnieje dokładne zdjęcie,

należy wybrać placeholder:

breakfast_generic

zamiast przypadkowego zdjęcia jajecznicy lub naleśników.

# **ETAP 2F – Rozszerzenie biblioteki o Ciasta i Desery Restauracyjne**

Do biblioteki dodano kolejną grupę obrazków:

- Ciasta
- Torty
- Tarty
- Monoporcje
- Desery restauracyjne
- Desery w pucharkach
- Musy
- Panna Cotta
- Creme Brulee
- Fondant
- Suflety

Każdy obrazek ma zostać opisany zgodnie z wcześniej zdefiniowaną strukturą.



---



# **Nowe placeholderCategory**

Agent powinien utworzyć nowe grupy placeholderów.

dessert_cake

dessert_cheesecake

dessert_chocolate

dessert_fruit

dessert_icecream

dessert_tart

dessert_pastry

dessert_mousse

dessert_glass

dessert_premium

dessert_traditional

dessert_monoporcja

dessert_hot

dessert_cold



---



# **category**

Przykładowe wartości

cake

cheesecake

tart

brownie

mousse

panna_cotta

creme_brulee

fondant

souffle

parfait

verrine

dessert



---



# **mealType**

Każdy rekord powinien otrzymać

dessert

Natomiast dodatkowo agent powinien określić

cold_dessert

  


hot_dessert

  


baked_dessert

  


layered_dessert

  


glass_dessert

  


restaurant_dessert

jeżeli dotyczy.



---



# **cuisine**

Przykładowo

Polska

Francuska

Włoska

Amerykańska

Brytyjska

Austriacka

Europejska

Międzynarodowa



---



# **ingredients**

Agent powinien automatycznie wykrywać najważniejsze składniki.

Przykład

Sernik

twaróg

ser

masło

jajka

cukier

wanilia



---



Brownie

czekolada

masło

kakao

jajka

mąka



---



Panna Cotta

śmietanka

żelatyna

wanilia

cukier



---



Fondant

gorzka czekolada

masło

jajka

kakao



---



# **cookingMethods**

Przykładowo

baked

  


chilled

  


frozen

  


caramelized

  


layered

  


whipped



---



# **fallbackTags**

Powinny obejmować:

- synonimy
- nazwy angielskie
- typ deseru
- główny składnik
- sposób podania

Przykład

Tiramisu

tiramisu

  


dessert

  


italian dessert

  


mascarpone

  


coffee dessert

  


cake

  


glass dessert



---



Brownie

brownie

  


cake

  


chocolate cake

  


dessert

  


cocoa

  


baked dessert



---



Panna Cotta

dessert

  


cream dessert

  


panna cotta

  


glass dessert

  


italian dessert

  


cold dessert



---



# **forbiddenTags**

Przykładowo

Brownie

pizza

  


burger

  


soup

  


fish

  


drink



---



# **Dodatkowe grupowanie deserów**

Agent powinien automatycznie rozpoznawać podobieństwa.

Przykład

Każdy sernik należy do grup:

sernik

  


cheesecake

  


cake

  


dessert



---



Każda Panna Cotta

panna cotta

  


dessert

  


glass dessert

  


cold dessert



---



Każdy mus

mousse

  


glass dessert

  


dessert



---



Każdy fondant

fondant

  


lava cake

  


hot dessert

  


chocolate dessert



---



# **Automatyczne rozpoznawanie nazw restauracyjnych**

Jeżeli restaurator wpisze

Deser dnia

  


Słodka niespodzianka

  


Chef Dessert

  


Deser Szefa

  


Premium Dessert

i nie znajdzie dokładnego zdjęcia,

agent NIE wybiera losowego sernika.

Powinien użyć placeholdera

dessert_premium



---



# **Wyszukiwanie semantyczne**

Przykład

Restaurator wpisuje

Sernik pistacjowy

Jeżeli nie istnieje,

agent powinien znaleźć:

1. dowolny sernik
2. cheesecake
3. cake
4. dessert_cake
5. dessert_premium



---



Restaurator wpisuje

Mus czekoladowy z wiśniami

Kolejność:

1. mousse chocolate
2. mousse
3. dessert_glass
4. dessert_chocolate
5. dessert_premium



---



## **💡 Moja propozycja (bardzo ważna)**

Patrząc na wszystko, co mi już wysłałeś (jest tego około **500–600 pozycji**), widzę, że da się zbudować system znacznie lepszy niż same tagi. Na końcu zaproponuję agentowi wygenerowanie **grafu kulinarnego (Food Knowledge Graph)**. Przykładowo:

- Pizza → Pizza Pepperoni → Pizza z salami → Pizza mięsna → Kuchnia włoska
- Łosoś → Ryba → Owoce morza → Danie główne → Grillowane
- Tiramisu → Deser → Deser włoski → Deser w pucharku → Z mascarpone

Dzięki temu, gdy restaurator wpisze **"Pizza z salami piccante"**, mimo że nie masz takiego zdjęcia, AI przejdzie po grafie i wybierze zdjęcie **Pizza Pepperoni**, a nie przypadkową pizzę. To będzie działało znacznie lepiej niż zwykłe porównywanie tekstu i pozwoli skalować bibliotekę nawet do dziesiątek tysięcy potraw.

## **KATEGORIA: DESERY PREMIUM / PATISSERIE**

### **1. Monoporcje i ekskluzywne desery cukiernicze**

**Produkty:**

- Monoporcja mirror glaze z czerwonym szkliwem i złotem
- Monoporcja pistacjowa z zieloną polewą lustrzaną
- Monoporcja malinowo-biała czekolada
- Monoporcja czarna porzeczka premium
- Geometryczna monoporcja velvet cube
- Kostka musowa marakuja-czekolada

**Opis dla AI:**  
 Ekskluzywne francuskie desery cukiernicze klasy premium. Charakteryzują się geometrycznymi formami, błyszczącymi polewami lustrzanymi, aksamitnymi strukturami velvet oraz dekoracjami premium (złoto jadalne, kwiaty, owoce liofilizowane). Kategorie stosowane w restauracjach fine dining, cukierniach premium i hotelach.

**Tagi AI:**  
 dessert, premium, fine dining, monoporcja, patisserie, luxury dessert, francuska cukiernia



---



### **2. Makaroniki francuskie**

**Produkty:**

- Makaronik różany
- Makaronik malinowy
- Makaronik pistacjowy
- Makaronik waniliowy
- Makaronik słony karmel
- Makaronik podwójnie czekoladowy
- Makaronik kokosowy
- Makaronik matcha
- Makaronik cytrynowy

**Opis dla AI:**  
 Kolorowe francuskie ciasteczka migdałowe typu macaron z kremowym nadzieniem. Produkty premium wykorzystywane jako deser bankietowy, dodatek kawowy, zestawy prezentowe oraz dekoracja witryn cukierniczych.

**Tagi AI:**  
 macaron, francuski deser, cukiernia, słodkości, premium bakery



---



## **KATEGORIA: KAWA**

### **1. Klasyczne kawy espresso**

**Produkty:**

- Espresso
- Double Espresso
- Ristretto
- Espresso Macchiato
- Doppio

**Opis dla AI:**  
 Podstawowe produkty kawowe przygotowywane na bazie espresso. Kategorie stosowane w kawiarniach, restauracjach i barach.

**Tagi AI:**  
 coffee, espresso, barista, kawiarnia, napoje gorące



---



### **2. Kawy mleczne**

**Produkty:**

- Cappuccino
- Latte Macchiato
- Flat White
- Cortado
- Caramel Macchiato

**Opis dla AI:**  
 Kawy espresso połączone ze spienionym mlekiem. Popularne napoje śniadaniowe oraz kawiarniane.

**Tagi AI:**  
 milk coffee, latte, cappuccino, coffee shop



---



### **3. Kawy deserowe i specjalne**

**Produkty:**

- Mocha
- Espresso Martini
- Affogato
- Pumpkin Spice Latte
- Dirty Chai Latte
- Espresso Tonic

**Opis dla AI:**  
 Kawy specjalne łączące espresso z deserami, przyprawami, lodami lub dodatkami premium.

**Tagi AI:**  
 specialty coffee, dessert coffee, modern cafe



---



## **KATEGORIA: HERBATY I NAPARY**

### **1. Herbaty klasyczne**

**Produkty:**

- Earl Grey
- Zielona herbata
- Rooibos
- Oolong
- Czarna herbata z mlekiem

**Opis dla AI:**  
 Tradycyjne herbaty liściaste i klasyczne napary serwowane w gastronomii.

**Tagi AI:**  
 tea, hot beverage, herbata, napar



---



### **2. Herbaty premium i ceremoniał**

**Produkty:**

- Matcha Latte
- Matcha Ceremony
- Blooming Tea
- Marokańska herbata miętowa
- Yerba Mate
- Masala Chai

**Opis dla AI:**  
 Premium napoje herbaciane inspirowane kulturami świata, często wykorzystywane w kawiarniach specialty.

**Tagi AI:**  
 premium tea, matcha, ceremony, asian tea



---



## **KATEGORIA: NAPOJE ZIMNE**

### **1. Lemoniady i napoje rzemieślnicze**

**Produkty:**

- Lemoniada cytrynowa
- Lemoniada arbuzowa
- Lemoniada lawendowa
- Lemoniada mango-chili
- Elderflower
- Spritzery owocowe

**Opis dla AI:**  
 Naturalne napoje chłodzące przygotowywane na bazie owoców, ziół i świeżych dodatków.

**Tagi AI:**  
 lemonade, cold drinks, craft beverage, summer drinks



---



## **KATEGORIA: ALKOHOLE**

### **1. Koktajle klasyczne**

**Produkty:**

- Mojito
- Margarita
- Aperol Spritz
- Old Fashioned
- Negroni
- Cosmopolitan
- Martini
- Piña Colada

**Opis dla AI:**  
 Klasyczne koktajle barowe stosowane w restauracjach, hotelach i cocktail barach.

**Tagi AI:**  
 cocktail, bar, drink, mixology



---



### **2. Piwa**

**Produkty:**

- IPA
- Lager
- Stout
- Porter
- Hefeweizen
- Sour Ale
- Amber Ale

**Opis dla AI:**  
 Kategorie piw kraftowych i klasycznych wykorzystywane w gastronomii.

**Tagi AI:**  
 beer, craft beer, pub, bar



---



### **3. Wina**

**Produkty:**

- Wino czerwone
- Wino białe
- Rosé
- Prosecco
- Szampan
- Sangria
- Porto

**Opis dla AI:**  
 Produkty alkoholowe do karty win restauracji, degustacji oraz obsługi eventów.

**Tagi AI:**  
 wine, sommelier, restaurant, premium alcohol

# **KATEGORIA: CATERING / BANKIETY / FINGER FOOD**

## **1. Zestawy cateringowe mięsne**

**Produkty:**

- Koryto biesiadne (wielki półmisek mięs)
- Półmisek mięs z grilla
- Box z chrupiącymi polędwiczkami
- Cateringowe zestawy grillowe
- Zestawy imprezowe z kurczakiem, kiełbasami i przekąskami mięsnymi

**Opis dla AI:**  
 Duże zestawy gastronomiczne przeznaczone na imprezy, wesela, eventy i obsługę grupową. Zawierają grillowane mięsa, przekąski ciepłe, dodatki oraz sosy. Typowe dla cateringu bankietowego i restauracji oferujących obsługę wydarzeń.

**Tagi AI:**  
 catering, bankiet, party food, grill, event catering, large platter



---



## **2. Mini przekąski bankietowe (Finger Food)**

**Produkty:**

- Mini burgery typu Sliders
- Mini hot-dogi
- Mini tacos
- Koreczki Caprese
- Szaszłyki finger-food
- Bruschetty
- Tortilla rolls
- Mini quiche
- Vol-au-vent
- Mini tartaletki wytrawne

**Opis dla AI:**  
 Małe porcje przekąsek przeznaczone do jedzenia bez sztućców podczas przyjęć, konferencji i wydarzeń. Produkty często serwowane na tacach cateringowych.

**Tagi AI:**  
 finger food, party snacks, buffet, banquet, cocktail party



---



## **3. Catering boxy i zestawy imprezowe**

**Produkty:**

- Catering box z kanapkami bankietowymi
- Box z mini deserami
- Box z makaronikami premium
- Box z sałatkami porcjowanymi
- Zestawy sushi catering
- Zestawy przekąsek mieszanych

**Opis dla AI:**  
 Gotowe zestawy cateringowe przygotowane do transportu i obsługi wydarzeń. Mogą zawierać przekąski zimne, słodkie, sushi, kanapki lub desery premium.

**Tagi AI:**  
 catering box, take away, event package, corporate catering



---



## **4. Deski i półmiski premium**

**Produkty:**

- Deska serów i wędlin premium
- Zimna płyta
- Półmisek owoców morza
- Patera świeżych owoców
- Półmisek Mezze
- Drewniane koryta warzywne

**Opis dla AI:**  
 Eleganckie półmiski restauracyjne przeznaczone do dzielenia się jedzeniem. Popularne w restauracjach premium, hotelach i podczas eventów.

**Tagi AI:**  
 sharing platter, premium board, charcuterie, mezze, seafood platter



---



# **KATEGORIA: SOSY / DIPY / DODATKI GASTRONOMICZNE**

## **1. Sosy klasyczne**

**Produkty:**

- Ketchup
- Majonez
- Sos czosnkowy
- Sos tatarski
- Musztarda francuska
- Sos BBQ

**Opis dla AI:**  
 Podstawowe sosy gastronomiczne używane jako dodatki do burgerów, frytek, mięs, przekąsek i dań obiadowych.

**Tagi AI:**  
 sauce, dip, condiment, restaurant sauce



---



## **2. Sosy kuchni świata**

**Produkty:**

- Guacamole
- Pico de Gallo
- Salsa pomidorowa
- Tzatziki
- Tahini
- Hummus
- Chimichurri
- Sos Satay
- Pesto bazyliowe

**Opis dla AI:**  
 Regionalne sosy i pasty inspirowane kuchniami świata. Stosowane jako dodatki do dań meksykańskich, śródziemnomorskich, azjatyckich i wegetariańskich.

**Tagi AI:**  
 international sauce, world cuisine, dip, vegetarian, vegan



---



## **3. Sosy pikantne i nowoczesne**

**Produkty:**

- Sriracha
- Sriracha Mayo
- Chipotle Mayo
- Sweet Chili
- Mango Chutney

**Opis dla AI:**  
 Nowoczesne sosy o profilu ostrym, słodko-pikantnym lub dymnym. Popularne w burgerowniach, street foodzie i kuchni fusion.

**Tagi AI:**  
 spicy sauce, street food, fusion, hot sauce



---



## **4. Sosy premium i dodatki luksusowe**

**Produkty:**

- Majonez truflowy
- Krem balsamiczny
- Oliwa Extra Virgin
- Sos Blue Cheese
- Oliwy aromatyzowane

**Opis dla AI:**  
 Produkty premium wykorzystywane w restauracjach wyższej klasy, kuchni europejskiej oraz daniach fine dining.

**Tagi AI:**  
 premium ingredient, fine dining, gourmet, luxury food



---



## **5. Dodatki przekąskowe**

**Produkty:**

- Nachosy
- Oliwki
- Pikle
- Orzechy
- Dodatki barowe

**Opis dla AI:**  
 Małe dodatki gastronomiczne wykorzystywane jako przekąski, elementy półmisków oraz dodatki do napojów i koktajli.

**Tagi AI:**  
 snacks, bar food, garnish, appetizer

# **KATEGORIA: CATERING / PRZEKĄSKI BANKIETOWE**

## **1. Duże półmiski i zestawy imprezowe**

**Produkty:**

- Koryto biesiadne
- Półmisek mięs z grilla
- Deska serów i wędlin premium
- Półmisek tradycyjnych zimnych płyt
- Drewniane koryto z pieczonymi warzywami

**Opis dla AI:**

Duże restauracyjne półmiski i zestawy cateringowe przeznaczone na imprezy, wesela, bankiety oraz wydarzenia firmowe. Charakteryzują się dużą ilością jedzenia, efektownym ułożeniem produktów, drewnianymi deskami, półmiskami gastronomicznymi oraz dekoracją z warzyw, sosów i dodatków.

**Tagi AI:**

catering platter, banquet food, party tray, restaurant catering, buffet table



---



## **2. Mini przekąski finger food**

**Produkty:**

- Catering box z kanapkami bankietowymi
- Mini burgery Sliders
- Szaszłyki finger food
- Mini hot-dogi
- Koreczki Caprese
- Bruschetty
- Mini tacos

**Opis dla AI:**

Małe porcjowane przekąski restauracyjne przeznaczone na catering i przyjęcia. Produkty prezentowane w pudełkach cateringowych, na tacach lub stojakach. Charakterystyczne elementy to miniaturowy rozmiar, dekoracyjne ułożenie, różnorodne składniki oraz elegancka prezentacja.

**Tagi AI:**

finger food, catering box, party snacks, appetizers, event catering



---



## **3. Catering premium i słodkie boxy**

**Produkty:**

- Pudełko ze słodkimi miniporcjami
- Catering box z makaronikami i pralinami
- Mini tartaletki
- Eklerki cateringowe
- Desery bankietowe

**Opis dla AI:**

Ekskluzywne zestawy deserowe przygotowane dla restauracji, kawiarni oraz cateringu premium. Charakteryzują się małymi porcjami, eleganckim wykończeniem, kolorowymi dekoracjami oraz estetycznym ułożeniem w pudełkach prezentowych.

**Tagi AI:**

premium dessert box, pastry catering, luxury sweets, french pastry



---



Czyli każda kolejna plansza, którą będziesz wrzucał, będę konwertował właśnie tak.

Dodatkowo będę pilnował jeszcze jednej rzeczy ważnej dla Twojej aplikacji Gastro-Manager:

- **Produkt → Grupa AI → Kategoria → Placeholder obrazka**

czyli np.:

Schab pieczony ze śliwką

↓

Tradycyjne pieczenie świąteczne

↓

Kuchnia świąteczna / dania sezonowe

↓

placeholder_roast_holiday_meat_01

albo:

Kajzerka

Bułka brioche

Bajgiel

↓

Pieczywo śniadaniowe

↓

Pieczywo / wyroby piekarnicze

↓

placeholder_breakfast_bread_01

# **KATEGORIA: PIECZYWO / WYROBY PIEKARNICZE**

## **1. Chleby tradycyjne i rzemieślnicze**

**Produkty:**

- Chleb rzemieślniczy na zakwasie
- Chleb żytni
- Chleb ziemniaczany / wiejski
- Pumpernikiel

**Opis dla AI:**

Tradycyjne bochenki chleba wypiekane metodami rzemieślniczymi. Charakteryzują się grubą chrupiącą skórką, rustykalnym wyglądem, nieregularnym kształtem oraz widoczną strukturą mąki i ziaren. Produkty wykorzystywane w restauracjach, piekarniach, śniadaniach oraz jako dodatek do dań głównych.

**Tagi AI:**

artisan bread, sourdough bread, traditional bakery, rustic bread, restaurant bread



---



## **2. Bułki śniadaniowe i pieczywo porcjowane**

**Produkty:**

- Kajzerka tradycyjna
- Bułka burgerowa brioche
- Bułeczki bankietowe
- Bajgiel
- Muffin angielski

**Opis dla AI:**

Małe pieczywo porcjowane przeznaczone do śniadań, burgerów, kanapek oraz cateringu. Charakteryzuje się regularnym kształtem, złocistą skórką, miękkim wnętrzem oraz dekoracyjnymi dodatkami takimi jak sezam, ziarna lub posypki.

**Tagi AI:**

breakfast bakery, buns, burger bun, sandwich bread, catering bread



---



## **3. Europejskie pieczywo i wypieki**

**Produkty:**

- Bagietka francuska
- Ciabatta
- Focaccia z rozmarynem
- Grissini
- Precel tradycyjny
- Croissant
- Pain au chocolat
- Chałka

**Opis dla AI:**

Międzynarodowe wyroby piekarnicze charakterystyczne dla kuchni europejskiej. Produkty o wyraźnej strukturze ciasta, warstwowej powierzchni lub chrupiącej skórce. Stosowane podczas śniadań, serwisu kawowego, degustacji win oraz jako dodatki restauracyjne.

**Tagi AI:**

european bakery, french pastry, italian bread, breakfast pastry, bakery products



---



## **4. Pieczywo świata i produkty mączne**

**Produkty:**

- Chlebek pita
- Indyjski Naan
- Tortille pszenne
- Tortille kukurydziane
- Chipsy z pity
- Nachosy kukurydziane

**Opis dla AI:**

Produkty zbożowe inspirowane kuchniami świata. Charakteryzują się płaskim kształtem, cienką strukturą lub formą przekąskową. Wykorzystywane do dań orientalnych, meksykańskich, street food oraz zestawów z sosami.

**Tagi AI:**

world cuisine bread, flatbread, tortilla, mexican food, street food



---



## **5. Dodatki piekarnicze i serwisowe**

**Produkty:**

- Grzanka z masłem czosnkowym
- Kostki grzanek do zup
- Puszyste masło

**Opis dla AI:**

Dodatki przygotowywane jako uzupełnienie pieczywa, zup, śniadań oraz dań restauracyjnych. Charakterystyczne elementy wizualne to małe porcje, złociste wypieki, masło w miseczkach oraz dodatki do samodzielnego komponowania potraw.

**Tagi AI:**

bread accessories, restaurant garnish, toast, butter, bakery side



---



# **KATEGORIA: KUCHNIA POLSKA / DANIA TRADYCYJNE**

## **1. Polskie dania mączne i ziemniaczane**

**Produkty:**

- Pyzy ziemniaczane z mięsem
- Kopytka tradycyjne
- Kluski śląskie
- Kartacze / Cepeliny
- Knedle ze śliwkami
- Kluski leniwe
- Pampuchy / kluski na parze
- Kluski przecierane
- Paluszki ziemniaczane panierowane

**Opis dla AI:**

Tradycyjne polskie dania przygotowywane z ziemniaków, mąki oraz twarogu. Charakteryzują się prostą, domową formą, okrągłymi lub podłużnymi kształtami, dodatkami takimi jak skwarki, cebula, masło, sosy lub słodkie nadzienia.

**Tagi AI:**

polish cuisine, traditional dumplings, potato dishes, homemade food, comfort food



---



## **2. Pierogi i dania faszerowane**

**Produkty:**

- Pierogi ruskie podsmażane
- Pierogi pieczone z kapustą i grzybami
- Pierogi na słodko z twarogiem
- Gołąbki tradycyjne
- Rolada śląska

**Opis dla AI:**

Klasyczne polskie dania bazujące na cieście i farszu. Charakterystyczne elementy wizualne to półksiężycowe pierogi, złociste podsmażenie, nadzienia mięsne lub warzywne oraz tradycyjne dodatki takie jak cebulka, śmietana i sosy.

**Tagi AI:**

polish traditional food, dumplings, stuffed dishes, eastern european cuisine



---



## **3. Placki, racuchy i dania smażone**

**Produkty:**

- Placki ziemniaczane chrupiące
- Placek po zbójnicku
- Racuchy z jabłkami
- Baba ziemniaczana

**Opis dla AI:**

Smażone i pieczone dania kuchni polskiej o złocistej powierzchni. Mogą być podawane zarówno jako dania wytrawne z mięsem i sosami, jak również jako słodkie potrawy z owocami, cukrem pudrem lub śmietaną.

**Tagi AI:**

fried food, polish pancakes, potato dishes, traditional restaurant food



---



## **4. Polskie dania mięsne i obiadowe**

**Produkty:**

- Pulpety w sosie koperkowym
- Biała kiełbasa zasmażana z cebulką
- Rolada śląska z modrą kapustą
- Bigos staropolski

**Opis dla AI:**

Tradycyjne polskie dania obiadowe bazujące na mięsie, kapuście oraz sosach. Charakteryzują się domowym stylem podania, głębokimi kolorami, gęstymi sosami oraz dodatkami typowymi dla kuchni regionalnej.

**Tagi AI:**

polish dishes, traditional meat, homemade cuisine, regional food



---



## **5. Sosy i dodatki kuchni polskiej**

**Produkty:**

- Kwaśna śmietana
- Skwarki
- Cebulka smażona
- Sosy do dań mącznych

**Opis dla AI:**

Dodatki stosowane do tradycyjnych polskich potraw takich jak pierogi, placki, kluski oraz dania ziemniaczane. Charakteryzują się prostą prezentacją w małych miseczkach lub jako dekoracyjne wykończenie dania.

**Tagi AI:**

polish food garnish, traditional sauce, restaurant topping, food accessories



---



## **Mapowanie placeholderów AI (propozycja)**

artisan_bread_rustic_01

↓

Chleb rzemieślniczy / żytni / wiejski / pumpernikiel

  
  


breakfast_buns_01

↓

Kajzerka / brioche / bajgiel / muffin

  
  


european_bakery_01

↓

Bagietka / croissant / focaccia / grissini

  
  


flatbread_world_01

↓

Pita / naan / tortilla / nachosy

  
  


polish_dumplings_01

↓

Pyzy / kluski / kopytka / kartacze

  
  


polish_pierogi_01

↓

Pierogi wszystkie warianty

  
  


polish_traditional_dishes_01

↓

Gołąbki / bigos / rolada / biała kiełbasa

  
  


polish_fried_food_01

↓

Placki / racuchy / baba ziemniaczana

# **KATEGORIA: SOSY / DIPS / DRESSINGI**

## **1. Sosy śmietanowe i kremowe**

**Produkty:**

- Sos śmietankowo-ziołowy
- Sos pieprzowy
- Sos chrzanowy
- Sos koperkowo-cytrynowy
- Sos jogurtowo-miętowy
- Sos Carbonara
- Sos Cajun
- Sos aioli z pieczonym czosnkiem

**Opis dla AI:**

Kremowe sosy przygotowywane na bazie śmietany, jogurtu, majonezu lub emulsji jajeczno-maślanych. Najczęściej podawane do mięs, ryb, makaronów, warzyw oraz dań grillowanych. Placeholder jednego sosu kremowego może zostać wykorzystany dla wielu podobnych sosów o jasnej barwie i gładkiej konsystencji.

**Tagi AI:**

cream sauce, white sauce, garlic sauce, yogurt sauce, herb sauce, aioli, creamy dip, restaurant sauce



---



## **2. Sosy mięsne i pieczeniowe**

**Produkty:**

- Sos pieczeniowy (Gravy)
- Demi-Glace
- Sos Bolognese
- Sos Bourbon BBQ

**Opis dla AI:**

Gęste, ciemne sosy przygotowywane na bazie mięsa, wywarów, pieczeni lub długo redukowanych bulionów. Wykorzystywane do wołowiny, wieprzowiny, makaronów, burgerów oraz dań premium.

**Tagi AI:**

brown sauce, meat sauce, gravy, demi glace, bbq sauce, beef sauce



---



## **3. Sosy grzybowe i owocowe**

**Produkty:**

- Sos kurkowy
- Sos śliwkowy
- Sos borówkowy
- Sos żurawinowy

**Opis dla AI:**

Sosy przygotowywane z grzybów lub owoców leśnych. Najczęściej podawane do pieczonych mięs, dziczyzny, drobiu, serów oraz dań świątecznych. AI powinno traktować podobne owocowe dodatki jako jedną rodzinę wizualną.

**Tagi AI:**

mushroom sauce, cranberry sauce, plum sauce, berry sauce, gourmet sauce



---



## **4. Sosy klasyczne kuchni świata**

**Produkty:**

- Sos Curry
- Sos Holenderski
- Sos Béarnaise
- Sos Satay
- Sos sojowo-miodowy
- Sos słodko-kwaśny

**Opis dla AI:**

Międzynarodowe sosy charakterystyczne dla kuchni azjatyckiej, francuskiej i europejskiej. Różnią się kolorem i składnikami, jednak pełnią podobną funkcję jako dodatki do mięs, ryb, makaronów oraz warzyw.

**Tagi AI:**

international sauce, asian sauce, french sauce, curry sauce, satay, hollandaise



---



## **5. Dodatki do degustacji sosów**

**Produkty:**

- Miseczka z grissini

**Opis dla AI:**

Produkty wykorzystywane jako dodatki do degustacji sosów, dipów oraz przystawek. Placeholder może zostać wykorzystany również dla pieczywa podawanego do sosów.

**Tagi AI:**

breadsticks, grissini, appetizer, dip accessory



---



# **KATEGORIA: ŚNIADANIA**

## **1. Dania jajeczne**

**Produkty:**

- Omlet francuski
- Szakszuka
- Jajka po turecku (Çılbır)
- Jajka w gnieździe ziemniaczanym

**Opis dla AI:**

Śniadania oparte na jajkach przygotowywanych w różnych technikach: smażonych, pieczonych, gotowanych w koszulce lub zapiekanych. Placeholder jednego dania jajecznego może zostać użyty dla podobnych pozycji śniadaniowych.

**Tagi AI:**

breakfast eggs, omelette, shakshuka, poached eggs, egg breakfast



---



## **2. Śniadania klasyczne i restauracyjne**

**Produkty:**

- Pełne śniadanie angielskie
- Breakfast Burrito
- Śniadaniowa Quesadilla
- Mini burgery śniadaniowe
- Hash z batatów

**Opis dla AI:**

Obfite śniadania restauracyjne zawierające jajka, mięso, pieczywo, warzywa i dodatki. AI powinno rozpoznawać je jako kompletny talerz śniadaniowy niezależnie od kuchni świata.

**Tagi AI:**

breakfast plate, brunch, english breakfast, breakfast burrito, restaurant breakfast



---



## **3. Kanapki i pieczywo śniadaniowe**

**Produkty:**

- Bajgiel z łososiem
- Awokado Toast
- Croque Monsieur

**Opis dla AI:**

Śniadania bazujące na pieczywie z dodatkiem ryb, serów, jaj lub warzyw. Placeholder jednego rodzaju tostu lub bajgla może zostać wykorzystany dla podobnych kanapek premium.

**Tagi AI:**

toast, bagel, breakfast sandwich, avocado toast, brunch



---



## **4. Śniadania słodkie**

**Produkty:**

- Placuszki Ricotta
- Dutch Baby
- Cynamonka
- Scones
- Pudding Chia
- Pieczona owsianka
- Granola z jogurtem
- Paluszki z tostów francuskich

**Opis dla AI:**

Słodkie śniadania i brunche przygotowywane z ciasta, zbóż, owoców oraz nabiału. Produkty należą do jednej rodziny wizualnej i mogą współdzielić placeholdery w przypadku braku idealnego dopasowania.

**Tagi AI:**

sweet breakfast, pancakes, granola, oatmeal, french toast, brunch dessert



---



## **5. Śniadaniowe dodatki**

**Produkty:**

- Masło ziołowe

**Opis dla AI:**

Dodatki serwowane do pieczywa, tostów oraz śniadań restauracyjnych. Placeholder może zostać wykorzystany dla różnych rodzajów maseł smakowych i dodatków do pieczywa.

**Tagi AI:**

breakfast butter, herb butter, bread spread, breakfast side

# **KATEGORIA: DANIA WEGAŃSKIE / WEGETARIAŃSKIE / ROŚLINNE**

## **1. Bowle, sałatki i dania fit**

**Produkty:**

- Wegański Buddha Bowl
- Ciepła sałatka z komosą i warzywami
- Wegańska miska z szarpanym jackfruitem
- Salsa z mango i awokado

**Opis dla AI:**

Kolorowe dania roślinne serwowane w miskach lub jako nowoczesne sałatki lunchowe. Zawierają komosę ryżową, ryż, kasze, tofu, warzywa, rośliny strączkowe, owoce, awokado oraz świeże zioła. W aplikacji wszystkie podobne bowl'e, power bowls, vegan bowls, poke bowls bez ryb oraz zdrowe sałatki mogą korzystać ze wspólnej grupy placeholderów.

**Tagi AI:**

vegan bowl, buddha bowl, healthy food, quinoa bowl, salad bowl, vegetarian meal, plant based



---



## **2. Roślinne dania główne**

**Produkty:**

- Wegański strogonow grzybowy
- Wegańskie gołąbki z soczewicą
- Pieczeń z soczewicy (Lentil Loaf)
- Wegańska zapiekanka pasterska (Shepherd's Pie)
- Ratatouille

**Opis dla AI:**

Sycące dania obiadowe bazujące na warzywach, roślinach strączkowych i grzybach. Stanowią roślinne odpowiedniki klasycznych dań mięsnych. Placeholder jednego dania może zostać wykorzystany dla podobnych pieczeni warzywnych, gulaszy, zapiekanek lub dań jednogarnkowych.

**Tagi AI:**

vegan main course, vegetarian dinner, plant based meal, lentil loaf, vegetable casserole, stew



---



## **3. Kuchnia azjatycka i orientalna**

**Produkty:**

- Wegański Pad Thai
- Dahl z ciecierzycy i szpinaku
- Kalafior Tikka Masala
- Tofu Katsu Curry
- Wok z warzywami i tempehem

**Opis dla AI:**

Roślinne dania inspirowane kuchnią azjatycką i indyjską. Bazują na tofu, tempehu, warzywach, makaronach, ryżu, curry oraz orientalnych przyprawach. AI powinno traktować podobne dania stir-fry, curry oraz potrawy z tofu jako jedną rodzinę wizualną.

**Tagi AI:**

asian vegan, tofu, curry, stir fry, pad thai, indian food, vegan asian cuisine



---



## **4. Dania z makaronów, ryżu i klusek**

**Produkty:**

- Gnocchi z batatów
- Risotto z dynią
- Lasagne z cukinii
- Wegański Mac and Cheese

**Opis dla AI:**

Roślinne dania wykorzystujące makaron, ryż, gnocchi oraz zapiekanki. Mogą być serwowane jako samodzielne obiady lub dania restauracyjne. W przypadku braku idealnego zdjęcia AI może wykorzystać placeholder podobnego makaronu lub risotto.

**Tagi AI:**

vegan pasta, risotto, gnocchi, vegan lasagna, mac and cheese, comfort food



---



## **5. Kotlety, steki i przekąski roślinne**

**Produkty:**

- Falafle
- Stek z kalafiora
- Steki z boczniaków
- Faszerowane Portobello
- Frytki z polenty z aioli

**Opis dla AI:**

Roślinne alternatywy dla klasycznych dań mięsnych oraz przekąsek. Obejmują kotlety warzywne, steki z warzyw, grillowane grzyby oraz chrupiące dodatki. Placeholder może zostać wykorzystany dla burgerów wegańskich, kotletów warzywnych i innych dań roślinnych.

**Tagi AI:**

vegan steak, falafel, mushroom steak, vegetarian appetizer, cauliflower steak, vegan snack



---



# **KATEGORIA: PRZYSTAWKI / STARTERY / APPETIZERS**

## **1. Surowe przystawki premium**

**Produkty:**

- Carpaccio wołowe
- Tatar wołowy
- Tataki z tuńczyka
- Róża z łososia sashimi
- Tatar z mango i awokado

**Opis dla AI:**

Ekskluzywne zimne przystawki przygotowywane z surowego mięsa, ryb lub drobno krojonych składników. Charakteryzują się elegancką prezentacją oraz niewielką porcją. AI powinno grupować podobne tatary, carpaccio, sashimi i nowoczesne przystawki degustacyjne.

**Tagi AI:**

beef tartare, carpaccio, sashimi, tuna tataki, gourmet appetizer, fine dining



---



## **2. Owoce morza i przystawki rybne**

**Produkty:**

- Ostryga
- Przegrzebek
- Mini Lobster Roll
- Szaszłyk z krewetki
- Mini tartaletka z łososiem i kawiorem

**Opis dla AI:**

Przystawki bazujące na owocach morza, rybach i skorupiakach. Najczęściej spotykane w restauracjach premium, seafood barach oraz menu degustacyjnych. Placeholder jednego dania może reprezentować podobne ekskluzywne owoce morza.

**Tagi AI:**

seafood appetizer, oyster, scallop, shrimp, lobster, salmon appetizer, gourmet seafood



---



## **3. Europejskie przystawki restauracyjne**

**Produkty:**

- Pieczony Brie
- Crostini z figą
- Roladka z bresaoli
- Vitello Tonnato
- Pasztet z gęsich wątróbek na brioche
- Kostka sera z truflą

**Opis dla AI:**

Klasyczne przystawki kuchni francuskiej i włoskiej wykorzystujące sery, wędliny dojrzewające, pieczywo oraz delikatne mięsa. AI powinno traktować je jako jedną grupę eleganckich starterów.

**Tagi AI:**

italian appetizer, french appetizer, cheese board, gourmet starter, fine dining appetizer



---



## **4. Ciepłe przystawki**

**Produkty:**

- Sajgonka z kaczką
- Arancini
- Kotlecik krabowy
- Ślimaki po burgundzku
- Faszerowana pieczarka

**Opis dla AI:**

Przystawki podawane na ciepło, smażone lub zapiekane. Obejmują kuchnię europejską i azjatycką. Placeholder może zostać wykorzystany dla podobnych finger foodów oraz małych dań restauracyjnych.

**Tagi AI:**

hot appetizer, fried appetizer, baked appetizer, finger food, restaurant starter



---



## **5. Finger food i zimne przekąski**

**Produkty:**

- Koreczek z szynki parmeńskiej i melona
- Mini Caprese
- Boczek w glazurze klonowej
- Miks oliwek premium

**Opis dla AI:**

Niewielkie przekąski serwowane podczas bankietów, cateringu, degustacji oraz przyjęć. AI powinno przypisywać do tej grupy również koreczki, antipasti, przekąski koktajlowe, tapas oraz drobne zakąski podawane przed daniem głównym.

**Tagi AI:**

finger food, antipasti, tapas, appetizer platter, cocktail food, party food, catering appetizer

  


**Nigdy nie dopasowuj obrazu tylko na podstawie nazwy produktu. Najważniejsze są cechy wizualne, składniki, sposób podania, rodzaj naczynia, kolorystyka oraz przynależność do grupy podobnych produktów. W przypadku braku identycznego obrazu wybierz najbardziej podobny wizualnie produkt z tej samej grupy, a dopiero w ostateczności użyj placeholdera kategorii.**

  
