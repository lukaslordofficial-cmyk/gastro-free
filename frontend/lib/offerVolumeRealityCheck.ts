/**
 * Oferta reality-check objętości po zapisie straty (PremiumAlert).
 */
import type { usePremiumAlert } from '@/components/PremiumAlert';

type AlertFn = ReturnType<typeof usePremiumAlert>['alert'];

export function offerVolumeRealityCheck(
  alert: AlertFn,
  opts: { onAccept: () => void; onSkip?: () => void },
) {
  alert(
    'Sprawdź ocenę objętości',
    'Oszacuj litraż „na oko”, potem odczytaj znak na garnku (lub skalę na ścianie). Zobaczysz poziom dokładności 1–5 — bez zgadywania w raporcie strat.',
    [
      { text: 'Później', style: 'cancel', onPress: () => opts.onSkip?.() },
      { text: 'Sprawdź teraz', style: 'primary', onPress: () => opts.onAccept() },
    ],
  );
}
