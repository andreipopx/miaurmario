'use client'

/**
 * Stinky as one inline SVG rig (prototype of a vector mascot: see lib/stinky-rig.ts).
 *
 * Same props as `<Stinky>`, but no pre-rendered clips: the coat, eyes and accessory are drawn
 * from data, and every state is the SDK clip's keyframes played on the rig's parts with the Web
 * Animations API (transforms, opacity and a filter; no per-frame JavaScript). A state change
 * glides from the pose on screen into the next clip over its first segment; one-shots end on
 * the neutral pose, the same picture the still rig shows, and then settle. Reduced motion, a
 * missing `animate()` (jsdom) or `paused` show the neutral pose.
 */

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'

import { haptic } from '@/lib/native/haptics'
import {
  COAT_LOOKS, DARK_OUTLINE, EARS, EYES, LIGHT_OUTLINE_WIDTH, MOUTH_NEUTRAL, MOUTH_OPEN, MOUTH_PINK, NEUTRAL_POSE, NOSE, PAW,
  PUPIL_COLOR, STINKY_SHAPES, VIEW, WHISKERS, decal, decalSize, irisColors, pawOpacity, poseAt, poseTransforms, rigTracks, stripePaths,
  triangleDown, type Pose, type RigPart,
} from '@/lib/stinky-rig'
import { DEFAULT_STINKY_COAT } from '@/lib/stinky-persona'
import { cn } from '@/lib/utils'

import type { StinkyProps } from './stinky'
import { StinkyAccessoryArt } from './stinky-accessory'
import { BITE_FX_MS, StinkyBiteFx } from './stinky-bite-fx'
import { STINKY_PET_VIBRATION, pickPetReaction, type StinkyPetReaction } from './stinky-pet'
import { useStinkyPersona } from './stinky-persona'
import { startPurrVibration } from './stinky-purr'
import { PURR_FX_MS, StinkyPurrFx } from './stinky-purr-fx'
import { STINKY_BITE_LEAN, STINKY_STATE_META, resolveStinkyState, type StinkyMouth, type StinkyState } from './stinky-states'
import { prefersReducedMotionNow, usePrefersReducedMotion } from './use-stinky-env'

export type StinkySvgProps = StinkyProps

const PET_STATES: ReadonlySet<StinkyState> = new Set<StinkyState>(['purr', 'bite'])
const PET_FX_MS: Record<StinkyPetReaction, number> = { purr: PURR_FX_MS, bite: BITE_FX_MS }
const PET_THROTTLE_MS = 1200
const ONCE_SLACK_MS = 40
const PARTS: readonly RigPart[] = ['head', 'face', 'eyeL', 'eyeR', 'pupilL', 'pupilR', 'earL', 'earR', 'paw']
const MOUTHS: readonly StinkyMouth[] = ['neutral', 'open', 'bite', 'bite-half']
const isLoop = (s: StinkyState) => STINKY_STATE_META[s].playback === 'loop'
const canAnimate = (el: Element | null): el is Element & { animate: Element['animate'] } => !!el && typeof el.animate === 'function'

/** Bite lean-in toward the camera (scale on the stage), same timing and pivot as the clip. */
function startBiteLean(el: HTMLElement | null): Animation | null {
  if (!canAnimate(el)) return null
  const total = STINKY_BITE_LEAN[STINKY_BITE_LEAN.length - 1]![0]
  el.style.transformOrigin = '50% 51%'
  return el.animate(STINKY_BITE_LEAN.map(([ms, s]) => ({ offset: ms / total, transform: `scale(${s})` })), { duration: total, easing: 'linear' })
}

/** Their own Stinky, as the vector rig: coat, eyes and accessory from the persona unless forced. */
export function StinkySvg({ coat: forcedCoat, eyes: forcedEyes, accessory: forcedAccessory, label, ...props }: StinkySvgProps) {
  const persona = useStinkyPersona()
  const coat = forcedCoat ?? persona.coat
  const eyes = forcedEyes ?? (forcedCoat ? 'natural' : persona.eyes)
  const accessory = forcedAccessory !== undefined ? forcedAccessory : forcedCoat ? null : persona.accessory
  return <StinkySvgHead {...props} coat={coat} eyes={eyes} accessory={accessory} name={persona.name} label={label ?? persona.name} />
}

function StinkySvgHead({
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
  accessory = null,
  name,
  className,
}: StinkySvgProps & { name: string }) {
  const id = useId().replace(/:/g, '')
  const reducedMotion = usePrefersReducedMotion()
  const requested = resolveStinkyState(state)
  const settle = settleTo == null ? null : resolveStinkyState(settleTo)
  const isInteractive = interactive ?? size >= 48
  const look = COAT_LOOKS[coat]
  const [irisL, irisR] = irisColors(coat, eyes)

  const parts = useRef<Partial<Record<RigPart, SVGGElement | null>>>({})
  const mouths = useRef<Partial<Record<StinkyMouth, SVGGElement | null>>>({})
  const gradeRef = useRef<SVGGElement | null>(null)
  const stageRef = useRef<HTMLSpanElement | null>(null)
  const running = useRef<Animation[]>([])
  const playing = useRef<{ state: StinkyState; startedAt: number; live: boolean } | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const petHistory = useRef<StinkyPetReaction[]>([])
  const lastPet = useRef(-Infinity)
  // A one-shot `state` is owed until it has played (or a pet cut it short); a pet cannot swallow it.
  const requestSeq = useRef(0)
  const shownSeq = useRef(-1)
  const doneSeq = useRef(-1)
  const latest = useRef({ requested, settle, onDone, onPet, paused })
  latest.current = { requested, settle, onDone, onPet, paused }
  const [petFx, setPetFx] = useState<{ kind: StinkyPetReaction; key: number } | null>(null)
  const [shown, setShown] = useState<StinkyState>(requested)

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }, [])

  const stop = useCallback(() => {
    running.current.forEach(a => a.cancel())
    running.current = []
    playing.current = null
  }, [])

  /** The pose on screen right now (neutral when nothing plays). */
  const currentPose = useCallback((): Pose => {
    const cur = playing.current
    return cur?.live ? poseAt(cur.state, performance.now() - cur.startedAt) : NEUTRAL_POSE
  }, [])

  const goToRef = useRef<(next: StinkyState) => void>(() => {})

  /** A one-shot has played through; it rests on the neutral pose. */
  const onOnceEnd = useCallback((ended: StinkyState) => {
    const { requested: req, settle: st, onDone: done } = latest.current
    const owed = !isLoop(req) && doneSeq.current !== requestSeq.current
    let next: StinkyState | null
    if (PET_STATES.has(ended)) {
      if (owed && shownSeq.current === requestSeq.current) {
        doneSeq.current = requestSeq.current
        done?.()
        next = st ?? 'idle'
      } else if (owed) next = req
      else next = isLoop(req) ? req : st ?? 'idle'
    } else {
      if (ended === req && owed) {
        doneSeq.current = requestSeq.current
        done?.()
      }
      next = req !== ended && isLoop(req) ? req : st != null && st !== ended ? st : null
    }
    stop()
    if (next) goToRef.current(next)
    else setShown(ended)
  }, [stop])

  const play = useCallback((next: StinkyState, from?: Pose) => {
    stop()
    const meta = STINKY_STATE_META[next]
    const still = prefersReducedMotionNow() || !canAnimate(parts.current.head ?? null)
    const startedAt = performance.now()
    if (!still) {
      const tracks = rigTracks(next, from)
      const opts: KeyframeAnimationOptions = { duration: tracks.durationMs, iterations: tracks.loop ? Infinity : 1 }
      const run = (el: Element | null | undefined, kf: Keyframe[]) => {
        if (el && canAnimate(el)) running.current.push(el.animate(kf, opts))
      }
      for (const p of PARTS) run(parts.current[p], tracks.parts[p])
      if (tracks.grade) run(gradeRef.current, tracks.grade)
      for (const m of MOUTHS) if (tracks.mouths?.[m]) run(mouths.current[m], tracks.mouths[m]!)
      if (next === 'purr') {
        const v = startPurrVibration(stageRef.current)
        if (v) running.current.push(v)
      }
      if (next === 'bite') {
        const v = startBiteLean(stageRef.current)
        if (v) running.current.push(v)
      }
    }
    playing.current = { state: next, startedAt, live: !still }
    if (next === latest.current.requested) shownSeq.current = requestSeq.current
    setShown(next)
    if (PET_STATES.has(next)) {
      const kind = next as StinkyPetReaction
      setPetFx({ kind, key: startedAt })
      later(() => setPetFx(fx => (fx?.key === startedAt ? null : fx)), PET_FX_MS[kind])
    }
    if (!isLoop(next)) {
      const mine = playing.current
      later(() => {
        if (playing.current === mine) onOnceEnd(next)
      }, (still ? Math.min(meta.durationMs, 1200) : meta.durationMs) + ONCE_SLACK_MS)
    }
  }, [later, onOnceEnd, stop])

  const goTo = useCallback((next: StinkyState) => {
    const cur = playing.current
    if (cur && cur.state === next && isLoop(next)) return
    play(next, cur ? currentPose() : undefined)
  }, [currentPose, play])
  goToRef.current = goTo

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
      stop()
    }
  }, [stop])

  // Start with the component; `paused` holds the neutral pose instead.
  useEffect(() => {
    if (paused) {
      stop()
      return
    }
    play(latest.current.requested)
  }, [paused, play, stop])

  // Follow the `state` prop. A pet in progress finishes first and then goes there.
  const firstRequest = useRef(true)
  useEffect(() => {
    if (firstRequest.current) firstRequest.current = false
    else requestSeq.current++
    if (latest.current.paused) return
    const cur = playing.current
    if (cur && PET_STATES.has(cur.state)) return
    goTo(requested)
  }, [requested, goTo])

  // Reduced motion toggled: the same state, live or still.
  useEffect(() => {
    const cur = playing.current
    if (!cur || latest.current.paused || cur.live === !reducedMotion) return
    play(cur.state)
  }, [reducedMotion, play])

  const pet = useCallback(() => {
    const now = performance.now()
    if (now - lastPet.current < PET_THROTTLE_MS) return
    const cur = playing.current
    if (cur && PET_STATES.has(cur.state)) return
    lastPet.current = now
    const reaction = pickPetReaction(petHistory.current)
    petHistory.current = [...petHistory.current, reaction].slice(-4)
    if (!prefersReducedMotionNow()) haptic(STINKY_PET_VIBRATION[reaction])
    latest.current.onPet?.(reaction)
    if (!latest.current.paused) goTo(reaction)
  }, [goTo])

  // ---- drawing (path space: the export's 420-unit viewBox before its 1.34 view scale)
  const neutral = poseTransforms(NEUTRAL_POSE, false)
  const ref = (p: RigPart) => (el: SVGGElement | null) => {
    parts.current[p] = el
  }
  const mouthRef = (m: StinkyMouth) => (el: SVGGElement | null) => {
    mouths.current[m] = el
  }
  // The outline (the only thing the dark look changes) comes from CSS variables: the coat's own on
  // the stage, the cream dark ones on the <svg> under the page's `dark` class — no script, no flash.
  const outline = { style: { stroke: 'var(--stk-ol)', strokeWidth: 'var(--stk-olw)', strokeOpacity: 'var(--stk-olo)', strokeLinejoin: 'round', paintOrder: 'stroke' } as CSSProperties }
  const lightVars = { '--stk-ol': look.outline, '--stk-olw': LIGHT_OUTLINE_WIDTH, '--stk-olo': look.outlineOpacity } as CSSProperties
  const darkVars = { '--stk-ol': DARK_OUTLINE.color, '--stk-olw': DARK_OUTLINE.width, '--stk-olo': DARK_OUTLINE.opacity } as CSSProperties
  const muzzleColor = look.muzzle?.color ?? look.fur
  const mz = { cx: 202.3, cy: 249.4 }
  const bz = { cx: 200.15, cy: 191.55 }

  const ear = (side: 'left' | 'right', part: RigPart, shape: string, inner: string, fur: string) => {
    const { pivot, inner: c } = EARS[side]
    return (
      <g transform={`translate(${pivot.x} ${pivot.y})`}>
        <g ref={ref(part)} transform={neutral[part]}>
          <g transform={`translate(${-pivot.x} ${-pivot.y})`}>
            <path d={shape} fill={fur} {...outline} />
            <g fill={look.earInner} fillOpacity={look.earInnerOpacity}>
              <path id={`${id}${part}`} d={inner} />
            </g>
            {look.earFur && (
              <use
                href={`#${id}${part}`}
                fill={look.earFur}
                fillOpacity={look.earFurOpacity}
                transform={`translate(${c.cx} ${c.cy + EARS.fur.dy}) scale(${EARS.fur.sx} ${EARS.fur.sy}) translate(${-c.cx} ${-c.cy})`}
              />
            )}
          </g>
        </g>
      </g>
    )
  }
  const eye = (side: 'left' | 'right', part: RigPart, pupil: RigPart, iris: string) => {
    const e = EYES[side]
    return (
      <g transform={`translate(${e.cx} ${e.cy})`}>
        <g ref={ref(part)} transform={neutral[part]}>
          <ellipse rx={e.rx} ry={e.ry} fill={iris} />
          <g clipPath={`url(#${id}${part})`}>
            <g transform={`rotate(${-e.rot})`}>
              <g ref={ref(pupil)} transform={neutral[pupil]}>
                <path d={EYES.pupil} fill={PUPIL_COLOR} />
              </g>
            </g>
          </g>
        </g>
      </g>
    )
  }
  const fangs = (y: number, h: number) => {
    const { x: cx, y: top } = decal(0, y)
    const { w, h: hh } = decalSize(MOUTH_OPEN.fangW, h)
    const dx = decalSize(MOUTH_OPEN.fangX, 0).w
    return (
      <>
        <path d={triangleDown(cx - dx, top - hh / 2, w, hh)} fill={MOUTH_OPEN.fang} />
        <path d={triangleDown(cx + dx, top - hh / 2, w, hh)} fill={MOUTH_OPEN.fang} />
      </>
    )
  }
  const patchEl = (p: NonNullable<typeof look.patches>[number], i: number) => {
    const c = decal(p.x, p.y)
    const s = decalSize(p.w, p.h)
    const t = `rotate(${p.rot} ${c.x} ${c.y})`
    return p.shape === 'ellipse' ? (
      <ellipse key={i} cx={c.x} cy={c.y} rx={s.w / 2} ry={s.h / 2} fill={p.color} transform={t} />
    ) : (
      <rect key={i} x={c.x - s.w / 2} y={c.y - s.h / 2} width={s.w} height={s.h} rx={Math.min(s.w, s.h) * 0.42} fill={p.color} transform={t} />
    )
  }

  const svg = (
    <svg
      viewBox='0 0 420 420'
      width={size}
      height={size}
      aria-hidden
      focusable='false'
      className={cn('pointer-events-none absolute inset-0 block h-full w-full select-none overflow-visible', !forcedVariant && 'dark:[--stk-ol:#f5efe6] dark:[--stk-olo:1] dark:[--stk-olw:6]')}
      style={forcedVariant === 'dark' ? darkVars : forcedVariant === 'light' ? lightVars : undefined}
    >
      <defs>
        <clipPath id={`${id}h`}><path d={STINKY_SHAPES.head} /></clipPath>
        <clipPath id={`${id}eyeL`}><ellipse rx={EYES.left.rx} ry={EYES.left.ry} /></clipPath>
        <clipPath id={`${id}eyeR`}><ellipse rx={EYES.right.rx} ry={EYES.right.ry} /></clipPath>
        {look.mask && (
          <radialGradient id={`${id}m`}>
            <stop offset='0.45' stopColor={look.mask} />
            <stop offset='1' stopColor={look.mask} stopOpacity='0' />
          </radialGradient>
        )}
      </defs>
      <g ref={ref('head')} transform={neutral.head}>
        <g transform={`translate(${VIEW.x} ${VIEW.y}) scale(${VIEW.scale})`}>
          <g ref={gradeRef}>
            {/* The outline is drawn first, under every fill, so the head and ears share one silhouette. */}
            <path d={STINKY_SHAPES.head} fill='none' {...outline} />
            {ear('left', 'earL', STINKY_SHAPES.earL, STINKY_SHAPES.earInL, look.earL ?? look.fur)}
            {ear('right', 'earR', STINKY_SHAPES.earR, STINKY_SHAPES.earInR, look.earR ?? look.fur)}
            <path d={STINKY_SHAPES.head} fill={look.fur} />
            <g clipPath={`url(#${id}h)`}>
              <g transform='translate(210 214)'>
                <g ref={ref('face')} transform={neutral.face}>
                  <g transform='translate(-210 -214)'>
                    {look.patches?.map(patchEl)}
                    {look.stripes && (
                      <g fill={look.stripes.color} fillOpacity={look.stripes.opacity}>
                        {stripePaths(look.stripes.forehead).map((d, i) => <path key={i} d={d} />)}
                      </g>
                    )}
                    {look.mask && (
                      <>
                        <ellipse cx='200.6' cy='227.6' rx='78' ry='71' fill={`url(#${id}m)`} />
                        <ellipse cx='200.6' cy='198' rx='24' ry='38' fill={`url(#${id}m)`} />
                      </>
                    )}
                    {look.muzzle && (
                      <path
                        d={STINKY_SHAPES.muzzle}
                        fill={look.muzzle.color}
                        transform={`translate(${mz.cx} ${mz.cy + look.muzzle.dy}) scale(${look.muzzle.sx} ${look.muzzle.sy}) translate(${-mz.cx} ${-mz.cy})`}
                      />
                    )}
                    {look.blaze && (
                      <path
                        d={STINKY_SHAPES.blaze}
                        fill={look.blaze.color}
                        transform={`translate(${bz.cx} ${bz.cy}) scale(${look.blaze.sx} ${look.blaze.sy}) translate(${-bz.cx} ${-bz.cy})`}
                      />
                    )}
                    <g stroke={look.whisker} strokeOpacity={look.whiskerOpacity} strokeWidth='1.6' strokeLinecap='round'>
                      {WHISKERS.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />)}
                    </g>
                    {/* One mouth at a time: the ":3", or an open / fanged / half-closed one during a clip. */}
                    <g ref={mouthRef('neutral')}>
                      {[-1, 1].map(s => (
                        <g key={s}>
                          <ellipse cx={MOUTH_NEUTRAL.cx + s * MOUTH_NEUTRAL.dx} cy={MOUTH_NEUTRAL.lip.y} rx={MOUTH_NEUTRAL.lip.rx} ry={MOUTH_NEUTRAL.lip.ry} fill={MOUTH_PINK} />
                          <ellipse cx={MOUTH_NEUTRAL.cx + s * MOUTH_NEUTRAL.dx} cy={MOUTH_NEUTRAL.carve.y} rx={MOUTH_NEUTRAL.carve.rx} ry={MOUTH_NEUTRAL.carve.ry} fill={muzzleColor} />
                        </g>
                      ))}
                    </g>
                    <g ref={mouthRef('open')} opacity='0'>
                      <ellipse {...MOUTH_OPEN.open.mouth} fill={MOUTH_OPEN.color} />
                      <ellipse {...MOUTH_OPEN.open.tongue} fill={MOUTH_OPEN.tongue} />
                    </g>
                    <g ref={mouthRef('bite')} opacity='0'>
                      <ellipse {...MOUTH_OPEN.bite.mouth} fill={MOUTH_OPEN.color} />
                      <ellipse {...MOUTH_OPEN.bite.tongue} fill={MOUTH_OPEN.tongue} />
                      {fangs(MOUTH_OPEN.bite.fang.y, MOUTH_OPEN.bite.fang.h)}
                    </g>
                    <g ref={mouthRef('bite-half')} opacity='0'>
                      <ellipse {...MOUTH_OPEN['bite-half'].mouth} fill={MOUTH_OPEN.color} />
                      {fangs(MOUTH_OPEN['bite-half'].fang.y, MOUTH_OPEN['bite-half'].fang.h)}
                    </g>
                    <path d={NOSE} fill={look.nose} />
                    {eye('left', 'eyeL', 'pupilL', irisL)}
                    {eye('right', 'eyeR', 'pupilR', irisR)}
                  </g>
                </g>
              </g>
            </g>
            <g transform={`translate(${PAW.cx} ${PAW.cy})`}>
              <g ref={ref('paw')} transform={neutral.paw} opacity={pawOpacity(NEUTRAL_POSE)}>
                <ellipse rx={PAW.rx} ry={PAW.ry} fill={look.paw ?? look.fur} {...outline} />
              </g>
            </g>
          </g>
        </g>
        {/* What he wears rides inside the head group, so it bobs with him (chin at ~80% of the 0–100 box). */}
        {accessory && (
          <g transform='scale(4.2)'>
            <StinkyAccessoryArt accessory={accessory} />
          </g>
        )}
      </g>
    </svg>
  )

  const decorative = !isInteractive && label === ''
  const body = (
    <>
      {/* The purr rumble and the bite lean move the head only, not the fx around it. */}
      <span ref={stageRef} className='absolute inset-0 block' style={lightVars} aria-hidden>
        {svg}
      </span>
      {petFx?.kind === 'purr' && <StinkyPurrFx key={petFx.key} size={size} reducedMotion={reducedMotion} />}
      {petFx?.kind === 'bite' && <StinkyBiteFx key={petFx.key} size={size} reducedMotion={reducedMotion} />}
    </>
  )
  const common = {
    className: cn('relative inline-block shrink-0', className),
    style: { width: size, height: size },
    'data-stinky-state': shown,
    'data-stinky-rig': reducedMotion || paused ? 'still' : 'live',
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

export default StinkySvg
