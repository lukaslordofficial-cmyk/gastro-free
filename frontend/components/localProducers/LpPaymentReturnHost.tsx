/**
 * Po Stripe Checkout: komunikat „Opłacono” dopiero gdy Stripe potwierdzi płatność.
 */
import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  LP_PAID_MESSAGE,
  LP_PAID_TITLE,
  clearPendingLpCheckout,
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
      if (!parsed.kind) return;
      if (parsed.kind === 'cancel') {
        void clearPendingLpCheckout();
        return;
      }
      if (handling.current) return;
      handling.current = true;
      void (async () => {
        try {
          const conf = await tryConfirmPendingLpPayment({ sessionId: parsed.sessionId });
          if (conf.paid && conf.shouldShowPaidAlert) showPaid(conf.message);
        } finally {
          handling.current = false;
        }
      })();
    };

    void Linking.getInitialURL().then((url) => handleUrl(url));
    const linkSub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    const unsubApp = subscribeLpAppStateConfirm((r) => {
      if (r.paid && r.shouldShowPaidAlert) showPaid(r.message);
    });

    return () => {
      linkSub.remove();
      unsubApp();
    };
  }, [alert]);

  return null;
}
