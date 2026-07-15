import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  X,
  Sparkles,
  TrendingDown,
  Truck,
  Mail,
  Copy,
  Check,
  ChevronRight,
  Store,
  Volume2,
  Phone,
  Send,
  CircleAlert,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { formatPln } from '@/lib/format';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

interface ProductLike {
  id: string;
  product_name: string;
  current_qty: number;
  critical_threshold: number;
  unit: string;
}

interface Props {
  visible: boolean;
  product: ProductLike | null;
  restaurantName?: string;
  onClose: () => void;
  /** Pre-loaded compare result — used by "Bulk Category-Targeted Orders" flow.
   *  Kiedy jest ustawione, modal pomija krok "qty" i od razu pokazuje krok "compare"
   *  z gotowym zestawieniem najtańszych ofert. */
  initialCompare?: CompareResult | null;
  /** Kontekst nagłówka dla trybu bulk (np. "Braki: Mięso i wędliny, Nabiał"). */
  bulkContextLabel?: string;
}

type Step = 'qty' | 'compare' | 'contact' | 'preview';

interface OfferItem {
  product_name: string;
  quantity: number;
  unit: string;
  unit_price_base: number;
  matched_name: string;
  line_total: number;
  base_dim: string;
}
interface SupplierGroup {
  supplier_id: string | null;
  supplier_name: string;
  supplier_email: string | null;
  items: OfferItem[];
  subtotal_pln: number;
}
interface OptionAllOne {
  type: string;
  supplier_id: string;
  supplier_name: string;
  supplier_email: string | null;
  items: OfferItem[];
  total_pln: number;
  missing: string[];
}
interface OptionOptimized {
  type: string;
  suppliers: SupplierGroup[];
  total_pln: number;
  missing: string[];
}
interface CompareResult {
  option_all_one: OptionAllOne | null;
  option_optimized: OptionOptimized;
  savings_pln: number;
  assistant_speech: string;
}
interface MessageCard {
  supplier_id: string | null;
  supplier_name: string;
  supplier_email: string | null;
  email_subject: string;
  email_html: string;
  email_text: string;
  email_body_text: string;
  sms_text: string;
  subtotal_pln: number;
}

function suggestQty(p: ProductLike): number {
  const base = p.current_qty > 0 ? p.current_qty * 1.5 : Math.max(p.critical_threshold, 1);
  const rounded = Math.round(base * 100) / 100;
  return rounded > 0 ? rounded : 1;
}

export function DealHunterModal({ visible, product, restaurantName, onClose, initialCompare, bulkContextLabel }: Props) {
  const [step, setStep] = useState<Step>('qty');
  const [qty, setQty] = useState('1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [selectedOption, setSelectedOption] = useState<'all_one' | 'optimized' | null>(null);
  const [messages, setMessages] = useState<MessageCard[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});
  const [bodyText, setBodyText] = useState<Record<string, string>>({});
  // contact profile
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const isBulkMode = !!initialCompare;

  useEffect(() => {
    if (visible) {
      if (initialCompare) {
        // Tryb zbiorczy (Bulk Category-Targeted Orders): pomijamy krok "qty",
        // od razu pokazujemy porównanie ofert wyliczone przez backend.
        setStep('compare');
        setCompare(initialCompare);
        setQty('1');
      } else if (product) {
        setStep('qty');
        setQty(String(suggestQty(product)));
        setCompare(null);
      }
      setError(null);
      setSelectedOption(null);
      setMessages([]);
      setCopiedId(null);
      setSendStatus({});
      setBodyText({});
    }
  }, [visible, product, initialCompare]);

  const runCompare = useCallback(async () => {
    if (!product) return;
    const q = parseFloat(qty.replace(',', '.'));
    if (isNaN(q) || q <= 0) {
      setError('Podaj poprawną ilość (liczba > 0).');
      return;
    }
    setError(null);
    setLoading(true);
    setStep('compare');
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/compare-offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_name: restaurantName ?? 'Nasza restauracja',
          items: [{ product_name_or_id: product.product_name, quantity: q, unit: product.unit }],
        }),
      });
      if (!res.ok) throw new Error(`Błąd serwera (${res.status})`);
      const data: CompareResult = await res.json();
      setCompare(data);
      if (!data.option_all_one && data.option_optimized.suppliers.length === 0) {
        setError('Nie znaleziono tego produktu w katalogu dostawców.');
      }
    } catch (e: any) {
      setError(e.message ?? 'Nie udało się pobrać ofert.');
    } finally {
      setLoading(false);
    }
  }, [product, qty, restaurantName]);

  const selectedSuppliers = useCallback((): SupplierGroup[] => {
    if (!compare || !selectedOption) return [];
    if (selectedOption === 'all_one' && compare.option_all_one) {
      const o = compare.option_all_one;
      return [{
        supplier_id: o.supplier_id,
        supplier_name: o.supplier_name,
        supplier_email: o.supplier_email,
        items: o.items,
        subtotal_pln: o.total_pln,
      }];
    }
    if (selectedOption === 'optimized') return compare.option_optimized.suppliers;
    return [];
  }, [compare, selectedOption]);

  const generateMessages = useCallback(async () => {
    const suppliers = selectedSuppliers();
    if (suppliers.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/generate-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_name: restaurantName ?? 'Nasza restauracja', suppliers }),
      });
      if (!res.ok) throw new Error(`Błąd serwera (${res.status})`);
      const data = await res.json();
      const msgs: MessageCard[] = data.messages ?? [];
      setMessages(msgs);
      const initial: Record<string, string> = {};
      msgs.forEach((m) => {
        initial[m.supplier_id ?? m.supplier_name] = m.email_body_text ?? m.email_text ?? '';
      });
      setBodyText(initial);
      setStep('preview');
    } catch (e: any) {
      setError(e.message ?? 'Nie udało się wygenerować wiadomości.');
    } finally {
      setLoading(false);
    }
  }, [selectedSuppliers, restaurantName]);

  // "Przygotuj E-mail": sprawdź profil → formularz lub od razu podgląd
  const prepareEmail = useCallback(async () => {
    if (!selectedOption) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/restaurant/profile`);
      const data = await res.json();
      setContactEmail(data.contact_email ?? '');
      setContactPhone(data.contact_phone ?? '');
      if (data.complete) {
        await generateMessages();
      } else {
        setStep('contact');
        setLoading(false);
      }
    } catch {
      // przy błędzie odczytu profilu — pokaż formularz
      setStep('contact');
      setLoading(false);
    }
  }, [selectedOption, generateMessages]);

  const saveProfile = useCallback(async () => {
    const email = contactEmail.trim();
    const phone = contactPhone.trim();
    if (!email || !phone) {
      setError('Uzupełnij e-mail i telefon kontaktowy.');
      return;
    }
    if (!email.includes('@') || !email.includes('.')) {
      setError('Podaj poprawny adres e-mail.');
      return;
    }
    setSavingProfile(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/restaurant/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_email: email, contact_phone: phone }),
      });
      if (!res.ok) throw new Error('Nie udało się zapisać danych.');
      await generateMessages();
    } catch (e: any) {
      setError(e.message ?? 'Nie udało się zapisać danych.');
    } finally {
      setSavingProfile(false);
    }
  }, [contactEmail, contactPhone, generateMessages]);

  async function copySms(m: MessageCard) {
    await Clipboard.setStringAsync(m.sms_text);
    setCopiedId(m.supplier_id ?? m.supplier_name);
    setTimeout(() => setCopiedId(null), 1800);
  }

  async function sendEmail(m: MessageCard) {
    if (!m.supplier_email) return;
    const key = m.supplier_id ?? m.supplier_name;
    setSendStatus((s) => ({ ...s, [key]: 'sending' }));
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: m.supplier_email,
          subject: m.email_subject,
          body_text: bodyText[key] ?? m.email_body_text,
          supplier_name: m.supplier_name,
        }),
      });
      if (!res.ok) throw new Error();
      setSendStatus((s) => ({ ...s, [key]: 'sent' }));
    } catch {
      setSendStatus((s) => ({ ...s, [key]: 'error' }));
    }
  }

  const o1 = compare?.option_all_one ?? null;
  const o2 = compare?.option_optimized ?? null;
  const stepIndex = step === 'qty' ? 0 : step === 'compare' ? 1 : 2;
  // W trybie bulk nie ma kroku "Ilość".
  const stepLabels = isBulkMode ? ['Oferty', 'Kontakt', 'Wyślij'] : ['Ilość', 'Oferty', 'Wyślij'];
  const bulkStepIndex = isBulkMode
    ? (step === 'compare' ? 0 : step === 'contact' ? 1 : step === 'preview' ? 2 : 0)
    : stepIndex;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container} testID="deal-hunter-modal">
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <Sparkles size={16} color={Colors.accent} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Łowca Okazji</Text>
              <Text style={styles.headerSub} numberOfLines={1}>
                {bulkContextLabel ?? product?.product_name ?? ''}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} testID="deal-hunter-close" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={22} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* Steps indicator */}
        <View style={styles.steps}>
          {stepLabels.map((label, i) => {
            const active = bulkStepIndex === i;
            const done = bulkStepIndex > i;
            return (
              <View key={label} style={styles.stepItem}>
                <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
                  {done ? (
                    <Check size={11} color={Colors.white} strokeWidth={3} />
                  ) : (
                    <Text style={[styles.stepNum, active && styles.stepNumActive]}>{i + 1}</Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
              </View>
            );
          })}
        </View>

        {error && (
          <View style={styles.errorBanner} testID="deal-hunter-error">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ── STEP 1: Quantity ── */}
        {step === 'qty' && product && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.stockCard}>
                <View style={styles.stockRow}>
                  <Text style={styles.stockLabel}>Stan aktualny</Text>
                  <Text style={styles.stockValue}>
                    {product.current_qty} {product.unit}
                  </Text>
                </View>
                <View style={styles.stockRow}>
                  <Text style={styles.stockLabel}>Próg krytyczny</Text>
                  <Text style={styles.stockValueMuted}>
                    {product.critical_threshold} {product.unit}
                  </Text>
                </View>
              </View>

              <Text style={styles.qtyHint}>
                Zaproponowaliśmy ilość o połowę większą niż aktualny stan. Możesz ją zmienić przed
                porównaniem ofert.
              </Text>

              <Text style={styles.fieldLabel}>Ilość do zamówienia</Text>
              <View style={styles.qtyInputRow}>
                <TextInput
                  style={styles.qtyInput}
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  placeholder="0"
                  placeholderTextColor={Colors.textTertiary}
                  testID="deal-hunter-qty-input"
                />
                <View style={styles.qtyUnit}>
                  <Text style={styles.qtyUnitText}>{product.unit}</Text>
                </View>
              </View>
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity style={styles.primaryBtn} onPress={runCompare} activeOpacity={0.85} testID="deal-hunter-compare-btn">
                <Sparkles size={17} color={Colors.white} strokeWidth={2.2} />
                <Text style={styles.primaryBtnText}>Porównaj oferty dostawców</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

        {/* ── STEP 2: Compare ── */}
        {step === 'compare' && (
          loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={Colors.accent} />
              <Text style={styles.loadingText}>Przeszukuję katalog dostawców...</Text>
            </View>
          ) : compare ? (
            <>
              <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
                <View style={styles.speechCard} testID="deal-hunter-speech">
                  <Volume2 size={15} color={Colors.accent} strokeWidth={2.2} />
                  <Text style={styles.speechText}>{compare.assistant_speech}</Text>
                </View>

                {compare.savings_pln > 0 && (
                  <View style={styles.savingsBadge} testID="deal-hunter-savings">
                    <TrendingDown size={14} color={Colors.success} strokeWidth={2.4} />
                    <Text style={styles.savingsText}>
                      Oszczędność z Opcją 2: {formatPln(compare.savings_pln)}
                    </Text>
                  </View>
                )}

                {o1 && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setSelectedOption('all_one')}
                    style={[styles.optCard, selectedOption === 'all_one' && styles.optCardActive]}
                    testID="deal-hunter-option-all-one"
                  >
                    <View style={styles.optHeader}>
                      <View style={styles.optBadge}>
                        <Store size={13} color={Colors.accent} strokeWidth={2.2} />
                        <Text style={styles.optBadgeText}>Opcja 1 · Wszystko u jednego</Text>
                      </View>
                      <View style={[styles.radio, selectedOption === 'all_one' && styles.radioActive]}>
                        {selectedOption === 'all_one' && <Check size={12} color={Colors.white} strokeWidth={3} />}
                      </View>
                    </View>
                    <Text style={styles.optSupplier}>{o1.supplier_name}</Text>
                    {o1.items.map((it, idx) => (
                      <View key={idx} style={styles.optLine}>
                        <Text style={styles.optLineName} numberOfLines={1}>
                          {it.matched_name} · {it.quantity} {it.unit}
                        </Text>
                        <Text style={styles.optLinePrice}>{formatPln(it.line_total)}</Text>
                      </View>
                    ))}
                    <View style={styles.optTotalRow}>
                      <Text style={styles.optTotalLabel}>Razem</Text>
                      <Text style={styles.optTotalValue}>{formatPln(o1.total_pln)}</Text>
                    </View>
                  </TouchableOpacity>
                )}

                {o2 && o2.suppliers.length > 0 && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setSelectedOption('optimized')}
                    style={[styles.optCard, selectedOption === 'optimized' && styles.optCardActive]}
                    testID="deal-hunter-option-optimized"
                  >
                    <View style={styles.optHeader}>
                      <View style={[styles.optBadge, styles.optBadgeGreen]}>
                        <TrendingDown size={13} color={Colors.success} strokeWidth={2.2} />
                        <Text style={[styles.optBadgeText, { color: Colors.success }]}>
                          Opcja 2 · Optymalizacja ceny
                        </Text>
                      </View>
                      <View style={[styles.radio, selectedOption === 'optimized' && styles.radioActive]}>
                        {selectedOption === 'optimized' && <Check size={12} color={Colors.white} strokeWidth={3} />}
                      </View>
                    </View>
                    {o2.suppliers.map((g, gi) => (
                      <View key={gi} style={styles.groupBlock}>
                        <View style={styles.groupHeader}>
                          <Truck size={11} color={Colors.textSecondary} strokeWidth={2.2} />
                          <Text style={styles.groupName}>{g.supplier_name}</Text>
                          <Text style={styles.groupSub}>{formatPln(g.subtotal_pln)}</Text>
                        </View>
                        {g.items.map((it, idx) => (
                          <View key={idx} style={styles.optLine}>
                            <Text style={styles.optLineName} numberOfLines={1}>
                              {it.matched_name} · {it.quantity} {it.unit}
                            </Text>
                            <Text style={styles.optLinePrice}>{formatPln(it.line_total)}</Text>
                          </View>
                        ))}
                      </View>
                    ))}
                    <View style={styles.optTotalRow}>
                      <Text style={styles.optTotalLabel}>Razem</Text>
                      <Text style={[styles.optTotalValue, { color: Colors.success }]}>
                        {formatPln(o2.total_pln)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                <View style={{ height: 16 }} />
              </ScrollView>
              <View style={styles.footer}>
                <TouchableOpacity
                  style={[styles.primaryBtn, (!selectedOption || loading) && styles.primaryBtnDisabled]}
                  onPress={prepareEmail}
                  disabled={!selectedOption || loading}
                  activeOpacity={0.85}
                  testID="deal-hunter-prepare-email-btn"
                >
                  {loading ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <>
                      <Mail size={16} color={Colors.white} strokeWidth={2.2} />
                      <Text style={styles.primaryBtnText}>Przygotuj E-mail</Text>
                      <ChevronRight size={17} color={Colors.white} strokeWidth={2.2} />
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.centerBox}>
              <Text style={styles.loadingText}>Brak danych.</Text>
            </View>
          )
        )}

        {/* ── STEP: Contact form (first time only) ── */}
        {step === 'contact' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>📋 Dane kontaktowe dla dostawców</Text>
                <Text style={styles.infoText}>
                  Wpisz dane, na które hurtownia ma się z Tobą kontaktować w sprawie tego zamówienia.
                  Trafią one do stopki wiadomości oraz w pole „Odpowiedz”.
                </Text>
              </View>

              <Text style={styles.fieldLabel}>Twój e-mail kontaktowy</Text>
              <View style={styles.inputRow}>
                <Mail size={16} color={Colors.textSecondary} strokeWidth={2} />
                <TextInput
                  style={styles.textInput}
                  value={contactEmail}
                  onChangeText={setContactEmail}
                  placeholder="np. kontakt@twojarestauracja.pl"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="deal-hunter-contact-email"
                />
              </View>

              <Text style={styles.fieldLabel}>Twój telefon</Text>
              <View style={styles.inputRow}>
                <Phone size={16} color={Colors.textSecondary} strokeWidth={2} />
                <TextInput
                  style={styles.textInput}
                  value={contactPhone}
                  onChangeText={setContactPhone}
                  placeholder="np. +48 600 100 200"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="phone-pad"
                  testID="deal-hunter-contact-phone"
                />
              </View>
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.primaryBtn, savingProfile && styles.primaryBtnDisabled]}
                onPress={saveProfile}
                disabled={savingProfile}
                activeOpacity={0.85}
                testID="deal-hunter-save-profile-btn"
              >
                {savingProfile ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Zapisz i przejdź do podglądu</Text>
                    <ChevronRight size={17} color={Colors.white} strokeWidth={2.2} />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

        {/* ── STEP: Preview + send ── */}
        {step === 'preview' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.msgIntro}>
                Sprawdź treść zamówienia. Możesz dopisać coś ręcznie w polu poniżej. Wysyłka nastąpi
                dopiero po kliknięciu przycisku „Zatwierdź i wyślij”.
              </Text>
              {messages.map((m) => {
                const key = m.supplier_id ?? m.supplier_name;
                const st = sendStatus[key];
                return (
                  <View key={key} style={styles.msgCard} testID={`deal-hunter-message-${m.supplier_name}`}>
                    <View style={styles.msgHeader}>
                      <Truck size={14} color={Colors.accent} strokeWidth={2.2} />
                      <Text style={styles.msgSupplier}>{m.supplier_name}</Text>
                      <Text style={styles.msgTotal}>{formatPln(m.subtotal_pln)}</Text>
                    </View>

                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Do:</Text>
                      <Text style={styles.metaValue} numberOfLines={1}>
                        {m.supplier_email ?? '— brak adresu e-mail —'}
                      </Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Temat:</Text>
                      <Text style={styles.metaValue} numberOfLines={2}>{m.email_subject}</Text>
                    </View>

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
                        <Check size={16} color={Colors.success} strokeWidth={2.5} />
                        <Text style={styles.successText}>Zamówienie zostało wysłane pomyślnie!</Text>
                      </View>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[styles.sendBtn, (!m.supplier_email || st === 'sending') && styles.btnDisabled]}
                          onPress={() => sendEmail(m)}
                          disabled={!m.supplier_email || st === 'sending'}
                          activeOpacity={0.85}
                          testID={`deal-hunter-send-email-${m.supplier_name}`}
                        >
                          {st === 'sending' ? (
                            <ActivityIndicator size="small" color={Colors.white} />
                          ) : (
                            <>
                              <Send size={16} color={Colors.white} strokeWidth={2.2} />
                              <Text style={styles.sendBtnText}>🚀 Zatwierdź i wyślij maila do hurtowni</Text>
                            </>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.smsBtn}
                          onPress={() => copySms(m)}
                          activeOpacity={0.85}
                          testID={`deal-hunter-copy-sms-${m.supplier_name}`}
                        >
                          {copiedId === key ? (
                            <>
                              <Check size={14} color={Colors.accent} strokeWidth={2.4} />
                              <Text style={styles.smsBtnText}>Skopiowano SMS</Text>
                            </>
                          ) : (
                            <>
                              <Copy size={14} color={Colors.accent} strokeWidth={2.2} />
                              <Text style={styles.smsBtnText}>Kopiuj do SMS</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </>
                    )}
                    {st === 'error' && (
                      <View style={styles.errRow}>
                        <CircleAlert size={13} color={Colors.danger} strokeWidth={2.2} />
                        <Text style={styles.emailError}>
                          Nie udało się wysłać. Sprawdź weryfikację domeny w Resend i spróbuj ponownie.
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
              <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.85} testID="deal-hunter-done-btn">
                <Text style={styles.doneBtnText}>Zakończ</Text>
              </TouchableOpacity>
              <View style={{ height: 24 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 18,
    paddingBottom: 12,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.accentLight,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  steps: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: Colors.card,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: Colors.accent },
  stepDotDone: { backgroundColor: Colors.success },
  stepNum: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary },
  stepNumActive: { color: Colors.white },
  stepLabel: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary },
  stepLabelActive: { color: Colors.textPrimary },
  errorBanner: {
    backgroundColor: Colors.dangerLight, marginHorizontal: 16, marginTop: 12,
    borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#FECACA',
  },
  errorText: { fontSize: 13, color: Colors.danger, fontWeight: '500' },
  body: { padding: 16, gap: 12 },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  // Step 1
  stockCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14, gap: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  stockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stockLabel: { fontSize: 13, color: Colors.textSecondary },
  stockValue: { fontSize: 15, fontWeight: '700', color: Colors.danger },
  stockValueMuted: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  qtyHint: { fontSize: 12, color: Colors.textTertiary, lineHeight: 17 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.3 },
  qtyInputRow: { flexDirection: 'row', gap: 10 },
  qtyInput: {
    flex: 1, backgroundColor: Colors.card, borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 16, fontSize: 24, fontWeight: '800', color: Colors.textPrimary,
    textAlign: 'center', borderWidth: 2, borderColor: Colors.accent,
  },
  qtyUnit: {
    width: 72, backgroundColor: Colors.borderLight, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border,
  },
  qtyUnitText: { fontSize: 16, fontWeight: '700', color: Colors.textSecondary },
  footer: {
    padding: 16, backgroundColor: Colors.card, borderTopWidth: 1, borderTopColor: Colors.border,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 15,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: Colors.white },
  // Step 2
  speechCard: {
    flexDirection: 'row', gap: 10, backgroundColor: Colors.accentLight,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#BFDBFE', alignItems: 'flex-start',
  },
  speechText: { flex: 1, fontSize: 13, color: Colors.accentDark, lineHeight: 19, fontWeight: '500' },
  savingsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: Colors.successLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  savingsText: { fontSize: 13, fontWeight: '700', color: Colors.success },
  optCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 8,
    borderWidth: 2, borderColor: Colors.border,
  },
  optCardActive: { borderColor: Colors.accent, backgroundColor: '#FBFDFF' },
  optHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.accentLight,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7,
  },
  optBadgeGreen: { backgroundColor: Colors.successLight },
  optBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.accent },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  optSupplier: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  optLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  optLineName: { flex: 1, fontSize: 13, color: Colors.textSecondary },
  optLinePrice: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  groupBlock: { gap: 5, marginTop: 2 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  groupName: { flex: 1, fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  groupSub: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  optTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 8, marginTop: 4,
  },
  optTotalLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  optTotalValue: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  // Contact form
  infoCard: {
    backgroundColor: Colors.accentLight, borderRadius: 12, padding: 14, gap: 6,
    borderLeftWidth: 3, borderLeftColor: Colors.accent,
  },
  infoTitle: { fontSize: 14, fontWeight: '800', color: Colors.accentDark },
  infoText: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 18 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card,
    borderRadius: 10, paddingHorizontal: 12, borderWidth: 1.5, borderColor: Colors.border,
  },
  textInput: { flex: 1, fontSize: 15, color: Colors.textPrimary, paddingVertical: 13 },
  // Preview / messages
  msgIntro: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  msgCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  msgHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  msgSupplier: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  msgTotal: { fontSize: 14, fontWeight: '700', color: Colors.accent },
  metaRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  metaLabel: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary, width: 48 },
  metaValue: { flex: 1, fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  msgSectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.4, marginTop: 4,
  },
  bodyInput: {
    backgroundColor: Colors.borderLight, borderRadius: 10, padding: 12, fontSize: 12.5,
    color: Colors.textPrimary, lineHeight: 18, minHeight: 200, borderWidth: 1, borderColor: Colors.border,
  },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 14, marginTop: 6,
  },
  sendBtnText: { fontSize: 14, fontWeight: '700', color: Colors.white, textAlign: 'center' },
  smsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.accentLight, borderRadius: 10, paddingVertical: 11,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  smsBtnText: { fontSize: 13, fontWeight: '700', color: Colors.accent },
  btnDisabled: { opacity: 0.5 },
  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.successLight,
    borderRadius: 10, padding: 13, borderWidth: 1, borderColor: '#BBF7D0', marginTop: 6,
  },
  successText: { fontSize: 13.5, fontWeight: '700', color: Colors.success },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  emailError: { flex: 1, fontSize: 12, color: Colors.danger },
  doneBtn: {
    backgroundColor: Colors.textPrimary, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 8,
  },
  doneBtnText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
