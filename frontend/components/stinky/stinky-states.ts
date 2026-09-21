/**
 * Stinky (Miaurmario mascot) — animation states and asset paths.
 *
 * Assets live in /public/brand/stinky/head/ and were produced with the OneWorks Avatar SDK (MIT):
 * clips are the editor's built-in presets baked for Stinky, plus a custom "wave" clip. Mouth is a
 * pink ":3" made of surface decals; pupils are vertical slits (see stinky-pupils.ts).
 */

export const STINKY_STATES = ['idle', 'thinking', 'happy', 'wave', 'sleepy', 'sad'] as const
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
} as const satisfies Record<string, StinkyState>
export type StinkyStateAlias = keyof typeof STINKY_STATE_ALIASES
export type StinkyStateInput = StinkyState | StinkyStateAlias

export const resolveStinkyState = (state: StinkyStateInput): StinkyState =>
  (STINKY_STATES as readonly string[]).includes(state)
    ? (state as StinkyState)
    : STINKY_STATE_ALIASES[state as StinkyStateAlias]

export interface StinkyStateMeta {
  /** Clip length in ms (matches stinky.animations.json). */
  readonly durationMs: number
  /** `loop` states repeat forever; `once` states play and then settle (default: `idle`). */
  readonly playback: 'loop' | 'once'
  /** Mouth style baked into the definition used for this state. */
  readonly mouth: 'neutral' | 'happy'
  /** Suggested use inside the app. */
  readonly use: string
}

export const STINKY_STATE_META: Readonly<Record<StinkyState, StinkyStateMeta>> = {
  idle: { durationMs: 3400, playback: 'loop', mouth: 'neutral', use: 'Default: breathing, soft glance, blink' },
  thinking: { durationMs: 3400, playback: 'loop', mouth: 'neutral', use: 'Stylist is generating a look' },
  happy: { durationMs: 3200, playback: 'once', mouth: 'happy', use: 'User accepts a look' },
  wave: { durationMs: 2600, playback: 'once', mouth: 'happy', use: 'Login / onboarding greeting' },
  sleepy: { durationMs: 3400, playback: 'loop', mouth: 'neutral', use: 'Empty states' },
  sad: { durationMs: 3200, playback: 'once', mouth: 'neutral', use: 'Errors' },
}

export type StinkyVariant = 'light' | 'dark'

const BASE = '/brand/stinky/head'
const suffix = (variant: StinkyVariant) => (variant === 'dark' ? '-dark' : '')

export const stinkyAssets = (state: StinkyState, variant: StinkyVariant = 'light') => ({
  /** Animated WebP with alpha, 320px, infinite loop. */
  webp: `${BASE}/anim/stinky-${state}${suffix(variant)}.webp`,
  /** Representative still frame of the state (vector). */
  poster: `${BASE}/poster/stinky-${state}${suffix(variant)}.svg`,
  /** Same still frame as PNG (256px) — fallback when animated WebP is unsupported. */
  posterPng: `${BASE}/poster/stinky-${state}${suffix(variant)}.png`,
})

/** Neutral static head (vector) for places where no state applies. */
export const stinkyStaticSvg = (variant: StinkyVariant = 'light') => `${BASE}/stinky-head${suffix(variant)}.svg`

/** Editable OneWorks definition for a state (neutral or happy ":3"), used by the live renderer. */
export const stinkyDefinitionUrl = (state: StinkyState, variant: StinkyVariant = 'light') =>
  `${BASE}/stinky-head${STINKY_STATE_META[state].mouth === 'happy' ? '-happy' : ''}${suffix(variant)}.avatar.json`

export const STINKY_ANIMATIONS_URL = `${BASE}/stinky.animations.json`
