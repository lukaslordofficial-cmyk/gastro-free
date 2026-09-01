/**
 * Modal ze wszystkimi powiadomieniami użytkownika.
 */
import React, { useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from 'react-native';
import { Bell, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PremiumColors } from '@/constants/premiumTheme';
import { Colors } from '@/constants/colors';
import { useNotifications } from '@/contexts/NotificationsContext';
import type { InboxNotification } from '@/lib/notificationsInbox';

type Props = {
  visible: boolean;
  onClose: () => void;
};

function formatWhen(iso: string): string {
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return '';
  const diffMs = Date.now() - d;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Przed chwilą';
  if (mins < 60) return `${mins} min temu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h temu`;
  return new Date(d).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function navigateFromNotification(
  router: ReturnType<typeof useRouter>,
  item: InboxNotification,
): boolean {
  const data = item.data || {};
  const type = String(data.type || '');
  if (type === 'lp_invoice' && data.order_id) {
    router.push({
      pathname: '/(tabs)/dostawcy/zamowienie/[id]',
      params: { id: String(data.order_id) },
    });
    return true;
  }
  if (type === 'expiry' && data.productName) {
    router.push('/(tabs)/magazyn');
    return true;
  }
  return false;
}

export function NotificationsModal({ visible, onClose }: Props) {
  const theme = useAppTheme();
  const router = useRouter();
  const { items, unreadCount, markRead, markAllRead } = useNotifications();

  const handleItemPress = useCallback(
    async (item: InboxNotification) => {
      await markRead(item.id);
      const navigated = navigateFromNotification(router, item);
      if (navigated) onClose();
    },
    [markRead, router, onClose],
  );

  const palette = theme.isPremium
    ? {
        sheet: PremiumColors.card,
        border: PremiumColors.border,
        title: PremiumColors.text,
        sub: PremiumColors.textMuted,
        itemBg: PremiumColors.cardElevated,
        itemUnread: PremiumColors.neonSoft,
        accent: PremiumColors.neon,
      }
    : {
        sheet: Colors.card,
        border: Colors.border,
        title: Colors.textPrimary,
        sub: Colors.textTertiary,
        itemBg: Colors.background,
        itemUnread: Colors.accentLight,
        accent: Colors.success,
      };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: palette.sheet, borderColor: palette.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.head}>
            <View style={[styles.headIcon, { backgroundColor: palette.itemUnread }]}>
              <Bell size={18} color={palette.accent} strokeWidth={2.5} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: palette.title }]}>Powiadomienia</Text>
              <Text style={[styles.sub, { color: palette.sub }]}>
                {unreadCount > 0
                  ? `${unreadCount} nieprzeczytanych`
                  : 'Wszystko przeczytane'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.close} hitSlop={10}>
              <X size={18} color={palette.sub} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {unreadCount > 0 ? (
            <TouchableOpacity
              style={[styles.markAll, { borderColor: palette.border }]}
              onPress={() => void markAllRead()}
            >
              <Text style={[styles.markAllText, { color: palette.accent }]}>
                Oznacz wszystkie jako przeczytane
              </Text>
            </TouchableOpacity>
          ) : null}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={items.length ? styles.scrollContent : styles.emptyWrap}
            showsVerticalScrollIndicator={false}
          >
            {items.length === 0 ? (
              <View style={styles.empty}>
                <Bell size={32} color={palette.sub} strokeWidth={1.8} />
                <Text style={[styles.emptyTitle, { color: palette.title }]}>Brak powiadomień</Text>
                <Text style={[styles.emptyBody, { color: palette.sub }]}>
                  Tutaj pojawią się alerty o ważności produktów, fakturach od przetwórców i statusie
                  dostaw.
                </Text>
              </View>
            ) : (
              items.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.item,
                    {
                      backgroundColor: item.read ? palette.itemBg : palette.itemUnread,
                      borderColor: palette.border,
                    },
                  ]}
                  onPress={() => void handleItemPress(item)}
                  activeOpacity={0.85}
                >
                  <View style={styles.itemTop}>
                    <Text style={[styles.itemTitle, { color: palette.title }]} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {!item.read ? (
                      <View style={[styles.dot, { backgroundColor: palette.accent }]} />
                    ) : null}
                  </View>
                  {item.body ? (
                    <Text style={[styles.itemBody, { color: palette.sub }]} numberOfLines={4}>
                      {item.body}
                    </Text>
                  ) : null}
                  <Text style={[styles.itemWhen, { color: palette.sub }]}>
                    {formatWhen(item.createdAt)}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '82%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  headIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
  close: { padding: 6 },
  markAll: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  markAllText: { fontSize: 12, fontWeight: '700' },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: 28, gap: 10 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', paddingVertical: 40 },
  empty: { alignItems: 'center', paddingHorizontal: 24, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  item: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  itemTitle: { flex: 1, fontSize: 14, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  itemBody: { fontSize: 13, lineHeight: 18 },
  itemWhen: { fontSize: 11, marginTop: 2 },
});
