'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

import type { StinkyVariant } from './stinky-states'

/** `true` when the user asked the OS to reduce motion. SSR-safe (false on the server). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

/** Light/dark asset variant following next-themes (dark variant has a cream outline). */
export function useStinkyVariant(forced?: StinkyVariant): StinkyVariant {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (forced) return forced
  // Before hydration we cannot know the theme; light is the safe default.
  return mounted && resolvedTheme === 'dark' ? 'dark' : 'light'
}
