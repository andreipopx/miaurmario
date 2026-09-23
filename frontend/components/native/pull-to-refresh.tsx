'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Stinky } from '@/components/stinky/stinky';
import { haptic } from '@/lib/native/haptics';

const THRESHOLD = 72; // px of (damped) pull that triggers a refresh
const MAX_PULL = 120;
const HOLD_AT = 64; // where the spinner rests while refreshing
const MIN_SPIN_MS = 600; // long enough to read as "it did something"

type Phase = 'idle' | 'pulling' | 'refreshing';

/**
 * Lightweight pull-to-refresh for the page scroller (touch only). Stinky "thinking"
 * is the spinner. Passive listeners only — the native rubber band is already off
 * (body { overscroll-behavior-y: none }), so nothing has to be preventDefault'ed and
 * scrolling stays on the compositor. Refetches every active query by default.
 *
 * Ignored when: not at the top, a dialog/sheet is open, the gesture starts
 * horizontally (carousels), or the touch starts in an input.
 */
export function PullToRefresh({ onRefresh }: { onRefresh?: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const t = useTranslations('pwa');
  const [phase, setPhase] = useState<Phase>('idle');
  const [pull, setPull] = useState(0);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(pointer: coarse)').matches && !('ontouchstart' in window)) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let decided = false;
    let distance = 0;
    let frame = 0;

    const blocked = (target: EventTarget | null) => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
      const el = target instanceof Element ? target : null;
      return !!el?.closest('input, textarea, select, [contenteditable="true"], [data-no-ptr]');
    };

    const onStart = (e: TouchEvent) => {
      if (phaseRef.current === 'refreshing' || e.touches.length !== 1) return;
      if (window.scrollY > 0 || blocked(e.target)) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
      decided = false;
      distance = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        decided = true;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) {
          tracking = false;
          return;
        }
        setPhase('pulling');
      }
      // Rubber-band damping: the further you pull, the less it moves.
      distance = Math.min(MAX_PULL, Math.max(0, dy) * 0.5);
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setPull(distance);
        });
      }
    };

    const onEnd = async () => {
      if (!tracking) return;
      tracking = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (distance < THRESHOLD) {
        setPull(0);
        setPhase('idle');
        return;
      }
      setPhase('refreshing');
      setPull(HOLD_AT);
      haptic(8);
      const started = Date.now();
      try {
        await (refreshRef.current ? refreshRef.current() : queryClient.refetchQueries({ type: 'active' }));
      } finally {
        const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - started));
        window.setTimeout(() => {
          setPull(0);
          setPhase('idle');
        }, wait);
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [queryClient]);

  const visible = phase !== 'idle' || pull > 0;
  const progress = Math.min(1, pull / THRESHOLD);
  const armed = pull >= THRESHOLD || phase === 'refreshing';

  return (
    <div
      aria-hidden={!visible}
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center lg:left-64"
      style={{ top: 'calc(4rem + env(safe-area-inset-top))' }}
    >
      <div
        role="status"
        aria-live="polite"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-background shadow-[0_6px_20px_rgba(0,0,0,0.14)] motion-safe:transition-transform motion-safe:duration-200"
        style={{
          transform: `translateY(${pull - 48}px) scale(${0.6 + 0.4 * progress})`,
          opacity: visible ? Math.max(0.25, progress) : 0,
          transitionDuration: phase === 'pulling' ? '0ms' : undefined,
        }}
      >
        {visible && <Stinky state={armed ? 'thinking' : 'idle'} size={34} interactive={false} label="" />}
        <span className="sr-only">{phase === 'refreshing' ? t('refreshing') : ''}</span>
      </div>
    </div>
  );
}
