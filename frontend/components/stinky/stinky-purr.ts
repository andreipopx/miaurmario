import { STINKY_PURR_VIBRATION } from './stinky-states'

/** Offsets (px) cycled at 25Hz — a soft, irregular rumble rather than a straight shake. */
const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 1], [0, -1], [1, 1], [-1, 0], [0, 1], [1, -1], [-1, -1],
]
const STEP_MS = 40 // 25 Hz

/**
 * Purr micro-vibration on the element that wraps Stinky. Timed relative to the start of the purr clip:
 * it runs only while the eyes are closed (STINKY_PURR_VIBRATION) and eases 1px → 2px → 1px.
 * Returns the Animation so callers can cancel it.
 */
export function startPurrVibration(el: HTMLElement | null): Animation | null {
  if (!el || typeof el.animate !== 'function') return null
  const { fromMs, toMs } = STINKY_PURR_VIBRATION
  const span = toMs - fromMs
  const steps = Math.round(span / STEP_MS)
  const keyframes: Keyframe[] = Array.from({ length: steps + 1 }, (_, i) => {
    if (i === 0 || i === steps) return { transform: 'translate(0px, 0px)' }
    const t = i * STEP_MS
    const amp = 1 + Math.min(1, t / 150, (span - t) / 150) // 1..2 px
    const [x, y] = OFFSETS[i % OFFSETS.length]!
    return { transform: `translate(${Math.round(x * amp)}px, ${Math.round(y * amp)}px)` }
  })
  return el.animate(keyframes, { delay: fromMs, duration: span, easing: `steps(${steps}, jump-none)` })
}
