import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import React from 'react'

import {
  ALL_TIP_KEYS,
  MIN_ITEMS_FOR_LOOKS,
  TOUR_KEY,
  firstStepsStage,
  mergeSeen,
  shouldAutoOpenTour,
  shouldShowTip,
  skipAllKeys,
  tipKeyForPath,
  unsyncedKeys,
} from '@/lib/onboarding/first-run'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

// ---- mocks -----------------------------------------------------------------------

const h = vi.hoisted(() => ({
  pathname: '/dashboard',
  user: null as null | Record<string, unknown>,
  patch: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// The real hook reads ['auth-user']; keep that contract so optimistic cache writes show up.
vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => {
    const q = useQuery({ queryKey: ['auth-user'], queryFn: () => h.user, initialData: h.user, staleTime: Infinity })
    return { user: q.data ?? undefined, isAuthenticated: !!q.data, isLoading: false }
  },
}))

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, patch: h.patch, get: vi.fn().mockResolvedValue(undefined) } }
})

vi.mock('@/lib/hooks/use-notifications', () => ({
  useNotificationPreferences: () => ({ data: undefined }),
}))

vi.mock('@/components/stinky/stinky', () => ({
  Stinky: ({ state }: { state?: string }) => <span data-testid="stinky" data-state={state} />,
}))

vi.mock('@/components/native/lazy-stinky', () => ({
  LazyStinky: ({ state }: { state?: string }) => <span data-testid="lazy-stinky" data-state={state} />,
}))

import { FeatureTour } from '@/components/onboarding/feature-tour'
import { AreaTip } from '@/components/onboarding/area-tip'
import { FirstStepsCard } from '@/components/onboarding/first-steps-card'
import { openFeatureTour } from '@/lib/hooks/use-seen-tips'

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="es" messages={es}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

const baseUser = (seen: string[] | undefined) => ({
  id: 'u1',
  email: 'a@b.c',
  username: 'ana',
  display_name: 'ana',
  role: 'member',
  timezone: 'UTC',
  onboarding_completed: true,
  seen_tips: seen,
})

beforeEach(() => {
  h.patch.mockReset()
  h.patch.mockImplementation(async (_url: string, body: { add?: string[] }) => ({
    seen_tips: body.add ?? [],
  }))
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
  window.localStorage.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---- pure rules ----------------------------------------------------------------

describe('first-run rules', () => {
  it('auto-opens the tour once: onboarded, handle chosen, not seen yet', () => {
    expect(shouldAutoOpenTour(baseUser([]))).toBe(true)
    expect(shouldAutoOpenTour(baseUser(['tip.wardrobe']))).toBe(true)
    expect(shouldAutoOpenTour(baseUser([TOUR_KEY]))).toBe(false)
    // Seen on this device but the PATCH failed: still never again here.
    expect(shouldAutoOpenTour(baseUser([]), [TOUR_KEY])).toBe(false)
    expect(shouldAutoOpenTour({ ...baseUser([]), onboarding_completed: false })).toBe(false)
    expect(shouldAutoOpenTour({ ...baseUser([]), username: null })).toBe(false)
    // Old backend without the field: show nothing rather than on every visit.
    expect(shouldAutoOpenTour(baseUser(undefined))).toBe(false)
    expect(shouldAutoOpenTour(null)).toBe(false)
  })

  it('maps areas (and their sub-pages) to one tip each; Hoy has none', () => {
    expect(tipKeyForPath('/dashboard')).toBeNull()
    expect(tipKeyForPath('/dashboard/wardrobe')).toBe('tip.wardrobe')
    expect(tipKeyForPath('/dashboard/outfits/abc')).toBe('tip.wardrobe')
    expect(tipKeyForPath('/dashboard/suggest')).toBe('tip.stylist')
    expect(tipKeyForPath('/dashboard/music')).toBe('tip.inspo')
    expect(tipKeyForPath('/dashboard/family/feed')).toBe('tip.inspo')
    expect(tipKeyForPath('/dashboard/stinky')).toBe('tip.stinky')
    expect(tipKeyForPath('/dashboard/family')).toBe('tip.settings')
    expect(tipKeyForPath('/dashboard/settings/integrations')).toBe('tip.settings')
    expect(tipKeyForPath('/dashboard/admin')).toBeNull()
    expect(tipKeyForPath(null)).toBeNull()
  })

  it('shows a tip only after the tour and until dismissed', () => {
    expect(shouldShowTip(baseUser([]), 'tip.wardrobe')).toBe(false) // tour first
    expect(shouldShowTip(baseUser([TOUR_KEY]), 'tip.wardrobe')).toBe(true)
    expect(shouldShowTip(baseUser([TOUR_KEY, 'tip.wardrobe']), 'tip.wardrobe')).toBe(false)
    expect(shouldShowTip(baseUser([TOUR_KEY]), 'tip.wardrobe', ['tip.wardrobe'])).toBe(false)
    expect(shouldShowTip(baseUser(skipAllKeys()), 'tip.settings')).toBe(false)
    expect(shouldShowTip(baseUser([TOUR_KEY]), null)).toBe(false)
  })

  it('"Saltar todo" covers the tour and every area tip', () => {
    expect(skipAllKeys()).toEqual([TOUR_KEY, ...ALL_TIP_KEYS])
    expect(ALL_TIP_KEYS).toHaveLength(5)
  })

  it('merges server and device state and finds what still needs syncing', () => {
    expect(mergeSeen(['tour'], ['tour', 'tip.stinky'])).toEqual(['tour', 'tip.stinky'])
    expect(mergeSeen(undefined, ['tour'])).toEqual(['tour'])
    expect(unsyncedKeys(['tour'], ['tour', 'tip.stinky'])).toEqual(['tip.stinky'])
  })

  it('uses the suggestion engine minimum for the Hoy first steps', () => {
    expect(MIN_ITEMS_FOR_LOOKS).toBe(2)
    expect(firstStepsStage(0)).toBe('empty')
    expect(firstStepsStage(1)).toBe('progress')
    expect(firstStepsStage(2)).toBe('ready')
    expect(firstStepsStage(40)).toBe('ready')
  })

  it('has the same firstRun keys in both locales', () => {
    const flat = (o: unknown, p = ''): string[] =>
      typeof o === 'object' && o
        ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k))
        : [p]
    expect(flat(en.firstRun).sort()).toEqual(flat(es.firstRun).sort())
    expect(en.nav.howItWorks).toBeTruthy()
    expect(es.nav.howItWorks).toBe('Cómo funciona')
  })
})

// ---- welcome tour ------------------------------------------------------------------

describe('FeatureTour', () => {
  it('opens by itself when not seen, and "Siguiente" / arrow keys walk the cards', async () => {
    h.user = baseUser([])
    renderWithProviders(<FeatureTour />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Paso 1 de 5')
    expect(screen.getByTestId('stinky')).toHaveAttribute('data-state', 'wave')

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(dialog).toHaveTextContent('Paso 2 de 5')
    expect(screen.getByTestId('stinky')).toHaveAttribute('data-state', 'thinking')

    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(dialog).toHaveTextContent('Paso 3 de 5')
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    expect(dialog).toHaveTextContent('Paso 2 de 5')

    fireEvent.click(screen.getByRole('button', { name: 'Ir al paso 5' }))
    expect(dialog).toHaveTextContent('Paso 5 de 5')
    expect(screen.getByRole('link', { name: /Cómo instalarla/ })).toHaveAttribute('href', '/dashboard/install')

    fireEvent.click(screen.getByRole('button', { name: '¡A por ello!' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(h.patch).toHaveBeenCalledWith('/users/me/seen-tips', { add: [TOUR_KEY] })
  })

  it('stays closed when already seen', () => {
    h.user = baseUser([TOUR_KEY])
    renderWithProviders(<FeatureTour />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"Saltar todo" marks the tour and every tip', async () => {
    h.user = baseUser([])
    renderWithProviders(<FeatureTour />)
    fireEvent.click(await screen.findByRole('button', { name: 'Saltar todo' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(h.patch).toHaveBeenCalledWith('/users/me/seen-tips', { add: skipAllKeys() })
  })

  it('does not block or come back on this device when saving fails', async () => {
    h.user = baseUser([])
    h.patch.mockRejectedValue(new Error('offline'))
    const first = renderWithProviders(<FeatureTour />)
    fireEvent.click(await screen.findByRole('button', { name: 'Saltar todo' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    first.unmount()

    // Next load: the server still says "not seen", but this device remembers.
    renderWithProviders(<FeatureTour />)
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('re-opens from the profile menu ("Cómo funciona") even when seen', async () => {
    h.user = baseUser([TOUR_KEY])
    renderWithProviders(<FeatureTour />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => openFeatureTour())
    expect(await screen.findByRole('dialog')).toHaveTextContent('Paso 1 de 5')
  })
})

// ---- area tips -------------------------------------------------------------------------

describe('AreaTip', () => {
  it('shows once per area after the tour and hides for good on dismiss', async () => {
    h.user = baseUser([TOUR_KEY])
    h.pathname = '/dashboard/wardrobe'
    renderWithProviders(<AreaTip />)
    expect(screen.getByTestId('area-tip')).toHaveTextContent('aquí vive tu ropa')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar consejo' }))
    await waitFor(() => expect(screen.queryByTestId('area-tip')).not.toBeInTheDocument())
    expect(h.patch).toHaveBeenCalledWith('/users/me/seen-tips', { add: ['tip.wardrobe'] })
  })

  it('never shows before the tour, on Hoy, or after "Saltar todo"', () => {
    h.pathname = '/dashboard/suggest'
    h.user = baseUser([])
    const a = renderWithProviders(<AreaTip />)
    expect(screen.queryByTestId('area-tip')).not.toBeInTheDocument()
    a.unmount()

    h.user = baseUser(skipAllKeys())
    const b = renderWithProviders(<AreaTip />)
    expect(screen.queryByTestId('area-tip')).not.toBeInTheDocument()
    b.unmount()

    h.pathname = '/dashboard'
    h.user = baseUser([TOUR_KEY])
    renderWithProviders(<AreaTip />)
    expect(screen.queryByTestId('area-tip')).not.toBeInTheDocument()
  })
})

// ---- Hoy first steps --------------------------------------------------------------------

describe('FirstStepsCard', () => {
  it('invites the first upload when empty', () => {
    renderWithProviders(<FirstStepsCard count={0} />)
    expect(screen.getByRole('heading', { name: 'Sube tu primera prenda' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Subir prenda/ })).toHaveAttribute('href', '/dashboard/wardrobe?add=1')
  })

  it('shows progress towards the engine minimum', () => {
    renderWithProviders(<FirstStepsCard count={1} />)
    expect(screen.getByText(`1 de ${MIN_ITEMS_FOR_LOOKS} prendas para que Stinky empiece a proponerte looks`)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })
})
