'use client';

import { useTranslations } from 'next-intl';
import { Loader2, RotateCcw, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Straighten a garment that is already in the wardrobe.
 *
 * The turn happens on screen the moment it is pressed and is saved behind the user's
 * back, so **`busy` does not disable anything**: it used to, and that is precisely
 * what made rotating a batch painful — every tap bought a wait before the next one
 * was allowed. It now only shows, quietly, that the last turn is still being written.
 * Both targets are 44 px, because this is a thing people do with a thumb.
 */
export function RotateButtons({
  onRotate,
  busy = false,
  className,
  size = 'md',
}: {
  onRotate: (direction: 'cw' | 'ccw') => void;
  /** A save still in the air. Shown, never enforced. */
  busy?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('imageCrop');
  // `sm` is a smaller *glyph*, not a smaller target. It used to be 36 px, which made
  // the docstring above untrue on the one screen where straightening matters most —
  // the review grid, where every photo comes out of a phone lying on its side.
  const glyph = size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]';

  return (
    <div className={cn('flex items-center gap-1.5', className)} role="group" aria-label={t('straighten')}>
      {(['ccw', 'cw'] as const).map((direction) => (
        <Button
          key={direction}
          type="button"
          size="icon"
          variant="secondary"
          className={cn('h-11 w-11 shrink-0')}
          onClick={(event) => {
            event.stopPropagation();
            onRotate(direction);
          }}
          aria-label={t(direction === 'cw' ? 'rotateRight' : 'rotateLeft')}
          title={t(direction === 'cw' ? 'rotateRight' : 'rotateLeft')}
        >
          {direction === 'cw' ? (
            <RotateCw className={glyph} strokeWidth={2} aria-hidden />
          ) : (
            <RotateCcw className={glyph} strokeWidth={2} aria-hidden />
          )}
        </Button>
      ))}
      {/* An `aria-label` on a bare svg is announced by nothing, so "guardando el
          giro" was sighted-only. A live region says it instead. */}
      {busy && (
        <span role="status" className="flex shrink-0 items-center">
          <Loader2
            className={cn(
              'shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none',
              glyph
            )}
            aria-hidden
          />
          <span className="sr-only">{t('saving')}</span>
        </span>
      )}
    </div>
  );
}
