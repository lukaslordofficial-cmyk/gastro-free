/**
 * Etap przetwarzania / zapisu dokumentu.
 */
import React from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { CATALOG_SCAN_C as C } from './catalogScanColors';
import { PROCESSING_MESSAGES, SAVING_MESSAGES } from './catalogScanHelpers';
import { catalogScanStyles as styles } from './catalogScanStyles';

type Props = {
  isSavingProducts: boolean;
  processingMsgIdx: number;
  elapsedSec: number;
  onBackground: () => void;
};

export function CatalogScanProcessingStage({
  isSavingProducts,
  processingMsgIdx,
  elapsedSec,
  onBackground,
}: Props) {
  const msgs = isSavingProducts ? SAVING_MESSAGES : PROCESSING_MESSAGES;
  return (
    <View style={styles.center} testID="doc-scan-processing">
      <View style={[styles.processingOrb, { backgroundColor: C.greenSoft, borderColor: C.green }]}>
        <ActivityIndicator size="large" color={C.green} />
      </View>
      <Text style={[styles.analyzingTitle, { color: C.text }]}>
        {isSavingProducts ? 'Zapisywanie produktów…' : 'Skan dokumentu AI'}
      </Text>
      <Text style={[styles.analyzingSub, { color: C.body }]}>
        {msgs[processingMsgIdx % msgs.length]}
      </Text>
      <View style={[styles.processingCard, { backgroundColor: C.card, borderColor: C.border }]}>
        <Text style={[styles.processingCardText, { color: C.muted }]}>
          {isSavingProducts
            ? 'Zapisuję produkty w magazynie i koszt zmienny. Listy odświeżą się automatycznie.'
            : 'Wielostronicowe katalogi PDF są czytane partiami — kredyty = realny koszt tokenów OpenAI. Możesz zostawić ekran otwarty albo wrócić — po fakturze otworzymy zatwierdzenie automatycznie.'}
        </Text>
        <Text style={[styles.elapsed, { color: C.green }]}>
          {elapsedSec < 60
            ? `${elapsedSec} s`
            : `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`}
        </Text>
      </View>
      {!isSavingProducts ? (
        <TouchableOpacity
          style={[styles.bgBtn, { borderColor: C.border }]}
          onPress={onBackground}
          activeOpacity={0.85}
          testID="doc-scan-background"
        >
          <Text style={[styles.bgBtnText, { color: C.body }]}>Kontynuuj w tle</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
