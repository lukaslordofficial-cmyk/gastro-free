/**
 * Host samouczka: auto-start po rejestracji / pierwszym logowaniu + modal.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { OnboardingTutorialModal, TUTORIAL_SLIDE_COUNT } from '@/components/OnboardingTutorialModal';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  consumeTutorialPending,
  isTutorialDone,
  markTutorialDone,
} from '@/lib/tutorialStorage';

export function TutorialHost() {
  const { accountKey, isAuthenticated, ready } = useAuth();
  const {
    tutorialVisible,
    tutorialSlide,
    openTutorial,
    closeTutorial,
    setTutorialSlide,
    startTutorialMenuScan,
  } = useUiOverlay();
  const autoTried = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !isAuthenticated || !accountKey) return;
    if (autoTried.current === accountKey) return;
    autoTried.current = accountKey;
    void (async () => {
      const pending = await consumeTutorialPending();
      if (!pending) return;
      const done = await isTutorialDone(accountKey);
      if (done) return;
      // Krótka pauza po starcie UI — unikamy kolizji ze splash / tabs.
      setTimeout(() => openTutorial(0), 600);
    })();
  }, [ready, isAuthenticated, accountKey, openTutorial]);

  const handleClose = useCallback(() => {
    void markTutorialDone(accountKey);
    closeTutorial();
  }, [accountKey, closeTutorial]);

  const handleNext = useCallback(() => {
    if (tutorialSlide >= TUTORIAL_SLIDE_COUNT - 1) {
      handleClose();
      return;
    }
    setTutorialSlide(tutorialSlide + 1);
  }, [tutorialSlide, setTutorialSlide, handleClose]);

  const handleBack = useCallback(() => {
    if (tutorialSlide <= 0) return;
    setTutorialSlide(tutorialSlide - 1);
  }, [tutorialSlide, setTutorialSlide]);

  return (
    <OnboardingTutorialModal
      visible={tutorialVisible}
      slide={tutorialSlide}
      onClose={handleClose}
      onNext={handleNext}
      onBack={handleBack}
      onAddMenu={startTutorialMenuScan}
    />
  );
}
