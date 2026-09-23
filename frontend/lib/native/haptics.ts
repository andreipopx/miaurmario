'use client';

/**
 * Haptics with an iOS fallback.
 *
 * Android/Chromium expose the Vibration API, so `navigator.vibrate` runs the pattern as-is.
 * iOS Safari has no Vibration API at all, but since iOS 17.4 toggling a native switch control
 * (`<input type="checkbox" switch>`, a Safari-only attribute) plays a system haptic tap. We keep
 * one hidden, inert switch in the document and click it once per "on" segment of the pattern.
 *
 * The trick is undocumented and unreliable (it needs iOS 17.4+, the Taptic engine, and Safari may
 * skip it outside a user gesture or with Reduce Motion / system haptics off), so everything here is
 * best-effort: it never throws, it degrades to doing nothing and callers can ignore the result.
 */

/** A `navigator.vibrate` pattern: one duration, or alternating on/off durations (ms). */
export type HapticPattern = number | readonly number[];

/** What actually happened (or would happen): the Vibration API, the iOS switch trick, or nothing. */
export type HapticOutcome = 'vibrate' | 'switch' | 'none';

/** Most switch taps we fire for one pattern — the trick is a tap, not a rumble; more just annoys. */
const MAX_TAPS = 4;
/** Hard cap on how long a pattern may keep firing taps. */
const MAX_SPAN_MS = 400;
/** Taps closer than this are indistinguishable on the Taptic engine, so we drop them. */
const MIN_GAP_MS = 40;

let switchEl: HTMLInputElement | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];

/** `true` when the user asked the OS to reduce motion (haptics included). SSR-safe. */
export function prefersReducedMotion(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Safari 17.4+ ships the `switch` attribute on checkboxes; the IDL property is the feature flag. */
function canSwitch(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    return 'switch' in document.createElement('input');
  } catch {
    return false;
  }
}

/**
 * The hidden switch: focusable enough for Safari to treat it as a real control, but invisible,
 * not announced by screen readers, out of the tab order and impossible to hit with a pointer.
 */
function ensureSwitch(): HTMLInputElement | null {
  if (switchEl?.isConnected) return switchEl;
  try {
    if (typeof document === 'undefined' || !document.body || !canSwitch()) return null;
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.setAttribute('switch', '');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-haptic-switch', '');
    el.tabIndex = -1;
    el.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;margin:0;padding:0;border:0;' +
      'pointer-events:none;z-index:-1;transform:translateZ(0)';
    document.body.appendChild(el);
    switchEl = el;
    return el;
  } catch {
    return null;
  }
}

/** Offsets (ms from now) at which to tap, derived from the "on" segments of a vibrate pattern. */
export function tapOffsets(pattern: HapticPattern): number[] {
  const segments = (typeof pattern === 'number' ? [pattern] : [...pattern]).map((n) =>
    Number.isFinite(n) && n > 0 ? n : 0
  );
  const offsets: number[] = [];
  let at = 0;
  let last = -Infinity;
  for (let i = 0; i < segments.length; i += 2) {
    if (at > MAX_SPAN_MS || offsets.length >= MAX_TAPS) break;
    if (at - last >= MIN_GAP_MS || offsets.length === 0) {
      offsets.push(at);
      last = at;
    }
    at += (segments[i] ?? 0) + (segments[i + 1] ?? 0);
  }
  return offsets.length ? offsets : [0];
}

/** Cancels the switch taps still queued from a previous call. */
function clearPending() {
  timers.forEach(clearTimeout);
  timers = [];
}

/** What a `haptic()` call would do right now, ignoring Reduce Motion. */
export function hapticSupport(): HapticOutcome {
  if (canVibrate()) return 'vibrate';
  if (canSwitch()) return 'switch';
  return 'none';
}

/**
 * Plays `pattern` on the device: the Vibration API where it exists, the iOS switch tap otherwise.
 * Does nothing (and returns `'none'`) with Reduce Motion on or with neither mechanism available.
 * Call it from a user gesture — iOS may ignore haptics fired on their own.
 */
export function haptic(pattern: HapticPattern): HapticOutcome {
  if (prefersReducedMotion()) return 'none';
  try {
    if (canVibrate()) {
      const ok = navigator.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
      return ok === false ? 'none' : 'vibrate';
    }
    const el = ensureSwitch();
    if (!el) return 'none';
    clearPending();
    const offsets = tapOffsets(pattern);
    for (const offset of offsets) {
      if (offset === 0) {
        el.click();
        continue;
      }
      timers.push(
        setTimeout(() => {
          try {
            el.click();
          } catch {
            /* the element went away: nothing to do */
          }
        }, offset)
      );
    }
    return 'switch';
  } catch {
    return 'none';
  }
}

/** Stops any queued taps and drops the hidden switch (tests, teardown). */
export function resetHaptics() {
  clearPending();
  try {
    switchEl?.remove();
  } catch {
    /* already gone */
  }
  switchEl = null;
}
