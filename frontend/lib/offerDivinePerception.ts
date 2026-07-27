/**
 * Shared prompt after waste save — offer „Boska Waga w Ręku” training.
 */
import type { usePremiumAlert } from '@/components/PremiumAlert';

type AlertFn = ReturnType<typeof usePremiumAlert>['alert'];

export function offerDivinePerceptionTraining(
  alert: AlertFn,
  opts: {
    onAccept: () => void;
    onSkip?: () => void;
  },
): void {
  alert(
    'Boska Percepcja',
    'Czy chcesz trenować swoją Boską Percepcję?\n\nOszacujesz wagę ręką i okiem, potem porównasz z wagą — Kompas Rozbieżności pokaże Twój poziom kultywacji.',
    [
      {
        text: 'Pomiń',
        style: 'cancel',
        onPress: () => opts.onSkip?.(),
      },
      {
        text: 'Trenuj',
        style: 'primary',
        onPress: () => opts.onAccept(),
      },
    ],
  );
}
