'use client';

import { useEffect } from 'react';

export type SwipeDirection = 'down' | 'left';

interface Options {
  direction: SwipeDirection;
  onDismiss: () => void;
  enabled?: boolean;
  /** Only react on narrow screens (sheets are bottom sheets below `sm`). */
  maxWidth?: number;
}

const START_SLOP = 8;
const DISTANCE_RATIO = 0.3; // of the sheet's size
const MIN_DISTANCE = 90;
const FLING_VELOCITY = 0.6; // px/ms
const SNAP_MS = 200;

/** Elements whose own touch handling must win (sliders, drag-and-drop, text entry, carousels). */
const IGNORE =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [data-no-swipe], [data-dnd-draggable], [aria-roledescription="draggable"]';

function scrolledAncestor(target: Element | null, root: HTMLElement, direction: SwipeDirection): boolean {
  for (let el = target; el && el !== root.parentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (direction === 'down') {
      const scrollable = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
      if (scrollable && el.scrollTop > 0) return true;
    } else {
      const scrollable = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
      if (scrollable) return true; // horizontal scrollers own horizontal swipes
    }
    if (el === root) break;
  }
  return false;
}

/**
 * Drag-to-dismiss for sheets and drawers on touch screens: follows the finger 1:1,
 * dismisses past ~30% (or on a fling), otherwise springs back. Only starts when the
 * content under the finger is scrolled to the top (so scrolling a long sheet still
 * works) and never steals gestures from inputs, sliders or drag-and-drop.
 */
export function useSwipeDismiss(
  el: HTMLElement | null,
  { direction, onDismiss, enabled = true, maxWidth }: Options
) {
  useEffect(() => {
    if (!el || !enabled) return;
    if (typeof window === 'undefined' || !('ontouchstart' in window || navigator.maxTouchPoints > 0)) return;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let state: 'idle' | 'pending' | 'dragging' = 'idle';
    let offset = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const apply = (px: number) => {
      el.style.transform = direction === 'down' ? `translate3d(0, ${px}px, 0)` : `translate3d(${-px}px, 0, 0)`;
    };
    const reset = () => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.animation = '';
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (maxWidth && window.innerWidth > maxWidth) return;
      const target = e.target as Element | null;
      if (target?.closest(IGNORE)) return;
      if (scrolledAncestor(target, el, direction)) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = performance.now();
      offset = 0;
      state = 'pending';
    };

    const onMove = (e: TouchEvent) => {
      if (state === 'idle') return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (state === 'pending') {
        if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return;
        const ok = direction === 'down' ? dy > 0 && Math.abs(dy) > Math.abs(dx) : dx < 0 && Math.abs(dx) > Math.abs(dy);
        if (!ok) {
          state = 'idle';
          return;
        }
        state = 'dragging';
        el.style.transition = 'none';
        el.style.animation = 'none';
      }
      e.preventDefault(); // we own this gesture now: no scroll underneath
      offset = Math.max(0, direction === 'down' ? dy : -dx);
      apply(offset);
    };

    const onEnd = () => {
      if (state !== 'dragging') {
        state = 'idle';
        return;
      }
      state = 'idle';
      const size = direction === 'down' ? el.offsetHeight : el.offsetWidth;
      const velocity = offset / Math.max(1, performance.now() - startT);
      const dismiss = offset > Math.max(MIN_DISTANCE, size * DISTANCE_RATIO) || (velocity > FLING_VELOCITY && offset > 24);
      if (dismiss) {
        el.style.transition = reduced ? 'none' : `transform ${SNAP_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
        apply(size + 40);
        window.setTimeout(
          () => {
            onDismiss();
            // Drawers animate out via their own classes; sheets unmount (animation: none skips
            // the exit keyframes). If something vetoed the close, put it back.
            if (direction === 'left') window.requestAnimationFrame(reset);
            else window.setTimeout(() => el.isConnected && reset(), 400);
          },
          reduced ? 0 : SNAP_MS
        );
      } else {
        el.style.transition = `transform ${SNAP_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
        apply(0);
        window.setTimeout(reset, SNAP_MS);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [el, direction, onDismiss, enabled, maxWidth]);
}
