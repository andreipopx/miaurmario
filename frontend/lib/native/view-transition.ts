'use client';

/**
 * Same-document View Transitions for route changes (Chromium 111+, Safari 18+).
 *
 * The App Router has no "navigation finished" promise, so the transition callback
 * resolves when NativeShell sees the new pathname, or after a short cap so a slow
 * network never freezes the screen (the new page then simply appears without the
 * cross-fade). Feature-detected, and skipped entirely for reduced motion.
 */

type StartViewTransition = (cb: () => Promise<void> | void) => { finished: Promise<void> };

const MAX_WAIT_MS = 180;
let pending: (() => void) | null = null;

export function supportsViewTransitions(): boolean {
  if (typeof document === 'undefined') return false;
  if (!('startViewTransition' in document)) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function navigateWithTransition(navigate: () => void) {
  if (!supportsViewTransitions() || pending) {
    navigate();
    return;
  }
  const start = (document as unknown as { startViewTransition: StartViewTransition }).startViewTransition.bind(document);
  start(
    () =>
      new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          pending = null;
          resolve();
        };
        pending = done;
        navigate();
        window.setTimeout(done, MAX_WAIT_MS);
      })
  ).finished.catch(() => {});
}

/** NativeShell calls this after a new pathname has rendered. */
export function routeRendered() {
  pending?.();
}
