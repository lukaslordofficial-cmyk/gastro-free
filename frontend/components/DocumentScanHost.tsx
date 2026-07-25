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

  return (
    <>
      <CatalogScanModal
        supplierId={null}
        visible={documentScanVisible}
        onClose={closeDocumentScan}
        onConfirmed={closeDocumentScan}
        scanContext={scanContext}
        onMenuDetected={onMenuDetected}
      />
      <MenuScanModal
        visible={menuScanVisible}
        onClose={closeMenuScan}
        onConfirmed={() => {
          closeMenuScan();
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
