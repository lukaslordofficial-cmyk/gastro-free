/**
 * Etap wyboru źródła (kamera / plik) skanera menu.
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Camera, FileText, Sparkles } from 'lucide-react-native';
import { MENU_SCAN_C as C } from './menuScanColors';
import { menuScanStyles as styles } from './menuScanStyles';

type Props = {
  footerPad: number;
  onCamera: () => void;
  onPickFile: () => void;
};

export function MenuScanChooseStage({ footerPad, onCamera, onPickFile }: Props) {
  return (
    <ScrollView contentContainerStyle={[styles.chooseWrap, { paddingBottom: footerPad }]}>
      <View style={styles.hintCard}>
        <Sparkles size={16} color={C.warning} strokeWidth={2} />
        <Text style={styles.hintText}>
          Wgraj <Text style={styles.b}>menu restauracji</Text> (PDF lub zdjęcie). AI odczyta nazwy dań, ceny,
          kategorie oraz — jeśli są w menu — składniki i gramaturę. Wszystko pokażemy do edycji.
        </Text>
      </View>
      <TouchableOpacity
        style={styles.sourceBtn}
        onPress={onCamera}
        testID="menu-scan-camera"
        activeOpacity={0.85}
      >
        <View style={styles.sourceIcon}>
          <Camera size={22} color={C.green} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sourceTitle}>Zrób zdjęcie</Text>
          <Text style={styles.sourceSub}>Sfotografuj menu aparatem</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.sourceBtn}
        onPress={onPickFile}
        testID="menu-scan-file"
        activeOpacity={0.85}
      >
        <View style={styles.sourceIcon}>
          <FileText size={22} color={C.green} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sourceTitle}>Wgraj plik</Text>
          <Text style={styles.sourceSub}>PDF, JPG lub PNG</Text>
        </View>
      </TouchableOpacity>
    </ScrollView>
  );
}
