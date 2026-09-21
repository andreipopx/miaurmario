'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');

  useEffect(() => {
    console.error('Dashboard error:', error);
  }, [error]);

  return (
    <div className="rounded-lg bg-panel">
      <EmptyState
        state="sad"
        title={t('pageErrorTitle')}
        description={t('pageErrorBody')}
        action={
          <Button size="lg" onClick={reset}>
            <RefreshCw className="h-[18px] w-[18px]" aria-hidden />
            {t('tryAgain')}
          </Button>
        }
      />
      {process.env.NODE_ENV === 'development' && (
        <pre className="mx-4 mb-4 max-h-48 overflow-auto rounded-2xl bg-background p-4 text-left text-xs">
          {error.message}
        </pre>
      )}
    </div>
  );
}
