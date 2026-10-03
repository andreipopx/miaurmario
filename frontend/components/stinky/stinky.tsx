'use client'

/* eslint-disable @next/next/no-img-element -- animated WebP must bypass next/image optimisation */

import { useCallback, useEffect, useRef, useState } from 'react'

import { haptic } from '@/lib/native/haptics'
import { cn } from '@/lib/utils'

import {
  STINKY_LIKELY_NEXT,
  STINKY_STATE_META,
  resolveStinkyState,
  stinkyAssets,
  stinkyNeutralStill,
  type StinkyState,
  type StinkyStateInput,
  type StinkyVariant,
} from './stinky-states'
import { BITE_FX_MS, StinkyBiteFx } from './stinky-bite-fx'
import { STINKY_PET_VIBRATION, pickPetReaction, type StinkyPetReaction } from './stinky-pet'
import { startPurrVibration } from './stinky-purr'
import { PURR_FX_MS, StinkyPurrFx } from './stinky-purr-fx'
import { currentStinkyVariant, prefersReducedMotionNow, usePrefersReducedMotion, useStinkyVariant } from './use-stinky-env'
import { useStinkyPersona } from './stinky-persona'
import { DEFAULT_STINKY_COAT, type StinkyCoat, type StinkyEyes } from '@/lib/stinky-persona'

export interface StinkyProps {
  /** Animation state (aliases such as `working` or `celebrate` map onto a shipped state). */
  state?: StinkyStateInput
  /** Rendered size in CSS px (square). Assets are 512px (256px for small sizes). */
  size?: number
  /** State to show after a `once` state finishes. Pass `null` to keep the finished state on screen. */
  settleTo?: StinkyStateInput | null
  /** Force a variant; defaults to the page's theme (the `dark` class on <html>). */
  variant?: StinkyVariant
  /** Called when a requested `once` state has played through. */
  onDone?: () => void
  /** Tap/click/Enter/Space pets Stinky (plays `purr` or, sometimes, a playful `bite`, then returns). Default: `size >= 48`. */
  interactive?: boolean
  /** Called when Stinky is petted, with the reaction he chose. */
  onPet?: (reaction: StinkyPetReaction) => void
  /** Accessible label when not interactive; pass `''` to mark Stinky as decorative. */
  label?: string
  /** Hold the still neutral head and release the animation (off screen, app in the background). */
  paused?: boolean
  /** Which coat to draw. Default: the person's own Stinky (Ajustes → Tu Stinky). */
  coat?: StinkyCoat
  /** Eye colour; default: the person's choice (or the coat's own eyes when `coat` is forced). */
  eyes?: StinkyEyes
  className?: string
}

/*
 * How clips hand over (see README.md, "Seamless splicing").
 *
 * Every clip starts and ends on the same neutral frame, and the one-shot clips are
 * encoded to play once, so they rest on it when they finish. A switch therefore waits
 * for the playing clip to reach that frame and then *cuts*: the next clip, already
 * fetched and decoded, goes on top in the same frame and the old one is dropped.
 * Nothing moves, nothing fades. Only when that frame is too far away (a tap mid-way
 * through a loop) does it cross-fade: the new clip fades in over the old one, then
 * the old one fades out, so no outline is left behind to pop.
 *
 * Every timer belongs to one switch (`gen`) and is ignored once another switch has
 * started, and the clock of a clip starts on the frame it is first shown.
 */

const FADE_IN_MS = 140
const FADE_OUT_MS = 110
/** The neutral end of every clip lasts 133–600 ms; cut this long before the nominal end. */
const CUT_LEAD_MS = 70
/** Within this much of a clip's start or end it is on (or next to) the neutral frame. */
const NEUTRAL_HEAD_MS = 30
const NEUTRAL_TAIL_MS = 130
/**
 * A one-shot clip is over this long after its nominal end. It then rests on its last frame,
 * or, should a decoder read "loop once" as "repeat once", is on frame 0 of a replay, which
 * is the same picture: either way the still neutral head can take over.
 */
const ONCE_SLACK_MS = 40
/** Longest wait for a neutral frame instead of cross-fading: a state change… */
const MAX_WAIT_MS = 900
/** …and a pet, which has to answer the tap. */
const MAX_WAIT_PET_MS = 350
/** Minimum time between two pets. */
const PET_THROTTLE_MS = 1200
/**
 * Heads drawn this small or smaller use the 256 px clips (sharp up to 3x screens, a quarter of
 * the decoding). Decided from the size prop, not measured, so the still drawn on the server and
 * the clip that follows always come from the same file size.
 */
const SMALL_MAX_SIZE = 85
/** Reactions to a pet: they return to whatever Stinky should be doing when they finish. */
const PET_STATES: ReadonlySet<StinkyState> = new Set<StinkyState>(['purr', 'bite'])
const PET_FX_MS: Record<StinkyPetReaction, number> = { purr: PURR_FX_MS, bite: BITE_FX_MS }

const isLoop = (s: StinkyState) => STINKY_STATE_META[s].playback === 'loop'

// ---- clip cache: one fetch per clip; each play gets a fresh object URL so the animation restarts at frame 0.
// Failed fetches are forgotten, so a clip that failed offline is fetched again later.
const blobCache = new Map<string, Promise<Blob>>()
function fetchClip(url: string): Promise<Blob> {
  let pending = blobCache.get(url)
  if (!pending) {
    pending = fetch(url).then(r => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status} ${url}`))))
    pending.catch(() => blobCache.delete(url))
    blobCache.set(url, pending)
  }
  return pending
}

interface Clip {
  readonly src: string
  /** An object URL this component must revoke. */
  readonly blob: boolean
  /** A still image (reduced motion, or the clip could not be fetched). */
  readonly still: boolean
  readonly variant: StinkyVariant
}

const releaseClip = (clip: Clip) => {
  if (clip.blob) URL.revokeObjectURL(clip.src)
}

/** Fetch and decode a clip before it is shown, so it appears whole on its first frame. */
async function prepareClip(
  state: StinkyState,
  variant: StinkyVariant,
  small: boolean,
  still: boolean,
  coat: StinkyCoat,
  eyes: StinkyEyes,
): Promise<Clip> {
  const assets = stinkyAssets(state, variant, { small, coat, eyes })
  const decode = async (src: string) => {
    const img = new Image()
    img.src = src
    try {
      await img.decode()
    } catch {
      /* shown anyway; onError swaps in the PNG */
    }
  }
  if (!still) {
    try {
      const src = URL.createObjectURL(await fetchClip(assets.webp))
      await decode(src)
      return { src, blob: true, still: false, variant }
    } catch {
      /* offline or missing: the still frame below */
    }
  }
  const src = state === 'idle' ? stinkyNeutralStill(variant, { small, coat, eyes }) : assets.poster
  await decode(src)
  return { src, blob: false, still: true, variant }
}

interface Layer {
  readonly key: number
  readonly state: StinkyState
  readonly clip: Clip
  /** cut: visible at once · in: fading in · on: visible · out: fading out, then removed. */
  readonly phase: 'cut' | 'in' | 'on' | 'out'
}

interface Playing {
  readonly key: number
  readonly state: StinkyState
  readonly still: boolean
  readonly variant: StinkyVariant
  /** performance.now() of the frame it was first shown on (its frame 0). */
  readonly startedAt: number
}

/**
 * Their own Stinky: his coat and name come from the person's choice unless forced. A new coat
 * is a new set of clips, so the head starts over from that coat's neutral frame.
 */
export function Stinky({ coat: forcedCoat, eyes: forcedEyes, label, ...props }: StinkyProps) {
  const persona = useStinkyPersona()
  const coat = forcedCoat ?? persona.coat
  const eyes = forcedEyes ?? (forcedCoat ? 'natural' : persona.eyes)
  return (
    <StinkyHead key={`${coat}/${eyes}`} {...props} coat={coat} eyes={eyes} name={persona.name} label={label ?? persona.name} />
  )
}

function StinkyHead({
  state = 'idle',
  size = 128,
  settleTo = 'idle',
  variant: forcedVariant,
  onDone,
  interactive,
  onPet,
  label,
  paused = false,
  coat = DEFAULT_STINKY_COAT,
  eyes = 'natural',
  name,
  className,
}: StinkyProps & { name: string }) {
  const reducedMotion = usePrefersReducedMotion()
  const variant = useStinkyVariant(forcedVariant)
  const requested = resolveStinkyState(state)
  const settle = settleTo == null ? null : resolveStinkyState(settleTo)
  const isInteractive = interactive ?? size >= 48

  const [layers, setLayers] = useState<Layer[]>([])
  // The still neutral head under everything until the first clip is on screen.
  const [baseVisible, setBaseVisible] = useState(true)
  // Pet overlay: hearts + "prrr" for purr, "¡ñam!" + bite marks for bite; a new key restarts it.
  const [petFx, setPetFx] = useState<{ kind: StinkyPetReaction; key: number } | null>(null)

  const playing = useRef<Playing | null>(null)
  /** State of the switch in progress (fetched, waiting for its frame, or mounting). */
  const target = useRef<StinkyState | null>(null)
  const gen = useRef(0)
  const keyRef = useRef(1)
  const shakeRef = useRef<HTMLSpanElement | null>(null)
  const vibration = useRef<Animation | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const frames = useRef(new Set<number>())
  const petHistory = useRef<StinkyPetReaction[]>([])
  const lastPet = useRef(-Infinity)
  const alive = useRef(true)
  // Each change of the `state` prop is a request; a one-shot request is owed until it
  // has played (or was shown and cut short by a pet), so a pet can't swallow it.
  const requestSeq = useRef(0)
  const shownSeq = useRef(-1)
  const doneSeq = useRef(-1)
  const latest = useRef({ requested, settle, onDone, onPet, size, forcedVariant, paused })
  latest.current = { requested, settle, onDone, onPet, size, forcedVariant, paused }

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, Math.max(0, ms))
    timers.current.add(id)
  }, [])

  const nextFrame = useCallback((fn: (now: number) => void) => {
    const id = requestAnimationFrame(now => {
      frames.current.delete(id)
      fn(now)
    })
    frames.current.add(id)
  }, [])

  const variantNow = useCallback(
    () => latest.current.forcedVariant ?? currentStinkyVariant(),
    [],
  )
  const smallNow = useCallback(() => latest.current.size <= SMALL_MAX_SIZE, [])

  const preload = useCallback((s: StinkyState) => {
    if (prefersReducedMotionNow()) return
    void fetchClip(stinkyAssets(s, variantNow(), { small: smallNow(), coat, eyes }).webp).catch(() => {})
  }, [smallNow, variantNow, coat, eyes])

  // Forward declaration: a finished clip starts the next switch.
  const goToRef = useRef<(next: StinkyState, opts?: { pet?: boolean; force?: boolean }) => void>(() => {})

  /** A one-shot clip has played through (it now rests on the neutral frame). */
  const onOnceEnd = useCallback((ended: StinkyState) => {
    const { requested: req, settle: st, onDone: done } = latest.current
    const owed = !isLoop(req) && doneSeq.current !== requestSeq.current
    let next: StinkyState | null
    if (PET_STATES.has(ended)) {
      if (owed && shownSeq.current === requestSeq.current) {
        // The pet interrupted it: it counts as played, and settles from here.
        doneSeq.current = requestSeq.current
        done?.()
        next = st ?? 'idle'
      } else if (owed) {
        // Asked for while he was being petted: play it now.
        next = req
      } else {
        next = isLoop(req) ? req : st ?? 'idle'
      }
    } else {
      if (ended === req && owed) {
        doneSeq.current = requestSeq.current
        done?.()
      }
      // A loop asked for meanwhile (e.g. "thinking" during a wave) wins over settling.
      next = req !== ended && isLoop(req) ? req : st != null && st !== ended ? st : null
    }
    if (next) {
      goToRef.current(next)
    } else {
      // Staying on the finished one-shot: hand over to the still neutral head (the same
      // picture), so nothing depends on how a decoder treats the end of a clip.
      gen.current++
      target.current = null
      vibration.current?.cancel()
      setBaseVisible(true)
      setLayers(prev => {
        prev.forEach(l => releaseClip(l.clip))
        return []
      })
    }
  }, [])

  /** The frame a mounted layer is first painted on: it becomes the playing clip. */
  const activate = useCallback((layer: Layer) => {
    nextFrame(now => {
      if (!alive.current) return
      const started: Playing = {
        key: layer.key,
        state: layer.state,
        still: layer.clip.still,
        variant: layer.clip.variant,
        startedAt: now,
      }
      playing.current = started
      if (target.current === layer.state) target.current = null
      if (layer.state === latest.current.requested) shownSeq.current = requestSeq.current
      setBaseVisible(false)

      if (layer.phase === 'cut') {
        // The old layers were hidden as this one went up; drop them now it's painted.
        nextFrame(() =>
          setLayers(prev => {
            prev.filter(l => l.key < layer.key).forEach(l => releaseClip(l.clip))
            return prev.filter(l => l.key >= layer.key)
          }),
        )
      } else {
        setLayers(prev => prev.map(l => (l.key === layer.key ? { ...l, phase: 'on' } : l)))
        later(() => {
          setLayers(prev => prev.map(l => (l.key < layer.key ? { ...l, phase: 'out' } : l)))
          later(() =>
            setLayers(prev => {
              prev.filter(l => l.key < layer.key).forEach(l => releaseClip(l.clip))
              return prev.filter(l => l.key >= layer.key)
            }),
          FADE_OUT_MS + 30)
        }, FADE_IN_MS)
      }

      vibration.current?.cancel()
      vibration.current =
        layer.state === 'purr' && !layer.clip.still ? startPurrVibration(shakeRef.current) : null
      if (PET_STATES.has(layer.state)) {
        const kind = layer.state as StinkyPetReaction
        setPetFx({ kind, key: now })
        later(() => setPetFx(fx => (fx?.key === now ? null : fx)), PET_FX_MS[kind])
      }
      if (!isLoop(layer.state)) {
        const meta = STINKY_STATE_META[layer.state]
        later(() => {
          if (playing.current?.key === layer.key) onOnceEnd(layer.state)
        }, (layer.clip.still ? Math.min(meta.durationMs, 1200) : meta.durationMs) + ONCE_SLACK_MS)
      }
      STINKY_LIKELY_NEXT[layer.state].forEach(preload)
    })
  }, [later, nextFrame, onOnceEnd, preload])

  /** How long until the playing clip is on its neutral frame, or null if that is too far off. */
  const waitForNeutral = (limit: number): number | null => {
    const cur = playing.current
    if (!cur || cur.still) return 0
    const dur = STINKY_STATE_META[cur.state].durationMs
    const elapsed = performance.now() - cur.startedAt
    if (!isLoop(cur.state) && elapsed >= dur - NEUTRAL_TAIL_MS) return 0 // finished, or on its last frame
    const into = isLoop(cur.state) ? elapsed % dur : elapsed
    if (into <= NEUTRAL_HEAD_MS || into >= dur - NEUTRAL_TAIL_MS) return 0
    const wait = dur - CUT_LEAD_MS - into
    return wait <= limit ? wait : null
  }

  const goTo = useCallback((next: StinkyState, opts: { pet?: boolean; force?: boolean } = {}) => {
    if (!opts.force) {
      if (target.current === next) return
      if (target.current == null && playing.current?.state === next && isLoop(next)) return
    }
    const my = ++gen.current
    target.current = next
    const still = prefersReducedMotionNow()
    const preparing = prepareClip(next, variantNow(), smallNow(), still, coat, eyes)
    void preparing.then(clip => {
      if (my !== gen.current || !alive.current) return releaseClip(clip)
      const limit = opts.pet ? MAX_WAIT_PET_MS : MAX_WAIT_MS
      const mount = (cut: boolean) => {
        if (my !== gen.current || !alive.current) return releaseClip(clip)
        // Changing look (light ↔ dark) is never "the same picture": fade, don't cut.
        const sameLook = !playing.current || playing.current.variant === clip.variant
        const layer: Layer = {
          key: keyRef.current++,
          state: next,
          clip,
          phase: still || (cut && sameLook) ? 'cut' : 'in',
        }
        setLayers(prev => [...prev, layer])
      }
      const wait = waitForNeutral(limit)
      if (wait == null) return mount(false)
      if (wait <= 0) return mount(true)
      later(() => {
        // The clock may have slipped while waiting (a busy main thread): check again.
        const again = waitForNeutral(limit)
        mount(again === 0 || (again != null && again < 40))
      }, wait)
    })
  }, [later, smallNow, variantNow, coat, eyes])
  goToRef.current = goTo

  // Start (and stop) with the component; `paused` holds the still head instead.
  useEffect(() => {
    alive.current = true
    const pendingTimers = timers.current
    const pendingFrames = frames.current
    return () => {
      alive.current = false
      gen.current++
      pendingTimers.forEach(clearTimeout)
      pendingTimers.clear()
      pendingFrames.forEach(cancelAnimationFrame)
      pendingFrames.clear()
      vibration.current?.cancel()
    }
  }, [])

  useEffect(() => {
    if (paused) {
      gen.current++
      target.current = null
      playing.current = null
      vibration.current?.cancel()
      setBaseVisible(true)
      setLayers(prev => {
        prev.forEach(l => releaseClip(l.clip))
        return []
      })
      return
    }
    // From the still neutral head (== frame 0 of every clip): a clean cut.
    goTo(latest.current.requested, { force: true })
  }, [paused, goTo])

  // Follow the `state` prop. A pet in progress finishes first and then goes there.
  const firstRequest = useRef(true)
  useEffect(() => {
    if (firstRequest.current) firstRequest.current = false
    else requestSeq.current++
    if (latest.current.paused) return
    const cur = playing.current
    if ((cur && PET_STATES.has(cur.state)) || (target.current && PET_STATES.has(target.current))) return
    goTo(requested)
  }, [requested, goTo])

  // Theme or reduced-motion change: the same state in the other look (only if what
  // is playing doesn't already match, e.g. it started after the theme was known).
  useEffect(() => {
    const cur = playing.current
    if (latest.current.paused || !cur) return
    // A switch on its way was prepared in the old look: prepare it again.
    if (target.current) return goTo(target.current, { force: true })
    if (cur.variant === variant && cur.still === reducedMotion) return
    // A one-shot finishes in the look it started in; whatever follows uses the new one.
    if (!isLoop(cur.state)) return
    goTo(cur.state, { force: true })
  }, [variant, reducedMotion, goTo])

  // Warm up what is likely next (+ the pet reactions when petting is possible).
  useEffect(() => {
    if (paused) return
    STINKY_LIKELY_NEXT[requested].forEach(preload)
    if (isInteractive) {
      preload('purr')
      preload('bite')
    }
  }, [requested, isInteractive, preload, variant, paused])

  const pet = useCallback(() => {
    const now = performance.now()
    if (now - lastPet.current < PET_THROTTLE_MS) return
    const cur = playing.current
    if ((cur && PET_STATES.has(cur.state)) || (target.current && PET_STATES.has(target.current))) return
    lastPet.current = now
    // ~65% purr / ~35% playful bite, never three bites in a row.
    const reaction = pickPetReaction(petHistory.current)
    petHistory.current = [...petHistory.current, reaction].slice(-4)
    // The tap is answered at once by the phone; Stinky reacts on his next neutral frame.
    if (!prefersReducedMotionNow()) haptic(STINKY_PET_VIBRATION[reaction])
    latest.current.onPet?.(reaction)
    if (!latest.current.paused) goTo(reaction, { pet: true })
  }, [goTo])

  const decorative = !isInteractive && label === ''
  const imgClass = 'pointer-events-none absolute inset-0 block h-full w-full select-none'
  const small = size <= SMALL_MAX_SIZE
  const base = forcedVariant ? (
    <img src={stinkyNeutralStill(forcedVariant, { small, coat, eyes })} alt='' aria-hidden draggable={false} width={size} height={size} className={imgClass} />
  ) : (
    <>
      {/* Both looks, picked by the theme class before any script runs: no light flash in dark mode. */}
      <img src={stinkyNeutralStill('light', { small, coat, eyes })} alt='' aria-hidden draggable={false} width={size} height={size} className={cn(imgClass, 'dark:hidden')} />
      <img src={stinkyNeutralStill('dark', { small, coat, eyes })} alt='' aria-hidden draggable={false} width={size} height={size} className={cn(imgClass, 'hidden dark:block')} />
    </>
  )

  /**
   * A cut layer is the same picture as what's under it, so it must replace it in one
   * frame: shown together they draw the soft edges twice (a bolder outline), and hiding
   * the old one first risks an empty frame. So the new <img> goes in hidden, is decoded
   * as an element, and then — in one task, so one frame — it's shown and everything
   * below it hidden. React removes the hidden ones on the next frames.
   */
  const revealCut = (el: HTMLImageElement, layer: Layer) => {
    el.style.visibility = 'hidden'
    void el
      .decode()
      .catch(() => {})
      .then(() => {
        if (!alive.current || !el.isConnected) return
        el.style.visibility = ''
        for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
          ;(sib as HTMLElement).style.visibility = 'hidden'
        }
        activate(layer)
      })
  }

  const images = layers.map(layer => (
    <img
      key={layer.key}
      src={layer.clip.src}
      alt=''
      width={size}
      height={size}
      draggable={false}
      decoding='sync'
      aria-hidden
      ref={el => {
        if (!el || el.dataset.started) return
        if (layer.phase === 'cut') {
          el.dataset.started = '1'
          revealCut(el, layer)
        } else if (el.complete && el.naturalWidth > 0) {
          // Decoded beforehand, so usually complete before React could attach onLoad.
          el.dataset.started = '1'
          activate(layer)
        }
      }}
      onLoad={e => {
        if (e.currentTarget.dataset.started) return
        e.currentTarget.dataset.started = '1'
        activate(layer)
      }}
      onError={e => {
        const fallback = stinkyAssets(layer.state, variantNow(), { coat, eyes }).posterPng
        if (e.currentTarget.src.endsWith(fallback)) return
        e.currentTarget.src = fallback
      }}
      className={imgClass}
      style={{
        opacity: layer.phase === 'in' || layer.phase === 'out' ? 0 : 1,
        transition:
          layer.phase === 'out'
            ? `opacity ${FADE_OUT_MS}ms linear`
            : layer.phase === 'on'
              ? `opacity ${FADE_IN_MS}ms linear`
              : undefined,
      }}
    />
  ))

  const displayed = playing.current?.state ?? requested
  const body = (
    <>
      {/* The purr rumble moves the head only, not the hearts around it. */}
      <span ref={shakeRef} className='absolute inset-0 block' aria-hidden>
        {baseVisible && base}
        {images}
      </span>
      {petFx?.kind === 'purr' && <StinkyPurrFx key={petFx.key} size={size} reducedMotion={reducedMotion} />}
      {petFx?.kind === 'bite' && <StinkyBiteFx key={petFx.key} size={size} reducedMotion={reducedMotion} />}
    </>
  )
  const common = {
    className: cn('relative inline-block shrink-0', className),
    style: { width: size, height: size },
    'data-stinky-state': displayed,
  } as const

  if (isInteractive) {
    return (
      <button
        type='button'
        aria-label={`Acariciar a ${name}`}
        onClick={pet}
        {...common}
        className={cn(
          common.className,
          'cursor-pointer rounded-full p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [-webkit-tap-highlight-color:transparent]',
        )}
      >
        {body}
      </button>
    )
  }

  return (
    <span {...common} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined}>
      {body}
    </span>
  )
}

export default Stinky
