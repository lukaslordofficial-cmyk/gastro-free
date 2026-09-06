import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Truck,
  Send,
  Check,
  Copy,
  CircleAlert,
  Landmark,
} from 'lucide-react-native';
import { formatPln } from '@/lib/format';
import { ASSISTANT_FROM_EMAIL } from '@/components/OrderEmailComposer';
import { stripAssistantOrderFooter } from '@/lib/orderEmailFooter';
import type { ManualPaymentOrder } from '@/components/dealHunter/ManualBankPaymentSheet';
import { themedStyles, useDealColors } from '@/components/dealHunter/theme';
import type { MessageCard } from '@/components/dealHunter/types';

type Props = {
  messages: MessageCard[];
  sendStatus: Record<string, 'sending' | 'sent' | 'error'>;
  copiedId: string | null;
  fromEmails: Record<string, string>;
  toEmails: Record<string, string>;
  subjectText: Record<string, string>;
  bodyText: Record<string, string>;
  setFromEmails: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setToEmails: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSubjectText: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setBodyText: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSendEmail: (m: MessageCard) => void;
  onSendAll: () => void;
  onCopySms: (m: MessageCard) => void;
  onManualPay: (order: ManualPaymentOrder) => void;
  onDone: () => void;
};

export function MessagePreviewStep({
  messages,
  sendStatus,
  copiedId,
  fromEmails,
  toEmails,
  subjectText,
  bodyText,
  setFromEmails,
  setToEmails,
  setSubjectText,
  setBodyText,
  onSendEmail,
  onSendAll,
  onCopySms,
  onManualPay,
  onDone,
}: Props) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.msgIntro}>
          Sprawdź treści zamówień. Wysyłaj pojedynczo albo wszystkie naraz (gdy nadawca to asystent dostaw).
        </Text>
        {messages.length > 1 && (
          <TouchableOpacity
            style={[
              styles.sendBtn,
              C.isPremium && { backgroundColor: '#5CFFB0' },
              messages.every((m) => sendStatus[m.supplier_id ?? m.supplier_name] === 'sent') && styles.btnDisabled,
            ]}
            onPress={() => void onSendAll()}
            activeOpacity={0.85}
            testID="deal-hunter-send-all"
          >
            <Send size={16} color={C.isPremium ? '#0A0A0A' : C.white} strokeWidth={2.2} />
            <Text style={[styles.sendBtnText, C.isPremium && { color: '#0A0A0A' }]}>
              Wyślij wszystkie ({messages.length})
            </Text>
          </TouchableOpacity>
        )}
        {messages.map((m) => {
          const key = m.supplier_id ?? m.supplier_name;
          const st = sendStatus[key];
          return (
            <View key={key} style={styles.msgCard} testID={`deal-hunter-message-${m.supplier_name}`}>
              <View style={styles.msgHeader}>
                <Truck size={14} color={C.accent} strokeWidth={2.2} />
                <Text style={styles.msgSupplier}>{m.supplier_name}</Text>
                <Text style={styles.msgTotal}>{formatPln(m.subtotal_pln)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Nadawca</Text>
              </View>
              <TextInput
                style={[styles.bodyInput, { minHeight: 44, marginBottom: 8 }]}
                value={fromEmails[key] ?? ASSISTANT_FROM_EMAIL}
                onChangeText={(t) => {
                  setFromEmails((b) => ({ ...b, [key]: t }));
                  if (t.trim().toLowerCase() !== ASSISTANT_FROM_EMAIL.toLowerCase()) {
                    setBodyText((b) => ({
                      ...b,
                      [key]: stripAssistantOrderFooter(b[key] ?? m.email_body_text ?? ''),
                    }));
                  }
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder={ASSISTANT_FROM_EMAIL}
                testID={`deal-hunter-from-${m.supplier_name}`}
              />
              {(fromEmails[key] ?? ASSISTANT_FROM_EMAIL).trim().toLowerCase() !==
              ASSISTANT_FROM_EMAIL.toLowerCase() ? (
                <Text style={{ fontSize: 11, color: C.textTertiary, marginBottom: 8 }}>
                  Otworzymy Twoją aplikację pocztową — bez stopki asystenta.
                </Text>
              ) : null}
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Odbiorca</Text>
              </View>
              <TextInput
                style={[styles.bodyInput, { minHeight: 44, marginBottom: 8 }]}
                value={toEmails[key] ?? m.supplier_email ?? ''}
                onChangeText={(t) => setToEmails((b) => ({ ...b, [key]: t }))}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="zamowienia@dostawca.pl"
                testID={`deal-hunter-to-${m.supplier_name}`}
              />
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Temat:</Text>
              </View>
              <TextInput
                style={[styles.bodyInput, { minHeight: 44, marginBottom: 8 }]}
                value={subjectText[key] ?? m.email_subject ?? ''}
                onChangeText={(t) => setSubjectText((b) => ({ ...b, [key]: t }))}
                placeholder="Temat wiadomości"
                placeholderTextColor={C.textTertiary}
                testID={`deal-hunter-subject-${m.supplier_name}`}
              />
              <Text style={styles.msgSectionLabel}>Treść wiadomości (edytowalna)</Text>
              <TextInput
                style={styles.bodyInput}
                value={bodyText[key] ?? ''}
                onChangeText={(t) => setBodyText((b) => ({ ...b, [key]: t }))}
                multiline
                textAlignVertical="top"
                testID={`deal-hunter-body-input-${m.supplier_name}`}
              />
              {st === 'sent' ? (
                <View style={styles.successBox} testID={`deal-hunter-sent-${m.supplier_name}`}>
                  <Check size={16} color={C.success} strokeWidth={2.5} />
                  <Text style={styles.successText}>Zamówienie zostało wysłane pomyślnie!</Text>
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={[
                      styles.sendBtn,
                      C.isPremium && { backgroundColor: '#5CFFB0' },
                      (!(toEmails[key] ?? m.supplier_email) || st === 'sending') && styles.btnDisabled,
                    ]}
                    onPress={() => onSendEmail(m)}
                    disabled={!(toEmails[key] ?? m.supplier_email) || st === 'sending'}
                    activeOpacity={0.85}
                    testID={`deal-hunter-send-email-${m.supplier_name}`}
                  >
                    {st === 'sending' ? (
                      <ActivityIndicator size="small" color={C.isPremium ? '#0A0A0A' : C.white} />
                    ) : (
                      <>
                        <Send size={16} color={C.isPremium ? '#0A0A0A' : C.white} strokeWidth={2.2} />
                        <Text style={[styles.sendBtnText, C.isPremium && { color: '#0A0A0A' }]}>Wyślij maila</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.smsBtn}
                    onPress={() => onCopySms(m)}
                    activeOpacity={0.85}
                    testID={`deal-hunter-copy-sms-${m.supplier_name}`}
                  >
                    {copiedId === key ? (
                      <>
                        <Check size={14} color={C.accent} strokeWidth={2.4} />
                        <Text style={styles.smsBtnText}>Skopiowano SMS</Text>
                      </>
                    ) : (
                      <>
                        <Copy size={14} color={C.accent} strokeWidth={2.2} />
                        <Text style={styles.smsBtnText}>Kopiuj do SMS</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity
                style={styles.payBtn}
                onPress={() =>
                  onManualPay({
                    supplierId: m.supplier_id,
                    supplierName: m.supplier_name,
                    orderTitle:
                      (subjectText[key] ?? m.email_subject ?? '').trim()
                      || `Zamówienie — ${m.supplier_name}`,
                    totalPln: m.subtotal_pln,
                  })
                }
                activeOpacity={0.85}
                testID={`deal-hunter-manual-pay-${m.supplier_name}`}
              >
                <Landmark size={16} color={C.accent} strokeWidth={2.2} />
                <Text style={styles.payBtnText}>Opłać zamówienie</Text>
              </TouchableOpacity>
              {st === 'error' && (
                <View style={styles.errRow}>
                  <CircleAlert size={13} color={C.danger} strokeWidth={2.2} />
                  <Text style={styles.emailError}>
                    Nie udało się wysłać. Sprawdź weryfikację domeny w Resend i spróbuj ponownie.
                  </Text>
                </View>
              )}
            </View>
          );
        })}
        <TouchableOpacity style={styles.doneBtn} onPress={onDone} activeOpacity={0.85} testID="deal-hunter-done-btn">
          <Text style={styles.doneBtnText}>Zakończ</Text>
        </TouchableOpacity>
        <View style={{ height: 24 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
