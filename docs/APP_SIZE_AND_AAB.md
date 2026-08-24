# Rozmiar aplikacji + AAB (beta)

Data: 2026-07-25.

## Co zrobiono.

| Zmiana | Efekt |.
|--------|--------|.
| Profile EAS `preview` + `production` → `buildType: "app-bundle"` | Dystrybucja jako **AAB** (Play / wewnętrzny share EAS) |
| Profil `preview-apk` | Opcjonalny APK gdy tester potrzebuje bezpośredniej instalacji |
| `.easignore`: `frontend/assets/premium/dishes/_board_*.png` | ~1,8 MB arkuszy źródłowych **nie trafia** do AAB (nie są `require()` w appce) |
| Kompresja `icon.png` / `adaptive-icon.png` (+ splash) | ~140 KB mniej w pakiecie startowym |
| Lazy `import()` Inspiracje / Przepisy w Menu | Mniejszy cold-start JS; katalogi dań ładują się przy otwarciu modala |
| `warmProductImageIndexes()` bez `dishCatalog()` | Start nie parsuje setek `require` dań |

Assety dań (WebP w `assets/premium/…`) zostają w repo i w bundlu — biznes ich potrzebuje offline w Inspiracjach / matchingu Menu.

## Jak zbudować AAB

```powershell
cd frontend
$env:NODE_OPTIONS='--use-system-ca'
node scripts/sync-eas-preview-env.js   # wstawia EXPO_PUBLIC_* do eas.json
eas build -p android --profile preview --non-interactive
# produkcja:
eas build -p android --profile production --non-interactive
# po buildzie nie commituj kluczy:
git checkout -- eas.json
```

Opcjonalny APK: `--profile preview-apk`.

## Uczciwe limity rozmiaru

- Katalog lokalnych WebP dań + składników to nadal **większość** wagi (~15–18 MB raw w `frontend/assets`). Pełne usunięcie = utrata Inspiracji offline / gorszy matching.
- AAB jest zwykle **mniejszy przy instalacji** niż uniwersalny APK (Play dzieli ABI), ale artefakt EAS nadal zawiera te assety.
- Dalsze cięcie: migracja kolejnych ikon wyłącznie do Supabase Storage (`product-icons`) + usuwanie `localAsset` z bundla; wymaga świadomej decyzji produktowej i offline UX.
- Oczekiwany zysk z tej rundy: **~2 MB** mniej w uploadzie EAS + lżejszy start; nie „magiczne −50%”.
