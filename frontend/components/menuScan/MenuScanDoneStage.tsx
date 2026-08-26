/**
 * Ekran sukcesu po zapisie skanu menu.
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Check } from 'lucide-react-native';
import { MENU_SCAN_C as C } from './menuScanColors';
import { menuScanStyles as styles } from './menuScanStyles';

type Result = {
  inserted: number;
  warnings: string[];
  inventoryCreated: number;
  inventoryItems: { name: string; category: string }[];
};

type Props = {
  result: Result;
  footerPad: number;
  onFinish: () => void;
};

export function MenuScanDoneStage({ result, footerPad, onFinish }: Props) {
  return (
    <ScrollView
      contentContainerStyle={[styles.resultWrap, { paddingBottom: footerPad }]}
      testID="menu-scan-done"
    >
      <View style={styles.successCircle}>
        <Check size={38} color={C.green} strokeWidth={2.5} />
      </View>
      <Text style={styles.resultTitle}>Menu zapisane!</Text>
      <Text style={styles.resultSub}>
        Dodano {result.inserted} {result.inserted === 1 ? 'potrawę' : 'potraw'} do zakładki Menu.
      </Text>
      {result.inventoryCreated > 0 && (
        <View style={styles.inventoryBox} testID="menu-scan-inventory-box">
          <Text style={styles.inventoryTitle}>
            Magazyn gotowy! Utworzyliśmy {result.inventoryCreated}{' '}
            {result.inventoryCreated === 1 ? 'nowy produkt' : 'nowych produktów'} ze stanem 0 i buforem 20%.
          </Text>
          <Text style={styles.inventorySub}>
            Twój magazyn jest gotowy na przyjęcie pierwszej faktury.
          </Text>
          {result.inventoryItems.slice(0, 12).map((it, i) => (
            <Text key={i} style={styles.inventoryItem}>• {it.name} → {it.category}</Text>
          ))}
          {result.inventoryItems.length > 12 && (
            <Text style={styles.inventoryItem}>…i {result.inventoryItems.length - 12} więcej</Text>
          )}
        </View>
      )}
      {result.warnings.length > 0 && (
        <View style={styles.warnBox}>
          {result.warnings.map((w, i) => (
            <Text key={i} style={styles.warnText}>• {w}</Text>
          ))}
        </View>
      )}
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={onFinish}
        testID="menu-scan-finish"
        activeOpacity={0.85}
      >
        <Text style={styles.primaryBtnText}>Zamknij i powróć do pulpitu</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
