/**
 * Globalny host skanera faktury/oferty/menu/sprzedaży — otwierany z Magazynu, Menu lub głosem.
 */
import React, { useCallback } from 'react';
import { CatalogScanModal } from '@/components/CatalogScanModal';
import { MenuScanModal } from '@/components/MenuScanModal';
import { SalesScanModal } from '@/components/SalesScanModal';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
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
  const { alert: premiumAlert } = usePremiumAlert();
  const scanContext = documentScanKind === 'offer' ? 'supplier' : 'warehouse';
  const salesOpen = documentScanVisible && documentScanKind === 'sales';
  const catalogOpen = documentScanVisible && documentScanKind !== 'sales';

  const onMenuDetected = useCallback(() => {
    closeDocumentScan();
    premiumAlert(
      'Rozpoznano menu restauracji',
      'To karta dań — otwieram skaner menu. Potrawy trafią do zakładki Menu (bez tworzenia dostawcy).',
      [{ text: 'OK', style: 'primary', onPress: () => openMenuScan() }],
    );
  }, [closeDocumentScan, openMenuScan, premiumAlert]);

  const onScanConfirmed = useCallback(() => {
    notifyDocumentScanComplete(documentScanKind === 'offer' ? 'offer' : 'invoice');
  }, [notifyDocumentScanComplete, documentScanKind]);

  return (
    <>
      <CatalogScanModal
        supplierId={null}
        visible={catalogOpen}
        onClose={closeDocumentScan}
        onConfirmed={onScanConfirmed}
        scanContext={scanContext}
        onMenuDetected={onMenuDetected}
      />
      <SalesScanModal
        visible={salesOpen}
        onClose={closeDocumentScan}
        onConfirmed={() => notifyDocumentScanComplete('sales')}
      />
      <MenuScanModal
        visible={menuScanVisible}
        onClose={closeMenuScan}
        onConfirmed={async () => {
          notifyDocumentScanComplete('menu');
          await new Promise((r) => setTimeout(r, 80));
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
