import fs from 'fs'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { STINKY_BITE_CHANCE, STINKY_PET_VIBRATION, pickPetReaction, type StinkyPetReaction } from '@/components/stinky/stinky-pet'
import {
  STINKY_MOUTH_TIMELINE,
  STINKY_STATE_META,
  STINKY_STATES,
  stinkyClipMouths,
  stinkyMouthAt,
} from '@/components/stinky/stinky-states'

const HEAD = path.resolve(__dirname, '../public/brand/stinky/head')

/** Deterministic PRNG (mulberry32) so the distribution test is stable. */
const rng = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('pickPetReaction', () => {
  it('bites below the threshold and purrs above it', () => {
    expect(pickPetReaction([], () => 0)).toBe('bite')
    expect(pickPetReaction([], () => STINKY_BITE_CHANCE - 0.001)).toBe('bite')
    expect(pickPetReaction([], () => STINKY_BITE_CHANCE)).toBe('purr')
    expect(pickPetReaction([], () => 0.99)).toBe('purr')
  })

  it('never bites three times in a row', () => {
    expect(pickPetReaction(['bite', 'bite'], () => 0)).toBe('purr')
    expect(pickPetReaction(['purr', 'bite', 'bite'], () => 0)).toBe('purr')
    expect(pickPetReaction(['bite', 'purr', 'bite'], () => 0)).toBe('bite')

    const random = rng(42)
    const history: StinkyPetReaction[] = []
    for (let i = 0; i < 5000; i++) history.push(pickPetReaction(history, random))
    expect(history.join(',')).not.toContain('bite,bite,bite')
  })

  it('is roughly 65% purr / 35% bite', () => {
    const random = rng(7)
    const history: StinkyPetReaction[] = []
    for (let i = 0; i < 20000; i++) history.push(pickPetReaction(history, random))
    const bites = history.filter(r => r === 'bite').length / history.length
    expect(bites).toBeGreaterThan(0.3)
    expect(bites).toBeLessThan(0.37)
  })

  it('uses distinct haptics for purr and bite', () => {
    expect(STINKY_PET_VIBRATION.bite).toEqual([20, 40, 20])
    expect(STINKY_PET_VIBRATION.purr).not.toEqual(STINKY_PET_VIBRATION.bite)
  })
})

describe('mouth timeline (exactly one mouth, neutral at both ends)', () => {
  it('keeps the ":3" at the first and last frame of every clip', () => {
    for (const state of STINKY_STATES) {
      const { durationMs } = STINKY_STATE_META[state]
      expect(stinkyMouthAt(state, 0)).toBe('neutral')
      expect(stinkyMouthAt(state, durationMs - 1)).toBe('neutral')
    }
  })

  it('never shows an open mouth in purr, and segments do not overlap', () => {
    expect(stinkyClipMouths('purr')).toEqual([])
    for (const segments of Object.values(STINKY_MOUTH_TIMELINE)) {
      const sorted = [...(segments ?? [])].sort((a, b) => a[0] - b[0])
      sorted.forEach(([from, to], i) => {
        expect(to).toBeGreaterThan(from)
        if (i > 0) expect(from).toBeGreaterThanOrEqual(sorted[i - 1][1])
      })
    }
  })

  it('bite opens with fangs, chomps (half-closed) twice and closes back to ":3"', () => {
    const seq = [0, 200, 500, 700, 850, 1000, 1400].map(t => stinkyMouthAt('bite', t))
    expect(seq).toEqual(['neutral', 'bite', 'bite-half', 'bite', 'bite-half', 'bite', 'neutral'])
  })
})

describe('assets', () => {
  const library = JSON.parse(fs.readFileSync(path.join(HEAD, 'stinky.animations.json'), 'utf8'))

  it('durations and playback match stinky.animations.json', () => {
    for (const state of STINKY_STATES) {
      const clip = library.groups.states.clips[state]
      expect(clip, state).toBeDefined()
      expect(clip.durationMs).toBe(STINKY_STATE_META[state].durationMs)
      expect(clip.playback).toBe(STINKY_STATE_META[state].playback)
    }
  })

  it('ships a WebP and posters for every state and variant, and a definition per mouth', () => {
    for (const state of STINKY_STATES) {
      for (const v of ['', '-dark']) {
        for (const f of [`anim/stinky-${state}${v}.webp`, `poster/stinky-${state}${v}.svg`, `poster/stinky-${state}${v}.png`]) {
          expect(fs.existsSync(path.join(HEAD, f)), f).toBe(true)
        }
      }
    }
    for (const m of ['', '-open', '-bite', '-bite-half']) {
      for (const v of ['', '-dark']) expect(fs.existsSync(path.join(HEAD, `stinky-head${m}${v}.avatar.json`))).toBe(true)
    }
  })
})

describe('cache-busting', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('appends ?v=<build id> to every Stinky asset URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'build 42')
    vi.resetModules()
    const m = await import('@/components/stinky/stinky-states')
    const urls = [
      ...Object.values(m.stinkyAssets('bite', 'dark')),
      m.stinkyStaticSvg('light'),
      m.stinkyDefinitionUrl('light', 'bite-half'),
      m.STINKY_ANIMATIONS_URL,
    ]
    for (const url of urls) expect(url).toMatch(/\?v=build%2042$/)
    expect(m.stinkyAssets('bite', 'dark').webp).toBe('/brand/stinky/head/anim/stinky-bite-dark.webp?v=build%2042')
  })

  it('leaves URLs untouched when no build id is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', '')
    vi.resetModules()
    const m = await import('@/components/stinky/stinky-states')
    expect(m.stinkyAssets('idle').webp).toBe('/brand/stinky/head/anim/stinky-idle.webp')
  })
})
