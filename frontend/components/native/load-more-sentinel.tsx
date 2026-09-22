'use client';

import { useEffect, useRef } from 'react';

/**
 * Invisible marker that calls `onVisible` when it scrolls within ~600px of the viewport,
 * turning a "Load more" button into infinite scroll. Keep the button next to it as the
 * keyboard / no-IntersectionObserver fallback.
 */
export function LoadMoreSentinel({ onVisible, enabled }: { onVisible: () => void; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) cb.current();
      },
      { rootMargin: '600px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  return <div ref={ref} aria-hidden className="h-px w-full" />;
}
