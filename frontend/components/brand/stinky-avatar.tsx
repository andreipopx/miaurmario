'use client';

/* eslint-disable @next/next/no-img-element -- tiny static SVG, no optimisation needed */

import { cn } from '@/lib/utils';
import { stinkyStaticSvg } from '@/components/stinky/stinky-states';
import { useStinkyPersona } from '@/components/stinky/stinky-persona';
import { StinkyAccessoryOverlay } from '@/components/stinky/stinky-accessory';
import { StinkySvg } from '@/components/stinky/stinky-svg';
import { FEATURES } from '@/lib/features';

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
  // Their own Stinky (Ajustes → Tu Stinky).
  const { coat, eyes, accessory } = useStinkyPersona();
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel', className)}
      style={{ width: size, height: size }}
    >
      {FEATURES.svgStinky ? (
        // The vector rig in its neutral pose (it draws the accessory itself), framed like the picture below.
        <StinkySvg paused interactive={false} label="" size={Math.round(size * 1.12)} className="translate-y-[4%]" />
      ) : (
        <>
          {/* Both looks, chosen by the theme class before any script runs (no light flash). */}
          {(['light', 'dark'] as const).map((variant) => (
            <img
              key={variant}
              src={stinkyStaticSvg(variant, { coat, eyes })}
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
          {/* Same box as the head picture above (112 %, nudged down), so it sits under the chin. */}
          <StinkyAccessoryOverlay
            accessory={accessory}
            className="pointer-events-none absolute left-1/2 top-1/2 h-[112%] w-[112%] max-w-none -translate-x-1/2 -translate-y-[46%]"
          />
        </>
      )}
    </span>
  );
}
