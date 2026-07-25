import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
} from 'react-native';
import { Check, ChevronDown, MonitorSmartphone } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import {
  POS_PROVIDERS,
  getPosProvider,
  type PosProviderId,
} from '@/lib/posProviders';

type Props = {
  value: PosProviderId;
  onChange: (id: PosProviderId) => void;
};

export function PosProviderPicker({ value, onChange }: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => getPosProvider(value), [value]);

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <MonitorSmartphone size={13} color={theme.textSecondary} strokeWidth={2} />
        <Text style={[styles.label, { color: theme.textSecondary }]}>Twój system POS</Text>
      </View>

      <TouchableOpacity
        style={[
          styles.trigger,
          prem && {
            backgroundColor: theme.segmentBg,
            borderColor: theme.border,
          },
        ]}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.triggerTitle, { color: theme.text }]}>{selected.name}</Text>
          <Text style={[styles.triggerSub, { color: theme.textMuted }]} numberOfLines={1}>
            {selected.blurb}
          </Text>
        </View>
        <ChevronDown size={18} color={theme.accent} strokeWidth={2} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              styles.sheet,
              prem && { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Wybierz system POS</Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {POS_PROVIDERS.map((p) => {
                const active = p.id === value;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.option,
                      prem && { borderColor: theme.border },
                      active && (prem
                        ? { backgroundColor: theme.accentSoft, borderColor: theme.accent }
                        : styles.optionActive),
                    ]}
                    onPress={() => {
                      onChange(p.id);
                      setOpen(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.optionName,
                          { color: theme.text },
                          active && { color: theme.accent, fontWeight: '800' },
                        ]}
                      >
                        {p.name}
                      </Text>
                      <Text style={[styles.optionBlurb, { color: theme.textMuted }]}>{p.blurb}</Text>
                    </View>
                    {active ? <Check size={18} color={theme.accent} strokeWidth={2.5} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  triggerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  triggerSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    maxHeight: '80%',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
  },
  optionActive: {
    backgroundColor: Colors.accentLight,
  },
  optionName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  optionNameActive: {
    color: Colors.accentDark,
  },
  optionBlurb: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
});
