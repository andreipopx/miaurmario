'use client';

/* eslint-disable @next/next/no-img-element -- tiny static SVG poster */

import { useEffect, useRef, useState } from 'react';
import { Stinky, type StinkyProps } from '@/components/stinky/stinky';
import { resolveStinkyState, stinkyAssets } from '@/components/stinky/stinky-states';
import { useStinkyVariant } from '@/components/stinky/use-stinky-env';
import { cn } from '@/lib/utils';

/**
 * <Stinky> that only exists (fetches + decodes its ~300KB animated WebP) while it is on
 * or near the screen, and while the tab is visible. Off-screen it is the static SVG
 * poster of the same state at the same size, so nothing shifts. Wraps components/stinky
 * from the outside; the mascot itself is untouched.
 */
export function LazyStinky({ className, ...props }: StinkyProps) {
  const size = props.size ?? 128;
  const hostRef = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const variant = useStinkyVariant(props.variant);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver !== 'function') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setNear(entry?.isIntersecting ?? true), {
      rootMargin: '200px 0px',
    });
    io.observe(host);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onVis = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const live = near && pageVisible;
  return (
    <span
      ref={hostRef}
      className={cn('inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {live ? (
        <Stinky {...props} size={size} />
      ) : (
        <img
          src={stinkyAssets(resolveStinkyState(props.state ?? 'idle'), variant).poster}
          alt={props.label ?? ''}
          width={size}
          height={size}
          draggable={false}
          className="h-full w-full"
        />
      )}
    </span>
  );
}
