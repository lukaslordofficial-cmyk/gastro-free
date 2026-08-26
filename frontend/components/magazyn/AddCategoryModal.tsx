import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { magazynScreenStyles as styles } from './magazynScreenStyles';

export type AddCategoryModalProps = {
  visible: boolean;
  newCatName: string;
  onChangeName: (name: string) => void;
  savingCat: boolean;
  onSave: () => void;
  onClose: () => void;
};

export function AddCategoryModal({
  visible,
  newCatName,
  onChangeName,
  savingCat,
  onSave,
  onClose,
}: AddCategoryModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.catOverlay}>
        <View style={styles.catModal}>
          <View style={styles.catModalHeader}>
            <Text style={styles.catModalTitle}>Nowa kategoria</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.catInput}
            value={newCatName}
            onChangeText={onChangeName}
            placeholder="np. Owoce morza"
            placeholderTextColor={Colors.textTertiary}
            autoFocus
            onSubmitEditing={onSave}
            returnKeyType="done"
          />
          <View style={styles.catModalBtns}>
            <TouchableOpacity style={styles.catCancelBtn} onPress={onClose}>
              <Text style={styles.catCancelText}>Anuluj</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.catSaveBtn, (!newCatName.trim() || savingCat) && { opacity: 0.5 }]}
              onPress={onSave}
              disabled={!newCatName.trim() || savingCat}
              activeOpacity={0.85}
            >
              {savingCat
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Text style={styles.catSaveText}>Dodaj kategorię</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
