/**
 * Lokalna skrzynka powiadomień (AsyncStorage) — historia alertów w aplikacji.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type InboxNotification = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  data?: Record<string, unknown>;
};

const STORAGE_KEY = 'gm_notifications_inbox_v1';
const MAX_ITEMS = 80;

type ChangeListener = () => void;
const listeners = new Set<ChangeListener>();

export function subscribeInboxChanges(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitChange() {
  listeners.forEach((fn) => fn());
}

async function loadRaw(): Promise<InboxNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InboxNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function save(items: InboxNotification[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  emitChange();
}

export async function loadInboxNotifications(): Promise<InboxNotification[]> {
  return loadRaw();
}

export async function appendInboxNotification(input: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<InboxNotification> {
  const item: InboxNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title: input.title.trim() || 'Powiadomienie',
    body: input.body.trim(),
    createdAt: new Date().toISOString(),
    read: false,
    data: input.data,
  };
  const items = await loadRaw();
  items.unshift(item);
  await save(items);
  return item;
}

export async function markInboxRead(id: string): Promise<void> {
  const items = await loadRaw();
  const idx = items.findIndex((i) => i.id === id);
  if (idx >= 0 && !items[idx].read) {
    items[idx] = { ...items[idx], read: true };
    await save(items);
  }
}

export async function markAllInboxRead(): Promise<void> {
  const items = await loadRaw();
  let changed = false;
  for (let i = 0; i < items.length; i++) {
    if (!items[i].read) {
      items[i] = { ...items[i], read: true };
      changed = true;
    }
  }
  if (changed) await save(items);
}

export async function countUnreadInbox(): Promise<number> {
  const items = await loadRaw();
  return items.filter((i) => !i.read).length;
}
