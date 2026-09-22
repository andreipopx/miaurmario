/**
 * Stinky (Miaurmario mascot) — animation states and asset paths.
 *
 * Assets live in /public/brand/stinky/head/ and were produced with the OneWorks Avatar SDK (MIT):
 * clips are the editor's built-in presets baked for Stinky plus custom "wave" and "purr" clips.
 * Every clip starts and ends on the exact same neutral frame (idle frame 0), so any clip can follow
 * any other without a visible jump.
 */

export const STINKY_STATES = ['idle', 'thinking', 'happy', 'wave', 'sleepy', 'sad', 'purr', 'bite'] as const
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
  nibble: 'bite',
  chomp: 'bite',
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
  bite: { durationMs: 1500, playback: 'once', use: 'User pets Stinky: playful nibble (alternative to purr)' },
}

/** Most likely next clip(s) for each state — preloaded so switching never flashes. */
export const STINKY_LIKELY_NEXT: Readonly<Record<StinkyState, readonly StinkyState[]>> = {
  idle: ['purr', 'bite', 'thinking'],
  thinking: ['happy', 'sad'],
  happy: ['idle'],
  wave: ['idle'],
  sleepy: ['idle'],
  sad: ['idle'],
  purr: ['idle'],
  bite: ['idle'],
}

export type StinkyVariant = 'light' | 'dark'

const BASE = '/brand/stinky/head'
const suffix = (variant: StinkyVariant) => (variant === 'dark' ? '-dark' : '')

/**
 * Cache-busting: every Stinky asset URL carries the build id, so each deploy bypasses stale copies in the
 * browser HTTP cache, Cloudflare and older service-worker caches (asset file names never change).
 * Preloads, blob fetches and fallbacks all go through these helpers, so they share the exact same URL.
 */
export const STINKY_ASSET_VERSION = process.env.NEXT_PUBLIC_BUILD_ID || ''
export const withStinkyVersion = (url: string) =>
  STINKY_ASSET_VERSION ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(STINKY_ASSET_VERSION)}` : url

export const stinkyAssets = (state: StinkyState, variant: StinkyVariant = 'light') => ({
  /** Animated WebP with alpha, 512px, infinite loop. */
  webp: withStinkyVersion(`${BASE}/anim/stinky-${state}${suffix(variant)}.webp`),
  /** Representative still frame of the state (vector). */
  poster: withStinkyVersion(`${BASE}/poster/stinky-${state}${suffix(variant)}.svg`),
  /** Same still frame as PNG (512px) — fallback when animated WebP is unsupported. */
  posterPng: withStinkyVersion(`${BASE}/poster/stinky-${state}${suffix(variant)}.png`),
})

/** Neutral static head (vector) — identical to the first/last frame of every clip. */
export const stinkyStaticSvg = (variant: StinkyVariant = 'light') => withStinkyVersion(`${BASE}/stinky-head${suffix(variant)}.svg`)

export type StinkyMouth = 'neutral' | 'open' | 'bite' | 'bite-half'

/**
 * Editable OneWorks definitions per variant and mouth. `neutral` has the pink ":3"; the others replace it
 * (open mouth; bite = open mouth with two fangs; bite-half = half-closed "ñam"). Everything else is identical.
 */
export const stinkyDefinitionUrl = (variant: StinkyVariant = 'light', mouth: StinkyMouth = 'neutral') =>
  withStinkyVersion(`${BASE}/stinky-head${mouth === 'neutral' ? '' : `-${mouth}`}${suffix(variant)}.avatar.json`)

/**
 * Mouth timeline per clip: [fromMs, toMs, mouth]; outside every segment the mouth is the ":3".
 * Stinky only ever shows ONE mouth — the pre-rendered WebPs were assembled with exactly this timeline.
 */
export const STINKY_MOUTH_TIMELINE: Partial<Record<StinkyState, ReadonlyArray<readonly [number, number, StinkyMouth]>>> = {
  happy: [[300, 2950, 'open']],
  wave: [[200, 1900, 'open']],
  bite: [[120, 470, 'bite'], [470, 570, 'bite-half'], [570, 800, 'bite'], [800, 900, 'bite-half'], [900, 1150, 'bite']],
}
export const stinkyMouthAt = (state: StinkyState, clipMs: number): StinkyMouth =>
  STINKY_MOUTH_TIMELINE[state]?.find(([from, to]) => clipMs >= from && clipMs < to)?.[2] ?? 'neutral'
/** Mouths (other than the ":3") a clip needs. */
export const stinkyClipMouths = (state: StinkyState): StinkyMouth[] =>
  Array.from(new Set((STINKY_MOUTH_TIMELINE[state] ?? []).map(([, , m]) => m)))

/**
 * Bite lean-in toward the camera (overall scale, which the 3D scene cannot animate): baked into the bite WebPs,
 * applied by StinkyLive as a CSS transform with the same timing. [ms, scale]; pivot 50% / 51%.
 */
export const STINKY_BITE_LEAN: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [60, 1], [260, 1.07], [430, 1.07], [520, 1.082], [610, 1.07], [780, 1.07], [870, 1.082], [960, 1.07],
  [1100, 1.07], [1340, 1], [1500, 1],
]

export const STINKY_ANIMATIONS_URL = withStinkyVersion(`${BASE}/stinky.animations.json`)

/** Window (ms) of the purr clip in which the pre-rendered frames vibrate; the live renderer mirrors it. */
export const STINKY_PURR_VIBRATION = { fromMs: 800, toMs: 1950 } as const
