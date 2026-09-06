/**
 * Zielony wykres liniowy z wypełnieniem, osiami Y/X i kropkami — styl „Total Spend”.
 * Obsługuje wartości ujemne (zysk/strata). Opcjonalnie ukrywa nagłówek / oś Y
 * (np. gdy nagłówek i Y są poza ScrollView).
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient as SvgGrad,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

export type AreaPoint = {
  label: string;
  value: number;
  subLabel?: string;
  /** Wyróżnij punkt (np. dzień z kosztem zmiennym / dostawą). */
  mark?: boolean;
};

type Props = {
  points: AreaPoint[];
  /** Kolor linii / wypełnienia */
  color?: string;
  height?: number;
  /** Format etykiet osi Y */
  formatY?: (n: number) => string;
  title?: string;
  totalLabel?: string;
  trendPct?: number | null;
  periodLabel?: string;
  /** Ciemny motyw Premium — jaśniejsze osie / nagłówki */
  dark?: boolean;
  /** Szerokość wykresu (np. dla poziomego slide) */
  width?: number;
  /** Ukryj nagłówek (tytuł / suma / trend) — renderowany poza scroll */
  hideHeader?: boolean;
  /** Ukryj etykiety osi Y — renderowane poza scroll */
  hideYAxis?: boolean;
};

const SCREEN_W = Dimensions.get('window').width;

function defaultFormatY(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = n / 1000;
    return `${k.toFixed(abs >= 10000 ? 0 : 1)}k`;
  }
  return Math.round(n).toLocaleString('pl-PL');
}

export function GreenAreaLineChart({
  points,
  color = '#00E676',
  height = 160,
  formatY = defaultFormatY,
  title,
  totalLabel,
  trendPct,
  periodLabel,
  dark = false,
  width: widthProp,
  hideHeader = false,
  hideYAxis = false,
}: Props) {
  const axis = dark ? '#8A8A8A' : '#94A3B8';
  const grid = dark ? 'rgba(255,255,255,0.06)' : 'rgba(120,120,120,0.25)';
  const titleColor = dark ? '#8A8A8A' : '#64748B';
  const periodColor = dark ? '#8A8A8A' : '#94A3B8';
  const padL = hideYAxis ? 8 : 36;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const w = Math.max(280, widthProp ?? SCREEN_W - 48);
  const chartW = w - padL - padR;
  const chartH = height - padT - padB;

  const values = points.map((p) => Number(p.value) || 0);
  const max = Math.max(...values, 0, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const yTicks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => min + (span * i) / steps);
  }, [min, span]);

  const yAt = (v: number) => padT + chartH - ((v - min) / span) * chartH;
  const zeroY = yAt(0);

  const coords = values.map((v, i) => {
    const x = padL + (i / Math.max(values.length - 1, 1)) * chartW;
    return { x, y: yAt(v), v };
  });

  const line = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = coords.length
    ? `${line} L ${coords[coords.length - 1].x} ${zeroY} L ${coords[0].x} ${zeroY} Z`
    : '';

  const total = values.reduce((a, b) => a + b, 0);

  if (!points.length) {
    return (
      <View style={[styles.wrap, { height }]}>
        <Text style={styles.empty}>Brak danych do wykresu</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {!hideHeader && (title || totalLabel) ? (
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            {!!title && <Text style={[styles.title, { color: titleColor }]}>{title}</Text>}
            <Text style={[styles.total, { color }]}>
              {totalLabel ?? `${Math.round(total).toLocaleString('pl-PL')} zł`}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {trendPct != null && Number.isFinite(trendPct) ? (
              <View style={[styles.trendPill, { backgroundColor: `${color}22` }]}>
                <Text style={[styles.trendText, { color }]}>
                  {trendPct >= 0 ? '+' : ''}{trendPct.toFixed(1)}%
                </Text>
              </View>
            ) : null}
            {!!periodLabel && <Text style={[styles.period, { color: periodColor }]}>{periodLabel}</Text>}
          </View>
        </View>
      ) : null}

      <Svg width={w} height={height}>
        <Defs>
          <SvgGrad id="greenAreaFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.32" />
            <Stop offset="1" stopColor={color} stopOpacity="0.02" />
          </SvgGrad>
        </Defs>

        {yTicks.map((t, i) => {
          const y = yAt(t);
          return (
            <React.Fragment key={`yt-${i}`}>
              <Line
                x1={padL}
                y1={y}
                x2={padL + chartW}
                y2={y}
                stroke={grid}
                strokeWidth={1}
              />
              {!hideYAxis ? (
                <SvgText
                  x={padL - 6}
                  y={y + 3}
                  fill={axis}
                  fontSize="9"
                  fontWeight="600"
                  textAnchor="end"
                >
                  {formatY(t)}
                </SvgText>
              ) : null}
            </React.Fragment>
          );
        })}

        {min < 0 && max > 0 ? (
          <Line
            x1={padL}
            y1={zeroY}
            x2={padL + chartW}
            y2={zeroY}
            stroke={axis}
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.7}
          />
        ) : null}

        {area ? <Path d={area} fill="url(#greenAreaFill)" /> : null}
        {line ? (
          <Path
            d={line}
            stroke={color}
            strokeWidth={2.6}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {coords.map((p, i) => {
          const marked = !!points[i]?.mark;
          return (
            <React.Fragment key={`dot-${i}`}>
              {marked ? (
                <Circle
                  cx={p.x}
                  cy={p.y}
                  r={8}
                  fill="rgba(255,171,64,0.35)"
                  stroke="#FFAB40"
                  strokeWidth={1.5}
                />
              ) : null}
              <Circle
                cx={p.x}
                cy={p.y}
                r={marked ? 5 : 4}
                fill={p.v < 0 ? '#FF5252' : marked ? '#FFAB40' : color}
                stroke={dark ? '#161616' : '#fff'}
                strokeWidth={1.5}
              />
            </React.Fragment>
          );
        })}

        {points.map((pt, i) => {
          const x = coords[i]?.x ?? 0;
          return (
            <SvgText
              key={`xl-${i}`}
              x={x}
              y={height - 8}
              fill={axis}
              fontSize="10"
              fontWeight="600"
              textAnchor="middle"
            >
              {pt.label}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

/** Stała oś Y do montażu obok poziomego ScrollView */
export function ChartYAxis({
  points,
  height = 170,
  formatY = defaultFormatY,
  dark = false,
}: {
  points: AreaPoint[];
  height?: number;
  formatY?: (n: number) => string;
  dark?: boolean;
}) {
  const axis = dark ? '#8A8A8A' : '#94A3B8';
  const values = points.map((p) => Number(p.value) || 0);
  const max = Math.max(...values, 0, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const padT = 16;
  const padB = 28;
  const chartH = height - padT - padB;
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);

  return (
    <View style={{ width: 40, height }}>
      {ticks.map((t, i) => {
        const y = padT + chartH - ((t - min) / span) * chartH;
        return (
          <Text
            key={`fy-${i}`}
            style={{
              position: 'absolute',
              right: 4,
              top: y - 6,
              fontSize: 9,
              fontWeight: '600',
              color: axis,
            }}
          >
            {formatY(t)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 8,
  },
  headerRight: { alignItems: 'flex-end', gap: 4 },
  title: { fontSize: 13, fontWeight: '700', color: '#64748B', marginBottom: 2 },
  total: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  trendPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  trendText: { fontSize: 11, fontWeight: '800' },
  period: { fontSize: 11, color: '#94A3B8', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#94A3B8', paddingVertical: 40, fontSize: 13 },
});
