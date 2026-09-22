'use client'

/* eslint-disable @next/next/no-img-element -- animated WebP must bypass next/image optimisation */

import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import {
  STINKY_LIKELY_NEXT,
  STINKY_STATE_META,
  resolveStinkyState,
  stinkyAssets,
  type StinkyState,
  type StinkyStateInput,
  type StinkyVariant,
} from './stinky-states'
import { BITE_FX_MS, StinkyBiteFx } from './stinky-bite-fx'
import { STINKY_PET_VIBRATION, pickPetReaction, type StinkyPetReaction } from './stinky-pet'
import { startPurrVibration } from './stinky-purr'
import { PURR_FX_MS, StinkyPurrFx } from './stinky-purr-fx'
import { usePrefersReducedMotion, useStinkyVariant } from './use-stinky-env'

export interface StinkyProps {
  /** Animation state (aliases such as `working` or `celebrate` map onto a shipped state). */
  state?: StinkyStateInput
  /** Rendered size in CSS px (square). Assets are 512px: crisp up to ~170px @3x / ~256px @2x. */
  size?: number
  /** State to show after a `once` state finishes. Pass `null` to keep the finished state looping. */
  settleTo?: StinkyStateInput | null
  /** Force a variant; defaults to the next-themes resolved theme. */
  variant?: StinkyVariant
  /** Called when a requested `once` state has played through. */
  onDone?: () => void
  /** Tap/click/Enter/Space pets Stinky (plays `purr` or, sometimes, a playful `bite`, then returns). Default: `size >= 48`. */
  interactive?: boolean
  /** Called when Stinky is petted, with the reaction he chose. */
  onPet?: (reaction: StinkyPetReaction) => void
  /** Accessible label when not interactive; pass `''` to mark Stinky as decorative. */
  label?: string
  className?: string
}

/** Crossfade length when a switch cannot wait for a clean clip boundary. */
const CROSSFADE_MS = 150
/** A loop that ends within this window finishes its cycle before switching (perfect splice). */
const MAX_BOUNDARY_WAIT_MS = 700
/** Minimum time between two pets. */
const PET_THROTTLE_MS = 1200
const PET_LABEL = 'Acariciar a Stinky'
/** Reactions to a pet: they return to the previous state when they finish. */
const PET_STATES: ReadonlySet<StinkyState> = new Set<StinkyState>(['purr', 'bite'])
const PET_FX_MS: Record<StinkyPetReaction, number> = { purr: PURR_FX_MS, bite: BITE_FX_MS }

// ---- clip cache: one fetch per clip; each play gets a fresh object URL so the animation restarts at frame 0
const blobCache = new Map<string, Promise<Blob | null>>()
const fetchClip = (url: string) => {
  let pending = blobCache.get(url)
  if (!pending) {
    pending = fetch(url)
      .then(r => (r.ok ? r.blob() : null))
      .catch(() => null)
    blobCache.set(url, pending)
  }
  return pending
}
const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([promise, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))])

interface Layer {
  readonly key: number
  readonly state: StinkyState
  readonly src: string
  readonly blob: boolean
  shown: boolean
}

export function Stinky({
  state = 'idle',
  size = 128,
  settleTo = 'idle',
  variant: forcedVariant,
  onDone,
  interactive,
  onPet,
  label = 'Stinky',
  className,
}: StinkyProps) {
  const reducedMotion = usePrefersReducedMotion()
  const variant = useStinkyVariant(forcedVariant)
  const requested = resolveStinkyState(state)
  const settle = settleTo == null ? null : resolveStinkyState(settleTo)
  const isInteractive = interactive ?? size >= 48

  const initial = stinkyAssets(requested, variant).webp
  // Pet overlay: hearts + "prrr" for purr, "¡ñam!" + bite marks for bite; a new key restarts the animation.
  const [petFx, setPetFx] = useState<{ kind: StinkyPetReaction; key: number } | null>(null)
  const petFxTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const petHistory = useRef<StinkyPetReaction[]>([])
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: 0, state: requested, src: initial, blob: false, shown: true }])

  // Mutable playback bookkeeping (not render state).
  const current = useRef<{ state: StinkyState; startedAt: number | null }>({ state: requested, startedAt: null })
  const keyRef = useRef(1)
  const rootRef = useRef<HTMLElement | null>(null)
  const vibration = useRef<Animation | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const switchToken = useRef(0)
  const returnTo = useRef<StinkyState | null>(null)
  const lastPet = useRef(-Infinity)
  const latest = useRef({ requested, settle, variant, reducedMotion, onDone, onPet })
  latest.current = { requested, settle, variant, reducedMotion, onDone, onPet }

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, Math.max(0, ms))
    timers.current.add(id)
  }, [])

  const urlFor = useCallback((s: StinkyState, v: StinkyVariant, still: boolean) => {
    const assets = stinkyAssets(s, v)
    return still ? assets.poster : assets.webp
  }, [])

  const preload = useCallback((s: StinkyState) => {
    const { variant: v, reducedMotion: still } = latest.current
    if (still) {
      const img = new Image()
      img.src = urlFor(s, v, true)
    } else {
      void fetchClip(urlFor(s, v, false))
    }
  }, [urlFor])

  // Forward declaration so onClipEnd and show can reference each other.
  const showRef = useRef<(next: StinkyState, opts?: { immediate?: boolean }) => void>(() => {})

  /** Called when a `once` clip reaches its last frame (== neutral frame). */
  const onClipEnd = useCallback((ended: StinkyState) => {
    const { requested: req, settle: st, onDone: done } = latest.current
    if (PET_STATES.has(ended)) {
      const back = returnTo.current ?? req
      returnTo.current = null
      showRef.current(STINKY_STATE_META[back].playback === 'loop' ? back : st ?? 'idle')
      return
    }
    if (ended === req) done?.()
    if (st != null && st !== ended) showRef.current(st)
  }, [])

  /** Mark a freshly loaded layer as playing, fade it in and retire the layers below it. */
  const activate = useCallback((layerKey: number, s: StinkyState) => {
    const now = performance.now()
    current.current = { state: s, startedAt: now }
    setLayers(prev => prev.map(l => (l.key === layerKey ? { ...l, shown: true } : l)))
    later(() => {
      // Retire only layers older than this one (a newer switch may already be on top).
      setLayers(prev => {
        prev.filter(l => l.key < layerKey && l.blob).forEach(l => URL.revokeObjectURL(l.src))
        return prev.filter(l => l.key >= layerKey)
      })
    }, CROSSFADE_MS + 40)
    const meta = STINKY_STATE_META[s]
    vibration.current?.cancel()
    vibration.current = s === 'purr' && !latest.current.reducedMotion ? startPurrVibration(rootRef.current) : null
    if (meta.playback === 'once') later(() => onClipEnd(s), meta.durationMs)
    STINKY_LIKELY_NEXT[s].forEach(preload)
  }, [later, onClipEnd, preload])

  const show = useCallback((next: StinkyState, opts: { immediate?: boolean } = {}) => {
    const token = ++switchToken.current
    const { state: cur, startedAt } = current.current
    let wait = 0
    if (!opts.immediate && startedAt != null && STINKY_STATE_META[cur].playback === 'loop') {
      const dur = STINKY_STATE_META[cur].durationMs
      const remain = dur - ((performance.now() - startedAt) % dur)
      if (remain <= MAX_BOUNDARY_WAIT_MS) wait = remain
    }
    later(async () => {
      if (token !== switchToken.current) return
      const { variant: v, reducedMotion: still } = latest.current
      const url = urlFor(next, v, still)
      let src = url
      let blob = false
      if (!still) {
        const data = await withTimeout(fetchClip(url), 400, null)
        if (token !== switchToken.current) return
        if (data) {
          src = URL.createObjectURL(data)
          blob = true
        }
      }
      const key = keyRef.current++
      setLayers(prev => [...prev, { key, state: next, src, blob, shown: false }])
    }, wait)
  }, [later, urlFor])
  showRef.current = show

  // Follow the `state` prop (a purr in progress finishes first, then returns to the new state).
  const lastRequested = useRef(requested)
  useEffect(() => {
    if (requested === lastRequested.current) return
    lastRequested.current = requested
    if (PET_STATES.has(current.current.state) && !PET_STATES.has(requested)) {
      returnTo.current = requested
      return
    }
    if (requested === current.current.state && STINKY_STATE_META[requested].playback === 'loop') return
    show(requested)
  }, [requested, show])

  // Theme or reduced-motion change: swap the current clip immediately.
  const firstEnv = useRef(true)
  useEffect(() => {
    if (firstEnv.current) {
      firstEnv.current = false
      if (!reducedMotion) return
    }
    show(current.current.state, { immediate: true })
  }, [variant, reducedMotion, show])

  // Preload what is likely next (+ purr when petting is possible).
  useEffect(() => {
    STINKY_LIKELY_NEXT[requested].forEach(preload)
    if (isInteractive) {
      preload('purr')
      preload('bite')
    }
  }, [requested, isInteractive, preload, variant])

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
      vibration.current?.cancel()
      if (petFxTimer.current) clearTimeout(petFxTimer.current)
    }
  }, [])

  const pet = useCallback(() => {
    const now = performance.now()
    if (now - lastPet.current < PET_THROTTLE_MS || PET_STATES.has(current.current.state)) return
    lastPet.current = now
    const prev = current.current.state
    returnTo.current = STINKY_STATE_META[prev].playback === 'loop' ? prev : latest.current.settle ?? 'idle'
    // ~65% purr / ~35% playful bite, never three bites in a row.
    const reaction = pickPetReaction(petHistory.current)
    petHistory.current = [...petHistory.current, reaction].slice(-4)
    show(reaction, { immediate: true })
    setPetFx({ kind: reaction, key: now })
    if (petFxTimer.current) clearTimeout(petFxTimer.current)
    petFxTimer.current = setTimeout(() => setPetFx(null), PET_FX_MS[reaction])
    if (!latest.current.reducedMotion && typeof navigator !== 'undefined') navigator.vibrate?.([...STINKY_PET_VIBRATION[reaction]])
    latest.current.onPet?.(reaction)
  }, [show])

  const onLayerLoad = (layer: Layer) => {
    if (layer.shown && current.current.startedAt != null) return
    activate(layer.key, layer.state)
  }

  const decorative = !isInteractive && label === ''
  const images = layers.map((layer, i) => (
    <img
      key={layer.key}
      src={layer.src}
      alt=''
      width={size}
      height={size}
      draggable={false}
      aria-hidden
      ref={el => {
        // Cached images may finish loading before React attaches onLoad.
        if (el?.complete && el.naturalWidth > 0 && !el.dataset.started) {
          el.dataset.started = '1'
          onLayerLoad(layer)
        }
      }}
      onLoad={e => {
        if (e.currentTarget.dataset.started) return
        e.currentTarget.dataset.started = '1'
        onLayerLoad(layer)
      }}
      onError={e => {
        const fallback = stinkyAssets(layer.state, variant).posterPng
        if (e.currentTarget.src.endsWith(fallback)) return
        e.currentTarget.src = fallback
      }}
      className='pointer-events-none absolute inset-0 block h-full w-full select-none'
      style={{
        opacity: layer.shown || i === 0 ? 1 : 0,
        transition: reducedMotion ? undefined : `opacity ${CROSSFADE_MS}ms linear`,
      }}
    />
  ))

  const displayed = [...layers].reverse().find(l => l.shown)?.state ?? requested
  const common = {
    className: cn('relative inline-block shrink-0', className),
    style: { width: size, height: size },
    'data-stinky-state': displayed,
  } as const

  if (isInteractive) {
    return (
      <button
        ref={el => { rootRef.current = el }}
        type='button'
        aria-label={PET_LABEL}
        onClick={pet}
        {...common}
        className={cn(
          common.className,
          'cursor-pointer rounded-full p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [-webkit-tap-highlight-color:transparent]',
        )}
      >
        {images}
        {petFx?.kind === 'purr' && <StinkyPurrFx key={petFx.key} size={size} reducedMotion={reducedMotion} />}
        {petFx?.kind === 'bite' && <StinkyBiteFx key={petFx.key} size={size} reducedMotion={reducedMotion} />}
      </button>
    )
  }

  return (
    <span ref={el => { rootRef.current = el }} {...common} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined}>
      {images}
    </span>
  )
}

export default Stinky
