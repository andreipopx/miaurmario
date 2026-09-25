'use client';

/* eslint-disable @next/next/no-img-element -- a signed URL that next/image would re-sign away */

import { Shirt } from 'lucide-react';

import { garmentTileTint } from '@/lib/garment-tint';
import { cn } from '@/lib/utils';

/**
 * A garment on a plate the colour of the garment.
 *
 * Two kinds of image end up here and they need opposite treatment. A true cut-out
 * is transparent, so it simply sits on the tint. An older photo still has a white
 * background baked in, and `mix-blend-multiply` lets the tint show through that
 * white — multiplying a real cut-out instead would darken the garment itself.
 * `hasCutout` comes from the API (it reads the stored file's extension), so the
 * grid does not have to guess.
 *
 * With no colour recorded — which is every garment before it is tagged — the plate
 * falls back to the neutral panel, so an untagged wardrobe still reads as one
 * surface rather than as a patchwork.
 */
export function GarmentThumb({
  src,
  color,
  colorHex,
  hasCutout = false,
  quarterTurns = 0,
  className,
  alt = '',
  loading,
}: {
  src?: string | null;
  color?: string | null;
  /** A measured hex, when we have one; otherwise the named colour's swatch is used. */
  colorHex?: string | null;
  hasCutout?: boolean;
  /** Turns applied on the server that the cached image may not show yet. */
  quarterTurns?: number;
  className?: string;
  alt?: string;
  loading?: 'lazy' | 'eager';
}) {
  const tint = garmentTileTint(color, colorHex);

  return (
    <div className={cn('relative overflow-hidden', tint.className, className)} style={tint.style}>
      {src ? (
        <img
          src={src}
          alt={alt}
          aria-hidden={alt === '' ? true : undefined}
          loading={loading}
          className={cn(
            'h-full w-full object-contain p-2 transition-transform duration-200 motion-reduce:transition-none',
            !hasCutout && 'mix-blend-multiply'
          )}
          style={quarterTurns ? { transform: `rotate(${quarterTurns * 90}deg)` } : undefined}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted-foreground">
          <Shirt className="h-1/3 w-1/3" strokeWidth={1.5} aria-hidden />
        </span>
      )}
    </div>
  );
}
