import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type CascadeProductItem = {
  id: string;
  name: string;
  quantity: number;
  minQuantity?: number;
  unit?: string;
};

export type CascadeMode = 'critical' | 'stock_asc' | 'custom';

type CascadeState = {
  visible: boolean;
  title: string;
  subtitle?: string;
  items: CascadeProductItem[];
  mode: CascadeMode;
};

export type VoiceOverlayOpts = {
  autoStartRecording?: boolean;
  autoStartWakeListen?: boolean;
};

export type DocumentScanKind = 'invoice' | 'offer' | 'document' | 'menu';

type UiOverlayContextValue = {
  /** Ukryj banery (Voice AI, aparat, skaner). */
  hideAds: boolean;
  setVoiceOverlay: (open: boolean) => void;
  setCameraOverlay: (open: boolean) => void;
  cascade: CascadeState;
  openProductCascade: (opts: {
    title?: string;
    subtitle?: string;
    items: CascadeProductItem[];
    mode?: CascadeMode;
  }) => void;
  closeProductCascade: () => void;
  /** Globalny modal sterowania głosowego (wake word / host). */
  voiceVisible: boolean;
  voiceOpts: VoiceOverlayOpts;
  openVoiceReport: (opts?: VoiceOverlayOpts) => void;
  closeVoiceReport: () => void;
  /** Globalny nasłuch hasła — host w root layout. */
  wakeListenEnabled: boolean;
  setWakeListenEnabled: (on: boolean) => void;
  /** Skan faktury / oferty / menu. */
  documentScanVisible: boolean;
  documentScanKind: DocumentScanKind;
  openDocumentScan: (kind?: DocumentScanKind) => void;
  closeDocumentScan: () => void;
  /**
   * Bump po zakończeniu skanu dokumentu (oferta/faktura) —
   * Magazyn / Dostawcy nasłuchują i odświeżają listy.
   */
  documentScanRevision: number;
  notifyDocumentScanComplete: () => void;
  /** Skaner karty dań (MenuScanModal). */
  menuScanVisible: boolean;
  openMenuScan: () => void;
  closeMenuScan: () => void;
};

const EMPTY_CASCADE: CascadeState = {
  visible: false,
  title: 'Produkty',
  subtitle: undefined,
  items: [],
  mode: 'custom',
};

const UiOverlayContext = createContext<UiOverlayContextValue>({
  hideAds: false,
  setVoiceOverlay: () => {},
  setCameraOverlay: () => {},
  cascade: EMPTY_CASCADE,
  openProductCascade: () => {},
  closeProductCascade: () => {},
  voiceVisible: false,
  voiceOpts: {},
  openVoiceReport: () => {},
  closeVoiceReport: () => {},
  wakeListenEnabled: false,
  setWakeListenEnabled: () => {},
  documentScanVisible: false,
  documentScanKind: 'invoice',
  openDocumentScan: () => {},
  closeDocumentScan: () => {},
  documentScanRevision: 0,
  notifyDocumentScanComplete: () => {},
  menuScanVisible: false,
  openMenuScan: () => {},
  closeMenuScan: () => {},
});

export function UiOverlayProvider({ children }: { children: React.ReactNode }) {
  /** Lokalne modale (ReportInfoButton) — tylko flaga reklam. */
  const [localVoiceOpen, setLocalVoiceOpen] = useState(false);
  /** Globalny host wake word. */
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceOpts, setVoiceOpts] = useState<VoiceOverlayOpts>({});
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cascade, setCascade] = useState<CascadeState>(EMPTY_CASCADE);
  const [wakeListenEnabled, setWakeListenEnabledState] = useState(false);
  const [documentScanVisible, setDocumentScanVisible] = useState(false);
  const [documentScanKind, setDocumentScanKind] = useState<DocumentScanKind>('invoice');
  const [documentScanRevision, setDocumentScanRevision] = useState(0);
  const [menuScanVisible, setMenuScanVisible] = useState(false);

  const openProductCascade = useCallback(
    (opts: {
      title?: string;
      subtitle?: string;
      items: CascadeProductItem[];
      mode?: CascadeMode;
    }) => {
      setCascade({
        visible: true,
        title: opts.title ?? 'Produkty',
        subtitle: opts.subtitle,
        items: opts.items,
        mode: opts.mode ?? 'custom',
      });
    },
    [],
  );

  const closeProductCascade = useCallback(() => {
    setCascade((c) => ({ ...c, visible: false }));
  }, []);

  const openVoiceReport = useCallback((opts?: VoiceOverlayOpts) => {
    setVoiceOpts(opts ?? {});
    setVoiceOpen(true);
  }, []);

  const closeVoiceReport = useCallback(() => {
    setVoiceOpen(false);
    setVoiceOpts({});
  }, []);

  const setWakeListenEnabled = useCallback((on: boolean) => {
    setWakeListenEnabledState(on);
  }, []);

  const openDocumentScan = useCallback((kind?: DocumentScanKind) => {
    if (kind === 'menu') {
      setMenuScanVisible(true);
      return;
    }
    setDocumentScanKind(kind ?? 'invoice');
    setDocumentScanVisible(true);
  }, []);

  const closeDocumentScan = useCallback(() => {
    setDocumentScanVisible(false);
  }, []);

  const notifyDocumentScanComplete = useCallback(() => {
    setDocumentScanRevision((n) => n + 1);
  }, []);

  const openMenuScan = useCallback(() => {
    setDocumentScanVisible(false);
    setMenuScanVisible(true);
  }, []);

  const closeMenuScan = useCallback(() => {
    setMenuScanVisible(false);
  }, []);

  const value = useMemo(
    () => ({
      hideAds: localVoiceOpen || voiceOpen || cameraOpen || cascade.visible || documentScanVisible || menuScanVisible,
      setVoiceOverlay: setLocalVoiceOpen,
      setCameraOverlay: setCameraOpen,
      cascade,
      openProductCascade,
      closeProductCascade,
      voiceVisible: voiceOpen,
      voiceOpts,
      openVoiceReport,
      closeVoiceReport,
      wakeListenEnabled,
      setWakeListenEnabled,
      documentScanVisible,
      documentScanKind,
      openDocumentScan,
      closeDocumentScan,
      documentScanRevision,
      notifyDocumentScanComplete,
      menuScanVisible,
      openMenuScan,
      closeMenuScan,
    }),
    [
      localVoiceOpen,
      voiceOpen,
      cameraOpen,
      cascade,
      documentScanVisible,
      documentScanKind,
      documentScanRevision,
      menuScanVisible,
      wakeListenEnabled,
      voiceOpts,
      openProductCascade,
      closeProductCascade,
      openVoiceReport,
      closeVoiceReport,
      setWakeListenEnabled,
      openDocumentScan,
      closeDocumentScan,
      notifyDocumentScanComplete,
      openMenuScan,
      closeMenuScan,
    ],
  );

  return <UiOverlayContext.Provider value={value}>{children}</UiOverlayContext.Provider>;
}

export function useUiOverlay() {
  return useContext(UiOverlayContext);
}
