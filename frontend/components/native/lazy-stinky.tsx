'use client';

import { useEffect, useRef, useState } from 'react';
import { Stinky, type StinkyProps } from '@/components/stinky/stinky';
import { cn } from '@/lib/utils';

/**
 * <Stinky> that only animates (fetches + decodes its animated WebP) while it is on or
 * near the screen, and while the tab is visible. Otherwise it holds the still neutral
 * head, which is frame 0 of every clip, so starting again is a clean cut.
 */
export function LazyStinky({ className, ...props }: StinkyProps) {
  const size = props.size ?? 128;
  const hostRef = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

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

  return (
    <span
      ref={hostRef}
      className={cn('inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <Stinky {...props} size={size} paused={!(near && pageVisible)} />
    </span>
  );
}
