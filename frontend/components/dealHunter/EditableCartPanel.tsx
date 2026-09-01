import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {
  Truck,
  Mail,
  Send,
  Plus,
  Search,
  ShoppingCart,
  Package,
  CreditCard,
  Landmark,
} from 'lucide-react-native';
import { formatPln } from '@/lib/format';
import type { OptimizeResult, SupplierGroup } from '@/lib/bargainHunter';
import type { ManualPaymentOrder } from '@/components/dealHunter/ManualBankPaymentSheet';
import { themedStyles, useDealColors } from '@/components/dealHunter/theme';
import type { SelectedOption } from '@/components/dealHunter/types';
import { MinOrderBadge, OfferLine } from '@/components/dealHunter/smallComponents';

export type SubstituteOffer = {
  supplier_id: string;
  supplier_name: string;
  supplier_email?: string | null;
  unit_price_base: number;
  base_dim: string;
  unit?: string;
  matched_name?: string;
  catalog_product_id?: string;
  is_local_producer?: boolean;
};

type Props = {
  effectiveSelectedOption: SelectedOption;
  result: OptimizeResult | null;
  groups: SupplierGroup[];
  loading: boolean;
  savingDraft: boolean;
  onQtyChange: (key: string, qty: number) => void;
  onRemoveItem: (supplierId: string | null, productName: string) => void;
  onAddSubstitute: (offer: SubstituteOffer, variantLabel: string) => void;
  onOpenNewOrder: () => void;
  onOpenCatalog: (picker: { id: string; name: string }) => void;
  onPrepareEmail: (groups: SupplierGroup[]) => void;
  onLocalProducerPay: (g: SupplierGroup) => void;
  onManualPay: (order: ManualPaymentOrder) => void;
  onSaveDraft: () => void;
};

export function EditableCartPanel({
  effectiveSelectedOption,
  result,
  groups,
  loading,
  savingDraft,
  onQtyChange,
  onRemoveItem,
  onAddSubstitute,
  onOpenNewOrder,
  onOpenCatalog,
  onPrepareEmail,
  onLocalProducerPay,
  onManualPay,
  onSaveDraft,
}: Props) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);

  const orderable = groups.filter(
    (g) => (g.min_order_value ?? 0) <= 0 || g.meets_minimum_order !== false,
  );
  const grand = Math.round(groups.reduce((s, g) => s + g.subtotal_pln, 0) * 100) / 100;
  const ctaBg = C.isPremium ? '#5CFFB0' : C.accent;
  const ctaFg = C.isPremium ? '#0A0A0A' : C.white;

  // Braki: (1) nie ma w katalogach, (2) są w katalogu, ale nie weszły do koszyka (min. zamówienia itd.)
  const { catalogMissing, basketMissing } = (() => {
    const catalog: string[] = [];
    const basket: string[] = [];
    const seenCat = new Set<string>();
    const seenBasket = new Set<string>();
    const pushUnique = (list: string[], seen: Set<string>, name: string) => {
      const n = String(name || '').trim();
      const key = n.toLowerCase();
      if (!n || seen.has(key)) return;
      seen.add(key);
      list.push(n);
    };

    if (!result) return { catalogMissing: catalog, basketMissing: basket };

    for (const r of result.items_requested ?? []) {
      if (r.found) continue;
      pushUnique(catalog, seenCat, r.product_name);
    }
    for (const name of result.not_found_products ?? []) {
      pushUnique(catalog, seenCat, name);
    }

    // Braki scenariusza (znalezione, ale nie przypisane do koszyka)
    const opt = effectiveSelectedOption;
    let scenarioMissing: string[] = [];
    if (opt === 'split_max' || opt === 'monolith' || opt === 'smart_hybrid') {
      const sc =
        (result.scenarios ?? []).find((s) => s.id === opt)
        ?? (opt === 'split_max' ? result.scenario_split_max : null)
        ?? (opt === 'monolith' ? result.scenario_monolith : null)
        ?? (opt === 'smart_hybrid' ? result.scenario_smart_hybrid : null);
      scenarioMissing = sc?.missing ?? [];
    } else if (opt === 'optimized') {
      scenarioMissing =
        result.option_optimized?.missing
        ?? result.variant_split?.missing
        ?? [];
    } else if (opt === 'all_one') {
      scenarioMissing =
        result.option_all_one?.missing
        ?? result.best_option?.missing
        ?? [];
    }
    for (const name of scenarioMissing) {
      pushUnique(basket, seenBasket, name);
    }

    // Pozycje „found” których nie ma w aktualnych grupach koszyka
    const inCart = new Set<string>();
    for (const g of groups) {
      for (const it of g.items ?? []) {
        const k = String(it.product_name || '').trim().toLowerCase();
        if (k) inCart.add(k);
      }
    }
    for (const r of result.items_requested ?? []) {
      if (!r.found) continue;
      const name = String(r.product_name || '').trim();
      const key = name.toLowerCase();
      if (!name || inCart.has(key) || seenCat.has(key)) continue;
      pushUnique(basket, seenBasket, name);
    }

    // Nie duplikuj nazw już w „brak w katalogu”
    const basketFiltered = basket.filter((n) => !seenCat.has(n.toLowerCase()));
    return { catalogMissing: catalog, basketMissing: basketFiltered };
  })();
  const packNotes: string[] = Array.isArray((result as any)?.pack_adjustment_notes)
    ? ((result as any).pack_adjustment_notes as string[]).filter((n) => !!String(n || '').trim())
    : [];

  return (
    <View style={styles.editCart} testID="deal-hunter-edit-cart">
      <Text style={styles.editCartTitle}>
        {effectiveSelectedOption === 'split_max' || effectiveSelectedOption === 'optimized'
          ? 'Zamówienie · Najniższa cena'
          : effectiveSelectedOption === 'monolith' || effectiveSelectedOption === 'all_one'
            ? 'Zamówienie · Wygoda (mało dostaw)'
            : 'Zamówienia u dostawców'}
      </Text>
      {(result?.variant_reports ?? []).length > 0 ? (
        <View style={{ gap: 10, marginBottom: 12 }} testID="deal-hunter-variant-reports">
          {(result?.variant_reports ?? []).map((vr, vi) => {
            const searchLabel = `${vr.base_name}${vr.requested_variant ? ' ' + vr.requested_variant : ''}`;
            return (
              <View
                key={`vr-${vi}`}
                style={{
                  borderWidth: 1,
                  borderColor: vr.exact_found ? C.accent : C.warning,
                  backgroundColor: C.isPremium ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                  borderRadius: 12,
                  padding: 12,
                  gap: 6,
                }}
                testID={`variant-report-${vi}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Search size={14} color={C.accent} strokeWidth={2.4} />
                  <Text style={{ fontWeight: '800', color: C.accentDark }}>Szukasz: {searchLabel}</Text>
                </View>
                {vr.exact_found ? (
                  <Text style={{ color: C.accent, fontWeight: '700', fontSize: 12 }}>
                    Znaleziono dokładnie tę odmianę — jest w koszyku poniżej.
                  </Text>
                ) : (
                  <Text style={{ color: C.warning, fontWeight: '700', fontSize: 12 }} testID={`variant-not-found-${vi}`}>
                    Nie znaleźliśmy odmiany „{vr.requested_variant}”.
                    {vr.substitute_variant_count > 0
                      ? ` Znaleźliśmy jednak ${vr.substitute_variant_count} inn${vr.substitute_variant_count === 1 ? 'ą odmianę' : 'e odmiany'} tego produktu — możesz dodać zamiennik do koszyka.`
                      : ' Brak zamienników w katalogu dostawców.'}
                  </Text>
                )}
                {vr.substitutes.map((sub, si) => (
                  <View key={`sub-${vi}-${si}`} style={{ gap: 4, marginTop: 4 }}>
                    <Text style={{ fontWeight: '700', color: C.accentDark, fontSize: 13 }}>
                      {vr.base_name} {sub.variant_label}
                    </Text>
                    {sub.offers.map((off, oi) => (
                      <View
                        key={`off-${vi}-${si}-${oi}`}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                      >
                        <Text style={{ color: C.textSecondary, fontSize: 12, flex: 1 }} numberOfLines={2}>
                          {formatPln(off.unit_price_base)}/{off.base_dim} · {off.supplier_name}
                        </Text>
                        <TouchableOpacity
                          onPress={() => onAddSubstitute(off, sub.variant_label)}
                          style={{
                            width: 30, height: 30, borderRadius: 15,
                            alignItems: 'center', justifyContent: 'center',
                            backgroundColor: C.accent,
                          }}
                          activeOpacity={0.85}
                          testID={`add-substitute-${vi}-${si}-${oi}`}
                        >
                          <Plus size={16} color={C.isPremium ? '#0A0A0A' : '#FFFFFF'} strokeWidth={2.6} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      ) : null}
      {groups.length > 0 ? (
        <Text style={[styles.speechText, { fontWeight: '700', marginBottom: 4 }]} testID="deal-hunter-suppliers-summary">
          Od: {groups.map((g) => {
            const name = (g.supplier_name || '').trim() || 'Dostawca';
            return g.is_local_producer ? `${name}` : name;
          }).join(' · ')}
        </Text>
      ) : null}
      <Text style={styles.editCartHint}>
        Edytuj pozycje. Dorzuć z katalogu tego dostawcy albo „Nowe zamówienie” (inni dostawcy).
      </Text>
      <TouchableOpacity
        style={[styles.newOrderBtn, { marginBottom: 8 }]}
        onPress={onOpenNewOrder}
        activeOpacity={0.85}
        testID="deal-hunter-new-order-btn-top"
      >
        <Package size={16} color={C.accent} strokeWidth={2.2} />
        <Text style={styles.newOrderBtnText} numberOfLines={2}>
          Dodaj z katalogów
        </Text>
      </TouchableOpacity>
      {groups.length === 0 ? (
        <Text style={styles.newOrderHint}>
          Brak pozycji w koszyku. Skorzystaj z przycisku powyżej, aby dodać produkty.
        </Text>
      ) : (
        groups.map((g, gi) => {
          const blocked = (g.min_order_value ?? 0) > 0 && g.meets_minimum_order === false;
          return (
          <View key={`${g.supplier_id}-${gi}`} style={styles.supplierOrderCard}>
            <View style={styles.groupHeader}>
              <Truck size={16} color={C.accent} strokeWidth={2.2} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.editCartHint, { marginBottom: 0 }]}>
                  {g.is_local_producer ? 'Lokalny przetwórca' : 'Zamówienie od'}
                </Text>
                <Text style={styles.groupName} numberOfLines={2}>
                  {(g.supplier_name || '').trim() || 'Dostawca (uzupełnij nazwę)'}
                </Text>
                {g.is_local_producer && g.local_producer_city ? (
                  <Text style={[styles.editCartHint, { marginBottom: 0 }]}>
                    {g.local_producer_city}
                    {g.local_producer_voivodeship ? ` · ${g.local_producer_voivodeship}` : ''}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.groupSub}>{formatPln(g.subtotal_pln)}</Text>
            </View>
            <Text style={[styles.editCartHint, { marginBottom: 6 }]}>
              {g.is_local_producer
                ? 'Płatność Stripe (produkty + kurier + 5% serwisu) — bez e-maila do dystrybutora.'
                : g.supplier_email
                  ? `E-mail: ${g.supplier_email}`
                  : 'Brak e-maila dostawcy — uzupełnij w module Dostawcy.'}
            </Text>
            <MinOrderBadge meets={g.meets_minimum_order} minVal={g.min_order_value} />
            {g.items.map((it, idx) => (
              <OfferLine
                key={`edit-${g.supplier_id}-${it.product_name}-${idx}`}
                item={it}
                productKey={it.product_name}
                onQtyChange={onQtyChange}
                editable
                onRemove={() => onRemoveItem(g.supplier_id, it.product_name)}
              />
            ))}
            {/* „Dodaj z katalogu” tylko dla hurtowników — lokalni mają produkty marketplace */}
            {!g.is_local_producer ? (
            <TouchableOpacity
              style={styles.addFromCatalogBtn}
              onPress={() => {
                if (g.supplier_id) {
                  onOpenCatalog({
                    id: g.supplier_id,
                    name: (g.supplier_name || '').trim() || 'Dostawca',
                  });
                } else {
                  onOpenNewOrder();
                }
              }}
              activeOpacity={0.8}
              testID={`deal-hunter-add-catalog-${g.supplier_id ?? gi}`}
            >
              <Plus size={14} color={C.accent} strokeWidth={2.5} />
              <Text style={styles.addFromCatalogText}>
                {g.supplier_id
                  ? 'Dodaj z katalogu tego dostawcy'
                  : 'Dodaj produkt z katalogów dostawców'}
              </Text>
            </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[
                styles.prepareSupplierBtn,
                { backgroundColor: blocked ? C.dangerLight : ctaBg },
                (loading || blocked) && styles.primaryBtnDisabled,
              ]}
              onPress={() => {
                if (g.is_local_producer) onLocalProducerPay(g);
                else void onPrepareEmail([g]);
              }}
              disabled={loading || blocked}
              activeOpacity={0.85}
              testID={`deal-hunter-prepare-${g.supplier_id ?? gi}`}
            >
              {loading ? (
                <ActivityIndicator size="small" color={ctaFg} />
              ) : (
                <>
                  {g.is_local_producer && !blocked ? (
                    <CreditCard size={15} color={ctaFg} strokeWidth={2.2} />
                  ) : (
                    <Mail size={15} color={blocked ? C.danger : ctaFg} strokeWidth={2.2} />
                  )}
                  <Text style={[styles.prepareSupplierBtnText, { color: blocked ? C.danger : ctaFg }]}>
                    {blocked
                      ? 'Poniżej minimum — uzupełnij koszyk'
                      : g.is_local_producer
                        ? 'Zamów i zapłać'
                        : 'Przygotuj e-mail/SMS'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            {!g.is_local_producer && !blocked ? (
              <TouchableOpacity
                style={styles.payBtn}
                onPress={() =>
                  onManualPay({
                    supplierId: g.supplier_id,
                    supplierName: (g.supplier_name || '').trim() || 'Dostawca',
                    orderTitle: `Zamówienie — ${(g.supplier_name || '').trim() || 'Dostawca'}`,
                    totalPln: Number(g.total_pln ?? g.subtotal_pln) || 0,
                  })
                }
                activeOpacity={0.85}
                testID={`deal-hunter-cart-manual-pay-${g.supplier_id ?? gi}`}
              >
                <Landmark size={16} color={C.accent} strokeWidth={2.2} />
                <Text style={styles.payBtnText}>Opłać zamówienie</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          );
        })
      )}

      {packNotes.length > 0 ? (
        <View style={[styles.missingBox, { borderColor: C.accent, backgroundColor: C.isPremium ? 'rgba(92,255,176,0.08)' : 'rgba(0,0,0,0.04)' }]} testID="deal-hunter-pack-notes">
          <Text style={[styles.missingTitle, { color: C.accentDark || C.accent }]}>Dopasowanie opakowań</Text>
          {packNotes.map((note, i) => (
            <Text key={`pack-note-${i}`} style={[styles.missingName, { color: C.textPrimary, marginBottom: 6 }]}>
              {note}
            </Text>
          ))}
        </View>
      ) : null}
      {catalogMissing.length > 0 || basketMissing.length > 0 ? (
        <Text style={[styles.editCartHint, { marginBottom: 6 }]} testID="deal-hunter-missing-count">
          Braki łącznie: {catalogMissing.length + basketMissing.length}
          {result?.items_requested?.length
            ? ` z ${result.items_requested.length} pozycji`
            : ''}
        </Text>
      ) : null}
      {catalogMissing.length > 0 ? (
        <View style={styles.missingBox} testID="deal-hunter-missing-catalog">
          <Text style={[styles.editCartHint, { color: C.danger, marginBottom: 4 }]}>
            Brak w katalogach dostawców ({catalogMissing.length})
          </Text>
          {catalogMissing.map((name) => (
            <Text key={`cat-${name}`} style={styles.missingName} numberOfLines={2}>
              • {name}
            </Text>
          ))}
        </View>
      ) : null}
      {basketMissing.length > 0 ? (
        <View style={styles.missingBox} testID="deal-hunter-missing-basket">
          <Text style={[styles.editCartHint, { color: C.danger, marginBottom: 4 }]}>
            Znalezione, ale nie weszły do koszyka ({basketMissing.length})
            {'\n'}
            (np. za daleko do minimum zamówienia albo reguły optymalizacji)
          </Text>
          {basketMissing.map((name) => (
            <Text key={`bask-${name}`} style={styles.missingName} numberOfLines={2}>
              • {name}
            </Text>
          ))}
        </View>
      ) : null}

      {groups.length > 0 && (
        <View style={styles.optTotalRow}>
          <Text style={styles.optTotalLabel}>Suma wszystkich zamówień</Text>
          <Text style={styles.optTotalValue}>{formatPln(grand)}</Text>
        </View>
      )}

      {orderable.length > 1 && (
        <TouchableOpacity
          style={[styles.prepareSupplierBtn, { backgroundColor: ctaBg }, loading && styles.primaryBtnDisabled]}
          onPress={() => onPrepareEmail(orderable)}
          disabled={loading}
          activeOpacity={0.85}
          testID="deal-hunter-order-all"
        >
          {loading ? (
            <ActivityIndicator size="small" color={ctaFg} />
          ) : (
            <>
              {orderable.every((g) => g.is_local_producer) ? (
                <CreditCard size={15} color={ctaFg} strokeWidth={2.2} />
              ) : (
                <Send size={15} color={ctaFg} strokeWidth={2.2} />
              )}
              <Text style={[styles.prepareSupplierBtnText, { color: ctaFg }]}>
                {orderable.every((g) => g.is_local_producer)
                  ? `Zamów i zapłać (${orderable.length})`
                  : orderable.some((g) => g.is_local_producer)
                    ? `Zamów hurtowników · lokalni osobno (${orderable.length})`
                    : `Zamów wszystkie (${orderable.length})`}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {groups.length > 0 && (
        <TouchableOpacity
          style={[styles.saveDraftBtn, savingDraft && { opacity: 0.6 }]}
          onPress={() => void onSaveDraft()}
          disabled={savingDraft}
          activeOpacity={0.85}
          testID="deal-hunter-save-draft"
        >
          {savingDraft ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <>
              <ShoppingCart size={16} color={C.accent} strokeWidth={2.2} />
              <Text style={styles.saveDraftBtnText}>Dodaj do koszyka (na później)</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.newOrderBtn}
        onPress={onOpenNewOrder}
        activeOpacity={0.85}
        testID="deal-hunter-new-order-btn"
      >
        <Package size={16} color={C.accent} strokeWidth={2.2} />
        <Text style={styles.newOrderBtnText}>Nowe zamówienie</Text>
      </TouchableOpacity>
      <Text style={styles.newOrderHint}>
        Przeszukaj katalogi dostawców i ręcznie dodaj produkty (także od innych hurtowników).
      </Text>
    </View>
  );
}
