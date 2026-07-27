/**
 * Oferta reality-check po zapisie straty (PremiumAlert).
 */
import type { usePremiumAlert } from '@/components/PremiumAlert';

type AlertFn = ReturnType<typeof usePremiumAlert>['alert'];

export function offerWeightRealityCheck(
  alert: AlertFn,
  opts: { onAccept: () => void; onSkip?: () => void },
) {
  alert(
    'Sprawdź ocenę na oko',
    'Weź produkt (lub podobną ilość), oszacuj wagę ręką i okiem, potem zważ na wadze. Zobaczysz poziom dokładności 1–5 — bez zgadywania w raporcie strat.',
    [
      { text: 'Później', style: 'cancel', onPress: () => opts.onSkip?.() },
      { text: 'Sprawdź teraz', style: 'primary', onPress: () => opts.onAccept() },
    ],
  );
}
