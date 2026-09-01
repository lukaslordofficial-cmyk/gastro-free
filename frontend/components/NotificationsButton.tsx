/**
 * Ikona powiadomień z badge — otwiera skrzynkę wszystkich alertów.
 */
import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useNotifications } from '@/contexts/NotificationsContext';
import { NotificationsModal } from '@/components/NotificationsModal';

interface Props {
  compact?: boolean;
  centered?: boolean;
  darkText?: boolean;
  testID?: string;
}

export function NotificationsButton({ compact, centered, darkText, testID }: Props) {
  const [open, setOpen] = useState(false);
  const theme = useAppTheme();
  const { unreadCount } = useNotifications();
  const accent = theme.isPremium ? theme.success : Colors.success;

  return (
    <>
      <TouchableOpacity
        style={[
          styles.btn,
          compact && styles.btnCompact,
          centered && styles.btnCentered,
          { backgroundColor: accent, shadowColor: accent },
        ]}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        testID={testID ?? 'notifications-btn'}
      >
        <View style={styles.iconWrap}>
          <View style={styles.icon}>
            <Bell
              size={compact ? 13 : 14}
              color={darkText ? '#0A0A0A' : Colors.white}
              strokeWidth={2.5}
            />
          </View>
          {unreadCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          ) : null}
        </View>
        {!compact && (
          <Text style={[styles.text, darkText && styles.textDark]}>Powiadomienia</Text>
        )}
      </TouchableOpacity>
      {open ? <NotificationsModal visible={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  btnCentered: { alignSelf: 'center' },
  btnCompact: { paddingRight: 6 },
  iconWrap: { position: 'relative' },
  icon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  text: { color: Colors.white, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  textDark: { color: '#0A0A0A' },
});
