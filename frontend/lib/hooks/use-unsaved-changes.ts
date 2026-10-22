'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Warns before leaving a settings screen with unsaved fields: the browser's own
 * prompt on reload/close, and a confirm on in-app navigation (pushState).
 */
export function useUnsavedChanges(isDirty: boolean) {
  const t = useTranslations('settings.header');
  useEffect(() => {
    if (!isDirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);

    const origPush = history.pushState.bind(history);
    history.pushState = function (...args) {
      if (window.confirm(t('unsavedChanges'))) {
        origPush(...args);
      }
    };

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      history.pushState = origPush;
    };
  }, [isDirty, t]);
}
