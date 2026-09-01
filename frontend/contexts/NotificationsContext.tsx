/**
 * Skrzynka powiadomień — stan + nasłuch expo-notifications (terminy ważności itd.).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  appendInboxNotification,
  countUnreadInbox,
  loadInboxNotifications,
  markAllInboxRead,
  markInboxRead,
  subscribeInboxChanges,
  type InboxNotification,
} from '@/lib/notificationsInbox';

let Notifications: typeof import('expo-notifications') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

type NotificationsContextValue = {
  items: InboxNotification[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [list, unread] = await Promise.all([loadInboxNotifications(), countUnreadInbox()]);
    setItems(list);
    setUnreadCount(unread);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeInboxChanges(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (!Notifications) return;
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification.request.content;
      const data = (content.data || {}) as Record<string, unknown>;
      if (data._inboxRecorded) return;
      const title = String(content.title || '').trim();
      const body = String(content.body || '').trim();
      if (!title && !body) return;
      void appendInboxNotification({ title: title || 'Powiadomienie', body, data });
    });
    return () => sub.remove();
  }, []);

  const markRead = useCallback(async (id: string) => {
    await markInboxRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    await markAllInboxRead();
  }, []);

  const value = useMemo(
    () => ({ items, unreadCount, loading, refresh, markRead, markAllRead }),
    [items, unreadCount, loading, refresh, markRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within NotificationsProvider');
  }
  return ctx;
}
