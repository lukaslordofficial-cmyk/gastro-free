/**
 * Wybór sposobu wysyłki: aplikacja pocztowa, logowanie portalu, asystent dostaw.
 */
import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Smartphone, Globe, Bot, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { findMailProvider, mailProviderLabel } from '@/lib/openMailCompose';

type Props = {
  visible: boolean;
  fromEmail: string;
  onClose: () => void;
  onPickApp: () => void;
  onPickLoginPage?: () => void;
  onPickAssistant: () => void;
  /** Tylko Asystent (np. receptury z PDF — zewnętrzna poczta nie dostanie załączników). */
  assistantOnly?: boolean;
};

export function MailSendMethodSheet({
  visible,
  fromEmail,
  onClose,
  onPickApp,
  onPickLoginPage,
  onPickAssistant,
  assistantOnly = false,
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
  const rowBg = prem ? DS.color.bgTertiary : Colors.borderLight;
  const iconBg = prem ? 'rgba(0,255,136,0.12)' : Colors.accentLight;

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
            {assistantOnly
              ? 'Receptury wyślemy jako osobne pliki PDF przez Asystenta dostaw.'
              : 'Wybierz sposób wysyłki zamówienia do dostawcy.'}
          </Text>

          {!assistantOnly ? (
            <TouchableOpacity
              style={[styles.row, { borderColor: border, backgroundColor: rowBg }]}
              onPress={onPickApp}
              activeOpacity={0.85}
              testID="mail-send-app"
            >
              <View style={[styles.icon, { backgroundColor: iconBg }]}>
                <Smartphone size={18} color={accent} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: text }]}>Aplikacja pocztowa</Text>
                <Text style={[styles.rowSub, { color: muted }]}>
                  Gotowy szkic (adresat, temat, treść) w Gmail / Outlook / innej aplikacji
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          {!assistantOnly && provider && onPickLoginPage ? (
            <TouchableOpacity
              style={[styles.row, { borderColor: border, backgroundColor: rowBg }]}
              onPress={onPickLoginPage}
              activeOpacity={0.85}
              testID="mail-send-login"
            >
              <View style={[styles.icon, { backgroundColor: iconBg }]}>
                <Globe size={18} color={accent} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: text }]}>Tylko logowanie — {label}</Text>
                <Text style={[styles.rowSub, { color: muted }]}>
                  Strona portalu; treść w schowku do wklejenia
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[styles.row, { borderColor: border, backgroundColor: rowBg }]}
            onPress={onPickAssistant}
            activeOpacity={0.85}
            testID="mail-send-assistant"
          >
            <View style={[styles.icon, { backgroundColor: iconBg }]}>
              <Bot size={18} color={accent} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: text }]}>
                Asystent dostaw — wyślij z aplikacji
              </Text>
              <Text style={[styles.rowSub, { color: muted }]}>
                Bezpośrednio z asystent.dostaw@gastromanager.org
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
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  cancel: { alignItems: 'center', paddingVertical: 8 },
  cancelText: { fontSize: 14, fontWeight: '600' },
});
