'use client';

import { useTranslations } from 'next-intl';
import { AlertCircle, Check, CopyCheck, Loader2, RotateCcw, Scissors, Tag, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { type PhotoState, type QueuedPhoto, isTerminal } from '@/lib/bulk-upload/queue';

const STATE_ICON: Record<PhotoState, typeof Check> = {
  pending: Loader2,
  uploading: Loader2,
  'removing-bg': Scissors,
  tagging: Tag,
  done: Check,
  duplicate: CopyCheck,
  error: AlertCircle,
};

function stateTone(state: PhotoState): string {
  if (state === 'error') return 'text-destructive';
  if (state === 'done') return 'text-success';
  if (state === 'duplicate') return 'text-warning';
  return 'text-muted-foreground';
}

/**
 * The queue, one row per photo.
 *
 * Every row carries its own state and its own retry, because a batch of thirty is
 * exactly the situation where one photo fails and the user must not have to work
 * out which one or start again.
 */
export function UploadQueueList({
  photos,
  onRetry,
  onRemove,
}: {
  photos: readonly QueuedPhoto[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations('bulkUpload.queue');

  /**
   * Say what actually went wrong. "No se pudo subir" tells the user nothing they
   * can act on; "esa foto pasa de 10 MB" tells them to pick another one.
   */
  const errorLabel = (photo: QueuedPhoto): string => {
    const key = `errors.${photo.errorCode ?? 'failed'}`;
    if (t.has(key as never)) return t(key as never);
    return photo.error || t('errors.failed');
  };

  return (
    <ul className="space-y-2" data-testid="bulk-queue">
      {photos.map((photo) => {
        const Icon = STATE_ICON[photo.state];
        const spinning = photo.state === 'uploading' || photo.state === 'pending';
        return (
          <li
            key={photo.id}
            data-testid="bulk-queue-row"
            data-state={photo.state}
            className="flex items-center gap-3 rounded-tile bg-panel p-2"
          >
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-background">
              {photo.previewUrl && (
                // A local object URL, so next/image optimisation does not apply.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  aria-hidden
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold" title={photo.name}>
                {photo.name}
              </p>
              <p className={`flex items-center gap-1.5 text-[13px] leading-snug ${stateTone(photo.state)}`}>
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${spinning ? 'animate-spin motion-reduce:animate-none' : ''}`}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="truncate">
                  {photo.state === 'error' ? errorLabel(photo) : t(`states.${photo.state}`)}
                </span>
              </p>
              {photo.state === 'uploading' && (
                <div
                  className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-background"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={photo.progress}
                  aria-label={t('states.uploading')}
                >
                  <div
                    className="h-full rounded-full bg-signature transition-[width] duration-200 motion-reduce:transition-none"
                    style={{ width: `${photo.progress}%` }}
                  />
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {photo.state === 'error' && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onRetry(photo.id)}
                  aria-label={t('retryOne', { name: photo.name })}
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden />
                  <span className="hidden sm:inline">{t('retry')}</span>
                </Button>
              )}
              {(!isTerminal(photo.state) || photo.state === 'error') && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  onClick={() => onRemove(photo.id)}
                  aria-label={t('removeOne', { name: photo.name })}
                >
                  <X className="h-4 w-4" strokeWidth={2} aria-hidden />
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
