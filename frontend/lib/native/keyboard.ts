'use client';

import { useSyncExternalStore } from 'react';

/**
 * On-screen keyboard state for iOS Safari / standalone and Android Chromium (incl. Huawei).
 *
 * Two browser behaviours to cover:
 * - "resizes-visual" (iOS, Chrome ≥108): the layout viewport keeps its height, the visual
 *   viewport shrinks → `inset` = layout bottom − visual bottom (what fixed UI must lift by).
 * - "resizes-content" (older Chromium, some Huawei builds): the whole layout shrinks, so
 *   fixed-bottom UI already sits on the keyboard → `inset` stays 0 but `open` is true.
 */
export interface KeyboardState {
  open: boolean;
  /** Pixels between the bottom of the layout viewport and the top of the keyboard. */
  inset: number;
}

const CLOSED: KeyboardState = { open: false, inset: 0 };
let state: KeyboardState = CLOSED;
const listeners = new Set<() => void>();

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !['checkbox', 'radio', 'range', 'file', 'color', 'button', 'submit', 'reset'].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

function set(next: KeyboardState) {
  if (next.open === state.open && next.inset === state.inset) return;
  state = next;
  if (typeof document !== 'undefined') {
    if (next.open) document.documentElement.dataset.keyboard = 'open';
    else delete document.documentElement.dataset.keyboard;
  }
  listeners.forEach((l) => l());
}

let started = false;
/** Starts the global listeners once (called by NativeShell). Returns a cleanup. */
export function startKeyboardTracking(): () => void {
  if (started || typeof window === 'undefined' || !window.visualViewport) return () => {};
  started = true;
  const vv = window.visualViewport;
  let baseline = window.innerHeight;
  let frame = 0;

  const measure = () => {
    frame = 0;
    const editing = isEditable(document.activeElement);
    if (!editing) {
      baseline = Math.max(window.innerHeight, vv.height);
      set(CLOSED);
      return;
    }
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const shrunk = baseline - vv.height > 150;
    set({ open: inset > 80 || shrunk, inset: inset > 80 ? inset : 0 });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const onOrientation = () => {
    baseline = window.innerHeight;
    schedule();
  };
  // Focus changes land before the viewport animates; re-measure a bit later too.
  const onFocus = () => {
    schedule();
    window.setTimeout(schedule, 350);
  };

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  window.addEventListener('orientationchange', onOrientation);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onFocus);
  measure();

  return () => {
    started = false;
    if (frame) cancelAnimationFrame(frame);
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    window.removeEventListener('orientationchange', onOrientation);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onFocus);
    set(CLOSED);
  };
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useKeyboard(): KeyboardState {
  return useSyncExternalStore(subscribe, () => state, () => CLOSED);
}
