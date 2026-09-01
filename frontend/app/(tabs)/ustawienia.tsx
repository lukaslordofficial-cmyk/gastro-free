import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  RefreshControl,
  ActivityIndicator,
  DeviceEventEmitter,
  Linking,
} from 'react-native';
import { RECIPE_INGREDIENTS_CHANGED } from '@/lib/recipeSync';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Settings,
  Webhook,
  Map as MapIcon,
  Info,
  Key,
  LogOut,
  FileText,
  Trash2,
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
import { PosInstructionBanner } from '@/components/settings/PosInstructionBanner';
import { PosSyncStatusCard } from '@/components/settings/PosSyncStatusCard';
import { WebhookUrlRow } from '@/components/settings/WebhookUrlRow';
import { RestaurantBillingForm } from '@/components/settings/RestaurantBillingForm';
import { SettingsTopTabs, type SettingsPaneId } from '@/components/settings/SettingsTopTabs';
import { settingsScreenStyles as styles } from '@/components/settings/settingsScreenStyles';
import { groupMenuItemsByCategory } from '@/lib/settingsMenuGroups';
import {
  getPosProvider,
  POS_PROVIDERS,
  type PosProviderId,
} from '@/lib/posProviders';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PremiumTabChrome } from '@/components/premium/PremiumTabChrome';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useAuth } from '@/contexts/AuthContext';
import { router } from 'expo-router';
import { apiJsonHeaders } from '@/lib/apiHeaders';
import { privacyPolicyUrl, termsUrl } from '@/lib/legalUrls';
import { deleteOwnAccount } from '@/lib/accountClient';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');
const POS_PROVIDER_KEY = '@gm/pos_provider';

interface PosSettings {
  id?: string;
  api_key: string;
  is_connected: boolean;
}

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
  const { alert: premiumAlert } = usePremiumAlert();
  const { user, profile, accountKey, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [settingsPane, setSettingsPane] = useState<SettingsPaneId>('lokal');

  const handleDeleteAccount = () => {
    premiumAlert(
      'Usuń konto',
      'To trwale skasuje login, profil i dane restauracji oraz anuluje subskrypcję Stripe. Tej operacji nie da się cofnąć.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń na zawsze',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingAccount(true);
              try {
                const res = await deleteOwnAccount();
                if (!res.ok) {
                  premiumAlert('Nie usunięto konta', res.message);
                  return;
                }
                await signOut();
                router.replace('/(auth)/login');
              } finally {
                setDeletingAccount(false);
              }
            })();
          },
        },
      ],
    );
  };

  const openLegal = (url: string | null) => {
    if (!url) {
      premiumAlert('Brak adresu', 'Ustaw EXPO_PUBLIC_BACKEND_URL, żeby otworzyć dokumenty prawne.');
      return;
    }
    void Linking.openURL(url);
  };

  const handleSignOut = () => {
    premiumAlert('Wylogowanie', 'Na pewno chcesz się wylogować?', [
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
      webhook_url: signedWebhookUrl || '',
      api_key: posSettings.api_key,
      is_connected: posSettings.is_connected,
    };
    const existingId = (posSettings as PosSettings & { id?: string }).id;
    const result = await savePosSettings(payload, existingId, accountKey);
    setPosSaving(false);
    if (result.error) {
      premiumAlert('Błąd', result.error.message);
    } else {
      setHasSaved(true);
      premiumAlert('Zapisano', 'Ustawienia POS zostały zaktualizowane.', [
        { text: 'OK', style: 'primary' },
      ]);
      fetchAll();
    }
  };

  const handleMenuItemChanged = () => {
    void (async () => {
      const data = await fetchActiveMenuPosList(accountKey);
      if (data.length) setMenuItems(data);
    })();
  };

  const menuByCategory = useMemo(
    () => groupMenuItemsByCategory(menuItems),
    [menuItems],
  );

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

        <SettingsTopTabs value={settingsPane} onChange={setSettingsPane} />

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
            <TouchableOpacity
              style={[
                styles.saveBtn,
                {
                  marginTop: 10,
                  backgroundColor: 'transparent',
                  borderWidth: 1,
                  borderColor: theme.isPremium ? theme.border : '#CBD5E1',
                },
              ]}
              onPress={() => openLegal(privacyPolicyUrl())}
              activeOpacity={0.85}
            >
              <FileText size={16} color={theme.textSecondary} strokeWidth={2.4} />
              <Text style={[styles.saveBtnText, { color: theme.text }]}>Polityka prywatności</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.saveBtn,
                {
                  marginTop: 10,
                  backgroundColor: 'transparent',
                  borderWidth: 1,
                  borderColor: theme.isPremium ? theme.border : '#CBD5E1',
                },
              ]}
              onPress={() => openLegal(termsUrl())}
              activeOpacity={0.85}
            >
              <FileText size={16} color={theme.textSecondary} strokeWidth={2.4} />
              <Text style={[styles.saveBtnText, { color: theme.text }]}>Regulamin</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.saveBtn,
                {
                  marginTop: 10,
                  backgroundColor: theme.isPremium ? 'rgba(255,90,90,0.08)' : Colors.dangerLight,
                  borderWidth: 1,
                  borderColor: theme.isPremium ? 'rgba(255,90,90,0.35)' : Colors.danger,
                },
                deletingAccount && styles.saveBtnDisabled,
              ]}
              onPress={handleDeleteAccount}
              disabled={deletingAccount || signingOut}
              activeOpacity={0.85}
              testID="settings-delete-account"
            >
              {deletingAccount ? (
                <ActivityIndicator color={theme.danger} />
              ) : (
                <>
                  <Trash2 size={16} color={theme.danger} strokeWidth={2.4} />
                  <Text style={[styles.saveBtnText, { color: theme.danger }]}>Usuń konto</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {settingsPane === 'lokal' ? (
          <View style={styles.section}>
            <RestaurantBillingForm />
          </View>
        ) : null}

        {settingsPane === 'pos' ? (
          <>
            <PosInstructionBanner providerId={posProvider} />

            <PosSyncStatusCard />

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

              {signedWebhookUrl ? (
                <WebhookUrlRow url={signedWebhookUrl} />
              ) : (
                <Text style={[styles.fieldLabel, { color: theme.textSecondary, marginVertical: 8 }]}>
                  Link webhooka pojawi się po zalogowaniu i połączeniu z serwerem. Nie kopiuj adresu lokalnego.
                </Text>
              )}

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
          </>
        ) : null}

        {settingsPane === 'mapowanie' ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MapIcon size={16} color={theme.textSecondary} />
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
        ) : null}
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
