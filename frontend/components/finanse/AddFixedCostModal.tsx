import React, { useState, useRef } from 'react';
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
import { X, Plus, Check } from 'lucide-react-native';
import type { FixedCost } from '@/lib/types';
import * as financeService from '@/services/financeService';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { DS } from '@/constants/premiumTheme';
import { BASE_FIXED_TYPES, CURRENT_MONTH } from '@/components/finanse/constants';
import { ms } from '@/components/finanse/finanseScreenStyles';

export function AddFixedCostModal({
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
  const [selectedKey, setSelectedKey] = useState<string>('rent');
  const selectedKeyRef = useRef('rent');
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const newCatValueRef = useRef('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  function selectKey(key: string) {
    setSelectedKey(key);
    selectedKeyRef.current = key;
    setShowNewInput(false);
  }

  function confirmNewCategory() {
    const trimmed = newCatValueRef.current.trim();
    if (!trimmed) return;
    if (!customCategories.includes(trimmed)) {
      setCustomCategories((prev) => [...prev, trimmed]);
    }
    setSelectedKey(trimmed);
    selectedKeyRef.current = trimmed;
    newCatValueRef.current = '';
    setNewCatName('');
    setShowNewInput(false);
  }

  async function handleSave() {
    const val = parseFloat(amount.replace(',', '.'));
    if (isNaN(val) || val <= 0) { Alert.alert('Błąd', 'Podaj poprawną kwotę.'); return; }

    let type: FixedCost['type'];
    let name: string;

    if (showNewInput) {
      const catName = newCatValueRef.current.trim();
      if (!catName) { Alert.alert('Błąd', 'Wpisz nazwę nowej kategorii.'); return; }
      type = 'other';
      name = catName;
    } else {
      const key = selectedKeyRef.current;
      const base = BASE_FIXED_TYPES.find((t) => t.key === key);
      type = base ? (base.key as FixedCost['type']) : 'other';
      name = base ? base.label : key;
      if (!name) { Alert.alert('Błąd', 'Wybierz lub utwórz kategorię.'); return; }
    }

    setSaving(true);
    try {
      await financeService.insertFixedCost({ year_month: CURRENT_MONTH, type, name, amount_pln: val });
      setAmount('');
      setNewCatName('');
      newCatValueRef.current = '';
      setShowNewInput(false);
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
            <Text style={[ms.title, prem && { color: DS.color.heading }]}>Dodaj koszt stały</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={prem ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <Text style={[ms.label, prem && { color: DS.color.muted }]}>Kategoria</Text>
          <View style={ms.typeRow}>
            {BASE_FIXED_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[
                  ms.pill,
                  prem && { backgroundColor: DS.color.bgTertiary, borderColor: DS.color.borderSubtle },
                  selectedKey === t.key && !showNewInput && (prem
                    ? { backgroundColor: 'rgba(0,255,120,0.18)', borderColor: DS.color.greenEnd }
                    : ms.pillActive),
                ]}
                onPress={() => selectKey(t.key)}
              >
                <Text
                  style={[
                    ms.pillText,
                    prem && { color: DS.color.muted },
                    selectedKey === t.key && !showNewInput && (prem
                      ? { color: DS.color.greenEnd, fontWeight: '800' }
                      : ms.pillTextActive),
                  ]}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
            {customCategories.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[
                  ms.pill,
                  prem && { backgroundColor: DS.color.bgTertiary, borderColor: DS.color.borderSubtle },
                  selectedKey === cat && !showNewInput && (prem
                    ? { backgroundColor: 'rgba(0,255,120,0.18)', borderColor: DS.color.greenEnd }
                    : ms.pillActive),
                ]}
                onPress={() => selectKey(cat)}
              >
                <Text
                  style={[
                    ms.pillText,
                    prem && { color: DS.color.muted },
                    selectedKey === cat && !showNewInput && (prem
                      ? { color: DS.color.greenEnd, fontWeight: '800' }
                      : ms.pillTextActive),
                  ]}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[
                ms.pill,
                prem && { backgroundColor: DS.color.bgTertiary, borderColor: DS.color.borderSubtle },
                showNewInput && (prem
                  ? { backgroundColor: 'rgba(0,255,120,0.18)', borderColor: DS.color.greenEnd }
                  : ms.pillActive),
              ]}
              onPress={() => setShowNewInput((v) => !v)}
            >
              <Plus size={13} color={showNewInput ? (prem ? DS.color.greenEnd : Colors.accent) : (prem ? DS.color.muted : Colors.textSecondary)} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
          {showNewInput && (
            <View style={ms.newCatRow}>
              <TextInput
                style={[
                  ms.input,
                  { flex: 1, marginBottom: 0 },
                  prem && {
                    backgroundColor: DS.color.bgTertiary,
                    borderColor: DS.color.borderSubtle,
                    color: DS.color.heading,
                  },
                ]}
                value={newCatName}
                onChangeText={(text) => { setNewCatName(text); newCatValueRef.current = text; }}
                placeholder="Nazwa kategorii..."
                placeholderTextColor={prem ? DS.color.muted : Colors.textTertiary}
                autoFocus
                onSubmitEditing={confirmNewCategory}
              />
              <TouchableOpacity
                style={[ms.newCatConfirm, prem && { backgroundColor: DS.color.greenEnd }]}
                onPress={confirmNewCategory}
              >
                <Check size={16} color={prem ? '#0A0A0A' : Colors.white} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          )}
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
              : <Text style={[ms.saveBtnText, prem && { color: '#0A0A0A' }]}>Zapisz koszt</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
