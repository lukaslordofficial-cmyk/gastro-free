/**
 * Drzewo okresów: rok → miesiąc → tydzień → dzień (checkboxy).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronDown, ChevronRight, Check } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';

export type PeriodSelection = {
  kind: 'year' | 'month' | 'week' | 'day';
  year: number;
  month?: number;
  week?: number;
  day?: number;
};

const MONTHS_PL = [
  '', 'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function weeksInMonth(year: number, month: number): number {
  return Math.min(5, Math.ceil(daysInMonth(year, month) / 7));
}

function daysOfWeek(year: number, month: number, week: number): number[] {
  const dim = daysInMonth(year, month);
  const start = 1 + (week - 1) * 7;
  const end = Math.min(dim, start + 6);
  if (start > dim) return [];
  const out: number[] = [];
  for (let d = start; d <= end; d++) out.push(d);
  return out;
}

function selKey(s: PeriodSelection): string {
  if (s.kind === 'year') return `y:${s.year}`;
  if (s.kind === 'month') return `m:${s.year}-${s.month}`;
  if (s.kind === 'week') return `w:${s.year}-${s.month}-${s.week}`;
  return `d:${s.year}-${s.month}-${s.day}`;
}

function hasSel(list: PeriodSelection[], s: PeriodSelection): boolean {
  const k = selKey(s);
  return list.some((x) => selKey(x) === k);
}

function toggleSel(list: PeriodSelection[], s: PeriodSelection): PeriodSelection[] {
  const k = selKey(s);
  if (list.some((x) => selKey(x) === k)) return list.filter((x) => selKey(x) !== k);
  return [...list, s];
}

export function labelForSelections(list: PeriodSelection[]): string {
  if (!list.length) return 'brak zaznaczenia';
  return list
    .map((s) => {
      if (s.kind === 'year') return `rok ${s.year}`;
      if (s.kind === 'month') return `${MONTHS_PL[s.month || 1]} ${s.year}`;
      if (s.kind === 'week') return `tydzień ${s.week} · ${MONTHS_PL[s.month || 1]} ${s.year}`;
      const dd = String(s.day || 1).padStart(2, '0');
      const mm = String(s.month || 1).padStart(2, '0');
      return `${dd}.${mm}.${s.year}`;
    })
    .join(' + ');
}

/** Parsuje „lipiec 2025” / „2025-07” → PeriodSelection month (zawsze z rokiem). */
export function parsePeriodHintToSelection(
  hint: string,
  opts?: { preferYear?: number },
): PeriodSelection | null {
  const t = (hint || '').trim();
  if (!t) return null;
  const iso = t.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return { kind: 'month', year, month };
  }
  const yMatch = t.match(/(20\d{2})/);
  const year = yMatch
    ? Number(yMatch[1])
    : (opts?.preferYear ?? new Date().getFullYear());
  const norm = t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
  const months: [string, number][] = [
    ['stycznia', 1], ['styczen', 1], ['lutego', 2], ['luty', 2],
    ['marca', 3], ['marzec', 3], ['kwietnia', 4], ['kwiecien', 4],
    ['maja', 5], ['maj', 5], ['czerwca', 6], ['czerwiec', 6],
    ['lipca', 7], ['lipiec', 7], ['sierpnia', 8], ['sierpien', 8],
    ['wrzesnia', 9], ['wrzesien', 9], ['pazdziernika', 10], ['pazdziernik', 10],
    ['listopada', 11], ['listopad', 11], ['grudznia', 12], ['grudnia', 12], ['grudzien', 12],
  ];
  for (const [name, month] of months) {
    // „maj” nie może łapać się w środku słowa — granica słowa dla krótkich form
    const re = name.length <= 3
      ? new RegExp(`(?:^|[^a-z])${name}(?:$|[^a-z])`)
      : null;
    if (re ? re.test(norm) : norm.includes(name)) {
      return { kind: 'month', year, month };
    }
  }
  if (yMatch && !months.some(([n]) => norm.includes(n))) {
    return { kind: 'year', year };
  }
  return null;
}

type Props = {
  value: PeriodSelection[];
  onChange: (next: PeriodSelection[]) => void;
  years?: number[];
  /** Domyślnie otwórz ten rok (np. z period_1) */
  preferYear?: number;
  preferMonth?: number;
};

export function PeriodPickerTree({ value, onChange, years: yearsProp, preferYear, preferMonth }: Props) {
  const years = useMemo(() => {
    if (yearsProp?.length) return [...yearsProp].filter((yr) => yr !== 2025).sort((a, b) => b - a);
    const y = new Date().getFullYear();
    // Bieżący ±1; 2025 był tylko rokiem demo/SIM — nie pokazujemy go w drzewie.
    return Array.from(new Set([y + 1, y, y - 1])).filter((yr) => yr !== 2025).sort((a, b) => b - a);
  }, [yearsProp]);

  const [openYear, setOpenYear] = useState<number | null>(
    preferYear && preferYear !== 2025
      ? preferYear
      : years.find((y) => y === new Date().getFullYear()) ?? years[0] ?? null,
  );
  const [openMonth, setOpenMonth] = useState<string | null>(
    preferYear && preferMonth ? `${preferYear}-${preferMonth}` : null,
  );
  const [openWeek, setOpenWeek] = useState<string | null>(null);

  return (
    <View style={styles.wrap} testID="period-picker-tree">
      <Text style={styles.hint}>
        Zaznacz rok, miesiące, tygodnie lub dni — możesz łączyć okresy. Potem Analizuj.
      </Text>
      {years.map((year) => {
        const yOpen = openYear === year;
        const ySel: PeriodSelection = { kind: 'year', year };
        const yChecked = hasSel(value, ySel);
        return (
          <View key={year} style={styles.block}>
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.chev}
                onPress={() => setOpenYear(yOpen ? null : year)}
                hitSlop={8}
                testID={`period-year-toggle-${year}`}
              >
                {yOpen
                  ? <ChevronDown size={16} color={DS.color.greenEnd} strokeWidth={2.4} />
                  : <ChevronRight size={16} color={DS.color.muted} strokeWidth={2.4} />}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.check, yChecked && styles.checkOn]}
                onPress={() => onChange(toggleSel(value, ySel))}
                testID={`period-year-check-${year}`}
              >
                {yChecked ? <Check size={12} color="#0A0A0A" strokeWidth={3} /> : null}
              </TouchableOpacity>
              <Text style={styles.yearLabel}>{year}</Text>
            </View>

            {yOpen &&
              Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                const mk = `${year}-${month}`;
                const mOpen = openMonth === mk;
                const mSel: PeriodSelection = { kind: 'month', year, month };
                const mChecked = hasSel(value, mSel);
                const nWeeks = weeksInMonth(year, month);
                return (
                  <View key={mk} style={styles.monthBlock}>
                    <View style={styles.row}>
                      <TouchableOpacity
                        style={styles.chev}
                        onPress={() => setOpenMonth(mOpen ? null : mk)}
                        hitSlop={8}
                      >
                        {mOpen
                          ? <ChevronDown size={14} color={DS.color.greenEnd} strokeWidth={2.4} />
                          : <ChevronRight size={14} color={DS.color.muted} strokeWidth={2.4} />}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.check, styles.checkSm, mChecked && styles.checkOn]}
                        onPress={() => onChange(toggleSel(value, mSel))}
                        testID={`period-month-check-${year}-${month}`}
                      >
                        {mChecked ? <Check size={10} color="#0A0A0A" strokeWidth={3} /> : null}
                      </TouchableOpacity>
                      <Text style={styles.monthLabel}>{MONTHS_PL[month]}</Text>
                    </View>

                    {mOpen &&
                      Array.from({ length: nWeeks }, (_, i) => i + 1).map((week) => {
                        const wk = `${mk}-w${week}`;
                        const wOpen = openWeek === wk;
                        const wSel: PeriodSelection = { kind: 'week', year, month, week };
                        const wChecked = hasSel(value, wSel);
                        const days = daysOfWeek(year, month, week);
                        return (
                          <View key={wk} style={styles.weekBlock}>
                            <View style={styles.weekRow}>
                              <TouchableOpacity
                                style={styles.chev}
                                onPress={() => setOpenWeek(wOpen ? null : wk)}
                                hitSlop={8}
                              >
                                {wOpen
                                  ? <ChevronDown size={13} color={DS.color.greenEnd} strokeWidth={2.4} />
                                  : <ChevronRight size={13} color={DS.color.muted} strokeWidth={2.4} />}
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.check, styles.checkSm, wChecked && styles.checkOn]}
                                onPress={() => onChange(toggleSel(value, wSel))}
                                testID={`period-week-check-${year}-${month}-${week}`}
                              >
                                {wChecked ? <Check size={10} color="#0A0A0A" strokeWidth={3} /> : null}
                              </TouchableOpacity>
                              <Text style={styles.weekLabel}>Tydzień {week}</Text>
                            </View>
                            {wOpen &&
                              days.map((day) => {
                                const dSel: PeriodSelection = { kind: 'day', year, month, week, day };
                                const dChecked = hasSel(value, dSel);
                                return (
                                  <View key={`${wk}-d${day}`} style={styles.dayRow}>
                                    <View style={styles.chev} />
                                    <TouchableOpacity
                                      style={[styles.check, styles.checkSm, dChecked && styles.checkOn]}
                                      onPress={() => onChange(toggleSel(value, dSel))}
                                      testID={`period-day-check-${year}-${month}-${day}`}
                                    >
                                      {dChecked ? <Check size={10} color="#0A0A0A" strokeWidth={3} /> : null}
                                    </TouchableOpacity>
                                    <Text style={styles.dayLabel}>
                                      {String(day).padStart(2, '0')}.{String(month).padStart(2, '0')}.{year}
                                    </Text>
                                  </View>
                                );
                              })}
                          </View>
                        );
                      })}
                  </View>
                );
              })}
          </View>
        );
      })}
      {value.length > 0 ? (
        <Text style={styles.preview} testID="period-picker-preview">
          Zaznaczone: {labelForSelections(value)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: DS.color.bgTertiary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    padding: 12,
    gap: 6,
    marginBottom: 10,
  },
  hint: { fontSize: 11, color: DS.color.muted, lineHeight: 15, marginBottom: 4 },
  block: { marginBottom: 4 },
  monthBlock: { marginLeft: 8, marginTop: 2 },
  weekBlock: { marginLeft: 8, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3, marginLeft: 8 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2, marginLeft: 24 },
  chev: { width: 22, alignItems: 'center' },
  check: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(92,255,176,0.45)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSm: { width: 18, height: 18, borderRadius: 5 },
  checkOn: { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd },
  yearLabel: { fontSize: 15, fontWeight: '800', color: DS.color.heading },
  monthLabel: { fontSize: 13, fontWeight: '600', color: DS.color.body },
  weekLabel: { fontSize: 12, fontWeight: '500', color: DS.color.muted },
  dayLabel: { fontSize: 11, fontWeight: '500', color: DS.color.muted },
  preview: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: DS.color.greenEnd,
    lineHeight: 17,
  },
});
