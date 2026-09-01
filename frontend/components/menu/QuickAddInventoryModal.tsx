import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, FlaskConical, X } from 'lucide-react-native';
import { menuScreenStyles as styles } from '@/components/menu/menuScreenStyles';
import { BLANK_INV_FORM } from '@/constants/menuFormDefaults';
import {
  INV_CATEGORY_COLORS,
  INV_PRESET_CATEGORIES,
  INV_UNIT_OPTIONS,
} from '@/constants/menuUi';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';

export type InvFormState = typeof BLANK_INV_FORM;

export function QuickAddInventoryModal({
  visible,
  invForm,
  setInvForm,
  invSaving,
  onSave,
  onClose,
}: {
  visible: boolean;
  invForm: InvFormState;
  setInvForm: React.Dispatch<React.SetStateAction<InvFormState>>;
  invSaving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const theme = useAppTheme();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView
        style={[styles.modalSafe, theme.isPremium && { backgroundColor: DS.color.bgPrimary }]}
        edges={['top']}
      >
        <View
          style={[
            styles.modalHeader,
            styles.invModalHeader,
            theme.isPremium && {
              backgroundColor: DS.color.bgPrimary,
              borderBottomColor: DS.color.borderSubtle,
            },
          ]}
        >
          <View style={styles.invModalTitleWrap}>
            <View style={[styles.invModalBadge, theme.isPremium && { backgroundColor: DS.color.greenEnd }]}>
              <FlaskConical size={13} color={theme.isPremium ? '#0A0A0A' : Colors.white} strokeWidth={2.5} />
              <Text style={[styles.invModalBadgeText, theme.isPremium && { color: '#0A0A0A' }]}>Nowy produkt</Text>
            </View>
            <Text style={[styles.modalTitle, theme.isPremium && { color: DS.color.heading }]}>Dodaj do Magazynu</Text>
            <Text style={[styles.modalSubtitle, theme.isPremium && { color: DS.color.muted }]}>
              Produkt zostanie automatycznie dodany do receptury
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={20} color={theme.isPremium ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.formScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            <View style={styles.fieldWrap}>
              <Text style={[styles.fieldLabel, theme.isPremium && { color: DS.color.muted }]}>
                Nazwa produktu <Text style={{ color: Colors.danger }}>*</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  theme.isPremium && {
                    backgroundColor: DS.color.bgTertiary,
                    borderColor: DS.color.borderSubtle,
                    color: DS.color.heading,
                  },
                ]}
                placeholder="np. Kurczak filet"
                placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                value={invForm.name}
                onChangeText={(v) => setInvForm((f) => ({ ...f, name: v }))}
                returnKeyType="next"
              />
            </View>

            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>Kategoria</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.formCatBar}>
                {INV_PRESET_CATEGORIES.map((cat) => {
                  const active = invForm.category === cat;
                  const color = INV_CATEGORY_COLORS[cat] ?? Colors.textSecondary;
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.formCatPill, active && { backgroundColor: color, borderColor: color }]}
                      onPress={() => setInvForm((f) => ({ ...f, category: cat }))}
                      activeOpacity={0.7}
                    >
                      {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                      <Text style={[styles.formCatText, active && { color: Colors.white, fontWeight: '700' }]}>{cat}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.fieldRow}>
              <View style={[styles.fieldWrap, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>
                  Aktualna ilość <Text style={{ color: Colors.danger }}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="np. 1500"
                  placeholderTextColor={Colors.textTertiary}
                  value={invForm.currentQty}
                  onChangeText={(v) => setInvForm((f) => ({ ...f, currentQty: v }))}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                />
              </View>
              <View style={[styles.fieldWrap, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>
                  Stan krytyczny <Text style={{ color: Colors.danger }}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="np. 500"
                  placeholderTextColor={Colors.textTertiary}
                  value={invForm.criticalThreshold}
                  onChangeText={(v) => setInvForm((f) => ({ ...f, criticalThreshold: v }))}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>
            </View>

            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>Jednostka</Text>
              <View style={styles.unitRow}>
                {INV_UNIT_OPTIONS.map((u) => {
                  const active = invForm.unit === u;
                  return (
                    <TouchableOpacity
                      key={u}
                      style={[styles.unitBtn, active && styles.unitBtnActive]}
                      onPress={() => setInvForm((f) => ({ ...f, unit: u }))}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.unitBtnText, active && styles.unitBtnTextActive]}>{u}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>Wielkość porcji w Menu ({invForm.unit})</Text>
              <TextInput
                style={styles.input}
                placeholder="np. 200 (opcjonalne)"
                placeholderTextColor={Colors.textTertiary}
                value={invForm.portionSize}
                onChangeText={(v) => setInvForm((f) => ({ ...f, portionSize: v }))}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
            </View>

            <View style={styles.switchRow}>
              <View style={styles.switchInfo}>
                <FlaskConical size={16} color={Colors.accent} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>Półprodukt / Combo</Text>
                  <Text style={styles.switchHint}>Produkt przygotowywany wewnętrznie z innych składników</Text>
                </View>
              </View>
              <Switch
                value={invForm.isCombo}
                onValueChange={(v) => setInvForm((f) => ({ ...f, isCombo: v }))}
                trackColor={{ false: Colors.borderLight, true: Colors.accentLight }}
                thumbColor={invForm.isCombo ? Colors.accent : Colors.textTertiary}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.saveBtn,
                theme.isPremium && { backgroundColor: DS.color.greenEnd, shadowColor: DS.color.greenEnd },
                invSaving && { opacity: 0.6 },
              ]}
              onPress={onSave}
              disabled={invSaving}
              activeOpacity={0.85}
            >
              <Check size={18} color={theme.isPremium ? '#0A0A0A' : Colors.white} strokeWidth={2.5} />
              <Text style={[styles.saveBtnText, theme.isPremium && { color: '#0A0A0A' }]}>
                {invSaving ? 'Zapisywanie...' : 'Zapisz i Dodaj do Receptury'}
              </Text>
            </TouchableOpacity>

            <View style={{ height: 32 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
