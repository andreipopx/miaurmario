'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { setApiErrorCatalogue } from '@/lib/api';

/**
 * Hands the API client the translated copy for backend error codes.
 *
 * The backend never sends user-facing prose — it sends `detail.code` — so error
 * text lives in messages/{es,en}.json under `errors.api.<code>`. Plain modules
 * (lib/api.ts, the React Query error handlers) cannot call hooks, so this
 * component registers the lookup once the locale's messages are available.
 */
export function ApiErrorMessages() {
  const t = useTranslations('errors');

  useEffect(() => {
    setApiErrorCatalogue({
      translate: (code) => (t.has(`api.${code}`) ? t(`api.${code}`) : null),
      generic: t('generic'),
    });
    return () => setApiErrorCatalogue(null);
  }, [t]);

  return null;
}
