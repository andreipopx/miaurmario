'use client'

import type { CSSProperties } from 'react'

/** Duration of the whole burst; matches the ~2.6 s purr clip. */
export const PURR_FX_MS = 2600

type Particle = {
  kind: 'heart' | 'prrr'
  /** Horizontal start, % of the avatar width. */
  x: number
  /** Horizontal drift while rising, % of the avatar width. */
  dx: number
  delay: number
  /** Size relative to the avatar (heart side / font size). */
  scale: number
  rotate: number
}

// Fixed layout (no randomness) so renders are deterministic and SSR-safe.
const PARTICLES: Particle[] = [
  { kind: 'heart', x: 18, dx: -10, delay: 0, scale: 0.16, rotate: -14 },
  { kind: 'prrr', x: 70, dx: 8, delay: 150, scale: 0.13, rotate: 8 },
  { kind: 'heart', x: 88, dx: -2, delay: 420, scale: 0.12, rotate: 12 },
  { kind: 'heart', x: 44, dx: -4, delay: 780, scale: 0.1, rotate: -6 },
  { kind: 'prrr', x: 14, dx: -6, delay: 1050, scale: 0.11, rotate: -10 },
  { kind: 'heart', x: 62, dx: 10, delay: 1300, scale: 0.14, rotate: 10 },
]

function Heart({ px }: { px: number }) {
  return (
    <svg viewBox='0 0 24 24' width={px} height={px} aria-hidden className='block drop-shadow-sm'>
      <path
        d='M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.9 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21z'
        className='fill-signature stroke-background'
        strokeWidth={1.5}
      />
    </svg>
  )
}

/**
 * Floating hearts and "prrr" bubbles shown while Stinky purrs.
 * Mount it with a new `key` per pet so the animation restarts.
 */
export function StinkyPurrFx({ size, reducedMotion }: { size: number; reducedMotion: boolean }) {
  // Reduced motion: a single still heart + "prrr", no floating.
  const particles = reducedMotion ? PARTICLES.filter((_, i) => i < 2) : PARTICLES
  return (
    <span aria-hidden className='pointer-events-none absolute inset-0 overflow-visible'>
      {particles.map((p, i) => {
        const style = {
          left: `${p.x}%`,
          top: '18%',
          '--fx-dx': `${(p.dx / 100) * size}px`,
          '--fx-rise': `${-0.75 * size}px`,
          '--fx-rot': `${p.rotate}deg`,
          animationDelay: `${p.delay}ms`,
          animationDuration: `${PURR_FX_MS - p.delay}ms`,
        } as CSSProperties
        return (
          <span
            key={i}
            className={reducedMotion ? 'stinky-fx-still absolute' : 'stinky-fx-float absolute'}
            style={style}
          >
            {p.kind === 'heart' ? (
              <Heart px={Math.max(10, Math.round(size * p.scale))} />
            ) : (
              <span
                className='block whitespace-nowrap font-extrabold italic tracking-tight text-signature [text-shadow:0_1px_0_var(--background)]'
                style={{ fontSize: Math.max(10, Math.round(size * p.scale)) }}
              >
                prrr
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}
