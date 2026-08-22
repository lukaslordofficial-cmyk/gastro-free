/**
 * Wybór sposobu wysyłki maila: przeglądarka (wg domeny From) lub aplikacja pocztowa.
 */
import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Globe, Smartphone, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { findMailProvider, mailProviderLabel } from '@/lib/mailProviders';

type Props = {
  visible: boolean;
  fromEmail: string;
  onClose: () => void;
  onPickBrowser: () => void;
  onPickApp: () => void;
};

export function MailSendMethodSheet({
  visible,
  fromEmail,
  onClose,
  onPickBrowser,
  onPickApp,
}: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const bg = prem ? DS.color.surfaceCard : Colors.card;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const provider = findMailProvider(fromEmail);
  const label = provider?.label ?? mailProviderLabel(fromEmail);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: bg, borderColor: border }]}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: text }]}>Wyślij mail</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <X size={20} color={muted} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.sub, { color: muted }]}>
            Nadawca: {fromEmail.trim() || '—'}
            {'\n'}
            {provider
              ? `Wykryto: ${label}. Wybierz sposób wysyłki.`
              : 'Domena firmowa / nieznana — nie otwieramy obcego portalu. Skopiujemy treść; zaloguj się w panelu swojej firmy lub użyj aplikacji pocztowej.'}
          </Text>

          {provider ? (
          <TouchableOpacity
            style={[styles.row, { borderColor: border, backgroundColor: prem ? DS.color.bgTertiary : Colors.borderLight }]}
            onPress={onPickBrowser}
            activeOpacity={0.85}
            testID="mail-send-browser"
          >
            <View style={[styles.icon, { backgroundColor: prem ? 'rgba(0,255,136,0.12)' : Colors.accentLight }]}>
              <Globe size={18} color={accent} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: text }]}>Przeglądarka — {label}</Text>
              <Text style={[styles.rowSub, { color: muted }]}>
                Otwórz stronę logowania ({provider.webInboxUrl.replace(/^https?:\/\//, '')})
              </Text>
            </View>
          </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[styles.row, { borderColor: border, backgroundColor: prem ? DS.color.bgTertiary : Colors.borderLight }]}
            onPress={onPickApp}
            activeOpacity={0.85}
            testID="mail-send-app"
          >
            <View style={[styles.icon, { backgroundColor: prem ? 'rgba(0,255,136,0.12)' : Colors.accentLight }]}>
              <Smartphone size={18} color={accent} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: text }]}>Aplikacja pocztowa</Text>
              <Text style={[styles.rowSub, { color: muted }]}>
                Zainstalowane programy na telefonie (Gmail, Outlook, …)
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.cancel}>
            <Text style={[styles.cancelText, { color: muted }]}>Anuluj</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 12, lineHeight: 17, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 14, fontWeight: '800' },
  rowSub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  cancel: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { fontSize: 13, fontWeight: '700' },
});
