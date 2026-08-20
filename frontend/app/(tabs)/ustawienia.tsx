import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
  DeviceEventEmitter,
} from 'react-native';
import { RECIPE_INGREDIENTS_CHANGED } from '@/lib/recipeSync';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Settings,
  Webhook,
  Map,
  Info,
  Copy,
  Check,
  Key,
  Zap,
  LogOut,
} from 'lucide-react-native';
import {
  fetchActiveMenuPosList,
  fetchSettingsBundle,
  savePosSettings,
} from '@/services/settingsService';
import { Colors } from '@/constants/colors';
import { CATEGORY_COLORS } from '@/constants/menuUi';
import MenuRecipeRow, {
  MenuItemForMapping,
  InventoryItemForRecipe,
} from '@/components/MenuRecipeRow';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { PosProviderPicker } from '@/components/PosProviderPicker';
import {
  buildPosWebhookUrl,
  getPosProvider,
  POS_PROVIDERS,
  type PosProviderId,
} from '@/lib/posProviders';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PremiumTabChrome } from '@/components/premium/PremiumTabChrome';
import { useAuth } from '@/contexts/AuthContext';
import { router } from 'expo-router';
import { apiJsonHeaders } from '@/lib/apiHeaders';

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');
const POS_PROVIDER_KEY = '@gm/pos_provider';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PosSettings {
  id?: string;
  api_key: string;
  is_connected: boolean;
}

// ─── PosInstructionBanner ─────────────────────────────────────────────────────

function PosInstructionBanner({ providerId }: { providerId: PosProviderId }) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const provider = getPosProvider(providerId);
  const steps = provider.steps;

  return (
    <View
      style={[
        instrStyles.container,
        prem && {
          backgroundColor: theme.accentSoft,
          borderColor: theme.border,
        },
      ]}
    >
      <View style={instrStyles.titleRow}>
        <Zap size={15} color={theme.accent} strokeWidth={2.5} />
        <Text style={[instrStyles.title, { color: prem ? theme.accent : Colors.accentDark }]}>
          Jak połączyć {provider.name} z Gastro-Manager?
        </Text>
      </View>
      <Text style={[instrStyles.panelHint, { color: prem ? theme.textMuted : '#3B82F6' }]}>
        {provider.panelHint}
      </Text>
      {steps.map((step, idx) => (
        <View key={idx} style={instrStyles.stepRow}>
          <View style={[instrStyles.stepBadge, { backgroundColor: theme.accent }]}>
            <Text style={[instrStyles.stepNum, prem && { color: '#0A0A0A' }]}>{idx + 1}</Text>
          </View>
          <Text style={[instrStyles.stepText, { color: prem ? theme.textSecondary : '#1E3A8A' }]}>
            {step}
          </Text>
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
  panelHint: {
    fontSize: 11,
    color: '#3B82F6',
    marginBottom: 10,
    fontWeight: '600',
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

function WebhookUrlRow({ url }: { url: string }) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    Clipboard.setString(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={whStyles.container}>
      <View style={whStyles.labelRow}>
        <Webhook size={13} color={theme.textSecondary} strokeWidth={2} />
        <Text style={[whStyles.label, { color: theme.textSecondary }]}>Twój Link Webhook</Text>
        <View style={[whStyles.autoBadge, prem && { backgroundColor: theme.accentSoft }]}>
          <Text style={[whStyles.autoBadgeText, prem && { color: theme.accent }]}>AUTO</Text>
        </View>
      </View>
      <View style={[whStyles.urlRow, prem && { backgroundColor: theme.segmentBg, borderColor: theme.border }]}>
        <Text style={[whStyles.urlText, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">
          {url}
        </Text>
        <TouchableOpacity
          style={[
            whStyles.copyBtn,
            prem && { backgroundColor: theme.accentSoft, borderColor: theme.accent },
            copied && (prem ? { backgroundColor: theme.accent } : whStyles.copyBtnSuccess),
          ]}
          onPress={handleCopy}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {copied
            ? <Check size={14} color={prem ? '#0A0A0A' : '#fff'} strokeWidth={2.5} />
            : <Copy size={14} color={theme.accent} strokeWidth={2} />}
          <Text
            style={[
              whStyles.copyBtnText,
              { color: theme.accent },
              copied && (prem ? { color: '#0A0A0A' } : whStyles.copyBtnTextSuccess),
            ]}
          >
            {copied ? 'Skopiowano!' : 'Kopiuj'}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={[whStyles.hint, { color: theme.textMuted }]}>
        Ten adres wklej w polu „Webhook URL” w panelu POS (cały link, łącznie z tokenem).
        Kody produktów w Mapowaniu receptur muszą być takie same jak w POS.
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
  const [posProvider, setPosProvider] = useState<PosProviderId>('generic');
  const [signedWebhookUrl, setSignedWebhookUrl] = useState<string | null>(null);

  const [menuItems, setMenuItems] = useState<MenuItemForMapping[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemForRecipe[]>([]);
  const theme = useAppTheme();
  const { user, profile, accountKey, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = () => {
    Alert.alert('Wylogowanie', 'Na pewno chcesz się wylogować?', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Wyloguj',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSigningOut(true);
            try {
              await signOut();
              router.replace('/(auth)/login');
            } finally {
              setSigningOut(false);
            }
          })();
        },
      },
    ]);
  };

  const fallbackWebhookUrl = buildPosWebhookUrl(
    BACKEND_URL || 'http://127.0.0.1:8001',
    posProvider,
  );
  const webhookUrl = signedWebhookUrl || fallbackWebhookUrl;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const headers = await apiJsonHeaders();
        const q = posProvider && posProvider !== 'generic' ? `?provider=${encodeURIComponent(posProvider)}` : '';
        const res = await fetch(`${BACKEND_URL}/api/pos/webhook-config${q}`, { headers });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && typeof data.url === 'string' && data.url) {
          setSignedWebhookUrl(data.url);
        }
      } catch {
        if (!cancelled) setSignedWebhookUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [posProvider, accountKey]);

  useEffect(() => {
    AsyncStorage.getItem(POS_PROVIDER_KEY).then((v) => {
      if (v && POS_PROVIDERS.some((p) => p.id === v)) {
        setPosProvider(v as PosProviderId);
      }
    }).catch(() => {});
  }, []);

  const handleProviderChange = (id: PosProviderId) => {
    setPosProvider(id);
    void AsyncStorage.setItem(POS_PROVIDER_KEY, id);
  };

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const bundle = await fetchSettingsBundle(accountKey);
      if (bundle.pos) {
        setPosSettings({
          id: bundle.pos.id,
          api_key: bundle.pos.api_key,
          is_connected: bundle.pos.is_connected,
        } as PosSettings & { id: string });
        setHasSaved(true);
      }
      setMenuItems(bundle.menuItems);
      setInventoryItems(bundle.inventoryItems);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Błąd ładowania ustawień');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accountKey]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Sync receptur z zakładki Menu (ta sama tabela recipe_ingredients)
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(RECIPE_INGREDIENTS_CHANGED, () => {
      void fetchAll();
    });
    return () => sub.remove();
  }, [fetchAll]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAll();
  };

  const handleSavePosSettings = async () => {
    setPosSaving(true);
    const payload = {
      webhook_url: webhookUrl,
      api_key: posSettings.api_key,
      is_connected: posSettings.is_connected,
    };
    const existingId = (posSettings as PosSettings & { id?: string }).id;
    const result = await savePosSettings(payload, existingId);
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
    void (async () => {
      const data = await fetchActiveMenuPosList(accountKey);
      if (data.length) setMenuItems(data);
    })();
  };

  /** Segregacja jak w Menu — nagłówek kategorii + pozycje (kolejność alfabetyczna kategorii). */
  const menuByCategory = useMemo(() => {
    const map = new Map<string, MenuItemForMapping[]>();
    for (const item of menuItems) {
      const cat = (item.category || '').trim() || 'Bez kategorii';
      const list = map.get(cat);
      if (list) list.push(item);
      else map.set(cat, [item]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'pl'));
  }, [menuItems]);

  const unmappedPosCount = menuItems.filter((m) => !m.pos_id).length;

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  const scrollBody = (
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
          />
        }
        contentContainerStyle={[styles.content, theme.isPremium && { paddingTop: 8 }]}
        showsVerticalScrollIndicator={false}
      >
        {!theme.isPremium ? (
          <View style={styles.header}>
            <Settings size={22} color={theme.accent} />
            <Text style={[styles.headerTitle, { color: '#1E293B' }]}>Ustawienia</Text>
          </View>
        ) : null}

        {/* ── Konto ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Info size={16} color={theme.textSecondary} />
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Konto</Text>
          </View>
          <View
            style={[
              styles.card,
              theme.isPremium && {
                backgroundColor: theme.card,
                borderColor: theme.border,
              },
            ]}
          >
            <Text style={[styles.fieldLabel, { color: theme.textSecondary, marginBottom: 4 }]}>
              E-mail
            </Text>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', marginBottom: 10 }}>
              {user?.email || profile?.email || '—'}
            </Text>
            {profile?.restaurant_name ? (
              <>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary, marginBottom: 4 }]}>
                  Restauracja
                </Text>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', marginBottom: 10 }}>
                  {profile.restaurant_name}
                </Text>
              </>
            ) : null}
            <Text style={[styles.fieldHint, { color: theme.textMuted, marginBottom: 14 }]}>
              Klucz konta (kredyty / Stripe): {accountKey}
            </Text>
            <TouchableOpacity
              style={[
                styles.saveBtn,
                {
                  backgroundColor: theme.isPremium ? 'rgba(255,90,90,0.16)' : Colors.dangerLight,
                  borderWidth: 1,
                  borderColor: theme.isPremium ? 'rgba(255,90,90,0.35)' : Colors.danger,
                },
                signingOut && styles.saveBtnDisabled,
              ]}
              onPress={handleSignOut}
              disabled={signingOut}
              activeOpacity={0.85}
              testID="settings-logout"
            >
              {signingOut ? (
                <ActivityIndicator color={theme.danger} />
              ) : (
                <>
                  <LogOut size={16} color={theme.danger} strokeWidth={2.4} />
                  <Text style={[styles.saveBtnText, { color: theme.danger }]}>Wyloguj się</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── POS Settings ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Webhook size={16} color={theme.textSecondary} />
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Integracja POS</Text>
          </View>

          <PosInstructionBanner providerId={posProvider} />

          <View
            style={[
              styles.card,
              theme.isPremium && {
                backgroundColor: theme.card,
                borderColor: theme.border,
              },
            ]}
          >
            <PosProviderPicker value={posProvider} onChange={handleProviderChange} />

            <View style={[styles.divider, theme.isPremium && { backgroundColor: theme.border }]} />

            <WebhookUrlRow url={webhookUrl} />

            <View style={[styles.divider, theme.isPremium && { backgroundColor: theme.border }]} />

            <View style={styles.fieldRow}>
              <View style={styles.fieldLabelRow}>
                <Key size={12} color={theme.textSecondary} strokeWidth={2} />
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Klucz API</Text>
              </View>
              <TextInput
                style={[
                  styles.input,
                  theme.isPremium && {
                    backgroundColor: theme.segmentBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={posSettings.api_key}
                onChangeText={(v) => setPosSettings((p) => ({ ...p, api_key: v }))}
                placeholder="Wklej tutaj token z panelu POS..."
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Text style={[styles.fieldHint, { color: theme.textMuted }]}>
                {getPosProvider(posProvider).needsApiKey
                  ? 'Ten POS zwykle wymaga tokenu — wklej klucz z panelu, potem włącz integrację.'
                  : '(Opcjonalnie) Wklej klucz tokenu wygenerowany w panelu Twojego POS, jeśli system wymaga dwustronnej autoryzacji.'}
              </Text>
            </View>

            <View style={[styles.divider, theme.isPremium && { backgroundColor: theme.border }]} />

            <View style={styles.fieldRowSwitch}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Aktywna integracja</Text>
                {!hasSaved && (
                  <Text style={[styles.switchHint, { color: theme.textMuted }]}>
                    Zapisz ustawienia, aby włączyć
                  </Text>
                )}
              </View>
              <Switch
                value={posSettings.is_connected}
                onValueChange={(v) => setPosSettings((p) => ({ ...p, is_connected: v }))}
                trackColor={{ true: theme.accent, false: theme.isPremium ? theme.border : '#CBD5E1' }}
                disabled={!hasSaved}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.saveBtn,
                theme.isPremium && { backgroundColor: theme.accent },
                posSaving && styles.saveBtnDisabled,
              ]}
              onPress={handleSavePosSettings}
              disabled={posSaving}
              activeOpacity={0.8}
            >
              {posSaving ? (
                <ActivityIndicator size="small" color={theme.isPremium ? '#0A0A0A' : '#fff'} />
              ) : (
                <Text style={[styles.saveBtnText, theme.isPremium && { color: '#0A0A0A' }]}>
                  Zapisz ustawienia POS
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Recipe Mapping ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Map size={16} color={theme.textSecondary} />
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Mapowanie Receptur</Text>
          </View>

          <View
            style={[
              styles.hintBox,
              theme.isPremium && {
                backgroundColor: theme.accentSoft,
                borderWidth: 1,
                borderColor: theme.border,
              },
            ]}
          >
            <Info size={14} color={theme.isPremium ? theme.accent : '#3B82F6'} />
            <Text style={[styles.hintText, { color: theme.isPremium ? theme.textSecondary : '#1D4ED8' }]}>
              Składniki 1:1 z Menu — edytujesz tu lub w Menu, obie strony się synchronizują. Zmapuj je
              do magazynu (auto po nazwie). Przy sprzedaży POS aplikacja odejmie te ilości z magazynu.
            </Text>
          </View>

          {unmappedPosCount > 0 && (
            <View
              style={[
                styles.warningBox,
                theme.isPremium && {
                  backgroundColor: 'rgba(245,158,11,0.12)',
                  borderWidth: 1,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text style={[styles.warningText, theme.isPremium && { color: theme.warning }]}>
                {unmappedPosCount}{' '}
                {unmappedPosCount === 1 ? 'pozycja nie ma' : 'pozycje nie mają'} przypisanego
                identyfikatora POS.
              </Text>
            </View>
          )}

          {menuItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyStateText, { color: theme.textMuted }]}>
                Dodaj dania w zakładce Menu — pojawią się tutaj automatycznie.
              </Text>
            </View>
          ) : (
            menuByCategory.map(([category, items]) => (
              <View key={category} style={styles.categoryBlock}>
                <View style={styles.categoryHeaderRow}>
                  <View
                    style={[
                      styles.categoryDot,
                      { backgroundColor: CATEGORY_COLORS[category] ?? theme.textMuted },
                    ]}
                  />
                  <Text
                    style={[styles.categoryHeader, { color: theme.isPremium ? theme.text : '#1E293B' }]}
                    allowFontScaling={false}
                  >
                    {category}
                  </Text>
                  <Text style={[styles.categoryCount, { color: theme.textMuted }]} allowFontScaling={false}>
                    {items.length}
                  </Text>
                </View>
                {items.map((item) => (
                  <MenuRecipeRow
                    key={item.id}
                    menuItem={item}
                    inventoryItems={inventoryItems}
                    onChanged={handleMenuItemChanged}
                  />
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]} edges={['top']}>
      {theme.isPremium ? (
        <PremiumTabChrome
          title="Ustawienia"
          subtitle="Ustawienia"
          showFloats={false}
          headerVariant="centered"
        >
          {scrollBody}
        </PremiumTabChrome>
      ) : (
        scrollBody
      )}
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
  categoryBlock: {
    marginBottom: 14,
    gap: 8,
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  categoryHeader: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  categoryCount: {
    fontSize: 13,
    fontWeight: '600',
  },
});
