/**
 * Delta-Scraper Monitor Modal — WYŁĄCZONY W UI (2026-07).
 * Zachowany w repozytorium na ewentualny powrót; nie importować z ekranów aplikacji.
 * Silnik: backend/delta_scraper (API zwraca 410).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  X,
  Globe,
  RefreshCw,
  Bell,
  Trash2,
  Plus,
  TrendingDown,
  Package,
  CircleAlert,
  Info,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  addScrapeTarget,
  checkAllTargets,
  checkOneTarget,
  formatAlertSummary,
  formatCatalogSyncSummary,
  listPriceAlerts,
  listScrapeTargets,
  removeScrapeTarget,
  deletePriceAlert,
  type PriceAlert,
  type ScrapeTarget,
} from '@/lib/deltaScraperClient';

interface SupplierOption {
  id: string;
  name: string;
}

interface Props {
  visible: boolean;
  suppliers: SupplierOption[];
  initialSupplierId?: string | null;
  onClose: () => void;
  onCatalogRefresh?: () => void;
}

function changeIcon(type: string) {
  if (type === 'price_drop') return TrendingDown;
  if (type === 'new_items') return Package;
  return Bell;
}

export function ScraperMonitorModal({
  visible,
  suppliers,
  initialSupplierId,
  onClose,
  onCatalogRefresh,
}: Props) {
  const [tab, setTab] = useState<'targets' | 'alerts'>('targets');
  const [targets, setTargets] = useState<ScrapeTarget[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [backendWarning, setBackendWarning] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const supplierMap = useMemo(
    () => Object.fromEntries(suppliers.map((s) => [s.id, s.name])),
    [suppliers],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, aRes] = await Promise.all([listScrapeTargets(), listPriceAlerts(40)]);
      setNeedsMigration(!!tRes.needs_migration);
      setTargets(tRes.targets ?? []);
      setAlerts(aRes.alerts ?? []);
      setBackendWarning(tRes.warning ?? null);
    } catch (e: unknown) {
      Alert.alert('Błąd', e instanceof Error ? e.message : 'Nie udało się załadować monitora.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setSupplierId(initialSupplierId ?? null);
      load();
    }
  }, [visible, initialSupplierId, load]);

  async function handleAdd() {
    const trimmed = url.trim();
    if (!trimmed.startsWith('http')) {
      Alert.alert('Błąd', 'Podaj pełny adres strony (zaczyna się od https://…).');
      return;
    }
    if (!supplierId) {
      Alert.alert(
        'Wybierz dostawcę',
        'Powiąż stronę z dostawcą, żeby wykryte produkty trafiły do jego katalogu i dało się je zamawiać.',
      );
      return;
    }
    setAdding(true);
    try {
      const res = await addScrapeTarget({
        url: trimmed,
        supplier_id: supplierId,
      });
      if (!res?.target?.id && !res?.ok) {
        throw new Error('Serwer nie potwierdził zapisu strony.');
      }
      setUrl('');
      await load();
      Alert.alert(
        'Dodano',
        'Strona jest na liście. Kliknij „Sprawdź teraz” — produkty pasujące do magazynu lub receptur menu '
          + 'zostaną wpisane do katalogu dostawcy (sekcja „Katalog (zamawianie)”).',
      );
    } catch (e: unknown) {
      Alert.alert('Błąd', e instanceof Error ? e.message : 'Nie udało się dodać URL.');
    } finally {
      setAdding(false);
    }
  }

  async function handleCheckAll() {
    setChecking(true);
    try {
      // force=true: pełne odświeżenie + ponowne dopasowanie do magazynu/menu
      const res = await checkAllTargets(true);
      const changed = res.results.filter((r) => r.changed).length;
      const syncLines = res.results
        .map((r) => formatCatalogSyncSummary(r.catalog_sync))
        .filter(Boolean);
      await load();
      onCatalogRefresh?.();
      Alert.alert(
        'Sprawdzono',
        [
          `${res.checked} stron · zmiany na stronie: ${changed}`,
          ...syncLines.slice(0, 3),
          res.results.some((r) => r.error) ? '(niektóre strony zwróciły błąd)' : '',
        ].filter(Boolean).join('\n'),
      );
    } catch (e: unknown) {
      Alert.alert('Błąd', e instanceof Error ? e.message : 'Sprawdzanie nie powiodło się.');
    } finally {
      setChecking(false);
    }
  }

  async function handleCheckOne(id: string) {
    setChecking(true);
    try {
      const res = await checkOneTarget(id, true);
      await load();
      onCatalogRefresh?.();
      const r = res.result;
      const syncLine = formatCatalogSyncSummary(r.catalog_sync);
      const base = r.error
        ? r.error
        : r.skipped_hash
          ? 'Strona bez zmian — odświeżono dopasowanie do magazynu/menu.'
          : r.changed
            ? `Na stronie: ${r.product_count ?? 0} prod., nowych: ${r.new_product_count ?? 0}`
            : `Na stronie: ${r.product_count ?? 0} produktów (baseline / brak istotnych różnic).`;
      Alert.alert(
        r.changed ? 'Wykryto zmiany' : 'Sprawdzono',
        [base, syncLine].filter(Boolean).join('\n\n'),
      );
    } catch (e: unknown) {
      Alert.alert('Błąd', e instanceof Error ? e.message : 'Sprawdzanie nie powiodło się.');
    } finally {
      setChecking(false);
    }
  }

  async function handleRemove(id: string) {
    Alert.alert('Usuń monitoring', 'Przestać obserwować tę stronę?', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeScrapeTarget(id);
            await load();
          } catch (e: unknown) {
            Alert.alert('Błąd', e instanceof Error ? e.message : 'Usuwanie nie powiodło się.');
          }
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Globe size={20} color={Colors.accent} strokeWidth={2} />
              <Text style={styles.title}>Monitor stron hurtowni</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={22} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Wklej link do cennika lub katalogu hurtowni. Aplikacja sama sprawdzi ceny
            (zwykle raz dziennie) i zaktualizuje katalog dostawcy.
          </Text>

          {needsMigration && (
            <View style={styles.migrationBox}>
              <CircleAlert size={16} color={Colors.warning} strokeWidth={2} />
              <Text style={styles.migrationText}>
                Uruchom w Supabase SQL Editor plik ADD_DELTA_SCRAPER.sql — bez tego monitoring nie zapisze stron.
              </Text>
            </View>
          )}

          {!!backendWarning && !needsMigration && (
            <View style={styles.infoBox}>
              <Info size={15} color={Colors.accent} strokeWidth={2} />
              <Text style={styles.infoText}>
                Lista stron działa przez bazę. Sprawdzanie cen wymaga działającego backendu (port 8001).
              </Text>
            </View>
          )}

          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, tab === 'targets' && styles.tabActive]}
              onPress={() => setTab('targets')}
            >
              <Text style={[styles.tabText, tab === 'targets' && styles.tabTextActive]}>
                Strony ({targets.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === 'alerts' && styles.tabActive]}
              onPress={() => setTab('alerts')}
            >
              <Text style={[styles.tabText, tab === 'alerts' && styles.tabTextActive]}>
                Alerty ({alerts.length})
              </Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={Colors.accent} />
            </View>
          ) : (
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
              {tab === 'targets' && (
                <>
                  <View style={styles.form}>
                    <Text style={styles.label}>Adres strony hurtowni</Text>
                    <TextInput
                      style={styles.input}
                      value={url}
                      onChangeText={setUrl}
                      placeholder="https://hurtownia.pl"
                      placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Text style={styles.hint}>
                      Wystarczy strona główna — aplikacja sama znajdzie podstrony z produktami
                      (do ok. 60 adresów, głębokość 3). Skan kosztuje 5 kredytów.
                    </Text>

                    <Text style={styles.label}>Powiąż z dostawcą (zalecane)</Text>
                    <Text style={styles.hint}>
                      Dzięki temu wykryte ceny trafią do katalogu tego dostawcy w aplikacji.
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                      <TouchableOpacity
                        style={[styles.chip, !supplierId && styles.chipActive]}
                        onPress={() => setSupplierId(null)}
                      >
                        <Text style={[styles.chipText, !supplierId && styles.chipTextActive]}>Bez powiązania</Text>
                      </TouchableOpacity>
                      {suppliers.map((s) => (
                        <TouchableOpacity
                          key={s.id}
                          style={[styles.chip, supplierId === s.id && styles.chipActive]}
                          onPress={() => setSupplierId(s.id)}
                        >
                          <Text style={[styles.chipText, supplierId === s.id && styles.chipTextActive]} numberOfLines={1}>
                            {s.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    <TouchableOpacity style={styles.addBtn} onPress={handleAdd} disabled={adding || needsMigration}>
                      {adding ? <ActivityIndicator color={Colors.white} size="small" /> : <Plus size={16} color={Colors.white} />}
                      <Text style={styles.addBtnText}>Dodaj stronę</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.checkAllBtn, targets.length === 0 && { opacity: 0.45 }]}
                    onPress={handleCheckAll}
                    disabled={checking || targets.length === 0}
                  >
                    <RefreshCw size={16} color={Colors.accent} strokeWidth={2} />
                    <Text style={styles.checkAllText}>
                      {checking ? 'Sprawdzam…' : 'Sprawdź wszystkie teraz'}
                    </Text>
                  </TouchableOpacity>

                  {targets.length === 0 && !needsMigration && (
                    <Text style={styles.empty}>
                      Brak stron na liście. Wklej adres cennika powyżej i kliknij „Dodaj stronę”.
                    </Text>
                  )}

                  {targets.map((t) => (
                    <View key={t.id} style={styles.targetRow}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={styles.targetUrl} numberOfLines={2}>{t.url}</Text>
                        <Text style={styles.targetMeta}>
                          {t.supplier_id ? supplierMap[t.supplier_id] ?? 'Dostawca' : 'Bez dostawcy'}
                          {' · '}{t.product_count} prod.
                          {t.last_checked_at ? ` · ${new Date(t.last_checked_at).toLocaleDateString('pl-PL')}` : ' · jeszcze nie sprawdzano'}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => handleCheckOne(t.id)} disabled={checking} style={styles.iconBtn}>
                        <RefreshCw size={16} color={Colors.accent} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleRemove(t.id)} style={styles.iconBtn}>
                        <Trash2 size={16} color={Colors.danger} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </>
              )}

              {tab === 'alerts' && (
                <>
                  {alerts.length === 0 ? (
                    <Text style={styles.empty}>Brak alertów — uruchom pierwsze sprawdzenie stron.</Text>
                  ) : (
                    alerts.map((a) => {
                      const Icon = changeIcon(a.change_type);
                      return (
                        <View key={a.id} style={styles.alertRow}>
                          <Icon size={16} color={a.change_type === 'price_drop' ? Colors.success : Colors.accent} strokeWidth={2} />
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.alertType}>
                              {a.change_type === 'price_drop' ? 'Spadek ceny' : a.change_type.replace('_', ' ')}
                            </Text>
                            <Text style={styles.alertSummary}>{formatAlertSummary(a)}</Text>
                            <Text style={styles.alertDate}>
                              {new Date(a.detected_at).toLocaleString('pl-PL')}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => {
                              Alert.alert(
                                'Usuń alert',
                                'Na pewno chcesz usunąć ten komunikat o spadku ceny?',
                                [
                                  { text: 'Anuluj', style: 'cancel' },
                                  {
                                    text: 'Usuń',
                                    style: 'destructive',
                                    onPress: async () => {
                                      try {
                                        await deletePriceAlert(a.id);
                                        setAlerts((prev) => prev.filter((x) => x.id !== a.id));
                                      } catch (e: any) {
                                        Alert.alert('Błąd', e?.message ?? 'Nie udało się usunąć alertu');
                                      }
                                    },
                                  },
                                ],
                              );
                            }}
                            style={styles.iconBtn}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Trash2 size={16} color={Colors.danger} />
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}
                </>
              )}
              <View style={{ height: 24 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary, paddingHorizontal: 20, marginBottom: 12, lineHeight: 17 },
  migrationBox: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 10,
    backgroundColor: Colors.warning + '18',
    borderRadius: 10,
  },
  migrationText: { flex: 1, fontSize: 12, color: Colors.warning },
  infoBox: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 10,
    backgroundColor: Colors.accentLight,
    borderRadius: 10,
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.accent, lineHeight: 16 },
  tabs: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 8, gap: 8 },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.borderLight,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: Colors.accent + '20' },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.accent },
  body: { paddingHorizontal: 20 },
  center: { padding: 40, alignItems: 'center' },
  form: { gap: 6, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, marginTop: 6 },
  hint: { fontSize: 11, color: Colors.textTertiary, lineHeight: 15, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.white,
  },
  chipScroll: { flexGrow: 0, marginVertical: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.borderLight,
    marginRight: 8,
    maxWidth: 140,
  },
  chipActive: { backgroundColor: Colors.accent },
  chipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: Colors.white },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 8,
  },
  addBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  checkAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.accent + '40',
    borderRadius: 10,
  },
  checkAllText: { color: Colors.accent, fontWeight: '600', fontSize: 13 },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  targetUrl: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  targetMeta: { fontSize: 11, color: Colors.textTertiary },
  iconBtn: { padding: 8 },
  alertRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  alertType: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase' },
  alertSummary: { fontSize: 13, color: Colors.textPrimary },
  alertDate: { fontSize: 11, color: Colors.textTertiary },
  empty: { textAlign: 'center', color: Colors.textTertiary, paddingVertical: 24, fontSize: 13, lineHeight: 18 },
});
