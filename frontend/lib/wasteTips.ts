/**
 * Porady przy dużym marnotrawstwie / krytycznych stratach (Jarvis rank_waste_cost).
 */
export type WasteTip = {
  id: string;
  title: string;
  body: string;
  /** Gdy koszt strat w okresie przekracza ten próg (PLN) — pokaż tip. 0 = zawsze. */
  minCostPln: number;
};

export const WASTE_CRITICAL_TIPS: WasteTip[] = [
  {
    id: 'waste-fifo',
    title: 'FIFO na stanowisku',
    body: 'Ustaw regułę „pierwsze weszło — pierwsze wyszło”: nowe dostawy na tył półki, otwarte opakowania oznacz datą. Najczęstsza przyczyna dużych strat to „zgubione” opakowanie za nowszym.',
    minCostPln: 0,
  },
  {
    id: 'waste-portion',
    title: 'Sprawdź gramatury porcji',
    body: 'Jeśli straty rosną przy tym samym utargu — zmierz 5 porcji wagi. Często kuchnia serwuje +15–25% względem receptury w Menu.',
    minCostPln: 150,
  },
  {
    id: 'waste-prep',
    title: 'Zmniejsz prep day-ahead',
    body: 'Przy wysokich stratach półproduktów ogranicz prep do 1 dnia. Nadprodukcja „na zapas” to najdroższa forma marnotrawstwa w gastronomii.',
    minCostPln: 300,
  },
  {
    id: 'waste-sales-note',
    title: 'Notuj sprzedaż ręcznie',
    body: 'Bez POS każda zmiana powinna kończyć się skanem listy sprzedaży (Magazyn → Skan sprzedaży). Inaczej stany „puchną” w systemie, a w lodówce brakuje towaru.',
    minCostPln: 0,
  },
  {
    id: 'waste-special',
    title: 'Specjał dnia z zagrożonych',
    body: 'Zrób 1–2 dania specjalne z produktów o najwyższym koszcie strat w tym okresie. Lepiej sprzedać ze zniżką niż wyrzucić.',
    minCostPln: 200,
  },
];

export function pickWasteTips(totalCostPln: number, limit = 3): WasteTip[] {
  const cost = Number.isFinite(totalCostPln) ? totalCostPln : 0;
  return WASTE_CRITICAL_TIPS.filter((t) => cost >= t.minCostPln).slice(0, limit);
}
