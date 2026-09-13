import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

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

export type DocumentScanKind = 'invoice' | 'offer' | 'document' | 'menu' | 'sales';

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
   * Bump po zakończeniu skanu — Magazyn/Dostawcy/Menu odświeżają listy.
   * `kind` pozwala Finansom reagować tylko na fakturę (nie na skan menu).
   */
  documentScanRevision: number;
  lastDocumentScanKind: DocumentScanKind | null;
  notifyDocumentScanComplete: (kind?: DocumentScanKind) => void;
  /** Skaner karty dań (MenuScanModal). */
  menuScanVisible: boolean;
  openMenuScan: () => void;
  closeMenuScan: () => void;
  /** Samouczek (Wyniki / po rejestracji). */
  tutorialVisible: boolean;
  tutorialSlide: number;
  openTutorial: (slide?: number) => void;
  closeTutorial: () => void;
  setTutorialSlide: (slide: number) => void;
  /** Slide 2 → skan menu; po potwierdzeniu i zamknięciu wraca na slide 3. */
  startTutorialMenuScan: () => void;
  /** Wywołaj w onConfirmed skanu menu — zapamiętuje sukces do momentu zamknięcia. */
  markTutorialMenuScanConfirmed: () => void;
  /** true = wrócono do tutoriala (nie nawiguj na Menu). */
  finishTutorialMenuScan: () => boolean;
  isTutorialMenuScanPending: () => boolean;
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
  lastDocumentScanKind: null,
  notifyDocumentScanComplete: () => {},
  menuScanVisible: false,
  openMenuScan: () => {},
  closeMenuScan: () => {},
  tutorialVisible: false,
  tutorialSlide: 0,
  openTutorial: () => {},
  closeTutorial: () => {},
  setTutorialSlide: () => {},
  startTutorialMenuScan: () => {},
  markTutorialMenuScanConfirmed: () => {},
  finishTutorialMenuScan: () => false,
  isTutorialMenuScanPending: () => false,
});

export function UiOverlayProvider({ children }: { children: React.ReactNode }) {
  const { accountKey, isAuthenticated } = useAuth();
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
  const [lastDocumentScanKind, setLastDocumentScanKind] = useState<DocumentScanKind | null>(null);
  const [menuScanVisible, setMenuScanVisible] = useState(false);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [tutorialSlide, setTutorialSlideState] = useState(0);
  const tutorialMenuScanPending = useRef(false);
  const tutorialMenuScanConfirmed = useRef(false);

  // Hard reset overlayów przy zmianie konta / wylogowaniu — zero wycieku UI między tenantami.
  useEffect(() => {
    setLocalVoiceOpen(false);
    setVoiceOpen(false);
    setVoiceOpts({});
    setCameraOpen(false);
    setCascade({ visible: false, title: 'Produkty', subtitle: undefined, items: [], mode: 'custom' });
    setWakeListenEnabledState(false);
    setDocumentScanVisible(false);
    setMenuScanVisible(false);
    setTutorialVisible(false);
    setTutorialSlideState(0);
    tutorialMenuScanPending.current = false;
    tutorialMenuScanConfirmed.current = false;
  }, [accountKey, isAuthenticated]);

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
      setDocumentScanVisible(false);
      setMenuScanVisible(true);
      return;
    }
    // Wzajemne wykluczenie: oferta/faktura/sprzedaż nie może lecieć równolegle ze skanem menu.
    setMenuScanVisible(false);
    setDocumentScanKind(kind ?? 'invoice');
    setDocumentScanVisible(true);
  }, []);

  const closeDocumentScan = useCallback(() => {
    setDocumentScanVisible(false);
  }, []);

  const notifyDocumentScanComplete = useCallback((kind: DocumentScanKind = 'document') => {
    setLastDocumentScanKind(kind);
    setDocumentScanRevision((n) => n + 1);
  }, []);

  const openMenuScan = useCallback(() => {
    setDocumentScanVisible(false);
    setMenuScanVisible(true);
  }, []);

  const closeMenuScan = useCallback(() => {
    setMenuScanVisible(false);
  }, []);

  const openTutorial = useCallback((slide = 0) => {
    setTutorialSlideState(Math.max(0, slide));
    setTutorialVisible(true);
  }, []);

  const closeTutorial = useCallback(() => {
    setTutorialVisible(false);
    tutorialMenuScanPending.current = false;
    tutorialMenuScanConfirmed.current = false;
  }, []);

  const setTutorialSlide = useCallback((slide: number) => {
    setTutorialSlideState(Math.max(0, slide));
  }, []);

  const startTutorialMenuScan = useCallback(() => {
    tutorialMenuScanPending.current = true;
    tutorialMenuScanConfirmed.current = false;
    setTutorialVisible(false);
    setDocumentScanVisible(false);
    setMenuScanVisible(true);
  }, []);

  const markTutorialMenuScanConfirmed = useCallback(() => {
    if (tutorialMenuScanPending.current) {
      tutorialMenuScanConfirmed.current = true;
    }
  }, []);

  const isTutorialMenuScanPending = useCallback(() => tutorialMenuScanPending.current, []);

  const finishTutorialMenuScan = useCallback(() => {
    if (!tutorialMenuScanPending.current) return false;
    const confirmed = tutorialMenuScanConfirmed.current;
    tutorialMenuScanPending.current = false;
    tutorialMenuScanConfirmed.current = false;
    setMenuScanVisible(false);
    setTutorialSlideState(confirmed ? 2 : 1);
    setTutorialVisible(true);
    return true;
  }, []);
  const value = useMemo(
    () => ({
      hideAds:
        localVoiceOpen
        || voiceOpen
        || cameraOpen
        || cascade.visible
        || documentScanVisible
        || menuScanVisible
        || tutorialVisible,
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
      lastDocumentScanKind,
      notifyDocumentScanComplete,
      menuScanVisible,
      openMenuScan,
      closeMenuScan,
      tutorialVisible,
      tutorialSlide,
      openTutorial,
      closeTutorial,
      setTutorialSlide,
      startTutorialMenuScan,
      markTutorialMenuScanConfirmed,
      finishTutorialMenuScan,
      isTutorialMenuScanPending,
    }),
    [
      localVoiceOpen,
      voiceOpen,
      cameraOpen,
      cascade,
      documentScanVisible,
      documentScanKind,
      documentScanRevision,
      lastDocumentScanKind,
      menuScanVisible,
      tutorialVisible,
      tutorialSlide,
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
      openTutorial,
      closeTutorial,
      setTutorialSlide,
      startTutorialMenuScan,
      markTutorialMenuScanConfirmed,
      finishTutorialMenuScan,
      isTutorialMenuScanPending,
    ],
  );

  return <UiOverlayContext.Provider value={value}>{children}</UiOverlayContext.Provider>;
}

export function useUiOverlay() {
  return useContext(UiOverlayContext);
}
