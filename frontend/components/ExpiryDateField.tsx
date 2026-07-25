/**
 * Pole daty ważności z kalendarzem (zamiast ręcznego wpisywania).
 * Zawsze zapisuje YYYY-MM-DD.
 * Premium: ciemne powierzchnie + zielony akcent (sheet pickera też).
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Calendar } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';

type Props = {
  label?: string;
  value: string; // YYYY-MM-DD or ''
  onChange: (iso: string) => void;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  bgColor?: string;
  accentColor?: string;
  /** Tło sheetu iOS/web (osobno od pola — zwykle ciemniejsze). */
  sheetBgColor?: string;
  testID?: string;
};

function parseIso(v: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  }
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatPl(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return 'Wybierz datę';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function ExpiryDateField({
  label = 'Data ważności',
  value,
  onChange,
  textColor,
  mutedColor,
  borderColor,
  bgColor,
  accentColor,
  sheetBgColor,
  testID,
}: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const cText = textColor ?? (prem ? DS.color.heading : Colors.textPrimary);
  const cMuted = mutedColor ?? (prem ? DS.color.muted : Colors.textSecondary);
  const cBorder = borderColor ?? (prem ? DS.color.borderSubtle : Colors.border);
  const cBg = bgColor ?? (prem ? DS.color.bgTertiary : Colors.card);
  const cAccent = accentColor ?? (prem ? DS.color.greenEnd : Colors.accent);
  const cSheet = sheetBgColor ?? (prem ? DS.color.bgSecondary : Colors.card);

  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState(() => parseIso(value));

  const openPicker = () => {
    setTemp(parseIso(value));
    setOpen(true);
  };

  const onAndroidChange = (event: DateTimePickerEvent, date?: Date) => {
    setOpen(false);
    if (event.type === 'dismissed' || !date) return;
    onChange(toIso(date));
  };

  const confirmIos = () => {
    onChange(toIso(temp));
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: cMuted }]}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.btn, { borderColor: cBorder, backgroundColor: cBg }]}
        onPress={openPicker}
        activeOpacity={0.8}
        testID={testID}
      >
        <Calendar size={16} color={cAccent} strokeWidth={2.2} />
        <Text style={[styles.btnText, { color: value ? cText : cMuted }]} numberOfLines={1}>
          {formatPl(value)}
        </Text>
      </TouchableOpacity>

      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          value={temp}
          mode="date"
          display="calendar"
          onChange={onAndroidChange}
          minimumDate={new Date(2020, 0, 1)}
        />
      ) : null}

      {open && Platform.OS === 'ios' ? (
        <Modal transparent animationType="slide" visible onRequestClose={() => setOpen(false)}>
          <View style={styles.iosOverlay}>
            <View style={[styles.iosSheet, { backgroundColor: cSheet }]}>
              <View style={[styles.iosBar, prem && { borderBottomColor: DS.color.borderSubtle, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10}>
                  <Text style={[styles.iosAction, { color: cMuted }]}>Anuluj</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={confirmIos} hitSlop={10}>
                  <Text style={[styles.iosAction, { color: cAccent, fontWeight: '800' }]}>
                    Gotowe
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={temp}
                mode="date"
                display="spinner"
                onChange={(_, d) => d && setTemp(d)}
                minimumDate={new Date(2020, 0, 1)}
                themeVariant={prem ? 'dark' : 'light'}
                style={{ alignSelf: 'center' }}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {open && Platform.OS === 'web' ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setOpen(false)}>
          <View style={styles.iosOverlay}>
            <View style={[styles.iosSheet, { backgroundColor: cSheet, padding: 16 }]}>
              <Text style={[styles.label, { color: cMuted, marginBottom: 8 }]}>Wybierz datę</Text>
              {/* @ts-expect-error web input */}
              <input
                type="date"
                value={value || toIso(new Date())}
                onChange={(e: any) => {
                  const v = String(e?.target?.value || '');
                  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) onChange(v);
                  setOpen(false);
                }}
                style={{
                  fontSize: 16,
                  padding: 10,
                  borderRadius: 8,
                  border: `1px solid ${cBorder}`,
                  width: '100%',
                  backgroundColor: cBg,
                  color: cText,
                }}
              />
              <TouchableOpacity onPress={() => setOpen(false)} style={{ marginTop: 12 }}>
                <Text style={{ color: cMuted, textAlign: 'center' }}>Anuluj</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 44,
  },
  btnText: { flex: 1, fontSize: 14, fontWeight: '700' },
  iosOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  iosSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  iosBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iosAction: { fontSize: 15 },
});
