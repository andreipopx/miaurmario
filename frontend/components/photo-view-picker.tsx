'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { ImageView } from '@/lib/types';

/** The three labels, in the order they read: the front, then its back, then a detail. */
export const IMAGE_VIEWS: readonly ImageView[] = ['front', 'back', 'detail'] as const;

/**
 * "¿Qué se ve en esta foto?" — delante, detrás, o un detalle.
 *
 * Real radio inputs behind the pills, not buttons: one choice out of three, arrow
 * keys for free, and a screen reader that says which of three is chosen instead of
 * reading three unrelated toggles. The inputs are visually hidden and the labels
 * are the targets, each a full 44 px tall.
 *
 * Saving is immediate and not a draft, like straightening a photo: a label is a
 * fact about the photo, and making the user press "guardar" for it would be asking
 * them to confirm something they already said.
 */
export function PhotoViewPicker({
  value,
  onChange,
  idPrefix,
  disabled = false,
  className,
  offer = IMAGE_VIEWS,
}: {
  value: ImageView;
  onChange: (next: ImageView) => void;
  /** Unique per photo, so two pickers on one screen do not share a radio group. */
  idPrefix: string;
  disabled?: boolean;
  className?: string;
  /**
   * Which labels to offer. All three by default; the merge dialog drops "delante",
   * because the garment being merged into already has its front.
   */
  offer?: readonly ImageView[];
}) {
  const t = useTranslations('imageViews');

  return (
    <fieldset className={cn('min-w-0', className)} disabled={disabled}>
      <legend className="mb-1.5 text-[13px] font-bold">{t('question')}</legend>
      <div className="flex min-w-0 flex-wrap gap-1.5" role="radiogroup" aria-label={t('question')}>
        {offer.map((view) => {
          const id = `${idPrefix}-view-${view}`;
          const active = value === view;
          return (
            <span key={view} className="min-w-0">
              <input
                type="radio"
                id={id}
                name={`${idPrefix}-view`}
                value={view}
                checked={active}
                onChange={() => onChange(view)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cn(
                  'flex min-h-[44px] min-w-0 cursor-pointer items-center rounded-full px-3.5',
                  'text-[14px] font-semibold transition-colors motion-reduce:transition-none',
                  'peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                  'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-panel text-foreground hover:bg-secondary'
                )}
              >
                <span className="min-w-0 truncate">{t(view)}</span>
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The short label for a photo's side, for a badge on the photo itself. */
export function useImageViewLabel() {
  const t = useTranslations('imageViews');
  return (view: ImageView | undefined | null) => t(view ?? 'front');
}
