import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView, RefreshControl,
} from 'react-native';
import {
  Wallet, Lock, Check, Crown, Sparkles, RefreshCw, Zap, Info,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

type Feature = {
  key: string; icon: string; name: string; cost: string;
  requires_deal_hunter: boolean; locked: boolean; locked_reason: string | null;
};
type TopupPkg = { key: string; credits: number; price_pln: number; label: string };
type Plan = {
  tier_level: number; name: string; price_pln: number; monthly_grant: number;
  max_credits: number; deal_hunter: boolean; price_note?: string | null; perks: string[];
};
type SubState = {
  ok?: boolean;
  needs_migration?: boolean;
  tier_level: number;
  tier_name: string;
  credits_balance: number;
  max_credits: number;
  credits_pln: number;
  status: string;
  current_period_end: string | null;
  deal_hunter_unlocked: boolean;
  features: Feature[];
  topup_packages: TopupPkg[];
  plans: Plan[];
  message?: string | null;
};

export function SubscriptionPanel() {
  const [data, setData] = useState<SubState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/subscription`);
      const d = await r.json();
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (path: string, body: any, key: string) => {
    setBusy(key);
    try {
      const r = await fetch(`${BACKEND_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d: SubState = await r.json();
      if (d && d.ok) {
        setData(d);
        if (d.message) { setToast(d.message); setTimeout(() => setToast(null), 3500); }
      }
    } catch {
      /* noop */
    } finally {
      setBusy(null);
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.center} testID="subscription-loading">
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  if (!data || data.needs_migration) {
    return (
      <View style={styles.migrateBox} testID="subscription-needs-migration">
        <Info size={22} color={Colors.accent} strokeWidth={2} />
        <Text style={styles.migrateTitle}>System subskrypcji nieaktywny</Text>
        <Text style={styles.migrateText}>
          Uruchom migrację <Text style={{ fontWeight: '800' }}>ADD_SUBSCRIPTIONS.sql</Text> w Supabase (SQL Editor),
          aby aktywować portfel kredytowy.
        </Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load} testID="subscription-retry">
          <RefreshCw size={15} color={Colors.white} strokeWidth={2.4} />
          <Text style={styles.retryText}>Odśwież</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const pct = data.max_credits > 0
    ? Math.max(0, Math.min(1, data.credits_balance / data.max_credits))
    : 0;
  const low = data.credits_balance <= 0;
  const activePaid = data.tier_level >= 1 && data.status === 'active';
  const periodEnd = data.current_period_end
    ? new Date(data.current_period_end).toLocaleDateString('pl-PL')
    : null;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.accent} />}
      testID="subscription-panel"
    >
      {/* ── Widget portfela ── */}
      <View style={[styles.wallet, data.tier_level >= 2 && styles.walletPro]} testID="wallet-widget">
        <View style={styles.walletTop}>
          <View style={styles.walletIcon}>
            {data.tier_level >= 2
              ? <Crown size={20} color={Colors.white} strokeWidth={2.2} />
              : <Wallet size={20} color={Colors.white} strokeWidth={2.2} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.walletPlanLabel}>Twój plan</Text>
            <Text style={styles.walletPlan}>{data.tier_name}</Text>
          </View>
          {data.status === 'canceled' && <Text style={styles.canceledBadge}>Anulowana</Text>}
        </View>

        <View style={styles.balanceRow}>
          <Text style={styles.balanceValue} testID="credits-balance">{data.credits_balance}</Text>
          <Text style={styles.balanceUnit}>/ {data.max_credits} kredytów</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct * 100}%` }, low && { backgroundColor: Colors.danger }]} />
        </View>

        {low && (
          <View style={styles.lowWarn}>
            <Zap size={13} color={Colors.danger} strokeWidth={2.4} />
            <Text style={styles.lowWarnText}>Brak kredytów — funkcje AI zablokowane. Doładuj portfel poniżej.</Text>
          </View>
        )}
        {periodEnd && data.status === 'active' && data.tier_level >= 1 && (
          <Text style={styles.periodText}>Kolejne doładowanie: {periodEnd}</Text>
        )}
      </View>

      {toast && (
        <View style={styles.toast} testID="subscription-toast">
          <Check size={15} color={Colors.success} strokeWidth={2.4} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* ── Funkcje w planie ── */}
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
              ? <Lock size={16} color={Colors.textTertiary} strokeWidth={2} testID={`lock-${f.key}`} />
              : <Check size={16} color={Colors.success} strokeWidth={2.4} />}
          </View>
        ))}
      </View>

      {/* ── Plany subskrypcji ── */}
      <Text style={styles.sectionTitle}>Plany subskrypcji</Text>
      <View style={styles.planRow}>
        {data.plans.slice().sort((a, b) => a.tier_level - b.tier_level).map((p) => {
          const isFree = p.tier_level === 0;
          const current = data.tier_level === p.tier_level && (isFree ? true : data.status === 'active');
          return (
            <View
              key={p.tier_level}
              style={[styles.planCard, current && styles.planCardActive, p.tier_level >= 2 && styles.planCardPro]}
              testID={`plan-card-${p.tier_level}`}
            >
              <View style={styles.planHeader}>
                {p.tier_level >= 2 && <Crown size={17} color={Colors.accentDark} strokeWidth={2.2} />}
                <Text style={styles.planName}>{p.name}</Text>
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
                  <View key={i} style={styles.perkRow} testID={`plan-${p.tier_level}-perk-${i}`}>
                    <Check size={14} color={Colors.success} strokeWidth={2.6} style={{ marginTop: 2 }} />
                    <Text style={styles.perkText}>{perk}</Text>
                  </View>
                ))}
              </View>

              {current ? (
                <View style={styles.planActiveTag}>
                  <Check size={13} color={Colors.success} strokeWidth={2.6} />
                  <Text style={styles.planActiveText}>Aktywny</Text>
                </View>
              ) : isFree ? null : (
                <TouchableOpacity
                  style={styles.planBtn}
                  onPress={() => act('/api/subscription/subscribe', { tier_level: p.tier_level }, `sub-${p.tier_level}`)}
                  disabled={busy !== null}
                  activeOpacity={0.85}
                  testID={`subscribe-tier-${p.tier_level}`}
                >
                  {busy === `sub-${p.tier_level}`
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.planBtnText}>{data.tier_level > p.tier_level ? 'Zmień plan' : 'Wybierz plan'}</Text>}
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
      {activePaid && (
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => act('/api/subscription/cancel', {}, 'cancel')}
          disabled={busy !== null}
          activeOpacity={0.8}
          testID="cancel-subscription"
        >
          {busy === 'cancel'
            ? <ActivityIndicator size="small" color={Colors.danger} />
            : <Text style={styles.cancelText}>Anuluj subskrypcję</Text>}
        </TouchableOpacity>
      )}

      {/* ── Doładuj portfel (Prepaid) ── */}
      <Text style={styles.sectionTitle}>Doładuj portfel (Prepaid)</Text>
      <View style={styles.topupRow}>
        {data.topup_packages.map((pkg) => (
          <TouchableOpacity
            key={pkg.key}
            style={styles.topupCard}
            onPress={() => act('/api/subscription/topup', { package: pkg.key }, `top-${pkg.key}`)}
            disabled={busy !== null}
            activeOpacity={0.85}
            testID={`topup-${pkg.key}`}
          >
            <Sparkles size={16} color={Colors.accent} strokeWidth={2.2} />
            <Text style={styles.topupCredits}>+{pkg.credits}</Text>
            <Text style={styles.topupCreditsLabel}>kredytów</Text>
            <View style={styles.topupPriceTag}>
              {busy === `top-${pkg.key}`
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Text style={styles.topupPrice}>{pkg.price_pln} zł</Text>}
            </View>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.mockNote}>Płatności w trybie testowym (MOCK) — Stripe podłączymy później.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 60, alignItems: 'center' },
  migrateBox: { backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 20, alignItems: 'center', gap: 8, marginTop: 8 },
  migrateTitle: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  migrateText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 16, marginTop: 6 },
  retryText: { color: Colors.white, fontWeight: '700', fontSize: 13 },

  wallet: { backgroundColor: '#1E293B', borderRadius: 20, padding: 20, marginTop: 4 },
  walletPro: { backgroundColor: '#3B2F0B' },
  walletTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  walletIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  walletPlanLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  walletPlan: { fontSize: 18, fontWeight: '900', color: Colors.white, marginTop: 1 },
  canceledBadge: { fontSize: 11, fontWeight: '700', color: '#FCA5A5', backgroundColor: 'rgba(220,38,38,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 14 },
  balanceValue: { fontSize: 34, fontWeight: '900', color: Colors.white },
  balanceUnit: { fontSize: 14, color: 'rgba(255,255,255,0.65)', fontWeight: '600' },
  balancePln: { fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginTop: 2, marginBottom: 12 },
  progressTrack: { height: 10, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6, backgroundColor: '#34D399' },
  lowWarn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, backgroundColor: 'rgba(220,38,38,0.15)', borderRadius: 10, padding: 10 },
  lowWarnText: { flex: 1, fontSize: 12, color: '#FCA5A5', fontWeight: '600', lineHeight: 17 },
  periodText: { fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 10 },

  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ECFDF5', borderRadius: 12, borderWidth: 1, borderColor: '#A7F3D0', padding: 12, marginTop: 14 },
  toastText: { flex: 1, fontSize: 12.5, color: '#065F46', fontWeight: '600', lineHeight: 18 },

  sectionTitle: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary, marginTop: 24, marginBottom: 12 },
  card: { backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  featureBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  featureIcon: { fontSize: 20 },
  featureName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  featureLocked: { color: Colors.textTertiary },
  featureCost: { fontSize: 12, color: Colors.accent, fontWeight: '600', marginTop: 2 },
  featureReason: { fontSize: 11.5, color: Colors.textTertiary, marginTop: 2 },

  planRow: { flexDirection: 'column', gap: 12 },
  planCard: { backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 3 },
  planCardActive: { borderColor: Colors.accent, borderWidth: 2 },
  planCardPro: { backgroundColor: '#FFFBEB' },
  planHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  planName: { fontSize: 16, fontWeight: '900', color: Colors.textPrimary },
  planPrice: { fontSize: 22, fontWeight: '900', color: Colors.textPrimary, marginTop: 2 },
  planPer: { fontSize: 12, fontWeight: '600', color: Colors.textTertiary },
  planNote: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600', marginTop: 1 },
  planGrant: { fontSize: 12.5, color: Colors.accent, fontWeight: '700', marginTop: 4 },
  perkList: { marginTop: 12, gap: 9 },
  perkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  perkText: { flex: 1, fontSize: 12.5, color: Colors.textSecondary, lineHeight: 18 },
  planBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  planBtnText: { color: Colors.white, fontWeight: '800', fontSize: 13 },
  planActiveTag: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#ECFDF5', borderRadius: 10, paddingVertical: 10, marginTop: 10 },
  planActiveText: { color: Colors.success, fontWeight: '800', fontSize: 13 },
  cancelBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 12 },
  cancelText: { color: Colors.danger, fontWeight: '700', fontSize: 13 },

  topupRow: { flexDirection: 'row', gap: 10 },
  topupCard: { flex: 1, backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 14, alignItems: 'center', gap: 2 },
  topupCredits: { fontSize: 22, fontWeight: '900', color: Colors.textPrimary, marginTop: 6 },
  topupCreditsLabel: { fontSize: 11, color: Colors.textTertiary, fontWeight: '600' },
  topupPriceTag: { backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 14, marginTop: 10, minWidth: 64, alignItems: 'center' },
  topupPrice: { color: Colors.white, fontWeight: '800', fontSize: 13 },
  mockNote: { fontSize: 11.5, color: Colors.textTertiary, textAlign: 'center', marginTop: 14, fontStyle: 'italic' },
});
