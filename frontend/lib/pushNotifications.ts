/**
 * Push + lokalne przypomnienia o datach ważności.
 * — telefon: expo-notifications (tray / lock screen)
 * — web/desktop: Notification API
 * — tokeny zapisujemy w device_push_tokens (Supabase)
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { appendInboxNotification } from '@/lib/notificationsInbox';

let Notifications: typeof import('expo-notifications') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CONSENT_KEY = 'gm_notif_consent_asked_v1';

export async function getNotificationPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined'
> {
  if (Platform.OS === 'web') {
    if (typeof Notification === 'undefined') return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return 'undetermined';
  }
  if (!Notifications) return 'denied';
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const r = await Notification.requestPermission();
    return r === 'granted';
  }
  if (!Notifications) return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final === 'granted') {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
  return final === 'granted';
}

export async function registerPushToken(): Promise<string | null> {
  const ok = await ensureNotificationPermissions();
  if (!ok) return null;

  if (Platform.OS === 'web') {
    return null;
  }
  if (!Notifications) return null;

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId ??
      undefined;
    const tokenRes = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenRes.data;
    if (!token) return null;

    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id ?? null;
    await supabase.from('device_push_tokens').upsert(
      {
        token,
        platform: Platform.OS,
        user_id: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
    return token;
  } catch {
    return null;
  }
}

/**
 * Pokaż polski dialog dark-premium, potem systemową zgodę OS.
 * `alertFn` = usePremiumAlert().alert
 */
export async function promptAndRegisterPush(
  alertFn: (
    title: string,
    message?: string,
    buttons?: {
      text: string;
      onPress?: () => void;
      style?: 'default' | 'cancel' | 'destructive' | 'primary';
    }[],
  ) => void,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
      getItem: (k: string) => Promise<string | null>;
      setItem: (k: string, v: string) => Promise<void>;
    };
    const asked = await AsyncStorage.getItem(CONSENT_KEY);
    const status = await getNotificationPermissionStatus();
    if (status === 'granted') {
      await registerPushToken();
      return;
    }
    if (status === 'denied' || asked === '1') return;

    await new Promise<void>((resolve) => {
      alertFn(
        'Powiadomienia',
        'Gastro Manager może wysyłać powiadomienia o kończącej się dacie ważności oraz o krytycznym stanie magazynu — także gdy aplikacja jest zamknięta. Czy chcesz je włączyć?',
        [
          {
            text: 'Nie teraz',
            style: 'cancel',
            onPress: () => {
              void AsyncStorage.setItem(CONSENT_KEY, '1');
              resolve();
            },
          },
          {
            text: 'Zezwól',
            style: 'primary',
            onPress: () => {
              void (async () => {
                await AsyncStorage.setItem(CONSENT_KEY, '1');
                await registerPushToken();
                resolve();
              })();
            },
          },
        ],
      );
    });
  } catch {
    await registerPushToken().catch(() => {});
  }
}

function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0);
}

/** Lokalne przypomnienia (telefon) + opcjonalnie desktop Notification (web). */
export async function scheduleExpiryReminders(
  productName: string,
  batches: { expirationDate: string; alertDays: number[] }[],
): Promise<void> {
  const ok = await ensureNotificationPermissions();
  if (!ok) return;

  for (const b of batches) {
    const exp = parseIsoDate(b.expirationDate);
    if (!exp) continue;
    const days = b.alertDays?.length ? b.alertDays : [7, 3, 1];
    for (const day of days) {
      const fire = new Date(exp);
      fire.setDate(fire.getDate() - Number(day));
      fire.setHours(9, 0, 0, 0);
      if (fire.getTime() <= Date.now()) continue;

      const title = 'Termin przydatności';
      const body =
        day === 0
          ? `${productName} kończy ważność DZIŚ!`
          : `${productName} kończy ważność za ${day} dni (${b.expirationDate}).`;

      if (Platform.OS === 'web' && typeof Notification !== 'undefined') {
        continue;
      }
      if (!Notifications) continue;
      try {
        await Notifications.scheduleNotificationAsync({
          content: { title, body, sound: true, data: { type: 'expiry', productName } },
          trigger: { type: 'date', date: fire } as any,
        });
      } catch {
        // ignore schedule errors
      }
    }
  }
}

export async function showDesktopOrLocalNow(
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  void appendInboxNotification({ title, body, data });
  const ok = await ensureNotificationPermissions();
  if (!ok) return;
  const payload = { ...(data || {}), _inboxRecorded: true };
  if (Platform.OS === 'web' && typeof Notification !== 'undefined') {
    try {
      new Notification(title, { body });
    } catch {
      /* ignore */
    }
    return;
  }
  if (!Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true, data: payload },
      trigger: null,
    });
  } catch {
    /* ignore */
  }
}

/** Wysyłka Expo Push (używane też z backendu — tu helper do testów). */
export async function sendExpoPush(messages: { to: string; title: string; body: string }[]) {
  if (!messages.length) return;
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
}
