'use client';

import { useEffect } from 'react';
import { Home, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');

  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <EmptyState
          state="sad"
          size="lg"
          title={<span className="text-2xl">{t('boundaryTitle')}</span>}
          description={t('boundaryBody')}
          action={
            <>
              <Button variant="secondary" size="lg" onClick={() => (window.location.href = '/')}>
                <Home className="h-[18px] w-[18px]" aria-hidden />
                {t('goHome')}
              </Button>
              <Button size="lg" onClick={reset}>
                <RefreshCw className="h-[18px] w-[18px]" aria-hidden />
                {t('tryAgain')}
              </Button>
            </>
          }
        />
        {process.env.NODE_ENV === 'development' && (
          <pre className="mt-2 max-h-48 overflow-auto rounded-2xl bg-panel p-4 text-left text-xs">
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        )}
      </div>
    </main>
  );
}
