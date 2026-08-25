import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  X,
  Sparkles,
  Truck,
  Mail,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  Store,
  Phone,
  Send,
  CircleAlert,
  Minus,
  Plus,
  Trash2,
  Search,
  ShoppingCart,
  Package,
  CreditCard,
  Landmark,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { DEAL_HUNTER_GATE_MESSAGE, DEAL_HUNTER_GATE_TITLE } from '@/lib/dealHunterGate';
import { rankProductMatches } from '@/lib/fuzzyProductMatch';
import { formatPln } from '@/lib/format';
import {
  checkSupplierMinOrder,
  minOrderAlertCopy,
} from '@/lib/supplierMinOrder';
import { ASSISTANT_FROM_EMAIL } from '@/components/OrderEmailComposer';
import { stripAssistantOrderFooter } from '@/lib/orderEmailFooter';
import { openMailInBrowser } from '@/lib/openMailCompose';
import * as supplierOrdersService from '@/services/supplierOrdersService';
import {
  type OptimizeResult,
  type OfferItem,
  type SupplierGroup,
  initQuantities,
  normalizeOptimizeResult,
  recalcFromMatrix,
  recalcLineTotal,
  toSupplierGroups,
} from '@/lib/bargainHunter';
import { supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import { apiJsonHeaders } from '@/lib/apiHeaders';
import {
  type DealHunterSearchScope,
  DEAL_HUNTER_SEARCH_SCOPE_OPTIONS,
  DEFAULT_DEAL_HUNTER_SEARCH_SCOPE,
} from '@/lib/dealHunterSearchScope';
import { LocalProducerCheckoutSheet } from '@/components/dealHunter/LocalProducerCheckoutSheet';
import {
  ManualBankPaymentSheet,
  type ManualPaymentOrder,
} from '@/components/dealHunter/ManualBankPaymentSheet';

import { BACKEND_URL, themedStyles, useDealColors } from './theme';
import type { CatalogRow } from './types';
import { sortCatalogMenuFirst } from './helpers';

export function SupplierCatalogPicker({
  visible,
  supplierId,
  supplierName,
  onClose,
  onPick,
  onResolvedSupplier,
}: {
  visible: boolean;
  supplierId: string;
  supplierName: string;
  onClose: () => void;
  onPick: (row: CatalogRow) => void;
  /** Gdy API zwróci prawdziwą nazwę / e-mail — uaktualnij koszyk. */
  onResolvedSupplier?: (info: { id: string; name: string; email?: string | null }) => void;
}) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState(supplierName);

  useEffect(() => {
    if (!visible || !supplierId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setRows([]);
      setResolvedName(supplierName);
      try {
        // 1) Backend (service role) — pełny katalog, bez problemów zagnieżdżonych Modal/RLS
        if (BACKEND_URL) {
          const headers = await apiJsonHeaders();
          const res = await fetch(
            `${BACKEND_URL}/api/suppliers/${encodeURIComponent(supplierId)}/catalog`,
            { headers },
          );
          if (res.ok) {
            const data = await res.json();
            if (cancelled) return;
            const name = String(data.supplier_name || supplierName || 'Dostawca').trim();
            setResolvedName(name);
            onResolvedSupplier?.({
              id: supplierId,
              name,
              email: data.supplier_email ?? null,
            });
            const products = Array.isArray(data.products) ? data.products : [];
            setRows(
              sortCatalogMenuFirst(
                products.map((r: any) => ({
                  id: String(r.id),
                  name: String(r.name || ''),
                  variant: r.variant ?? null,
                  unit: r.unit || 'szt',
                  price_pln: Number(r.price_pln) || 0,
                  in_menu: r.in_menu !== false,
                })).filter((r: CatalogRow) => !!r.name),
              ),
            );
            setLoading(false);
            return;
          }
        }
        // 2) Fallback: Supabase bezpośrednio
        const { data, error } = await supabase
          .from('supplier_catalog')
          .select('id,name,variant,unit,price_pln,is_visible')
          .eq('supplier_id', supplierId)
          .order('name')
          .limit(2000);
        if (cancelled) return;
        if (error) throw error;
        // Nazwa dostawcy z tabeli suppliers
        const { data: supRow } = await supabase
          .from('suppliers')
          .select('id,name,email')
          .eq('id', supplierId)
          .maybeSingle();
        if (!cancelled && supRow?.name) {
          const name = String(supRow.name).trim();
          setResolvedName(name);
          onResolvedSupplier?.({ id: supplierId, name, email: supRow.email ?? null });
        }
        setRows(
          sortCatalogMenuFirst(
            (data ?? []).map((r: any) => ({
              id: r.id,
              name: r.name,
              variant: r.variant,
              unit: r.unit || 'szt',
              price_pln: Number(r.price_pln) || 0,
              in_menu: r.is_visible !== false,
            })).filter((r: CatalogRow) => !!r.name),
          ),
        );
      } catch (e: unknown) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Nie udało się wczytać katalogu.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, supplierId, supplierName, onResolvedSupplier]);

  useEffect(() => {
    if (visible) setQ('');
  }, [visible]);

  const filtered = useMemo(() => {
    const s = q.trim();
    const list = !s
      ? rows
      : rankProductMatches(s, rows, (r) => `${r.name} ${r.variant ?? ''}`, {
          threshold: 52,
          limit: 200,
        }).map((x) => x.item);
    return sortCatalogMenuFirst(list).slice(0, 200);
  }, [rows, q]);

  const inMenu = filtered.filter((r) => r.in_menu);
  const extra = filtered.filter((r) => !r.in_menu);

  if (!visible) return null;

  const renderRow = (r: CatalogRow) => (
    <TouchableOpacity
      key={r.id}
      style={[styles.pickerRow, r.price_pln <= 0 && { opacity: 0.55 }]}
      onPress={() => {
        if (r.price_pln <= 0) {
          Alert.alert('Brak ceny', 'Ta pozycja nie ma ceny w katalogu — uzupełnij cenę u Dostawców.');
          return;
        }
        onPick(r);
      }}
      activeOpacity={0.75}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.pickerName}>{r.name}</Text>
        {!!r.variant && <Text style={styles.pickerVariant}>{r.variant}</Text>}
        {r.in_menu ? (
          <View style={styles.menuTag}>
            <Text style={styles.menuTagText}>W recepturach menu</Text>
          </View>
        ) : (
          <View style={styles.extraTag}>
            <Text style={styles.extraTagText}>Dodatkowa oferta (też do zamówienia)</Text>
          </View>
        )}
      </View>
      <Text style={styles.pickerPrice}>
        {r.price_pln > 0 ? formatPln(r.price_pln) : 'brak ceny'}
      </Text>
    </TouchableOpacity>
  );

  // Overlay WEWNĄTRZ modala Łowcy (nie drugi Modal — na web/RN zagnieżdżenie nic nie pokazywało)
  return (
    <View style={[styles.pickerOverlay, { zIndex: 50 }]} testID="deal-hunter-catalog-picker">
      <View style={styles.pickerSheet}>
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle} numberOfLines={1}>
            Katalog: {resolvedName || supplierName || 'Dostawca'}
          </Text>
          <TouchableOpacity onPress={onClose} testID="deal-hunter-catalog-close">
            <X size={22} color={C.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={styles.pickerSearch}>
          <Search size={16} color={C.textTertiary} />
          <TextInput
            style={styles.pickerSearchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Szukaj produktu…"
            placeholderTextColor={C.textTertiary}
            autoFocus
          />
        </View>
        {loading ? (
          <ActivityIndicator style={{ margin: 24 }} color={C.accent} />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled">
            {loadError ? (
              <Text style={[styles.pickerEmpty, { color: C.danger }]}>{loadError}</Text>
            ) : null}
            {filtered.length === 0 && !loadError ? (
              <Text style={styles.pickerEmpty}>Brak produktów w katalogu tego dostawcy.</Text>
            ) : (
              <>
                {inMenu.length > 0 ? (
                  <>
                    <Text style={styles.pickerSection}>W RECEPTURACH MENU ({inMenu.length})</Text>
                    {inMenu.map(renderRow)}
                  </>
                ) : null}
                {extra.length > 0 ? (
                  <>
                    <Text style={styles.pickerSection}>
                      DODATKOWA OFERTA — TEŻ DO ZAMÓWIENIA ({extra.length})
                    </Text>
                    {extra.map(renderRow)}
                  </>
                ) : null}
                {inMenu.length === 0 && extra.length === 0 && filtered.length > 0 ? (
                  filtered.map(renderRow)
                ) : null}
              </>
            )}
            <View style={{ height: 28 }} />
          </ScrollView>
        )}
      </View>
    </View>
  );
}
