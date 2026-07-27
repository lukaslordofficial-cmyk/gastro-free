import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgGrad, Path, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Mic, Sparkles, ToggleLeft, ToggleRight } from 'lucide-react-native';
import { PremiumColors } from '@/constants/premiumTheme';
import { useThemeMode } from '@/contexts/ThemeModeContext';
import {
  AiWaveOrb,
  AnimatedCounter,
  FloatingAsset,
  GlitchTyping,
  LaserScanner,
} from '@/components/premium/premiumAnimations';
import { imageSourceForProduct, MEAT_CATALOG } from '@/lib/productImages';
import { GreenAreaLineChart } from '@/components/GreenAreaLineChart';

const LOGO = require('@/assets/premium/gastro-manager-logo.webp');
const FALLBACK_MEAT = require('@/assets/premium/beef-steak.webp');

function productSrc(name: string): number | { uri: string } {
  return imageSourceForProduct(name) ?? FALLBACK_MEAT;
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const { width: SCREEN_W } = Dimensions.get('window');

export type PremiumDashProps = {
  revenue: number;
  foodCostPct: number;
  inventoryValueHint: number;
  wastePct: number;
  criticalItems: { id: string; name: string; quantity: number; min_quantity: number; unit?: string }[];
  chartPoints: number[];
  refreshing: boolean;
  onRefresh: () => void;
};

function formatPLN(n: number): string {
  return (
    Math.round(n).toLocaleString('pl-PL', { maximumFractionDigits: 0 }) + ' PLN'
  );
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function Sparkline({ data, color, width = 72, height = 28 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (!data.length) return <View style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');
  const d = `M ${pts.replace(/ /g, ' L ')}`;
  return (
    <Svg width={width} height={height}>
      <Path d={d} stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

function AreaChart({ data }: { data: number[] }) {
  const w = SCREEN_W - 64;
  const h = 140;
  const progress = useSharedValue(0);
  const values = data.length ? data : [12, 18, 15, 22, 20, 26, 24];

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) });
  }, [values.join(','), progress]);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w;
    const y = h - ((v - min) / span) * (h - 20) - 10;
    return { x, y };
  });
  const line = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  const pathLen = w * 2.2;

  const lineProps = useAnimatedProps(() => ({
    strokeDashoffset: pathLen * (1 - progress.value),
  }));

  return (
    <Svg width={w} height={h}>
      <Defs>
        <SvgGrad id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={PremiumColors.neon} stopOpacity="0.35" />
          <Stop offset="1" stopColor={PremiumColors.neon} stopOpacity="0" />
        </SvgGrad>
      </Defs>
      <Path d={area} fill="url(#areaFill)" />
      <AnimatedPath
        d={line}
        stroke={PremiumColors.neon}
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${pathLen} ${pathLen}`}
        animatedProps={lineProps}
      />
    </Svg>
  );
}

function DonutChart({
  segments,
}: {
  segments: { pct: number; color: string; label: string }[];
}) {
  const size = 110;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) });
  }, [progress]);

  let offset = 0;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#222"
          strokeWidth={stroke}
          fill="none"
        />
        {segments.map((s, i) => {
          const len = (s.pct / 100) * c;
          const dashOffset = -offset;
          offset += len;
          return (
            <DonutSeg
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={s.color}
              strokeWidth={stroke}
              circumference={c}
              length={len}
              dashOffset={dashOffset}
              progress={progress}
              delay={i * 120}
            />
          );
        })}
      </Svg>
    </View>
  );
}

function DonutSeg({
  cx,
  cy,
  r,
  stroke,
  strokeWidth,
  circumference,
  length,
  dashOffset,
  progress,
  delay,
}: {
  cx: number;
  cy: number;
  r: number;
  stroke: string;
  strokeWidth: number;
  circumference: number;
  length: number;
  dashOffset: number;
  progress: SharedValue<number>;
  delay: number;
}) {
  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(delay, withTiming(1, { duration: 900 }));
  }, [delay, progress]);

  const props = useAnimatedProps(() => ({
    strokeDasharray: `${length * progress.value} ${circumference}`,
  }));

  return (
    <AnimatedCircle
      cx={cx}
      cy={cy}
      r={r}
      stroke={stroke}
      strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          strokeDashoffset={dashOffset}
          animatedProps={props}
        />
  );
}

function KpiTile({
  title,
  value,
  delta,
  positive,
  spark,
  formatValue,
}: {
  title: string;
  value: number;
  delta: string;
  positive: boolean;
  spark: number[];
  formatValue: (n: number) => string;
}) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiTitle}>{title}</Text>
      <AnimatedCounter value={value} formatValue={formatValue} style={styles.kpiValue} />
      <View style={styles.kpiFooter}>
        <Text style={[styles.kpiDelta, { color: positive ? PremiumColors.neon : PremiumColors.alert }]}>
          {delta}
        </Text>
        <Sparkline data={spark} color={positive ? PremiumColors.neon : PremiumColors.alert} />
      </View>
    </View>
  );
}

export function PremiumDashboard({
  revenue,
  foodCostPct,
  inventoryValueHint,
  wastePct,
  criticalItems,
  chartPoints,
  refreshing,
  onRefresh,
}: PremiumDashProps) {
  const { toggleAppearance } = useThemeMode();
  const [jarvisMsg] = useState(
    'Clyde online. Sales trend stable. Suggest +15% tomato order based on weekend spike.'
  );

  const matches = useMemo(
    () =>
      MEAT_CATALOG.slice(0, 3).map((m, i) => ({
        name: m.labelPl,
        pct: [95, 92, 87][i],
        tag: i < 2 ? 'Best Match' : 'Good Match',
        img: productSrc(m.labelPl),
      })),
    []
  );

  const donut = [
    { pct: 35, color: PremiumColors.neon, label: 'Beef' },
    { pct: 25, color: PremiumColors.cyan, label: 'Flour' },
    { pct: 20, color: '#A78BFA', label: 'Oil' },
    { pct: 20, color: '#52525B', label: 'Other' },
  ];

  const lowStock = criticalItems.slice(0, 4);
  const demoLow =
    lowStock.length > 0
      ? lowStock
      : [
          { id: '1', name: 'Olive Oil', quantity: 2.1, min_quantity: 5, unit: 'L' },
          { id: '2', name: 'Parmesan', quantity: 0.4, min_quantity: 2, unit: 'kg' },
          { id: '3', name: 'Basil', quantity: 0.2, min_quantity: 1, unit: 'kg' },
        ];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={PremiumColors.neon}
          />
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={LOGO} style={styles.logo} contentFit="contain" />
            <View style={{ flex: 1 }}>
              <Text style={styles.brand}>GASTRO-MANAGER</Text>
              <Text style={styles.brandSub}>PRO DARK · JARVIS</Text>
            </View>
          </View>
          {__DEV__ ? (
            <TouchableOpacity style={styles.devToggle} onPress={() => void toggleAppearance()} activeOpacity={0.85}>
              <ToggleRight size={16} color={PremiumColors.neon} strokeWidth={2} />
              <Text style={styles.devToggleText}>Free UI</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaChip}>This Month</Text>
          <View style={styles.voiceStatus}>
            <Mic size={12} color={PremiumColors.neon} strokeWidth={2.5} />
            <Text style={styles.voiceStatusText}>Voice AI · Online</Text>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <KpiTile
            title="Total Sales"
            value={revenue}
            delta="+12.5% m/m"
            positive
            spark={chartPoints.length ? chartPoints : [10, 14, 12, 18, 16, 22]}
            formatValue={formatPLN}
          />
          <KpiTile
            title="Food Cost"
            value={foodCostPct}
            delta="-2.1% m/m"
            positive
            spark={[32, 31, 30, 29, 28.8, foodCostPct || 28.4]}
            formatValue={formatPct}
          />
        </View>
        <View style={styles.kpiRow}>
          <KpiTile
            title="Inventory"
            value={inventoryValueHint}
            delta="+8.5% m/m"
            positive
            spark={[14, 15, 16, 17, 18, 19]}
            formatValue={formatPLN}
          />
          <KpiTile
            title="Waste"
            value={wastePct}
            delta="-3.6% m/m"
            positive={false}
            spark={[4.2, 3.8, 3.5, 3.1, 2.8, wastePct || 2.3]}
            formatValue={formatPct}
          />
        </View>

        <View style={styles.card}>
          <GreenAreaLineChart
            points={(chartPoints.length ? chartPoints : [12, 18, 15, 22, 20, 26, 24]).map((v, i) => ({
              label: ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'][i % 7],
              value: v,
            }))}
            color={PremiumColors.neon}
            height={160}
            title="Total Spend"
            totalLabel={`${Math.round(
              (chartPoints.length ? chartPoints : [12, 18, 15, 22, 20, 26, 24]).reduce((a, b) => a + b, 0),
            ).toLocaleString('pl-PL')} zł`}
            periodLabel="This week"
            dark
          />
        </View>

        <View style={styles.splitRow}>
          <View style={[styles.card, { flex: 1.1 }]}>
            <View style={styles.jarvisHead}>
              <AiWaveOrb listening />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cardTitle}>Clyde · Jarvis</Text>
                <GlitchTyping text={jarvisMsg} style={styles.jarvisText} charMs={22} />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Sparkles size={14} color={PremiumColors.neon} strokeWidth={2} />
            <Text style={styles.cardTitle}>Smart Suggestions</Text>
          </View>
          <View style={styles.suggestRow}>
            <LaserScanner active>
              <FloatingAsset source={productSrc('antrykot')} size={86} />
            </LaserScanner>
            <View style={{ flex: 1 }}>
              <Text style={styles.suggestTitle}>Antrykot / Ribeye</Text>
              <GlitchTyping
                text="Increase by 15% based on usage trend."
                style={styles.suggestBody}
              />
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>AI Ingredient Matching</Text>
          {matches.map((m, i) => (
            <View key={m.name} style={styles.matchRow}>
              <FloatingAsset source={m.img} size={44} delay={i * 180} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.matchName}>{m.name}</Text>
                <Text style={styles.matchTag}>{m.tag}</Text>
              </View>
              <View style={styles.matchPctWrap}>
                <Text style={styles.matchPct}>{m.pct}%</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.bottomRow}>
          <View style={[styles.card, { flex: 1 }]}>
            <Text style={styles.cardTitle}>Top Ingredients</Text>
            <View style={styles.donutRow}>
              <DonutChart segments={donut} />
              <View style={{ flex: 1, gap: 6 }}>
                {donut.map((d) => (
                  <View key={d.label} style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: d.color }]} />
                    <Text style={styles.legendText}>
                      {d.label} {d.pct}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Low Stock Alerts</Text>
          {demoLow.map((item) => {
            const pct = Math.max(
              4,
              Math.min(100, (item.quantity / Math.max(item.min_quantity, 0.01)) * 100)
            );
            return (
              <View key={item.id} style={styles.lowRow}>
                <LaserScanner active={pct < 40}>
                  <FloatingAsset source={productSrc(item.name)} size={40} />
                </LaserScanner>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.lowName}>{item.name}</Text>
                  <Text style={styles.lowQty}>
                    {item.quantity}
                    {item.unit ? ` ${item.unit}` : ''} left
                  </Text>
                  <View style={styles.barTrack}>
                    <LinearGradient
                      colors={[PremiumColors.alert, '#FF8A65']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.barFill, { width: `${pct}%` as any }]}
                    />
                  </View>
                </View>
                <View style={styles.lowBadge}>
                  <Text style={styles.lowBadgeText}>Low</Text>
                </View>
              </View>
            );
          })}
        </View>

        {__DEV__ ? (
          <Text style={styles.footerHint}>
            Tryb testowy Premium — przełącznik Free UI powyżej. Wygląd darmowy bez zmian.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Mały przełącznik na ekranie free (tylko __DEV__). */
export function PremiumPreviewToggle() {
  const { isPremiumUi, toggleAppearance } = useThemeMode();
  if (!__DEV__) return null;
  return (
    <TouchableOpacity
      style={toggleStyles.btn}
      onPress={() => void toggleAppearance()}
      activeOpacity={0.85}
    >
      {isPremiumUi ? (
        <ToggleRight size={14} color="#fff" strokeWidth={2} />
      ) : (
        <ToggleLeft size={14} color="#fff" strokeWidth={2} />
      )}
      <Text style={toggleStyles.text}>
        {isPremiumUi ? 'Premium UI' : 'Podgląd Premium'}
      </Text>
    </TouchableOpacity>
  );
}

const toggleStyles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PremiumColors.bg },
  content: { padding: 16, paddingBottom: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  logo: { width: 52, height: 52 },
  brand: {
    color: PremiumColors.neon,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  brandSub: {
    color: PremiumColors.cyan,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.6,
    marginTop: 2,
  },
  devToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: PremiumColors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  devToggleText: { color: PremiumColors.neon, fontSize: 11, fontWeight: '700' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  metaChip: {
    color: PremiumColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: PremiumColors.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    overflow: 'hidden',
  },
  voiceStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  voiceStatusText: { color: PremiumColors.neon, fontSize: 11, fontWeight: '600' },
  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  kpi: {
    flex: 1,
    backgroundColor: PremiumColors.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: PremiumColors.border,
  },
  kpiTitle: { color: PremiumColors.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 6 },
  kpiValue: { color: PremiumColors.text, fontSize: 20, fontWeight: '800', marginBottom: 8 },
  kpiFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kpiDelta: { fontSize: 11, fontWeight: '700' },
  card: {
    backgroundColor: PremiumColors.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    marginBottom: 12,
  },
  cardTitle: {
    color: PremiumColors.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  splitRow: { flexDirection: 'row', gap: 10 },
  jarvisHead: { flexDirection: 'row', alignItems: 'center' },
  jarvisText: { color: PremiumColors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  suggestTitle: { color: PremiumColors.text, fontSize: 15, fontWeight: '700' },
  suggestBody: { color: PremiumColors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PremiumColors.border,
  },
  matchName: { color: PremiumColors.text, fontSize: 13, fontWeight: '700' },
  matchTag: { color: PremiumColors.neon, fontSize: 10, fontWeight: '700', marginTop: 2 },
  matchPctWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: PremiumColors.neon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchPct: { color: PremiumColors.neon, fontSize: 11, fontWeight: '800' },
  bottomRow: { flexDirection: 'row', gap: 10 },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: PremiumColors.textSecondary, fontSize: 11 },
  lowRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  lowName: { color: PremiumColors.text, fontSize: 13, fontWeight: '700' },
  lowQty: { color: PremiumColors.textMuted, fontSize: 11, marginTop: 2, marginBottom: 6 },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2A2A2A',
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: 3 },
  lowBadge: {
    backgroundColor: PremiumColors.alertSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  lowBadgeText: { color: PremiumColors.alert, fontSize: 10, fontWeight: '800' },
  footerHint: {
    color: PremiumColors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 15,
  },
});
