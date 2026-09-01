import React, { useState } from 'react';
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
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import * as financeService from '@/services/financeService';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { DS } from '@/constants/premiumTheme';
import { CURRENT_MONTH } from '@/components/finanse/constants';
import { ms } from '@/components/finanse/finanseScreenStyles';

export function AddRevenueModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const prem = theme.isPremium;
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const val = parseFloat(amount.replace(',', '.'));
    if (isNaN(val) || val <= 0) { Alert.alert('Błąd', 'Podaj poprawną kwotę.'); return; }
    setSaving(true);
    try {
      await financeService.insertRevenue({
        year_month: CURRENT_MONTH,
        description: desc.trim() || null,
        amount_pln: val,
      });
      setDesc(''); setAmount('');
      onSaved(); onClose();
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się zapisać.');
    } finally { setSaving(false); }
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
            <Text style={[ms.title, prem && { color: DS.color.heading }]}>Dodaj przychód</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={prem ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <Text style={[ms.label, prem && { color: DS.color.muted }]}>Opis (opcjonalnie)</Text>
          <TextInput
            style={[
              ms.input,
              prem && {
                backgroundColor: DS.color.bgTertiary,
                borderColor: DS.color.borderSubtle,
                color: DS.color.heading,
              },
            ]}
            value={desc}
            onChangeText={setDesc}
            placeholder="np. Utarg dzienny"
            placeholderTextColor={prem ? DS.color.muted : Colors.textTertiary}
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
              : <Text style={[ms.saveBtnText, prem && { color: '#0A0A0A' }]}>Zapisz przychód</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
