import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { haptic, hapticSupport, prefersReducedMotion, resetHaptics, tapOffsets } from '@/lib/native/haptics';
import { STINKY_PET_VIBRATION } from '@/components/stinky/stinky-pet';

const PURR = STINKY_PET_VIBRATION.purr;

/** jsdom has neither `navigator.vibrate` nor the iOS `switch` attribute, so both are installed per test. */
function withVibrate(impl: (pattern: number | number[]) => boolean = () => true) {
  const spy = vi.fn(impl);
  Object.defineProperty(navigator, 'vibrate', { value: spy, configurable: true, writable: true });
  return spy;
}

function removeVibrate() {
  // @ts-expect-error -- jsdom lets us drop the property again
  delete navigator.vibrate;
}

function withSwitchSupport() {
  Object.defineProperty(HTMLInputElement.prototype, 'switch', { value: false, configurable: true, writable: true });
}

function removeSwitchSupport() {
  // @ts-expect-error -- only defined by withSwitchSupport()
  delete HTMLInputElement.prototype.switch;
}

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
}

const hiddenSwitch = () => document.querySelector<HTMLInputElement>('input[data-haptic-switch]');

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
});

afterEach(() => {
  resetHaptics();
  removeVibrate();
  removeSwitchSupport();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('haptic() branching', () => {
  it('uses the Vibration API when it exists (Android/Chromium)', () => {
    const vibrate = withVibrate();
    withSwitchSupport(); // even if both are available, vibrate wins

    expect(haptic(PURR)).toBe('vibrate');
    expect(vibrate).toHaveBeenCalledWith([...PURR]);
    expect(hiddenSwitch()).toBeNull();
  });

  it('passes a single duration straight through', () => {
    const vibrate = withVibrate();
    expect(haptic(8)).toBe('vibrate');
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it('reports none when the Vibration API refuses the pattern', () => {
    withVibrate(() => false);
    expect(haptic(PURR)).toBe('none');
  });

  it('falls back to toggling a hidden iOS switch when there is no vibrate', () => {
    removeVibrate();
    withSwitchSupport();

    expect(haptic(PURR)).toBe('switch');
    const el = hiddenSwitch();
    expect(el).not.toBeNull();
    expect(el!.type).toBe('checkbox');
    expect(el!.hasAttribute('switch')).toBe(true);
    // Hidden from assistive tech and from the pointer, and out of the tab order.
    expect(el!.getAttribute('aria-hidden')).toBe('true');
    expect(el!.tabIndex).toBe(-1);
    expect(el!.style.pointerEvents).toBe('none');
  });

  it('toggles once per "on" segment, reusing the same element', () => {
    removeVibrate();
    withSwitchSupport();

    haptic(PURR);
    const el = hiddenSwitch()!;
    // purr is [15,30,15,30,15,30,15] → taps at 0/45/90/135ms; the first one fires synchronously.
    expect(el.checked).toBe(true);
    const clicks = vi.spyOn(el, 'click');
    vi.advanceTimersByTime(1000);
    expect(clicks).toHaveBeenCalledTimes(tapOffsets(PURR).length - 1);

    haptic(PURR);
    expect(document.querySelectorAll('input[data-haptic-switch]')).toHaveLength(1);
  });

  it('does nothing when neither mechanism exists', () => {
    removeVibrate();
    removeSwitchSupport();

    expect(haptic(PURR)).toBe('none');
    expect(hiddenSwitch()).toBeNull();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });

  it('never throws when the Vibration API does', () => {
    withVibrate(() => {
      throw new Error('nope');
    });
    expect(haptic(PURR)).toBe('none');
  });

  it('stays quiet with Reduce Motion on, whatever the device supports', () => {
    setReducedMotion(true);
    const vibrate = withVibrate();
    withSwitchSupport();

    expect(prefersReducedMotion()).toBe(true);
    expect(haptic(PURR)).toBe('none');
    expect(vibrate).not.toHaveBeenCalled();
    expect(hiddenSwitch()).toBeNull();
  });
});

describe('hapticSupport()', () => {
  it('names the mechanism this device would use', () => {
    withVibrate();
    expect(hapticSupport()).toBe('vibrate');
    removeVibrate();
    withSwitchSupport();
    expect(hapticSupport()).toBe('switch');
    removeSwitchSupport();
    expect(hapticSupport()).toBe('none');
  });
});

describe('tapOffsets()', () => {
  it('taps at the start of every "on" segment', () => {
    expect(tapOffsets([15, 30, 15, 30, 15, 30, 15])).toEqual([0, 45, 90, 135]);
    expect(tapOffsets([20, 40, 20])).toEqual([0, 60]);
    expect(tapOffsets(8)).toEqual([0]);
  });

  it('caps the number of taps and the total span, and drops taps that are too close together', () => {
    const many = Array.from({ length: 40 }, () => 50);
    expect(tapOffsets(many).length).toBeLessThanOrEqual(4);
    expect(Math.max(...tapOffsets(many))).toBeLessThanOrEqual(400);
    // 5ms apart is below the engine's resolution: only the first tap survives that burst.
    expect(tapOffsets([1, 4, 1, 4, 1, 300, 1])).toEqual([0, 311]);
  });

  it('survives nonsense patterns', () => {
    expect(tapOffsets([])).toEqual([0]);
    expect(tapOffsets([-5, NaN, Infinity])).toEqual([0]);
  });
});
