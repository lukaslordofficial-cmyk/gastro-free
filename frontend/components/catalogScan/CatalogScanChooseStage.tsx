/**
 * Etap wyboru źródła dokumentu (kamera / plik).
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Camera, FileText, Sparkles } from 'lucide-react-native';
import { CATALOG_SCAN_C as C } from './catalogScanColors';
import { catalogScanStyles as styles } from './catalogScanStyles';

type Props = {
  scanContext: 'warehouse' | 'supplier';
  onCamera: () => void;
  onPickFile: () => void;
};

export function CatalogScanChooseStage({ scanContext, onCamera, onPickFile }: Props) {
  return (
    <ScrollView contentContainerStyle={styles.chooseWrap}>
      <View style={[styles.hintCard, { backgroundColor: C.warningSoft, borderColor: C.warningBorder }]}>
        <Sparkles size={16} color={C.warning} strokeWidth={2} />
        <Text style={[styles.hintText, { color: C.body }]}>
          {scanContext === 'warehouse' ? (
            <>
              <Text style={[styles.b, { color: C.text }]}>Wgraj fakturę zakupową lub ofertę handlową.</Text>
              {' '}System rozpoznaje typ dokumentu: faktura trafi do magazynu/kosztów, oferta — do katalogu dostawcy.
              Po analizie AI zapisze dane we właściwych zakładkach i Cię powiadomi.
            </>
          ) : (
            <>
              <Text style={[styles.b, { color: C.text }]}>Wgraj ofertę dostawcy, lub fakturę</Text>
              {' '}na produkty, które od niego kupiłeś. System automatycznie stworzy profil
              tego dostawcy, uzupełni jego dane, i doda produkty z dokumentu do jego katalogu.
              Gdy będziesz chciał złożyć zamówienie produktowe, skorzysta z podanych danych,
              by przygotować dla Ciebie najkorzystniejszą ofertę.
            </>
          )}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.sourceBtn, { backgroundColor: C.card, borderColor: C.border }]}
        onPress={onCamera}
        testID="doc-scan-camera"
        activeOpacity={0.85}
      >
        <View style={[styles.sourceIcon, { backgroundColor: C.greenSoft }]}>
          <Camera size={22} color={C.green} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sourceTitle, { color: C.text }]}>Zrób zdjęcie</Text>
          <Text style={[styles.sourceSub, { color: C.muted }]}>
            {scanContext === 'warehouse'
              ? 'Sfotografuj fakturę lub ofertę'
              : 'Sfotografuj fakturę lub ofertę'}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.sourceBtn, { backgroundColor: C.card, borderColor: C.border }]}
        onPress={onPickFile}
        testID="doc-scan-file"
        activeOpacity={0.85}
      >
        <View style={[styles.sourceIcon, { backgroundColor: C.greenSoft }]}>
          <FileText size={22} color={C.green} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sourceTitle, { color: C.text }]}>Wgraj plik</Text>
          <Text style={[styles.sourceSub, { color: C.muted }]}>
            PDF (także wielostronicowy, do ~40 stron), JPG lub PNG
          </Text>
        </View>
      </TouchableOpacity>
    </ScrollView>
  );
}
