import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Switch,
  RefreshControl,
  ActivityIndicator,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Settings,
  Webhook,
  Map,
  Info,
  Copy,
  Check,
  ChevronRight,
  Key,
  Zap,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import MenuRecipeRow, {
  MenuItemForMapping,
  InventoryItemForRecipe,
} from '@/components/MenuRecipeRow';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';

// ─── Constants ────────────────────────────────────────────────────────────────

const WEBHOOK_URL = 'https://mzmwevqdfpigmkcflkqc.supabase.co/functions/v1/pos-webhook';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PosSettings {
  id?: string;
  api_key: string;
  is_connected: boolean;
}

// ─── PosInstructionBanner ─────────────────────────────────────────────────────

function PosInstructionBanner() {
  const steps = [
    'Skopiuj automatycznie wygenerowany Link Webhook widoczny poniżej.',
    'Zaloguj się do panelu administracyjnego swojego systemu POS (np. GoPOS, POSbistro) w przeglądarce.',
    'Przejdź do Ustawienia → Integracje / Webhooki, wklej tam skopiowany link i wybierz zdarzenie "Zamknięcie rachunku / Sprzedaż".',
    'Jeśli Twój POS tego wymaga, skopiuj z tamtego panelu Klucz API i wklej go w polu poniżej, a następnie włącz integrację.',
  ];

  return (
    <View style={instrStyles.container}>
      <View style={instrStyles.titleRow}>
        <Zap size={15} color={Colors.accent} strokeWidth={2.5} />
        <Text style={instrStyles.title}>Jak połączyć aplikację z Twoim systemem POS?</Text>
      </View>
      {steps.map((step, idx) => (
        <View key={idx} style={instrStyles.stepRow}>
          <View style={instrStyles.stepBadge}>
            <Text style={instrStyles.stepNum}>{idx + 1}</Text>
          </View>
          <Text style={instrStyles.stepText}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

const instrStyles = StyleSheet.create({
  container: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accentDark,
    lineHeight: 18,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 9,
  },
  stepBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  stepNum: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  stepText: {
    flex: 1,
    fontSize: 12,
    color: '#1E3A8A',
    lineHeight: 17,
  },
});

// ─── WebhookUrlRow ────────────────────────────────────────────────────────────

function WebhookUrlRow() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    Clipboard.setString(WEBHOOK_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={whStyles.container}>
      <View style={whStyles.labelRow}>
        <Webhook size={13} color={Colors.textSecondary} strokeWidth={2} />
        <Text style={whStyles.label}>Twój Link Webhook</Text>
        <View style={whStyles.autoBadge}>
          <Text style={whStyles.autoBadgeText}>AUTO</Text>
        </View>
      </View>
      <View style={whStyles.urlRow}>
        <Text style={whStyles.urlText} numberOfLines={1} ellipsizeMode="middle">
          {WEBHOOK_URL}
        </Text>
        <TouchableOpacity
          style={[whStyles.copyBtn, copied && whStyles.copyBtnSuccess]}
          onPress={handleCopy}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {copied
            ? <Check size={14} color="#fff" strokeWidth={2.5} />
            : <Copy size={14} color={Colors.accent} strokeWidth={2} />}
          <Text style={[whStyles.copyBtnText, copied && whStyles.copyBtnTextSuccess]}>
            {copied ? 'Skopiowano!' : 'Kopiuj'}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={whStyles.hint}>
        Ten adres wklej w polu "Webhook URL" lub "Endpoint" w panelu swojego systemu POS.
      </Text>
    </View>
  );
}

const whStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    flex: 1,
  },
  autoBadge: {
    backgroundColor: '#DCFCE7',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  autoBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#15803D',
    letterSpacing: 0.5,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
  },
  urlText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    fontFamily: 'monospace' as any,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.accentLight,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  copyBtnSuccess: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  copyBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.accent,
  },
  copyBtnTextSuccess: {
    color: '#fff',
  },
  hint: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 6,
    lineHeight: 15,
  },
});

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function UstawieniaScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [posSettings, setPosSettings] = useState<PosSettings>({
    api_key: '',
    is_connected: false,
  });
  const [posSaving, setPosSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);

  const [menuItems, setMenuItems] = useState<MenuItemForMapping[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemForRecipe[]>([]);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [posRes, menuRes, invRes] = await Promise.all([
        supabase.from('pos_settings').select('*').maybeSingle(),
        supabase
          .from('menu_items')
          .select('id, name, category, price_pln, pos_id')
          .eq('is_active', true)
          .order('category')
          .order('name'),
        supabase
          .from('inventory_items')
          .select('id, name, unit, inventory_categories(name)')
          .order('name'),
      ]);

      if (posRes.data) {
        setPosSettings({
          id: posRes.data.id,
          api_key: posRes.data.api_key ?? '',
          is_connected: posRes.data.is_connected ?? false,
        } as PosSettings & { id: string });
        setHasSaved(true);
      }

      setMenuItems(
        (menuRes.data ?? []).map((m: any) => ({
          id: m.id,
          name: m.name,
          category: m.category,
          price_pln: m.price_pln,
          pos_id: m.pos_id,
        }))
      );

      setInventoryItems(
        (invRes.data ?? []).map((i: any) => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          category_name: i.inventory_categories?.name ?? null,
        }))
      );
    } catch (e: any) {
      setError(e.message ?? 'Błąd ładowania ustawień');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAll();
  };

  const handleSavePosSettings = async () => {
    setPosSaving(true);
    let result;
    const payload = {
      webhook_url: WEBHOOK_URL,
      api_key: posSettings.api_key,
      is_connected: posSettings.is_connected,
    };

    if ((posSettings as any).id) {
      result = await supabase
        .from('pos_settings')
        .update(payload)
        .eq('id', (posSettings as any).id);
    } else {
      result = await supabase.from('pos_settings').insert(payload);
    }
    setPosSaving(false);
    if (result.error) {
      Alert.alert('Błąd', result.error.message);
    } else {
      setHasSaved(true);
      Alert.alert('Zapisano', 'Ustawienia POS zostały zaktualizowane.');
      fetchAll();
    }
  };

  const handleMenuItemChanged = () => {
    supabase
      .from('menu_items')
      .select('id, name, category, price_pln, pos_id')
      .eq('is_active', true)
      .order('category')
      .order('name')
      .then(({ data }) => {
        if (data) {
          setMenuItems(
            data.map((m: any) => ({
              id: m.id,
              name: m.name,
              category: m.category,
              price_pln: m.price_pln,
              pos_id: m.pos_id,
            }))
          );
        }
      });
  };

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  const unmappedPosCount = menuItems.filter((m) => !m.pos_id).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Settings size={22} color={Colors.accent} />
          <Text style={styles.headerTitle}>Ustawienia</Text>
        </View>

        {/* ── POS Settings ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Webhook size={16} color={Colors.textSecondary} />
            <Text style={styles.sectionTitle}>Integracja POS</Text>
          </View>

          {/* Step-by-step instruction banner */}
          <PosInstructionBanner />

          <View style={styles.card}>
            {/* Webhook URL — read-only with copy */}
            <WebhookUrlRow />

            <View style={styles.divider} />

            {/* API Key */}
            <View style={styles.fieldRow}>
              <View style={styles.fieldLabelRow}>
                <Key size={12} color={Colors.textSecondary} strokeWidth={2} />
                <Text style={styles.fieldLabel}>Klucz API</Text>
              </View>
              <TextInput
                style={styles.input}
                value={posSettings.api_key}
                onChangeText={(v) => setPosSettings((p) => ({ ...p, api_key: v }))}
                placeholder="Wklej tutaj token z panelu POS..."
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Text style={styles.fieldHint}>
                (Opcjonalnie) Wklej klucz tokenu wygenerowany w panelu Twojego POS, jeśli system
                wymaga dwustronnej autoryzacji.
              </Text>
            </View>

            <View style={styles.divider} />

            {/* Active integration toggle */}
            <View style={styles.fieldRowSwitch}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Aktywna integracja</Text>
                {!hasSaved && (
                  <Text style={styles.switchHint}>Zapisz ustawienia, aby włączyć</Text>
                )}
              </View>
              <Switch
                value={posSettings.is_connected}
                onValueChange={(v) => setPosSettings((p) => ({ ...p, is_connected: v }))}
                trackColor={{ true: Colors.accent, false: '#CBD5E1' }}
                disabled={!hasSaved}
              />
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, posSaving && styles.saveBtnDisabled]}
              onPress={handleSavePosSettings}
              disabled={posSaving}
              activeOpacity={0.8}
            >
              {posSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Zapisz ustawienia POS</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Recipe Mapping ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Map size={16} color={Colors.textSecondary} />
            <Text style={styles.sectionTitle}>Mapowanie Receptur</Text>
          </View>

          <View style={styles.hintBox}>
            <Info size={14} color="#3B82F6" />
            <Text style={styles.hintText}>
              Dla każdego dania rozwiń kafelek i wpisz kod SKU lub identyfikator z systemu POS.
              Gdy POS zarejestruje sprzedaż tego dania, aplikacja automatycznie odliczy składniki
              receptury z magazynu.
            </Text>
          </View>

          {unmappedPosCount > 0 && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                {unmappedPosCount}{' '}
                {unmappedPosCount === 1 ? 'pozycja nie ma' : 'pozycje nie mają'} przypisanego
                identyfikatora POS.
              </Text>
            </View>
          )}

          {menuItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                Dodaj dania w zakładce Menu — pojawią się tutaj automatycznie.
              </Text>
            </View>
          ) : (
            menuItems.map((item) => (
              <MenuRecipeRow
                key={item.id}
                menuItem={item}
                inventoryItems={inventoryItems}
                onChanged={handleMenuItemChanged}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1E293B',
  },

  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  fieldRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 5,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  fieldHint: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 6,
    lineHeight: 15,
  },
  fieldRowSwitch: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchHint: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  input: {
    height: 40,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#1E293B',
    backgroundColor: '#F8FAFC',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginHorizontal: 14,
  },
  saveBtn: {
    margin: 14,
    marginTop: 12,
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },

  hintBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    color: '#1D4ED8',
    lineHeight: 17,
  },
  warningBox: {
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  warningText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
  },
});
