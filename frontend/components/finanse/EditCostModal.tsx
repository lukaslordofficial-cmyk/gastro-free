import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import * as financeService from '@/services/financeService';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { DS } from '@/constants/premiumTheme';
import { CURRENT_MONTH } from '@/components/finanse/constants';
import type { EditableCostRow } from '@/components/finanse/types';
import { ms } from '@/components/finanse/finanseScreenStyles';

export function EditCostModal({
  visible,
  cost,
  onClose,
  onSaved,
}: {
  visible: boolean;
  cost: EditableCostRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const prem = theme.isPremium;
  const { alert: premiumAlert } = usePremiumAlert();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [yearMonth, setYearMonth] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!cost || !visible) return;
    setName(cost.name);
    setAmount(String(cost.amount_pln ?? ''));
    setYearMonth(cost.year_month || CURRENT_MONTH);
  }, [cost, visible]);

  async function handleSave() {
    if (!cost) return;
    const trimmed = name.trim();
    if (!trimmed) {
      premiumAlert('Błąd', 'Podaj nazwę kosztu.');
      return;
    }
    const val = parseFloat(amount.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      premiumAlert('Błąd', 'Podaj poprawną kwotę.');
      return;
    }
    const ym = (yearMonth || '').trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      premiumAlert('Błąd', 'Miesiąc w formacie RRRR-MM (np. 2026-07).');
      return;
    }

    setSaving(true);
    try {
      const tableName = cost.kind === 'fixed' ? 'fixed_costs' : 'variable_cost_entries';
      await financeService.updateCost(tableName, cost.id, { name: trimmed, amount_pln: val, year_month: ym });
      onSaved();
      onClose();
    } catch (e: any) {
      premiumAlert('Błąd', e.message ?? 'Nie udało się zapisać zmian.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[ms.overlay, prem && { backgroundColor: 'rgba(0,0,0,0.72)' }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            ms.sheet,
            { paddingBottom: Math.max(insets.bottom, 20) + 8 },
            prem && {
              backgroundColor: DS.color.surfaceCard,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: DS.color.borderSubtle,
            },
          ]}
        >
          <View style={ms.header}>
            <Text style={[ms.title, prem && { color: DS.color.heading }]}>
              Edytuj koszt {cost?.kind === 'variable' ? 'zmienny' : 'stały'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={prem ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <Text style={[ms.label, prem && { color: DS.color.muted }]}>Nazwa *</Text>
          <TextInput
            style={[
              ms.input,
              prem && {
                backgroundColor: DS.color.bgTertiary,
                borderColor: DS.color.borderSubtle,
                color: DS.color.heading,
              },
            ]}
            value={name}
            onChangeText={setName}
            placeholder="Nazwa kosztu"
            placeholderTextColor={prem ? DS.color.muted : Colors.textTertiary}
            autoFocus
          />
          <Text style={[ms.label, prem && { color: DS.color.muted }]}>Kwota (PLN) *</Text>
          <TextInput
            style={[
              ms.input,
              prem && {
                backgroundColor: DS.color.bgTertiary,
                borderColor: DS.color.borderSubtle,
                color: DS.color.heading,
              },
            ]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={prem ? DS.color.muted : Colors.textTertiary}
          />
          <Text style={[ms.label, prem && { color: DS.color.muted }]}>Miesiąc (RRRR-MM)</Text>
          <TextInput
            style={[
              ms.input,
              prem && {
                backgroundColor: DS.color.bgTertiary,
                borderColor: DS.color.borderSubtle,
                color: DS.color.heading,
              },
            ]}
            value={yearMonth}
            onChangeText={setYearMonth}
            placeholder={CURRENT_MONTH}
            placeholderTextColor={prem ? DS.color.muted : Colors.textTertiary}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[
              ms.saveBtn,
              prem && { backgroundColor: DS.color.greenEnd },
              saving && ms.saveBtnDisabled,
            ]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator size="small" color={prem ? '#0A0A0A' : Colors.white} />
              : <Text style={[ms.saveBtnText, prem && { color: '#0A0A0A' }]}>Zapisz zmiany</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
