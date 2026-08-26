/**
 * Picker kategorii potrawy w skanerze menu.
 */
import React from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { Check } from 'lucide-react-native';
import { MENU_CATEGORIES, type DraftDish } from './menuScanTypes';
import { MENU_SCAN_C as C } from './menuScanColors';
import { menuScanStyles as styles } from './menuScanStyles';

type Props = {
  categoryPickerFor: string | null;
  dishes: DraftDish[];
  footerPad: number;
  onClose: () => void;
  onSelect: (dishKey: string, category: string) => void;
};

export function MenuScanCategoryPicker({
  categoryPickerFor,
  dishes,
  footerPad,
  onClose,
  onSelect,
}: Props) {
  return (
    <Modal
      visible={categoryPickerFor !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.pickerOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={[styles.pickerSheet, { paddingBottom: footerPad + 8 }]}>
          <Text style={styles.pickerTitle}>Wybierz kategorię</Text>
          <ScrollView style={{ maxHeight: 400 }}>
            {MENU_CATEGORIES.map((cat) => {
              const currentDish = dishes.find((d) => d.key === categoryPickerFor);
              const active = currentDish?.category === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.pickerRow, active && styles.pickerRowActive]}
                  onPress={() => {
                    if (categoryPickerFor) {
                      onSelect(categoryPickerFor, cat);
                    }
                    onClose();
                  }}
                  testID={`menu-scan-category-option-${cat}`}
                >
                  <Text style={[styles.pickerRowText, active && styles.pickerRowTextActive]}>
                    {cat}
                  </Text>
                  {active && <Check size={16} color={C.green} strokeWidth={2.5} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}
