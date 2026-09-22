// @ts-nocheck -- REMOVE this line after installing @oneworks/avatar-react (see README.md in this folder).
'use client'

/**
 * Stinky rendered live with the OneWorks Avatar SDK (React renderer, SVG — no WebGL/three.js).
 *
 * NOT imported anywhere yet: it needs `@oneworks/avatar` + `@oneworks/avatar-react` installed.
 * Load it client-side only:
 *
 *   const StinkyLive = dynamic(() => import('@/components/stinky/stinky-live'), {
 *     ssr: false,
 *     loading: () => <Stinky state='idle' size={128} />,
 *   })
 *
 * It degrades to the pre-rendered <Stinky> sprite when:
 *  - prefers-reduced-motion is set (static poster),
 *  - the device looks low-end (≤4 cores, ≤4GB RAM, Save-Data),
 *  - measured frames are too slow at runtime (the renderer costs ~30ms of JS per frame on a
 *    fast desktop and ~125ms at 4x CPU throttling — see README.md).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, type AvatarHandle } from '@oneworks/avatar-react/renderer'
import '@oneworks/avatar-react/renderer.css'
import type { AvatarAnimationClip, AvatarAnimationLibrary, AvatarDefinition } from '@oneworks/avatar'

import { Stinky, type StinkyProps } from './stinky'
import { BITE_FX_MS, StinkyBiteFx } from './stinky-bite-fx'
import { STINKY_PET_VIBRATION, pickPetReaction, type StinkyPetReaction } from './stinky-pet'
import { startPurrVibration } from './stinky-purr'
import { PURR_FX_MS, StinkyPurrFx } from './stinky-purr-fx'
import { observeSlitPupils } from './stinky-pupils'
import {
  STINKY_ANIMATIONS_URL,
  STINKY_BITE_LEAN,
  STINKY_MOUTH_TIMELINE,
  STINKY_STATE_META,
  resolveStinkyState,
  stinkyClipMouths,
  stinkyDefinitionUrl,
  stinkyMouthAt,
  type StinkyMouth,
  type StinkyState,
  type StinkyVariant,
} from './stinky-states'
import { usePrefersReducedMotion, useStinkyVariant } from './use-stinky-env'

export interface StinkyLiveProps extends StinkyProps {
  /** Max renderer updates per second (each update re-projects the 3D scene on the main thread). */
  fps?: number
}

const MOUTHS: readonly StinkyMouth[] = ['neutral', 'open', 'bite', 'bite-half']
const PET_STATES: ReadonlySet<StinkyState> = new Set<StinkyState>(['purr', 'bite'])
const PET_FX_MS: Record<StinkyPetReaction, number> = { purr: PURR_FX_MS, bite: BITE_FX_MS }

type Loaded = { definitions: Record<StinkyMouth, AvatarDefinition>; library: AvatarAnimationLibrary }
const cache = new Map<string, Promise<unknown>>()
const getJson = <T,>(url: string) => {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(url)))))
  return cache.get(url) as Promise<T>
}
// One definition per mouth (":3", open, bite, bite-half), identical otherwise; clips swap between them so only
// one mouth ever shows.
const load = (variant: StinkyVariant) => Promise.all([
  Promise.all(MOUTHS.map(m => getJson<AvatarDefinition>(stinkyDefinitionUrl(variant, m)))),
  getJson<AvatarAnimationLibrary>(STINKY_ANIMATIONS_URL),
]).then(([defs, library]): Loaded => ({
  definitions: Object.fromEntries(MOUTHS.map((m, i) => [m, defs[i]])) as Record<StinkyMouth, AvatarDefinition>,
  library,
}))

/** Bite lean-in toward the camera, same timing/pivot as the pre-rendered bite clip. */
function startBiteLean(el: HTMLElement | null): Animation | null {
  if (!el || typeof el.animate !== 'function') return null
  const total = STINKY_BITE_LEAN.at(-1)![0]
  el.style.transformOrigin = '50% 51%'
  return el.animate(
    STINKY_BITE_LEAN.map(([ms, s]) => ({ offset: ms / total, transform: `scale(${s})` })),
    { duration: total, easing: 'linear' },
  )
}

const looksLowEnd = () => {
  if (typeof navigator === 'undefined') return true
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData === true
}

export default function StinkyLive(props: StinkyLiveProps) {
  const { state = 'idle', size = 128, settleTo = 'idle', variant: forced, onDone, onPet, interactive, label = 'Stinky', className, fps = 24 } = props
  const isInteractive = interactive ?? size >= 48
  const beforePet = useRef<StinkyState | null>(null)
  const lastPet = useRef(-Infinity)
  const petHistory = useRef<StinkyPetReaction[]>([])
  const [petFx, setPetFx] = useState<{ kind: StinkyPetReaction; key: number } | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const variant = useStinkyVariant(forced)
  const [data, setData] = useState<Loaded | null>(null)
  const [downgraded, setDowngraded] = useState(() => looksLowEnd())
  const requested = resolveStinkyState(state)
  const settle = settleTo == null ? null : resolveStinkyState(settleTo)
  const [shown, setShown] = useState<StinkyState>(requested)
  const hostRef = useRef<HTMLSpanElement>(null)
  /** Inner stage: receives the purr vibration / bite lean (the fx overlays stay unscaled). */
  const stageRef = useRef<HTMLSpanElement>(null)
  // One renderer per mouth the clip needs, stacked; all follow the same clock and exactly one is visible per tick.
  const avatars = useRef<Partial<Record<StinkyMouth, AvatarHandle | null>>>({})
  const layers = useRef<Partial<Record<StinkyMouth, HTMLSpanElement | null>>>({})

  useEffect(() => setShown(requested), [requested])
  useEffect(() => {
    let alive = true
    load(variant).then(d => alive && setData(d)).catch(() => alive && setDowngraded(true))
    return () => { alive = false }
  }, [variant])

  const clip = useMemo<AvatarAnimationClip | null>(
    () => (data?.library.groups.states?.clips[shown] as AvatarAnimationClip | undefined) ?? null,
    [data, shown],
  )
  const mouthKey = stinkyClipMouths(shown).join(',')
  const clipMouths = useMemo<StinkyMouth[]>(() => ['neutral', ...stinkyClipMouths(shown)], [mouthKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (clip == null || reducedMotion || downgraded) return
    const host = hostRef.current
    const edges = (STINKY_MOUTH_TIMELINE[shown] ?? []).flatMap(([from, to]) => [from, to])
    let raf = 0
    let started = false
    let t0 = 0
    let pausedAt: number | null = null
    let lastUpdate = -Infinity
    let lastFrame = 0
    let slowFrames = 0
    let sampled = 0
    let visible = true
    let finished = false
    let motion: Animation | null = null

    // Self-clocked driver: play() + pause() once, then seek() on our own rAF clock.
    // This avoids an SDK 1.0.0-rc.9 race where the renderer's first rAF timestamp precedes
    // play()'s performance.now(), yielding a negative elapsed time that throws
    // "Invalid OneWorks Avatar animation track" and silently stops the animation under load.
    // It also lets us cap the update rate and pause off-screen.
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      if (!started) {
        const handles = clipMouths.map(m => avatars.current[m])
        if (!host?.querySelector('svg') || handles.some(h => !h)) return
        for (const a of handles) {
          a!.play(clip, { playback: clip.playback, trackId: 'stinky' }).catch(() => setDowngraded(true))
          a!.pause('stinky')
        }
        started = true
        t0 = now
        lastFrame = now
        if (shown === 'purr') motion = startPurrVibration(stageRef.current)
        if (shown === 'bite') motion = startBiteLean(stageRef.current)
        return
      }
      // Runtime performance guard: sample the first 30 frames after start.
      if (sampled < 30) {
        if (now - lastFrame > 90) slowFrames += 1
        sampled += 1
        if (slowFrames >= 8) { setDowngraded(true); return }
      }
      lastFrame = now
      if (!visible || document.hidden || finished) { pausedAt ??= now; return }
      if (pausedAt != null) { t0 += now - pausedAt; pausedAt = null }
      if (now - lastUpdate < 1000 / fps - 1) return
      lastUpdate = now
      const elapsed = now - t0
      const clipMs = clip.playback === 'loop' ? elapsed % clip.durationMs : Math.min(elapsed, clip.durationMs)
      // Seek the visible renderer, plus the others when a mouth swap is within two updates (so they are
      // already on the right frame when they become visible). Exactly one layer is visible.
      const mouth = stinkyMouthAt(shown, clipMs)
      const nearSwap = edges.some(e => Math.abs(clipMs - e) <= 2 * (1000 / fps))
      for (const m of clipMouths) {
        if (m === mouth || nearSwap) avatars.current[m]?.seek(clipMs, 'stinky')
        const layer = layers.current[m]
        if (layer) layer.style.visibility = m === mouth ? 'visible' : 'hidden'
      }
      if (clip.playback === 'once' && elapsed >= clip.durationMs) {
        finished = true
        onDone?.()
        if (PET_STATES.has(shown)) {
          const back = beforePet.current ?? requested
          beforePet.current = null
          setShown(STINKY_STATE_META[back].playback === 'loop' ? back : settle ?? 'idle')
        } else if (settle != null && settle !== shown) setShown(settle)
      }
    }
    const io = typeof IntersectionObserver === 'function' && host
      ? new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true })
      : null
    if (io && host) io.observe(host)
    raf = requestAnimationFrame(tick)
    const avatarsAtStart = avatars.current
    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
      motion?.cancel()
      for (const m of clipMouths) avatarsAtStart[m]?.stop({ trackId: 'stinky' })
    }
  }, [clip, clipMouths, reducedMotion, downgraded, fps, settle, shown, onDone, requested])

  // Slit pupils: rewrite the SDK's (black) eye highlight into a vertical slit on every render.
  const live = !reducedMotion && !downgraded && data != null
  useEffect(() => {
    const host = hostRef.current
    if (!live || !host) return
    return observeSlitPupils(host)
  }, [live, data])

  useEffect(() => {
    if (!petFx) return
    const t = setTimeout(() => setPetFx(null), PET_FX_MS[petFx.kind])
    return () => clearTimeout(t)
  }, [petFx])

  if (!live || data == null) {
    return (
      <Stinky
        state={shown}
        size={size}
        settleTo={settleTo}
        variant={forced}
        onDone={onDone}
        interactive={interactive}
        onPet={onPet}
        label={label}
        className={className}
      />
    )
  }

  const pet = () => {
    const now = performance.now()
    if (PET_STATES.has(shown) || now - lastPet.current < 1200) return
    lastPet.current = now
    beforePet.current = shown
    // ~65% purr / ~35% playful bite, never three bites in a row.
    const reaction = pickPetReaction(petHistory.current)
    petHistory.current = [...petHistory.current, reaction].slice(-4)
    setShown(reaction)
    setPetFx({ kind: reaction, key: now })
    navigator.vibrate?.([...STINKY_PET_VIBRATION[reaction]])
    onPet?.(reaction)
  }
  const decorative = !isInteractive && label === ''
  return (
    <span
      ref={hostRef}
      className={className}
      style={{ position: 'relative', display: 'inline-block', width: size, height: size, cursor: isInteractive ? 'pointer' : undefined }}
      role={isInteractive ? 'button' : decorative ? undefined : 'img'}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? 'Acariciar a Stinky' : decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      onClick={isInteractive ? pet : undefined}
      onKeyDown={isInteractive ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pet() } } : undefined}
      data-stinky-state={shown}
      data-stinky-mode='live'
    >
      <span ref={stageRef} style={{ position: 'absolute', inset: 0 }}>
        {clipMouths.map(m => (
          <span
            key={m}
            ref={el => { layers.current[m] = el }}
            data-stinky-mouth={m}
            style={{ position: 'absolute', inset: 0, visibility: m === 'neutral' ? 'visible' : 'hidden' }}
          >
            <Avatar
              ref={h => { avatars.current[m] = h }}
              definition={data.definitions[m]}
              animationLibraries={[data.library]}
              theme={variant}
              style={{ width: '100%', height: '100%' }}
            />
          </span>
        ))}
      </span>
      {petFx?.kind === 'purr' && <StinkyPurrFx key={petFx.key} size={size} reducedMotion={false} />}
      {petFx?.kind === 'bite' && <StinkyBiteFx key={petFx.key} size={size} reducedMotion={false} />}
    </span>
  )
}

export { STINKY_STATE_META }
