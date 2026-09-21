'use client';

/* eslint-disable @next/next/no-img-element -- tiny static SVG, no optimisation needed */

import { cn } from '@/lib/utils';
import { stinkyStaticSvg } from '@/components/stinky/stinky-states';
import { useStinkyVariant } from '@/components/stinky/use-stinky-env';

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
  const variant = useStinkyVariant();
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel', className)}
      style={{ width: size, height: size }}
    >
      <img
        src={stinkyStaticSvg(variant)}
        alt={label}
        aria-hidden={label === '' || undefined}
        width={size}
        height={size}
        draggable={false}
        className="block h-[112%] w-[112%] max-w-none translate-y-[4%] select-none object-contain"
      />
    </span>
  );
}
