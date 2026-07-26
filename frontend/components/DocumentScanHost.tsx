/**
 * Globalny host skanera faktury/oferty/menu — otwierany z Magazynu, Menu lub głosem.
 */
import React, { useCallback } from 'react';
import { Alert } from 'react-native';
import { CatalogScanModal } from '@/components/CatalogScanModal';
import { MenuScanModal } from '@/components/MenuScanModal';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { router } from 'expo-router';

export function DocumentScanHost() {
  const {
    documentScanVisible,
    documentScanKind,
    closeDocumentScan,
    notifyDocumentScanComplete,
    menuScanVisible,
    openMenuScan,
    closeMenuScan,
  } = useUiOverlay();
  const scanContext = documentScanKind === 'offer' ? 'supplier' : 'warehouse';

  const onMenuDetected = useCallback(() => {
    closeDocumentScan();
    Alert.alert(
      'Rozpoznano menu restauracji',
      'To karta dań — otwieram skaner menu. Potrawy trafią do zakładki Menu (bez tworzenia dostawcy).',
      [{ text: 'OK', onPress: () => openMenuScan() }],
    );
  }, [closeDocumentScan, openMenuScan]);

  const onScanConfirmed = useCallback(() => {
    // Odśwież Magazyn / Dostawców — NIE zamykaj modala (użytkownik widzi wynik).
    notifyDocumentScanComplete();
  }, [notifyDocumentScanComplete]);

  return (
    <>
      <CatalogScanModal
        supplierId={null}
        visible={documentScanVisible}
        onClose={closeDocumentScan}
        onConfirmed={onScanConfirmed}
        scanContext={scanContext}
        onMenuDetected={onMenuDetected}
      />
      <MenuScanModal
        visible={menuScanVisible}
        onClose={closeMenuScan}
        onConfirmed={() => {
          closeMenuScan();
          notifyDocumentScanComplete();
          try {
            router.push('/(tabs)/menu');
          } catch {
            /* ignore */
          }
        }}
      />
    </>
  );
}
