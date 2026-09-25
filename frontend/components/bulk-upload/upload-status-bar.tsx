'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';

import { useBulkUpload } from '@/lib/bulk-upload/bulk-upload-context';

/**
 * The batch, while the sheet is closed.
 *
 * Without this the upload would be invisible the moment you navigate away, which
 * is precisely when people assume it died and start again. It sits above the
 * mobile dock and is a link straight back into the sheet.
 */
export function UploadStatusBar() {
  const t = useTranslations('bulkUpload.statusBar');
  const { photos, counts } = useBulkUpload();
  const searchParams = useSearchParams();

  const sheetIsOpen = searchParams?.get('bulk') === '1';
  const interesting = counts.busy > 0 || counts.failed > 0;
  if (!interesting || sheetIsOpen || photos.length === 0) return null;

  const done = counts.saved + counts.duplicate + counts.failed;
  const pct = counts.total === 0 ? 0 : Math.round((done / counts.total) * 100);
  const failing = counts.busy === 0 && counts.failed > 0;

  return (
    <div
      className="fixed inset-x-4 z-40 mx-auto max-w-md max-[359px]:inset-x-3 lg:inset-x-auto lg:right-6 lg:mx-0 lg:w-80"
      style={{ bottom: 'calc(6.25rem + env(safe-area-inset-bottom))' }}
      data-testid="bulk-status-bar"
    >
      <Link
        href={{ pathname: '/dashboard/wardrobe', query: { bulk: '1' } }}
        className="glass-dock flex items-center gap-3 rounded-[28px] px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={t('open')}
      >
        {failing ? (
          <AlertCircle className="h-5 w-5 shrink-0 text-destructive" strokeWidth={2} aria-hidden />
        ) : (
          <Loader2
            className="h-5 w-5 shrink-0 animate-spin text-foreground motion-reduce:animate-none"
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold leading-tight">
            {failing ? t('failed', { count: counts.failed }) : t('uploading', { done, total: counts.total })}
          </span>
          <span
            className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-panel"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span
              className="block h-full rounded-full bg-signature transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
      </Link>
    </div>
  );
}
