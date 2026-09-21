'use client'

/* eslint-disable @next/next/no-img-element -- animated WebP must bypass next/image optimisation */

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

import {
  STINKY_STATE_META,
  resolveStinkyState,
  stinkyAssets,
  type StinkyState,
  type StinkyStateInput,
  type StinkyVariant,
} from './stinky-states'
import { usePrefersReducedMotion, useStinkyVariant } from './use-stinky-env'

export interface StinkyProps {
  /** Animation state (aliases such as `working` or `celebrate` map onto a shipped state). */
  state?: StinkyStateInput
  /** Rendered size in CSS px (square). Assets are 320px, crisp up to ~160px @2x. */
  size?: number
  /** State to show after a `once` state finishes. Pass `null` to keep the finished state. */
  settleTo?: StinkyStateInput | null
  /** Force a variant; defaults to the next-themes resolved theme. */
  variant?: StinkyVariant
  /** Called when a `once` state has played through. */
  onDone?: () => void
  /** Accessible label; pass `''` to mark Stinky as decorative. */
  label?: string
  className?: string
}

/**
 * Stinky, the Miaurmario mascot, as pre-rendered animation (no runtime deps).
 *
 * - Animated WebP with alpha; browsers without WebP get the state's still PNG.
 * - prefers-reduced-motion → static vector poster of the state.
 * - Dark theme → cream-outlined variant so the black cat stays legible.
 */
export function Stinky({
  state = 'idle',
  size = 128,
  settleTo = 'idle',
  variant: forcedVariant,
  onDone,
  label = 'Stinky',
  className,
}: StinkyProps) {
  const reducedMotion = usePrefersReducedMotion()
  const variant = useStinkyVariant(forcedVariant)
  const requested = resolveStinkyState(state)
  const settle = settleTo == null ? null : resolveStinkyState(settleTo)
  const [shown, setShown] = useState<StinkyState>(requested)
  // Bumping the key restarts the animated image from frame 0 when a state is requested again.
  const [playId, setPlayId] = useState(0)

  useEffect(() => {
    setShown(requested)
    setPlayId(id => id + 1)
  }, [requested])

  useEffect(() => {
    const meta = STINKY_STATE_META[shown]
    if (meta.playback !== 'once' || shown !== requested) return
    // Under reduced motion the state's poster is held for the same time.
    const timer = window.setTimeout(() => {
      onDone?.()
      if (settle != null && settle !== shown) setShown(settle)
    }, meta.durationMs)
    return () => window.clearTimeout(timer)
  }, [shown, requested, settle, onDone, playId])

  const assets = stinkyAssets(shown, variant)
  const decorative = label === ''
  const alt = decorative ? '' : label
  const common = {
    width: size,
    height: size,
    draggable: false,
    className: 'block h-full w-full select-none',
  } as const

  return (
    <span
      className={cn('inline-block shrink-0', className)}
      style={{ width: size, height: size }}
      data-stinky-state={shown}
      aria-hidden={decorative || undefined}
    >
      {reducedMotion ? (
        <img src={assets.poster} alt={alt} {...common} />
      ) : (
        <picture key={`${shown}-${variant}-${playId}`}>
          <source srcSet={assets.webp} type='image/webp' />
          <img src={assets.posterPng} alt={alt} {...common} />
        </picture>
      )}
    </span>
  )
}

export default Stinky
