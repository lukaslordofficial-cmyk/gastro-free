/**
 * Po starcie aplikacji: polski dialog dark-premium o zgodzie na powiadomienia.
 */
import { useEffect, useRef } from 'react';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { promptAndRegisterPush } from '@/lib/pushNotifications';

export function PushConsentBootstrap() {
  const { alert } = usePremiumAlert();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const t = setTimeout(() => {
      void promptAndRegisterPush(alert);
    }, 900);
    return () => clearTimeout(t);
  }, [alert]);

  return null;
}
