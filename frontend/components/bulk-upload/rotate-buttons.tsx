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
  const box = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11';
  const glyph = size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]';

  return (
    <div className={cn('flex items-center gap-1.5', className)} role="group" aria-label={t('straighten')}>
      {(['ccw', 'cw'] as const).map((direction) => (
        <Button
          key={direction}
          type="button"
          size="icon"
          variant="secondary"
          className={cn('shrink-0', box)}
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
      {busy && (
        <Loader2
          className={cn('shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none', glyph)}
          aria-label={t('saving')}
        />
      )}
    </div>
  );
}
