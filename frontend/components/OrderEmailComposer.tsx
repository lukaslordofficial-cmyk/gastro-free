/**
 * Edytowalny szablon e-maila zamówienia (Łowca Okazji + zamówienie ręczne)
 * lub wiadomości ogólnej (np. receptury).
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
import { X, Send, Mail, Landmark, Copy, Check } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { fetchJson } from '@/lib/safeFetch';
import { apiJsonHeaders } from '@/lib/apiHeaders';
import { stripAssistantOrderFooter, withAssistantFooterIfNeeded } from '@/lib/orderEmailFooter';
import {
  checkSupplierMinOrder,
  minOrderAlertCopy,
} from '@/lib/supplierMinOrder';
import {
  mailProviderLabel,
  openMailInApp,
  openMailLoginOnly,
} from '@/lib/openMailCompose';
import {
  fetchRestaurantProfile,
  resolveOrderEmailFrom,
} from '@/services/restaurantProfileService';
import { useAuth } from '@/contexts/AuthContext';
import { MailSendMethodSheet } from '@/components/MailSendMethodSheet';

/** Zweryfikowany nadawca Resend (Gmail jako From jest blokowany). */
export const ASSISTANT_FROM_EMAIL = 'asystent.dostaw@gastromanager.org';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
const PREP_MSG = 'Twoje zamówienie trafiło do zakładki Dostawy - Przygotowywane';
const ASSISTANT_SENT_MSG =
  `Wiadomość została wysłana na podany adres, z maila ${ASSISTANT_FROM_EMAIL}`;

export type OrderEmailAttachment = {
  filename: string;
  contentBase64: string;
  contentType?: string;
};

export type OrderEmailDraft = {
  supplierName: string;
  toEmail: string;
  fromEmail?: string;
  subject: string;
  body: string;
  supplierId?: string | null;
  totalPln?: number;
  attachments?: OrderEmailAttachment[];
};

type Props = {
  visible: boolean;
  draft: OrderEmailDraft | null;
  onClose: () => void;
  onSent?: () => void;
  onMailClientOpened?: () => void;
  onPayPress?: () => void;
  /** `message` = receptury / ogólny mail (bez komunikatów zamówienia). */
  mode?: 'order' | 'message';
};

function isAssistantFrom(email: string): boolean {
  return email.trim().toLowerCase() === ASSISTANT_FROM_EMAIL.toLowerCase();
}

export function OrderEmailComposer({
  visible,
  draft,
  onClose,
  onSent,
  onMailClientOpened,
  onPayPress,
  mode = 'order',
}: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const { alert } = usePremiumAlert();
  const { user } = useAuth();
  const [fromEmail, setFromEmail] = useState(ASSISTANT_FROM_EMAIL);
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSendMethod, setShowSendMethod] = useState(false);
  const isMessage = mode === 'message';

  React.useEffect(() => {
    if (!visible || !draft) return;
    let cancelled = false;
    const rawBody = draft.body || '';
    if (isMessage) {
      setToEmail(draft.toEmail || '');
      setSubject(draft.subject || '');
      setFromEmail(ASSISTANT_FROM_EMAIL);
      setBody(rawBody);
      setCopied(false);
      return () => {
        cancelled = true;
      };
    }
    const seedFrom = (draft.fromEmail || ASSISTANT_FROM_EMAIL).trim() || ASSISTANT_FROM_EMAIL;
    setToEmail(draft.toEmail || '');
    setSubject(draft.subject || '');
    setFromEmail(seedFrom);
    setBody(isAssistantFrom(seedFrom) ? rawBody : stripAssistantOrderFooter(rawBody));
    setCopied(false);

    void resolveOrderEmailFrom(rawBody, ASSISTANT_FROM_EMAIL, user?.email).then((resolved) => {
      if (cancelled) return;
      setFromEmail(resolved.fromEmail);
      setBody(isAssistantFrom(resolved.fromEmail) ? rawBody : resolved.body);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, draft, user?.email, isMessage]);

  const bg = prem ? DS.color.bgPrimary : Colors.background;
  const card = prem ? DS.color.surfaceCard : Colors.card;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const inputBg = prem ? DS.color.bgTertiary : Colors.borderLight;

  const providerLabel = useMemo(() => mailProviderLabel(fromEmail), [fromEmail]);

  const onChangeFrom = (next: string) => {
    if (isMessage) {
      setFromEmail(ASSISTANT_FROM_EMAIL);
      return;
    }
    setFromEmail(next);
    if (!isAssistantFrom(next)) {
      setBody((b) => stripAssistantOrderFooter(b));
    }
  };

  const copyBody = async () => {
    const payload = `Do: ${toEmail.trim()}\nTemat: ${subject.trim()}\n\n${body}`;
    await Clipboard.setStringAsync(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const afterExternalOpen = (opts?: { loginOnly?: boolean }) => {
    onMailClientOpened?.();
    if (isMessage) {
      const extra = opts?.loginOnly
        ? '\n\nTreść jest w schowku. Po zalogowaniu: Nowa wiadomość → wklej (długie przytrzymanie).'
        : '';
      alert('Wiadomość', `Dokończ wysyłkę w aplikacji pocztowej.${extra}`, [
        { text: 'OK', style: 'primary' },
      ]);
      return;
    }
    const extra = opts?.loginOnly
      ? '\n\nTreść jest w schowku. Po zalogowaniu: Nowa wiadomość → wklej (długie przytrzymanie).'
      : '';
    alert('Zamówienie', `${PREP_MSG}${extra}`, [{ text: 'OK', style: 'primary' }]);
  };

  const sendViaApp = async () => {
    setShowSendMethod(false);
    const to = toEmail.trim();
    const from = isMessage
      ? ASSISTANT_FROM_EMAIL
      : fromEmail.trim() || ASSISTANT_FROM_EMAIL;
    try {
      await openMailInApp({
        fromEmail: from,
        to,
        subject: subject.trim(),
        body: stripAssistantOrderFooter(body),
      });
      afterExternalOpen();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się otworzyć aplikacji pocztowej.';
      alert('Błąd', msg);
    }
  };

  const sendViaLoginPage = async () => {
    setShowSendMethod(false);
    const to = toEmail.trim();
    const from = isMessage
      ? ASSISTANT_FROM_EMAIL
      : fromEmail.trim() || ASSISTANT_FROM_EMAIL;
    try {
      await Clipboard.setStringAsync(
        `Do: ${to}\nTemat: ${subject.trim()}\n\n${stripAssistantOrderFooter(body)}`,
      );
      await openMailLoginOnly(from);
      afterExternalOpen({ loginOnly: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się otworzyć strony logowania.';
      alert('Błąd', msg);
    }
  };

  const sendViaAssistant = async () => {
    if (!BACKEND_URL) {
      alert(
        'Brak backendu',
        'Ustaw EXPO_PUBLIC_BACKEND_URL na port 8001 (uvicorn), nie 8081 (Expo), aby wysłać z adresu asystenta.',
      );
      return;
    }
    setSending(true);
    try {
      let footerHint = '';
      try {
        const profile = await fetchRestaurantProfile();
        const mail = (profile.contact_email || '').trim() || (user?.email || '').trim() || '(brak)';
        const phone = (profile.contact_phone || '').trim() || '(brak)';
        footerHint =
          `--- Wiadomość wygenerowana automatycznie przez asystenta AI Gastro-Manager. `
          + `Prosimy NIE ODPOWIADAĆ na tego maila. Kontakt z restauracją wyłącznie pod adresem: `
          + `${mail} lub numerem telefonu: ${phone}. ---`;
      } catch {
        /* body bez stopki jeśli profil niedostępny */
      }
      const bodyText = withAssistantFooterIfNeeded(body, true, footerHint);
      const attachments = (draft?.attachments || [])
        .filter((a) => a?.filename && a?.contentBase64)
        .map((a) => ({
          filename: a.filename,
          content_base64: a.contentBase64,
          content_type: a.contentType || 'application/pdf',
        }));
      const res = await fetchJson<{ ok?: boolean; detail?: string; id?: string }>(
        `${BACKEND_URL}/api/orders/send-email`,
        {
          method: 'POST',
          headers: await apiJsonHeaders(),
          body: JSON.stringify({
            to: toEmail.trim(),
            subject: subject.trim(),
            body_text: bodyText,
            from_email: ASSISTANT_FROM_EMAIL,
            supplier_name: draft?.supplierName,
            ...(attachments.length ? { attachments } : {}),
          }),
        },
      );
      if (!res.ok) throw new Error(res.error || 'Błąd wysyłki');
      alert('Wysłano', ASSISTANT_SENT_MSG, [{ text: 'OK', style: 'primary' }]);
      onSent?.();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się wysłać maila przez asystenta.';
      alert('Błąd wysyłki', msg);
    } finally {
      setSending(false);
    }
  };

  const pickAssistantSend = () => {
    setShowSendMethod(false);
    void sendViaAssistant();
  };

  const ensureMinOrderMet = async (): Promise<boolean> => {
    if (isMessage) return true;
    const sid = (draft?.supplierId || '').trim();
    if (!sid) return true;
    const subtotal = Number(draft?.totalPln);
    if (!Number.isFinite(subtotal)) return true;
    const check = await checkSupplierMinOrder({
      supplierId: sid,
      subtotalPln: subtotal,
      supplierName: draft?.supplierName,
    });
    if (check.ok) return true;
    const copy = minOrderAlertCopy(check);
    alert(copy.title, copy.message, [{ text: 'OK', style: 'primary' }]);
    return false;
  };

  const send = async () => {
    const to = toEmail.trim();
    if (!to) {
      alert('Brak odbiorcy', 'Podaj adres e-mail odbiorcy.', [
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
    if (!(await ensureMinOrderMet())) return;
    setShowSendMethod(true);
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
              <Text style={[styles.title, { color: text }]}>
                {isMessage ? 'Wyślij wiadomość' : 'Szablon zamówienia'}
              </Text>
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
            editable={!isMessage}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder={ASSISTANT_FROM_EMAIL}
            placeholderTextColor={muted}
            testID="order-email-from"
          />
          <Text style={[styles.hint, { color: muted }]}>
            {isMessage
              ? `Wiadomość wyśle Asystent dostaw z adresu ${ASSISTANT_FROM_EMAIL} (Resend)`
                + `${(draft.attachments?.length || 0) > 0
                  ? ` · ${(draft.attachments || []).length} PDF w załączniku`
                  : ''}.`
              : `Po „Wyślij mail” wybierzesz: aplikację pocztową, logowanie ${providerLabel}, albo wysyłkę przez Asystenta dostaw.`}
          </Text>

          <Text style={[styles.label, { color: muted }]}>Odbiorca</Text>
          <TextInput
            style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: text }]}
            value={toEmail}
            onChangeText={setToEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="adres@email.pl"
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

          <View style={styles.bodyLabelRow}>
            <Text style={[styles.label, { color: muted, marginTop: 0, marginBottom: 0 }]}>
              {isMessage ? 'Treść' : 'Treść zamówienia'}
            </Text>
            <TouchableOpacity
              onPress={() => void copyBody()}
              style={[styles.copyBtn, { borderColor: border }]}
              activeOpacity={0.85}
              testID="order-email-copy"
            >
              {copied ? (
                <Check size={14} color={prem ? DS.color.greenEnd : Colors.accent} strokeWidth={2.5} />
              ) : (
                <Copy size={14} color={muted} strokeWidth={2.2} />
              )}
              <Text
                style={[
                  styles.copyText,
                  { color: copied ? (prem ? DS.color.greenEnd : Colors.accent) : muted },
                ]}
              >
                {copied ? 'Skopiowano' : 'Kopiuj'}
              </Text>
            </TouchableOpacity>
          </View>
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
          {onPayPress && !isMessage ? (
            <TouchableOpacity
              onPress={() => {
                void (async () => {
                  if (!(await ensureMinOrderMet())) return;
                  onPayPress();
                })();
              }}
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
                  <Text style={styles.sendText}>Wyślij mail</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <MailSendMethodSheet
        visible={showSendMethod}
        fromEmail={fromEmail}
        assistantOnly={isMessage}
        onClose={() => setShowSendMethod(false)}
        onPickApp={() => void sendViaApp()}
        onPickLoginPage={() => void sendViaLoginPage()}
        onPickAssistant={pickAssistantSend}
      />
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
  bodyLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 6,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  copyText: { fontSize: 12, fontWeight: '700' },
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
