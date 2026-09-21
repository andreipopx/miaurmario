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
import { startPurrVibration } from './stinky-purr'
import { observeSlitPupils } from './stinky-pupils'
import {
  STINKY_ANIMATIONS_URL,
  STINKY_STATE_META,
  resolveStinkyState,
  stinkyDefinitionUrl,
  type StinkyState,
  type StinkyVariant,
} from './stinky-states'
import { usePrefersReducedMotion, useStinkyVariant } from './use-stinky-env'

export interface StinkyLiveProps extends StinkyProps {
  /** Max renderer updates per second (each update re-projects the 3D scene on the main thread). */
  fps?: number
}

type Loaded = { definition: AvatarDefinition; library: AvatarAnimationLibrary }
const cache = new Map<string, Promise<unknown>>()
const getJson = <T,>(url: string) => {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(url)))))
  return cache.get(url) as Promise<T>
}
// One definition per variant; mouth accents (open mouth) are animated parts inside the clips.
const load = (variant: StinkyVariant) => Promise.all([
  getJson<AvatarDefinition>(stinkyDefinitionUrl(variant)),
  getJson<AvatarAnimationLibrary>(STINKY_ANIMATIONS_URL),
]).then(([definition, library]): Loaded => ({ definition, library }))

const looksLowEnd = () => {
  if (typeof navigator === 'undefined') return true
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData === true
}

export default function StinkyLive(props: StinkyLiveProps) {
  const { state = 'idle', size = 128, settleTo = 'idle', variant: forced, onDone, onPet, interactive, label = 'Stinky', className, fps = 24 } = props
  const isInteractive = interactive ?? size >= 48
  const beforePurr = useRef<StinkyState | null>(null)
  const lastPet = useRef(-Infinity)
  const reducedMotion = usePrefersReducedMotion()
  const variant = useStinkyVariant(forced)
  const [data, setData] = useState<Loaded | null>(null)
  const [downgraded, setDowngraded] = useState(() => looksLowEnd())
  const requested = resolveStinkyState(state)
  const settle = settleTo == null ? null : resolveStinkyState(settleTo)
  const [shown, setShown] = useState<StinkyState>(requested)
  const hostRef = useRef<HTMLSpanElement>(null)
  const avatarRef = useRef<AvatarHandle>(null)

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

  useEffect(() => {
    if (clip == null || reducedMotion || downgraded) return
    const host = hostRef.current
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

    // Self-clocked driver: play() + pause() once, then seek() on our own rAF clock.
    // This avoids an SDK 1.0.0-rc.9 race where the renderer's first rAF timestamp precedes
    // play()'s performance.now(), yielding a negative elapsed time that throws
    // "Invalid OneWorks Avatar animation track" and silently stops the animation under load.
    // It also lets us cap the update rate and pause off-screen.
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const avatar = avatarRef.current
      if (!avatar) return
      const now = performance.now()
      if (!started) {
        if (!host?.querySelector('svg')) return
        avatar.play(clip, { playback: clip.playback, trackId: 'stinky' }).catch(() => setDowngraded(true))
        avatar.pause('stinky')
        started = true
        t0 = now
        lastFrame = now
        if (shown === 'purr') startPurrVibration(host)
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
      if (clip.playback === 'loop') {
        avatar.seek(elapsed % clip.durationMs, 'stinky')
      } else {
        avatar.seek(Math.min(elapsed, clip.durationMs), 'stinky')
        if (elapsed >= clip.durationMs) {
          finished = true
          onDone?.()
          if (shown === 'purr') {
            const back = beforePurr.current ?? requested
            beforePurr.current = null
            setShown(STINKY_STATE_META[back].playback === 'loop' ? back : settle ?? 'idle')
          } else if (settle != null && settle !== shown) setShown(settle)
        }
      }
    }
    const io = typeof IntersectionObserver === 'function' && host
      ? new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true })
      : null
    if (io && host) io.observe(host)
    raf = requestAnimationFrame(tick)
    const avatarAtStart = avatarRef
    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
      avatarAtStart.current?.stop({ trackId: 'stinky' })
    }
  }, [clip, reducedMotion, downgraded, fps, settle, shown, onDone, requested])

  // Slit pupils: rewrite the SDK's (black) eye highlight into a vertical slit on every render.
  const live = !reducedMotion && !downgraded && data != null
  useEffect(() => {
    const host = hostRef.current
    if (!live || !host) return
    return observeSlitPupils(host)
  }, [live, data])

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
    if (shown === 'purr' || now - lastPet.current < 1200) return
    lastPet.current = now
    beforePurr.current = shown
    setShown('purr')
    navigator.vibrate?.([15, 30, 15, 30, 15, 30, 15])
    onPet?.()
  }
  const decorative = !isInteractive && label === ''
  return (
    <span
      ref={hostRef}
      className={className}
      style={{ display: 'inline-block', width: size, height: size, cursor: isInteractive ? 'pointer' : undefined }}
      role={isInteractive ? 'button' : decorative ? undefined : 'img'}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? 'Acariciar a Stinky' : decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      onClick={isInteractive ? pet : undefined}
      onKeyDown={isInteractive ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pet() } } : undefined}
      data-stinky-state={shown}
      data-stinky-mode='live'
    >
      <Avatar
        ref={avatarRef}
        definition={data.definition}
        animationLibraries={[data.library]}
        theme={variant}
        style={{ width: '100%', height: '100%' }}
      />
    </span>
  )
}

export { STINKY_STATE_META }
