'use client';

/* eslint-disable @next/next/no-img-element -- tiny static SVG, no optimisation needed */

import { cn } from '@/lib/utils';
import { stinkyStaticSvg } from '@/components/stinky/stinky-states';

/**
 * Static Stinky head in a circle — used as the profile avatar in the header,
 * the sidebar and small "Stinky says" bubbles. Static on purpose: an always-on
 * animation in chrome that is visible on every page is distracting.
 */
export function StinkyAvatar({
  size = 44,
  className,
  label = '',
}: {
  size?: number;
  className?: string;
  /** Accessible name; empty (default) marks it decorative. */
  label?: string;
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel', className)}
      style={{ width: size, height: size }}
    >
      {/* Both looks, chosen by the theme class before any script runs (no light flash). */}
      {(['light', 'dark'] as const).map((variant) => (
        <img
          key={variant}
          src={stinkyStaticSvg(variant)}
          alt=""
          aria-hidden
          width={size}
          height={size}
          draggable={false}
          className={cn(
            'h-[112%] w-[112%] max-w-none translate-y-[4%] select-none object-contain',
            variant === 'light' ? 'block dark:hidden' : 'hidden dark:block'
          )}
        />
      ))}
    </span>
  );
}
