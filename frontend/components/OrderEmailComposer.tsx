/**
 * Edytowalny szablon e-maila zamówienia (Łowca Okazji + zamówienie ręczne).
 * — Nadawca = asystent.dostaw@… → wysyłka przez Resend (backend)
 * — Inny nadawca (np. mail restauracji) → klient poczty telefonu (mailto), bez stopki asystenta
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Linking from 'expo-linking';
import { X, Send, Mail, Landmark } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { fetchJson } from '@/lib/safeFetch';
import { apiJsonHeaders } from '@/lib/apiHeaders';
import { stripAssistantOrderFooter } from '@/lib/orderEmailFooter';

export const ASSISTANT_FROM_EMAIL = 'asystent.dostaw@gastromanager.org';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');

export type OrderEmailDraft = {
  supplierName: string;
  toEmail: string;
  fromEmail?: string;
  subject: string;
  body: string;
  /** Do przycisku „Opłać zamówienie” (przelew ręczny). */
  supplierId?: string | null;
  totalPln?: number;
};

type Props = {
  visible: boolean;
  draft: OrderEmailDraft | null;
  onClose: () => void;
  onSent?: () => void;
  onPayPress?: () => void;
};

function isAssistantFrom(email: string): boolean {
  return email.trim().toLowerCase() === ASSISTANT_FROM_EMAIL.toLowerCase();
}

export function OrderEmailComposer({ visible, draft, onClose, onSent, onPayPress }: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const { alert } = usePremiumAlert();
  const [fromEmail, setFromEmail] = useState(ASSISTANT_FROM_EMAIL);
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  React.useEffect(() => {
    if (!visible || !draft) return;
    const from = (draft.fromEmail || ASSISTANT_FROM_EMAIL).trim() || ASSISTANT_FROM_EMAIL;
    setFromEmail(from);
    setToEmail(draft.toEmail || '');
    setSubject(draft.subject || '');
    const rawBody = draft.body || '';
    setBody(isAssistantFrom(from) ? rawBody : stripAssistantOrderFooter(rawBody));
  }, [visible, draft]);

  const bg = prem ? DS.color.bgPrimary : Colors.background;
  const card = prem ? DS.color.surfaceCard : Colors.card;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const inputBg = prem ? DS.color.bgTertiary : Colors.borderLight;

  const usesAssistant = useMemo(() => isAssistantFrom(fromEmail), [fromEmail]);

  const onChangeFrom = (next: string) => {
    setFromEmail(next);
    if (!isAssistantFrom(next)) {
      setBody((b) => stripAssistantOrderFooter(b));
    }
  };

  const send = async () => {
    const to = toEmail.trim();
    const from = fromEmail.trim() || ASSISTANT_FROM_EMAIL;
    if (!to) {
      alert('Brak odbiorcy', 'Podaj adres e-mail dostawcy (odbiorca).', [
        { text: 'OK', style: 'primary' },
      ]);
      return;
    }
    if (!subject.trim() || !body.trim()) {
      alert('Uzupełnij wiadomość', 'Temat i treść nie mogą być puste.', [
        { text: 'OK', style: 'primary' },
      ]);
      return;
    }

    const bodyToSend = isAssistantFrom(from) ? body : stripAssistantOrderFooter(body);

    if (!isAssistantFrom(from)) {
      const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyToSend)}`;
      try {
        await Linking.openURL(url);
        onSent?.();
        onClose();
      } catch (e: any) {
        alert('Błąd', e?.message || 'Nie udało się otworzyć aplikacji pocztowej.');
      }
      return;
    }

    if (!BACKEND_URL) {
      alert(
        'Brak backendu',
        'Ustaw EXPO_PUBLIC_BACKEND_URL na port 8001 (uvicorn), nie 8081 (Expo), aby wysłać z adresu asystenta.',
      );
      return;
    }

    setSending(true);
    try {
      const res = await fetchJson<{ ok?: boolean; detail?: string; id?: string }>(
        `${BACKEND_URL}/api/orders/send-email`,
        {
          method: 'POST',
          headers: await apiJsonHeaders(),
          body: JSON.stringify({
            to,
            subject,
            body_text: bodyToSend,
            from_email: ASSISTANT_FROM_EMAIL,
            supplier_name: draft?.supplierName,
          }),
        },
      );
      if (!res.ok) throw new Error(res.error || 'Błąd wysyłki');
      alert('Wysłano', `Wiadomość poszła z ${ASSISTANT_FROM_EMAIL} do ${to}.`, [
        { text: 'OK', style: 'primary' },
      ]);
      onSent?.();
      onClose();
    } catch (e: any) {
      alert('Błąd wysyłki', e?.message || 'Nie udało się wysłać maila przez asystenta.');
    } finally {
      setSending(false);
    }
  };

  if (!draft) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: bg }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { borderBottomColor: border, backgroundColor: bg }]}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Mail size={18} color={prem ? DS.color.greenEnd : Colors.accent} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: text }]}>Szablon zamówienia</Text>
              <Text style={[styles.sub, { color: muted }]} numberOfLines={1}>
                {draft.supplierName}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <X size={22} color={muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.label, { color: muted }]}>Nadawca</Text>
          <TextInput
            style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: text }]}
            value={fromEmail}
            onChangeText={onChangeFrom}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder={ASSISTANT_FROM_EMAIL}
            placeholderTextColor={muted}
            testID="order-email-from"
          />
          <Text style={[styles.hint, { color: muted }]}>
            {usesAssistant
              ? 'Wiadomość wyśle skrypt z adresu asystenta dostaw (wymaga backendu :8001).'
              : 'Otworzymy Twoją aplikację pocztową z gotową treścią (bez stopki asystenta).'}
          </Text>

          <Text style={[styles.label, { color: muted }]}>Odbiorca (dostawca)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: text }]}
            value={toEmail}
            onChangeText={setToEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="zamowienia@dostawca.pl"
            placeholderTextColor={muted}
            testID="order-email-to"
          />

          <Text style={[styles.label, { color: muted }]}>Temat</Text>
          <TextInput
            style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: text }]}
            value={subject}
            onChangeText={setSubject}
            placeholder="Temat wiadomości"
            placeholderTextColor={muted}
          />

          <Text style={[styles.label, { color: muted }]}>Treść zamówienia</Text>
          <TextInput
            style={[
              styles.input,
              styles.bodyInput,
              { backgroundColor: inputBg, borderColor: border, color: text },
            ]}
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
            placeholder="Treść…"
            placeholderTextColor={muted}
            testID="order-email-body"
          />
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: border, backgroundColor: card }]}>
          {onPayPress ? (
            <TouchableOpacity
              onPress={onPayPress}
              activeOpacity={0.85}
              style={[styles.payBtn, { borderColor: prem ? DS.color.greenEnd : Colors.accent }]}
              testID="order-email-manual-pay"
            >
              <Landmark size={16} color={prem ? DS.color.greenEnd : Colors.accent} strokeWidth={2.2} />
              <Text style={[styles.payBtnText, { color: prem ? DS.color.greenEnd : Colors.accent }]}>
                Opłać zamówienie
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => void send()}
            disabled={sending}
            activeOpacity={0.88}
            style={[styles.sendWrap, sending && { opacity: 0.6 }]}
            testID="order-email-send"
          >
            <LinearGradient
              colors={[...DS.gradient.green]}
              start={{ x: 0, y: 0.2 }}
              end={{ x: 1, y: 0.8 }}
              style={styles.sendGrad}
            >
              {sending ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <>
                  <Send size={16} color="#0A0A0A" strokeWidth={2.4} />
                  <Text style={styles.sendText}>
                    {usesAssistant ? 'Wyślij maila (asystent)' : 'Otwórz pocztę i wyślij'}
                  </Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 18 : 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
  body: { padding: 16, paddingBottom: 40, gap: 4 },
  label: { fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  hint: { fontSize: 11, lineHeight: 15, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 14,
  },
  bodyInput: { minHeight: 220, paddingTop: 12 },
  footer: { padding: 16, borderTopWidth: 1, paddingBottom: Platform.OS === 'ios' ? 28 : 16, gap: 10 },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 13,
    borderWidth: 1.5,
  },
  payBtnText: { fontSize: 14, fontWeight: '800' },
  sendWrap: { borderRadius: 14, overflow: 'hidden' },
  sendGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  sendText: { fontSize: 14, fontWeight: '800', color: '#0A0A0A' },
});
