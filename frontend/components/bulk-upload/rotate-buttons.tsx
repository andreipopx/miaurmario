'use client';

import { useTranslations } from 'next-intl';
import { Loader2, RotateCcw, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Straighten a garment that is already in the wardrobe.
 *
 * Wherever this appears the turn is saved the moment it is pressed, so it says so
 * ("Girada y guardada") instead of leaving the user to wonder. Both targets are
 * 44 px, because this is a thing people do with a thumb.
 */
export function RotateButtons({
  onRotate,
  busy = false,
  className,
  size = 'md',
}: {
  onRotate: (direction: 'cw' | 'ccw') => void;
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
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onRotate(direction);
          }}
          aria-label={t(direction === 'cw' ? 'rotateRight' : 'rotateLeft')}
          title={t(direction === 'cw' ? 'rotateRight' : 'rotateLeft')}
        >
          {busy ? (
            <Loader2 className={cn('animate-spin motion-reduce:animate-none', glyph)} aria-hidden />
          ) : direction === 'cw' ? (
            <RotateCw className={glyph} strokeWidth={2} aria-hidden />
          ) : (
            <RotateCcw className={glyph} strokeWidth={2} aria-hidden />
          )}
        </Button>
      ))}
    </div>
  );
}
