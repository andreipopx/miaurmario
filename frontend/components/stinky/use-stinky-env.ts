'use client'

import { useSyncExternalStore } from 'react'

import type { StinkyVariant } from './stinky-states'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Reduce Motion right now (false on the server). */
export function prefersReducedMotionNow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
}

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia(REDUCED_MOTION)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** `true` when the user asked the OS to reduce motion. SSR-safe (false on the server). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotionNow, () => false)
}

/**
 * The page's theme as next-themes applies it: the `dark` class on <html>, which its
 * inline script sets before the first paint. Read straight from the DOM so a dark
 * page never starts with the light Stinky (the theme hook only knows after mount).
 */
export function currentStinkyVariant(): StinkyVariant {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function subscribeTheme(onChange: () => void) {
  if (typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** Light/dark asset variant following the page's theme (dark variant has a cream outline). */
export function useStinkyVariant(forced?: StinkyVariant): StinkyVariant {
  const live = useSyncExternalStore(subscribeTheme, currentStinkyVariant, () => 'light' as StinkyVariant)
  return forced ?? live
}
