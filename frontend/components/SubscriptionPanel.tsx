/**
 * SubscriptionPanel — plany, kredyty, top-up. Styl premium dark gdy isPremiumUi.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView, RefreshControl,
} from 'react-native';
import { Lock, Check, Crown, Sparkles, RefreshCw, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { CreditsWalletCard } from '@/components/CreditsWalletCard';
import { TIER_PLANS } from '@/lib/subscriptionCatalog';
import { formatTrialDaysLeft, trialDaysRemaining } from '@/lib/subscriptionClient';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAppTheme } from '@/hooks/useAppTheme';
import { DS } from '@/constants/premiumTheme';
import { fetchBillingStatus } from '@/lib/billingClient';

export function SubscriptionPanel() {
  const theme = useAppTheme();
  const styles = useMemo(() => makeSubStyles(theme), [theme.isPremium]);
  const { state: data, loading, refresh, subscribe, cancel, resign, topup } = useSubscription();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mockBilling, setMockBilling] = useState(false);

  useEffect(() => {
    void fetchBillingStatus().then((s) => setMockBilling(s.mock_billing));
  }, []);

  const run = useCallback(async (key: string, fn: () => Promise<{ message?: string | null }>) => {
    setBusy(key);
    try {
      const d = await fn();
      if (d.message) {
        setToast(d.message);
        setTimeout(() => setToast(null), 3500);
      }
    } finally {
      setBusy(null);
    }
  }, []);

  if (loading && !data) {
    return (
      <View style={styles.center} testID="subscription-loading">
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (!data || data.needs_migration) {
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.migrateBox} testID="subscription-needs-migration">
          <Info size={22} color={theme.accent} strokeWidth={2} />
          <Text style={styles.migrateTitle}>System subskrypcji nieaktywny</Text>
          <Text style={styles.migrateText}>
            {data?.message ?? 'Subskrypcje są chwilowo niedostępne. Odśwież albo skontaktuj się z supportem.'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refresh()} testID="subscription-retry">
            <RefreshCw size={15} color={theme.isPremium ? '#0A0A0A' : Colors.white} strokeWidth={2.4} />
            <Text style={[styles.retryText, theme.isPremium && { color: '#0A0A0A' }]}>Odśwież</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionTitle}>Plany subskrypcji</Text>
        <PlanList
          data={data ?? { tier_level: 0, status: 'active', plans: TIER_PLANS }}
          busy={busy}
          onSubscribe={(t) => run(`sub-${t}`, () => subscribe(t))}
          styles={styles}
          theme={theme}
        />
      </ScrollView>
    );
  }

  const activePaid = data.tier_level >= 1 && data.status === 'active';
  const onFreeTier = data.tier_level === 0;
  const trialLabel = data.trial_active
    ? formatTrialDaysLeft(trialDaysRemaining(data.trial_ends_at))
    : null;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); refresh().finally(() => setRefreshing(false)); }}
          tintColor={theme.accent}
        />
      }
      testID="subscription-panel"
    >
      <CreditsWalletCard />

      {trialLabel ? (
        <View style={styles.trialBanner} testID="subscription-trial-banner">
          <Sparkles size={16} color={theme.accent} strokeWidth={2.2} />
          <Text style={styles.trialBannerText}>{trialLabel}</Text>
        </View>
      ) : null}

      {toast && (
        <View style={styles.toast} testID="subscription-toast">
          <Check size={15} color={theme.success} strokeWidth={2.4} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Dostępne funkcje w Twoim planie</Text>
      <View style={styles.card}>
        {data.features.map((f, i) => (
          <View
            key={f.key}
            style={[styles.featureRow, i < data.features.length - 1 && styles.featureBorder]}
            testID={`feature-${f.key}`}
          >
            <Text style={styles.featureIcon}>{f.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.featureName, f.locked && styles.featureLocked]}>{f.name}</Text>
              {f.locked
                ? <Text style={styles.featureReason}>{f.locked_reason}</Text>
                : <Text style={styles.featureCost}>{f.cost}</Text>}
            </View>
            {f.locked
              ? <Lock size={16} color={theme.textMuted} strokeWidth={2} />
              : <Check size={16} color={theme.success} strokeWidth={2.4} />}
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Plany subskrypcji</Text>
      <PlanList
        data={data}
        busy={busy}
        onSubscribe={(t) => run(`sub-${t}`, () => subscribe(t))}
        onResign={() => run('resign', resign)}
        styles={styles}
        theme={theme}
      />

      {activePaid && (
        <View style={styles.resignBanner} testID="resign-plan-banner">
          <Text style={styles.resignBannerTitle}>Twój plan: {data.tier_name}</Text>
          <TouchableOpacity
            style={styles.resignBannerBtn}
            onPress={() => run('resign', resign)}
            disabled={busy !== null}
            testID="resign-subscription-primary"
          >
            {busy === 'resign'
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <Text style={styles.resignBannerBtnText}>
                  Zrezygnuj z planu
                </Text>}
          </TouchableOpacity>
        </View>
      )}

      {(activePaid || (data.status === 'canceled' && data.tier_level >= 1)) && (
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => run('cancel', cancel)}
          disabled={busy !== null}
          testID="cancel-subscription"
        >
          {busy === 'cancel'
            ? <ActivityIndicator size="small" color={theme.danger} />
            : <Text style={styles.cancelText}>Anuluj subskrypcję (koniec okresu)</Text>}
        </TouchableOpacity>
      )}

      {!activePaid && (onFreeTier || data.tier_level >= 1) && (
        <TouchableOpacity
          style={styles.resignBtn}
          onPress={() => run('resign', resign)}
          disabled={busy !== null}
          testID="resign-subscription"
        >
          {busy === 'resign'
            ? <ActivityIndicator size="small" color={theme.danger} />
            : <Text style={styles.resignText}>Zrezygnuj z subskrypcji → plan Free (bez ponownego pakietu 1000 kr.)</Text>}
        </TouchableOpacity>
      )}

      <Text style={styles.sectionTitle}>Doładuj portfel (Prepaid)</Text>
      <View style={styles.topupRow}>
        {data.topup_packages.map((pkg) => (
          <TouchableOpacity
            key={pkg.key}
            style={styles.topupCard}
            onPress={() => run(`top-${pkg.key}`, () => topup(pkg.key))}
            disabled={busy !== null}
            testID={`topup-${pkg.key}`}
          >
            <Sparkles size={16} color={theme.accent} strokeWidth={2.2} />
            <Text
              style={styles.topupCredits}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              +{pkg.credits}
            </Text>
            <Text style={styles.topupCreditsLabel}>kredytów</Text>
            <View style={styles.topupPriceTag}>
              {busy === `top-${pkg.key}`
                ? <ActivityIndicator size="small" color={theme.isPremium ? '#0A0A0A' : Colors.white} />
                : <Text style={[styles.topupPrice, theme.isPremium && { color: '#0A0A0A' }]}>{pkg.price_pln} zł</Text>}
            </View>
          </TouchableOpacity>
        ))}
      </View>
      {mockBilling ? (
        <Text style={styles.mockNote}>
          Tryb testowy Stripe. Po zapłacie wróć tu i odśwież portfel albo potwierdź sesję poniżej.
        </Text>
      ) : (
        <Text style={styles.mockNote}>
          Po zapłacie w Stripe portfel odświeży się automatycznie. Jeśli saldo się nie zmieni — przeciągnij listę w dół.
        </Text>
      )}

      <TouchableOpacity
        style={styles.portalBtn}
        onPress={() => run('confirm', async () => {
          const { confirmPendingCheckout } = await import('@/lib/billingClient');
          return confirmPendingCheckout();
        })}
        disabled={busy !== null}
        testID="billing-confirm"
      >
        {busy === 'confirm'
          ? <ActivityIndicator size="small" color={theme.accent} />
          : <Text style={styles.portalText}>Odśwież status płatności</Text>}
      </TouchableOpacity>

      {activePaid && (
        <TouchableOpacity
          style={[styles.portalBtn, { marginTop: 10 }]}
          onPress={() => run('portal', async () => {
            const { openBillingPortal } = await import('@/lib/billingClient');
            return openBillingPortal();
          })}
          disabled={busy !== null}
          testID="billing-portal"
        >
          {busy === 'portal'
            ? <ActivityIndicator size="small" color={theme.accent} />
            : <Text style={styles.portalText}>Zarządzaj subskrypcją (Stripe)</Text>}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function PlanList({
  data,
  busy,
  onSubscribe,
  onResign,
  styles,
  theme,
}: {
  data: { tier_level: number; status: string; plans: typeof import('@/lib/subscriptionCatalog').TIER_PLANS };
  busy: string | null;
  onSubscribe: (tier: 1 | 2) => void;
  onResign?: () => void;
  styles: ReturnType<typeof makeSubStyles>;
  theme: ReturnType<typeof useAppTheme>;
}) {
  const plans = data?.plans ?? [];
  return (
    <View style={styles.planRow}>
      {plans.slice().sort((a, b) => a.tier_level - b.tier_level).map((p) => {
        const isFree = p.tier_level === 0;
        const current = data.tier_level === p.tier_level && (isFree ? true : data.status === 'active');
        const upgradeLabel = data.tier_level > 0 && p.tier_level > data.tier_level
          ? 'Ulepsz plan'
          : data.tier_level > p.tier_level
            ? 'Zmień plan'
            : 'Wybierz plan';
        return (
          <View
            key={p.tier_level}
            style={[styles.planCard, current && styles.planCardActive, p.tier_level >= 2 && styles.planCardPro]}
            testID={`plan-card-${p.tier_level}`}
          >
            <View style={styles.planHeader}>
              {p.tier_level >= 2 && <Crown size={17} color={theme.accent} strokeWidth={2.2} />}
              <Text style={[styles.planName, { textAlign: 'center', width: '100%' }]}>{p.name}</Text>
            </View>
            {isFree ? (
              <Text style={styles.planPrice}>Darmowy</Text>
            ) : (
              <Text style={styles.planPrice}>{p.price_pln} zł<Text style={styles.planPer}>/mies.</Text></Text>
            )}
            {!!p.price_note && <Text style={styles.planNote}>{p.price_note}</Text>}
            {p.monthly_grant > 0 && (
              <Text style={styles.planGrant}>+{p.monthly_grant} kredytów AI / 30 dni</Text>
            )}
            <View style={styles.perkList}>
              {(p.perks ?? []).map((perk, i) => (
                <View key={i} style={styles.perkRow}>
                  <Check size={14} color={theme.success} strokeWidth={2.6} style={{ marginTop: 2 }} />
                  <Text style={styles.perkText}>{perk}</Text>
                </View>
              ))}
            </View>
            {current ? (
              <>
                <View style={styles.planActiveTag}>
                  <Check size={13} color={theme.success} strokeWidth={2.6} />
                  <Text style={styles.planActiveText}>Aktywny</Text>
                </View>
                {!isFree && onResign ? (
                  <TouchableOpacity
                    style={styles.planResignBtn}
                    onPress={onResign}
                    disabled={busy !== null}
                    testID={`resign-tier-${p.tier_level}`}
                  >
                    {busy === 'resign'
                      ? <ActivityIndicator size="small" color={theme.danger} />
                      : <Text style={styles.planResignText}>Zrezygnuj z planu</Text>}
                  </TouchableOpacity>
                ) : null}
              </>
            ) : isFree ? null : (
              <TouchableOpacity
                style={styles.planBtn}
                onPress={() => onSubscribe(p.tier_level as 1 | 2)}
                disabled={busy !== null}
                testID={`subscribe-tier-${p.tier_level}`}
              >
                {busy === `sub-${p.tier_level}`
                  ? <ActivityIndicator size="small" color={theme.isPremium ? '#0A0A0A' : Colors.white} />
                  : <Text style={[styles.planBtnText, theme.isPremium && { color: '#0A0A0A' }]}>{upgradeLabel}</Text>}
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

function makeSubStyles(theme: ReturnType<typeof useAppTheme>) {
  const card = theme.isPremium ? DS.color.surfaceCard : Colors.card;
  const border = theme.isPremium ? DS.color.borderSubtle : Colors.border;
  const text = theme.isPremium ? DS.color.heading : Colors.textPrimary;
  const muted = theme.isPremium ? DS.color.muted : Colors.textTertiary;
  const body = theme.isPremium ? DS.color.body : Colors.textSecondary;
  const soft = theme.isPremium ? DS.color.bgTertiary : Colors.borderLight;
  const accent = theme.accent;
  const accentSoft = theme.isPremium ? 'rgba(0,255,120,0.12)' : Colors.accentLight;
  const successSoft = theme.isPremium ? 'rgba(0,255,120,0.10)' : '#ECFDF5';

  return StyleSheet.create({
    center: { paddingVertical: 60, alignItems: 'center' },
    migrateBox: { backgroundColor: card, borderRadius: 16, borderWidth: 1, borderColor: border, padding: 20, alignItems: 'center', gap: 8, marginTop: 8 },
    migrateTitle: { fontSize: 15, fontWeight: '800', color: text },
    migrateText: { fontSize: 13, color: body, textAlign: 'center', lineHeight: 19 },
    retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: accent, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 16, marginTop: 6 },
    retryText: { color: Colors.white, fontWeight: '700', fontSize: 13 },
    toast: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: successSoft, borderRadius: 12, borderWidth: 1, borderColor: theme.isPremium ? 'rgba(0,255,136,0.3)' : '#A7F3D0', padding: 12, marginTop: 14 },
    toastText: { flex: 1, fontSize: 12.5, color: theme.isPremium ? DS.color.greenEnd : '#065F46', fontWeight: '600', lineHeight: 18 },
    trialBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.isPremium ? 'rgba(0,255,136,0.08)' : '#ECFDF5',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.isPremium ? 'rgba(0,255,136,0.25)' : '#A7F3D0',
      padding: 12,
      marginTop: 12,
    },
    trialBannerText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '700',
      color: theme.isPremium ? DS.color.greenEnd : '#065F46',
      lineHeight: 18,
    },
    sectionTitle: { fontSize: 14, fontWeight: '800', color: text, marginTop: 24, marginBottom: 12 },
    card: { backgroundColor: card, borderRadius: 16, borderWidth: 1, borderColor: border, paddingHorizontal: 16 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
    featureBorder: { borderBottomWidth: 1, borderBottomColor: soft },
    featureIcon: { fontSize: 20 },
    featureName: { fontSize: 14, fontWeight: '700', color: text },
    featureLocked: { color: muted },
    featureCost: { fontSize: 12, color: accent, fontWeight: '600', marginTop: 2 },
    featureReason: { fontSize: 11.5, color: muted, marginTop: 2 },
    planRow: { flexDirection: 'column', gap: 12 },
    planCard: { backgroundColor: card, borderRadius: 16, borderWidth: 1, borderColor: border, padding: 16, gap: 3 },
    planCardActive: { borderColor: accent, borderWidth: 2 },
    planCardPro: { backgroundColor: theme.isPremium ? 'rgba(0,255,120,0.06)' : '#FFFBEB' },
    planHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 2, width: '100%' },
    planName: { fontSize: 16, fontWeight: '900', color: text, textAlign: 'center' },
    planPrice: { fontSize: 22, fontWeight: '900', color: text, marginTop: 2, textAlign: 'center' },
    planPer: { fontSize: 12, fontWeight: '600', color: muted },
    planNote: { fontSize: 12, color: body, fontWeight: '600', marginTop: 1 },
    planGrant: { fontSize: 12.5, color: accent, fontWeight: '700', marginTop: 4 },
    perkList: { marginTop: 12, gap: 9 },
    perkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    perkText: { flex: 1, fontSize: 12.5, color: body, lineHeight: 18 },
    planBtn: { backgroundColor: accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
    planBtnText: { color: Colors.white, fontWeight: '800', fontSize: 13 },
    planActiveTag: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: successSoft, borderRadius: 10, paddingVertical: 10, marginTop: 10 },
    planActiveText: { color: theme.success, fontWeight: '800', fontSize: 13 },
    planResignBtn: {
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: 'center',
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.isPremium ? 'rgba(255,80,80,0.45)' : '#FECACA',
      backgroundColor: theme.isPremium ? 'rgba(255,80,80,0.08)' : '#FEF2F2',
    },
    planResignText: { color: theme.danger, fontWeight: '800', fontSize: 13 },
    resignBanner: {
      marginTop: 14,
      backgroundColor: theme.isPremium ? 'rgba(255,80,80,0.08)' : '#FEF2F2',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.isPremium ? 'rgba(255,80,80,0.35)' : '#FECACA',
      padding: 14,
      gap: 10,
    },
    resignBannerTitle: { fontSize: 13, fontWeight: '700', color: text, textAlign: 'center' },
    resignBannerBtn: {
      backgroundColor: theme.danger,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    resignBannerBtnText: { color: Colors.white, fontWeight: '800', fontSize: 14 },
    cancelBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 12 },
    cancelText: { color: theme.danger, fontWeight: '700', fontSize: 13 },
    resignBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 4, paddingHorizontal: 12 },
    resignText: { color: theme.danger, fontWeight: '700', fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
    topupRow: { flexDirection: 'row', gap: 8 },
    topupCard: {
      flex: 1,
      minWidth: 0,
      backgroundColor: card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: border,
      paddingVertical: 12,
      paddingHorizontal: 8,
      alignItems: 'center',
      gap: 2,
    },
    topupCredits: {
      fontSize: 18,
      fontWeight: '900',
      color: text,
      marginTop: 6,
      width: '100%',
      textAlign: 'center',
    },
    topupCreditsLabel: { fontSize: 11, color: muted, fontWeight: '600' },
    topupPriceTag: {
      backgroundColor: accent,
      borderRadius: 10,
      paddingVertical: 7,
      paddingHorizontal: 10,
      marginTop: 10,
      minWidth: 56,
      alignItems: 'center',
    },
    topupPrice: { color: Colors.white, fontWeight: '800', fontSize: 12 },
    mockNote: { fontSize: 11.5, color: muted, textAlign: 'center', marginTop: 14, lineHeight: 16 },
    portalBtn: {
      marginTop: 16,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: accent,
      backgroundColor: accentSoft,
    },
    portalText: { color: accent, fontWeight: '800', fontSize: 13.5 },
  });
}
