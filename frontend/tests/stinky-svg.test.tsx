import fs from 'fs'
import path from 'path'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StinkySvg } from '@/components/stinky/stinky-svg'
import { STINKY_STATES, STINKY_STATE_META, type StinkyState } from '@/components/stinky/stinky-states'
import { STINKY_COATS, STINKY_EYES, STINKY_NATURAL_EYES, stinkyEyeColor } from '@/lib/stinky-persona'
import {
  CLIP_KEYS,
  COAT_LOOKS,
  EAR_KEYS,
  NEUTRAL_POSE,
  PUPIL_KEYS,
  band,
  bezier,
  irisColors,
  poseAt,
  poseTransforms,
  rigTracks,
  stripePaths,
} from '@/lib/stinky-rig'

const ANIMATIONS = path.resolve(__dirname, '../public/brand/stinky/head/stinky.animations.json')

/** jsdom has no Web Animations API: a stub so the live path runs. */
const fakeAnimation = () => ({ cancel: vi.fn(), pause: vi.fn(), finished: Promise.resolve() })
const installAnimate = () => {
  const animate = vi.fn(fakeAnimation)
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate })
  return animate
}
const removeAnimate = () => {
  delete (Element.prototype as { animate?: unknown }).animate
}
const matchMedia = (reduced: boolean) =>
  vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }))

afterEach(() => {
  cleanup()
  removeAnimate()
  vi.useRealTimers()
  window.matchMedia = matchMedia(false)
})

describe('rig data', () => {
  it('has a look for every coat and iris colours for every eye option', () => {
    for (const coat of STINKY_COATS) {
      const look = COAT_LOOKS[coat]
      expect(look, coat).toBeDefined()
      expect(look.fur).toMatch(/^#[0-9a-f]{6}$/i)
      expect(look.eyes).toHaveLength(2)
      for (const eyes of STINKY_EYES) {
        const [l, r] = irisColors(coat, eyes)
        expect(l).toMatch(/^#[0-9a-f]{6}$/i)
        expect(r).toMatch(/^#[0-9a-f]{6}$/i)
        if (eyes !== 'natural') expect(l).toBe(stinkyEyeColor(coat, eyes))
      }
      // A coat's own eyes match the swatch the settings page shows for them (white: odd eyes).
      const own = STINKY_NATURAL_EYES[coat]
      if (own) expect(look.eyes[0]).toBe(look.eyes[1])
      else expect(look.eyes[0]).not.toBe(look.eyes[1])
    }
    expect(COAT_LOOKS.siames.mask).toBeTruthy()
    expect(COAT_LOOKS.calico.patches?.length).toBeGreaterThan(2)
    expect(COAT_LOOKS['naranja-atigrado'].stripes?.forehead).toBe(true)
  })

  it('carries the SDK clips verbatim: durations, keyframe times, easings, face and view values', () => {
    const lib = JSON.parse(fs.readFileSync(ANIMATIONS, 'utf8')).groups.states.clips
    const EASE = { 'ease-in-out': 'io', 'ease-out': 'o', 'ease-in': 'i' } as const
    for (const state of STINKY_STATES) {
      const clip = lib[state]
      expect(clip.durationMs, state).toBe(STINKY_STATE_META[state].durationMs)
      expect(clip.playback).toBe(STINKY_STATE_META[state].playback)
      const keys = CLIP_KEYS[state]
      expect(keys.length, state).toBe(clip.keyframes.length)
      clip.keyframes.forEach((kf: { atMs: number; easing: keyof typeof EASE; patch: { face: Record<string, number>; view: Record<string, number> } }, i: number) => {
        const k = keys[i]!
        const { face, view } = kf.patch
        expect(k.slice(0, 11), `${state} #${i}`).toEqual([
          kf.atMs, EASE[kf.easing], +face.height!.toFixed(2), face.rotation, face.leftEyeRotation, face.rightEyeRotation, face.gap,
          +view.pitch!.toFixed(3), +view.yaw!.toFixed(3), view.positionX, view.positionY,
        ])
        if (face.leftEyeHeight != null) expect(k[11]?.lh).toBe(+face.leftEyeHeight.toFixed(2))
        if (face.rightEyeHeight != null) expect(k[11]?.rh).toBe(+face.rightEyeHeight.toFixed(2))
      })
    }
  })

  it('starts and ends every clip on the neutral pose, extras included', () => {
    for (const state of STINKY_STATES) {
      const { durationMs } = STINKY_STATE_META[state]
      for (const ms of [0, durationMs - 1, durationMs]) {
        const p = poseAt(state, ms)
        expect(poseTransforms(p), `${state} @ ${ms}`).toEqual(poseTransforms(NEUTRAL_POSE))
      }
      const first = (EAR_KEYS[state] ?? [])[0]
      if (first && first[0] === 0) expect(first.slice(1)).toEqual([0, 0])
      const last = (PUPIL_KEYS[state] ?? []).at(-1)
      if (last) expect(last.slice(1)).toEqual([0, 0, 1])
    }
    // Mid-clip poses differ (the clip actually moves) and loops wrap.
    expect(poseTransforms(poseAt('thinking', 1536)).face).not.toBe(poseTransforms(NEUTRAL_POSE).face)
    expect(poseAt('idle', 3350 + 640)).toEqual(poseAt('idle', 640))
    expect(poseAt('idle', 1600).h).toBeCloseTo(7, 5)
    expect(poseAt('wave', 640).lh).toBeCloseTo(7, 5)
    expect(poseAt('wave', 640).rh).toBeCloseTo(36, 5)
  })

  it('eases like CSS', () => {
    expect(bezier([0.42, 0, 0.58, 1], 0)).toBe(0)
    expect(bezier([0.42, 0, 0.58, 1], 1)).toBe(1)
    expect(bezier([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 3)
    expect(bezier([0.42, 0, 0.58, 1], 0.25)).toBeLessThan(0.25)
    expect(bezier([0, 0, 0.58, 1], 0.25)).toBeGreaterThan(0.25)
  })

  it('turns a clip into monotonic Web Animations tracks, one mouth at a time', () => {
    for (const state of STINKY_STATES) {
      const tracks = rigTracks(state)
      expect(tracks.durationMs).toBe(STINKY_STATE_META[state].durationMs)
      expect(tracks.loop).toBe(STINKY_STATE_META[state].playback === 'loop')
      for (const kfs of Object.values(tracks.parts)) {
        expect(kfs[0]!.offset).toBe(0)
        expect(kfs.at(-1)!.offset).toBe(1)
        kfs.forEach((k, i) => i && expect(k.offset).toBeGreaterThanOrEqual(kfs[i - 1]!.offset as number))
        expect(kfs[0]!.transform).toBe(kfs.at(-1)!.transform)
      }
      expect(tracks.grade === null).toBe(state !== 'sad')
      expect(tracks.mouths === null).toBe(!['happy', 'wave', 'bite'].includes(state))
    }
    const bite = rigTracks('bite').mouths!
    expect(Object.keys(bite).sort()).toEqual(['bite', 'bite-half', 'neutral'])
    expect(bite.neutral![0]!.opacity).toBe(1)
    expect(bite.neutral!.at(-1)!.opacity).toBe(1)
    // Cuts: two keyframes at the same offset (hidden, then shown) where the fanged mouth opens at 120 ms.
    expect(bite.bite!.filter(k => k.offset === +(120 / 1500).toFixed(3)).map(k => k.opacity)).toEqual([0, 1])
    // A switch mid-clip starts from the pose on screen.
    const from = poseAt('purr', 800)
    const blended = rigTracks('idle', from)
    expect(blended.parts.eyeL[0]!.transform).toBe(poseTransforms(from).eyeL)
    expect(blended.parts.eyeL[1]!.transform).toBe(rigTracks('idle').parts.eyeL[1]!.transform)
  })

  it('draws tapered stripes as closed paths', () => {
    expect(band(0, 0, 10, 0, 2)).toMatch(/^M0 0Q5 2 10 0Q5 -2 0 0Z$/)
    expect(stripePaths(true)).toHaveLength(17)
    expect(stripePaths(false)).toHaveLength(12)
  })

  it('turns the whole head, features ahead of the skull (parallax), far eye narrower', () => {
    const p = poseAt('thinking', 1536) // yaw 0.1 (from −0.12), pitch −0.15, tilt −4°
    const t = poseTransforms(p)
    const num = (s: string) => s.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
    const [sx, sy, srot] = num(t.skull)
    const [fx, fy, frot] = num(t.face)
    expect(sx).toBeGreaterThan(0)
    expect(fx).toBeGreaterThan(sx)
    expect(sy).toBeLessThan(0)
    expect(fy).toBeLessThan(sy)
    expect(srot).toBeLessThan(0)
    expect(srot! + frot!).toBeCloseTo(p.rot, 3)
    // The head turned to the viewer's right: the right eye is the far one and narrows.
    const scaleX = (s: string) => num(s.slice(s.indexOf('scale')))[0]!
    expect(scaleX(t.eyeR)).toBeLessThan(1)
    expect(scaleX(t.eyeL)).toBe(1)
    expect(poseTransforms(NEUTRAL_POSE).skull).toBe('translate(0px, 0px) rotate(0deg)')
  })
})

describe('<StinkySvg>', () => {
  beforeEach(() => {
    window.matchMedia = matchMedia(false)
  })

  it('renders every state (and aliases) as one inline SVG rig', () => {
    for (const state of [...STINKY_STATES, 'celebrate', 'hello'] as const) {
      const { container, unmount } = render(<StinkySvg state={state} interactive={false} label="Stinky" />)
      const host = container.querySelector('[data-stinky-state]')!
      expect(host, state).toBeTruthy()
      expect(container.querySelectorAll('svg[viewBox="0 0 420 420"]')).toHaveLength(1)
      expect(host.getAttribute('role')).toBe('img')
      unmount()
    }
    const { container } = render(<StinkySvg state="celebrate" interactive={false} />)
    expect(container.querySelector('[data-stinky-state]')!.getAttribute('data-stinky-state')).toBe('happy')
  })

  it('draws the chosen coat, eyes and accessory', () => {
    const { container } = render(<StinkySvg coat="siames" eyes="verde" accessory="pajarita" interactive={false} />)
    const svg = container.querySelector('svg')!
    expect(svg.querySelector('radialGradient')).toBeTruthy()
    const irises = Array.from(svg.querySelectorAll('ellipse')).filter(e => e.getAttribute('fill') === stinkyEyeColor('siames', 'verde'))
    expect(irises).toHaveLength(2)
    expect(svg.innerHTML).toContain('#ff7fb2') // the bow tie, inside the head group
  })

  it('pets on tap: fires onPet and shows a reaction', () => {
    const animate = installAnimate()
    vi.useFakeTimers()
    const onPet = vi.fn()
    const { container, getByRole } = render(<StinkySvg onPet={onPet} />)
    act(() => {
      getByRole('button', { name: /acariciar/i }).click()
    })
    expect(onPet).toHaveBeenCalledTimes(1)
    const reaction = onPet.mock.calls[0]![0]
    expect(['purr', 'bite']).toContain(reaction)
    expect(container.querySelector('[data-stinky-state]')!.getAttribute('data-stinky-state')).toBe(reaction)
    expect(animate).toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(container.querySelector('[data-stinky-state]')!.getAttribute('data-stinky-state')).toBe('idle')
  })

  it('shows the static neutral pose under reduced motion and starts no animation', () => {
    window.matchMedia = matchMedia(true)
    const animate = installAnimate()
    const { container } = render(<StinkySvg state="thinking" interactive={false} />)
    const host = container.querySelector('[data-stinky-state]')!
    expect(host.getAttribute('data-stinky-rig')).toBe('still')
    expect(animate).not.toHaveBeenCalled()
    const neutral = poseTransforms(NEUTRAL_POSE, false)
    const groups = Array.from(container.querySelectorAll('g[transform]')).map(g => g.getAttribute('transform'))
    expect(groups).toContain(neutral.face)
    expect(groups).toContain(neutral.eyeL)
  })

  it('fires onDone once a one-shot has played, then settles', () => {
    installAnimate()
    vi.useFakeTimers()
    const onDone = vi.fn()
    const { container, rerender } = render(<StinkySvg state="wave" settleTo="idle" onDone={onDone} interactive={false} />)
    expect(container.querySelector('[data-stinky-state]')!.getAttribute('data-stinky-state')).toBe('wave')
    act(() => {
      vi.advanceTimersByTime(2700)
    })
    expect(onDone).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-stinky-state]')!.getAttribute('data-stinky-state')).toBe('idle')
    // Loops never finish.
    rerender(<StinkySvg state="thinking" settleTo="idle" onDone={onDone} interactive={false} />)
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('still fires onDone without the Web Animations API (static rig)', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    render(<StinkySvg state="sad" settleTo={null} onDone={onDone} interactive={false} />)
    act(() => {
      vi.advanceTimersByTime(1300)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('holds the neutral pose while paused', () => {
    const animate = installAnimate()
    const { container } = render(<StinkySvg state="happy" paused interactive={false} />)
    expect(animate).not.toHaveBeenCalled()
    expect(container.querySelector('[data-stinky-state]')!.getAttribute('data-stinky-rig')).toBe('still')
  })
})

/** A state the rig must accept (type check only). */
const _state: StinkyState = 'idle'
void _state
