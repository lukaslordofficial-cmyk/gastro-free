/**
 * Po Stripe Checkout (BLIK/karta): deep link → od razu „Opłacono”, confirm w tle.
 */
import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  LP_PAID_MESSAGE,
  LP_PAID_TITLE,
  claimOptimisticLpPaidAlert,
  parseLpBillingDeepLink,
  subscribeLpAppStateConfirm,
  tryConfirmPendingLpPayment,
} from '@/services/localProducers/checkoutClient';

export function LpPaymentReturnHost() {
  const { alert } = usePremiumAlert();
  const handling = useRef(false);

  useEffect(() => {
    const showPaid = (message?: string) => {
      alert(LP_PAID_TITLE, message || LP_PAID_MESSAGE, [{ text: 'OK', style: 'primary' }]);
    };

    const handleUrl = (url: string | null) => {
      const parsed = parseLpBillingDeepLink(url);
      if (!parsed.kind || parsed.kind === 'cancel') return;
      if (handling.current) return;
      handling.current = true;
      void (async () => {
        try {
          // Najpierw komunikat (Stripe success URL = płatność OK), potem confirm.
          const optimistic = await claimOptimisticLpPaidAlert(parsed.sessionId);
          if (optimistic.shouldShow) showPaid(optimistic.message);
          void tryConfirmPendingLpPayment({ sessionId: parsed.sessionId });
        } finally {
          handling.current = false;
        }
      })();
    };

    void Linking.getInitialURL().then((url) => handleUrl(url));
    const linkSub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    const unsubApp = subscribeLpAppStateConfirm((r) => {
      if (r.shouldShowPaidAlert) showPaid(r.message);
    });

    return () => {
      linkSub.remove();
      unsubApp();
    };
  }, [alert]);

  return null;
}
