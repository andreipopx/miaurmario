'use client'

import type { CSSProperties } from 'react'

/** Duration of the whole burst; matches the ~1.5 s bite clip. */
export const BITE_FX_MS = 1500

type Item =
  | { kind: 'word'; text: string; x: number; y: number; delay: number; scale: number; rotate: number; jump: number }
  | { kind: 'mark'; x: number; y: number; delay: number; scale: number; rotate: number }

// Fixed layout (no randomness) so renders are deterministic and SSR-safe. Delays follow the clip:
// the mouth opens at ~120 ms and chomps ("ñam") at ~470 ms and ~800 ms.
const ITEMS: Item[] = [
  { kind: 'word', text: '¡ñam!', x: 78, y: 16, delay: 120, scale: 0.16, rotate: 8, jump: -0.16 },
  { kind: 'mark', x: 86, y: 50, delay: 470, scale: 0.2, rotate: -18 },
  { kind: 'word', text: 'ñac', x: 18, y: 24, delay: 800, scale: 0.12, rotate: -10, jump: -0.12 },
  { kind: 'mark', x: 12, y: 56, delay: 820, scale: 0.17, rotate: 20 },
]

/** Two little rows of tooth marks (a bite doodle). */
function BiteMark({ px }: { px: number }) {
  return (
    <svg viewBox='0 0 32 24' width={px} height={(px * 24) / 32} aria-hidden className='block overflow-visible drop-shadow-sm'>
      <g fill='none' strokeLinecap='round' strokeLinejoin='round' className='stroke-signature' strokeWidth={2.4}>
        <path className='stinky-fx-draw' pathLength={40} d='M3 7 L8 11 L13 6 L18 11 L23 6 L28 10' />
        <path className='stinky-fx-draw' pathLength={40} d='M5 18 L10 14 L15 19 L20 14 L25 18' style={{ animationDelay: 'calc(var(--fx-delay, 0ms) + 80ms)' }} />
      </g>
    </svg>
  )
}

/**
 * "¡ñam!" / "ñac" pops and bite-mark doodles shown while Stinky bites.
 * Mount it with a new `key` per pet so the animation restarts.
 */
export function StinkyBiteFx({ size, reducedMotion }: { size: number; reducedMotion: boolean }) {
  // Reduced motion: a single still "¡ñam!" + one mark, no jumping.
  const items = reducedMotion ? ITEMS.filter((_, i) => i < 2) : ITEMS
  return (
    <span aria-hidden className='pointer-events-none absolute inset-0 overflow-visible'>
      {items.map((item, i) => {
        const style = {
          left: `${item.x}%`,
          top: `${item.y}%`,
          '--fx-rot': `${item.rotate}deg`,
          '--fx-jump': item.kind === 'word' ? `${item.jump * size}px` : '0px',
          '--fx-delay': `${item.delay}ms`,
          animationDelay: reducedMotion ? undefined : `${item.delay}ms`,
          animationDuration: reducedMotion ? undefined : `${BITE_FX_MS - item.delay}ms`,
        } as CSSProperties
        const className = reducedMotion
          ? 'stinky-fx-still-short absolute'
          : item.kind === 'word' ? 'stinky-fx-pop absolute' : 'stinky-fx-mark absolute'
        return (
          <span key={i} className={className} style={style}>
            {item.kind === 'word' ? (
              <span
                className='block whitespace-nowrap font-extrabold italic tracking-tight text-signature [text-shadow:0_1px_0_var(--background)]'
                style={{ fontSize: Math.max(10, Math.round(size * item.scale)) }}
              >
                {item.text}
              </span>
            ) : (
              <BiteMark px={Math.max(12, Math.round(size * item.scale))} />
            )}
          </span>
        )
      })}
    </span>
  )
}
