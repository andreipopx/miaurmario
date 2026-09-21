/**
 * Stinky (Miaurmario mascot) — animation states and asset paths.
 *
 * Assets live in /public/brand/stinky/head/ and were produced with the OneWorks Avatar SDK (MIT):
 * clips are the editor's built-in presets baked for Stinky plus custom "wave" and "purr" clips.
 * Every clip starts and ends on the exact same neutral frame (idle frame 0), so any clip can follow
 * any other without a visible jump.
 */

export const STINKY_STATES = ['idle', 'thinking', 'happy', 'wave', 'sleepy', 'sad', 'purr'] as const
export type StinkyState = (typeof STINKY_STATES)[number]

/** Former/extra state names, mapped onto a shipped state. */
export const STINKY_STATE_ALIASES = {
  working: 'thinking',
  curious: 'thinking',
  surprised: 'happy',
  laughing: 'happy',
  celebrate: 'happy',
  wink: 'happy',
  error: 'sad',
  empty: 'sleepy',
  hello: 'wave',
  pet: 'purr',
} as const satisfies Record<string, StinkyState>
export type StinkyStateAlias = keyof typeof STINKY_STATE_ALIASES
export type StinkyStateInput = StinkyState | StinkyStateAlias

export const resolveStinkyState = (state: StinkyStateInput): StinkyState =>
  (STINKY_STATES as readonly string[]).includes(state)
    ? (state as StinkyState)
    : STINKY_STATE_ALIASES[state as StinkyStateAlias]

export interface StinkyStateMeta {
  /** Clip length in ms — identical to `durationMs` in stinky.animations.json and to the WebP length. */
  readonly durationMs: number
  /** `loop` states repeat forever; `once` states play and then settle (default: `idle`). */
  readonly playback: 'loop' | 'once'
  /** Suggested use inside the app. */
  readonly use: string
}

export const STINKY_STATE_META: Readonly<Record<StinkyState, StinkyStateMeta>> = {
  idle: { durationMs: 3350, playback: 'loop', use: 'Default: breathing, soft glance, blink' },
  thinking: { durationMs: 3350, playback: 'loop', use: 'Stylist is generating a look' },
  happy: { durationMs: 3350, playback: 'once', use: 'User accepts a look' },
  wave: { durationMs: 2700, playback: 'once', use: 'Login / onboarding greeting' },
  sleepy: { durationMs: 3350, playback: 'loop', use: 'Empty states' },
  sad: { durationMs: 3350, playback: 'once', use: 'Errors' },
  purr: { durationMs: 2600, playback: 'once', use: 'User pets Stinky (tap/click)' },
}

/** Most likely next clip(s) for each state — preloaded so switching never flashes. */
export const STINKY_LIKELY_NEXT: Readonly<Record<StinkyState, readonly StinkyState[]>> = {
  idle: ['purr', 'thinking'],
  thinking: ['happy', 'sad'],
  happy: ['idle'],
  wave: ['idle'],
  sleepy: ['idle'],
  sad: ['idle'],
  purr: ['idle'],
}

export type StinkyVariant = 'light' | 'dark'

const BASE = '/brand/stinky/head'
const suffix = (variant: StinkyVariant) => (variant === 'dark' ? '-dark' : '')

export const stinkyAssets = (state: StinkyState, variant: StinkyVariant = 'light') => ({
  /** Animated WebP with alpha, 512px, infinite loop. */
  webp: `${BASE}/anim/stinky-${state}${suffix(variant)}.webp`,
  /** Representative still frame of the state (vector). */
  poster: `${BASE}/poster/stinky-${state}${suffix(variant)}.svg`,
  /** Same still frame as PNG (512px) — fallback when animated WebP is unsupported. */
  posterPng: `${BASE}/poster/stinky-${state}${suffix(variant)}.png`,
})

/** Neutral static head (vector) — identical to the first/last frame of every clip. */
export const stinkyStaticSvg = (variant: StinkyVariant = 'light') => `${BASE}/stinky-head${suffix(variant)}.svg`

export type StinkyMouth = 'neutral' | 'open'

/**
 * Editable OneWorks definitions per variant. `neutral` has the pink ":3"; `open` replaces it with the open mouth
 * (same everything else). Stinky only ever shows ONE mouth: happy/wave swap to `open` inside their mouth window.
 */
export const stinkyDefinitionUrl = (variant: StinkyVariant = 'light', mouth: StinkyMouth = 'neutral') =>
  `${BASE}/stinky-head${mouth === 'open' ? '-open' : ''}${suffix(variant)}.avatar.json`

/** Clip-time windows [from, to) in ms where the open mouth replaces the ":3" (pre-rendered assets use the same). */
export const STINKY_MOUTH_OPEN_WINDOWS: Partial<Record<StinkyState, readonly [number, number]>> = {
  happy: [300, 2950],
  wave: [200, 1900],
}
export const stinkyMouthAt = (state: StinkyState, clipMs: number): StinkyMouth => {
  const w = STINKY_MOUTH_OPEN_WINDOWS[state]
  return w && clipMs >= w[0] && clipMs < w[1] ? 'open' : 'neutral'
}

export const STINKY_ANIMATIONS_URL = `${BASE}/stinky.animations.json`

/** Window (ms) of the purr clip in which the pre-rendered frames vibrate; the live renderer mirrors it. */
export const STINKY_PURR_VIBRATION = { fromMs: 800, toMs: 1950 } as const
