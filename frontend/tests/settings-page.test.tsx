/**
 * Ajustes is a navigation list: every setting is a row that opens its own
 * screen, and each screen saves only its own fields.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import es from '@/messages/es.json'

const h = vi.hoisted(() => ({
  updatePreferences: vi.fn().mockResolvedValue({}),
  updateProfile: vi.fn().mockResolvedValue({}),
}))

const mutation = vi.hoisted(
  () => () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  })
)

const profile = vi.hoisted(() => ({
  id: 'u1',
  username: 'andrei',
  email: 'a@example.com',
  display_name: 'Andrei',
  avatar_url: null,
  timezone: 'Europe/Madrid',
  timezone_source: 'auto',
  location_name: 'Madrid, Comunidad de Madrid, España',
  location_lat: 40.4,
  location_lon: -3.7,
  has_password: true,
  body_measurements: { height: 180, shirt_size: 'M' },
}))

const preferences = vi.hoisted(() => ({
  color_favorites: ['black', 'olive'],
  color_avoid: ['orange'],
  style_profile: { casual: 50, formal: 50, sporty: 50, minimalist: 50, bold: 50 },
  temperature_unit: 'celsius',
  temperature_sensitivity: 'normal',
  cold_threshold: 10,
  hot_threshold: 25,
  layering_preference: 'moderate',
  avoid_repeat_days: 7,
  prefer_underused_items: true,
  variety_level: 'moderate',
  default_occasion: 'casual',
  ai_endpoints: [],
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'token' }, status: 'authenticated' }),
  signOut: vi.fn(),
}))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}))
vi.mock('@/lib/hooks/use-preferences', () => ({
  usePreferences: () => ({ data: preferences, isLoading: false }),
  useUpdatePreferences: () => ({ ...mutation(), mutateAsync: h.updatePreferences }),
  useResetPreferences: mutation,
}))
vi.mock('@/lib/hooks/use-user', () => ({
  useUserProfile: () => ({ data: profile, isLoading: false }),
  useUpdateUserProfile: () => ({ ...mutation(), mutateAsync: h.updateProfile }),
  useUploadAvatar: mutation,
  useDeleteAvatar: mutation,
}))
vi.mock('@/lib/hooks/use-location', async (original) => ({
  ...((await original()) as Record<string, unknown>),
  useAutoTimezone: mutation,
  useDeleteLocation: mutation,
}))
vi.mock('@/lib/hooks/use-ai-access', () => ({
  useAIStatus: () => ({ data: { access: 'platform', is_admin: false }, isLoading: false }),
}))
vi.mock('@/lib/hooks/use-lastfm', () => ({
  useLastfmStatus: () => ({ data: { connected: true, configured: true }, isLoading: false }),
}))
vi.mock('@/lib/hooks/use-spotify', () => ({
  useSpotifyStatus: () => ({ data: { connected: false, configured: false }, isLoading: false }),
}))
vi.mock('@/lib/hooks/use-pinterest', () => ({
  usePinterestStatus: () => ({ data: { connected: false, configured: false }, isLoading: false }),
}))
vi.mock('@/components/stinky/stinky-persona', () => ({
  useStinkyPersona: () => ({ name: 'Mishi', coat: 'esmoquin', eyes: 'natural', voice: 'gato', accessory: null }),
}))
vi.mock('@/lib/api', async (original) => {
  const real = (await original()) as Record<string, unknown>
  return {
    ...real,
    api: { get: vi.fn().mockResolvedValue({}), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
    setAccessToken: vi.fn(),
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard/settings',
  useSearchParams: () => new URLSearchParams(),
}))

import SettingsPage from '@/app/dashboard/settings/page'
import ColorsSettingsPage from '@/app/dashboard/settings/colors/page'
import RecommendationsSettingsPage from '@/app/dashboard/settings/recommendations/page'
import MeasurementsSettingsPage from '@/app/dashboard/settings/measurements/page'
import IntegrationsIndexPage from '@/app/dashboard/settings/integrations/page'
import { SETTINGS } from '@/components/nav-items'

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  h.updatePreferences.mockClear()
  h.updateProfile.mockClear()
  // Radix (sliders) wants a ResizeObserver; next/link's prefetch wants an
  // IntersectionObserver. jsdom has neither.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  globalThis.IntersectionObserver = class {
    root = null
    rootMargin = ''
    thresholds: number[] = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
})

const rowLink = (label: string) => screen.getByRole('link', { name: new RegExp(`^${label}`) })

describe('Ajustes', () => {
  it('is a list: one row per screen, each linking to its route', () => {
    render(<SettingsPage />, { wrapper: Providers })

    const rows: [string, string][] = [
      [es.settings.account.title, '/dashboard/settings/account'],
      [es.settings.appearance.title, '/dashboard/settings/appearance'],
      [es.settings.security.title, '/dashboard/settings/security'],
      [es.settings.rows.stinky, '/dashboard/stinky/customize'],
      [es.settings.rows.style, '/dashboard/settings/style'],
      [es.settings.stinkyMemory.title, '/dashboard/settings/memory'],
      [es.settings.rows.ai, '/dashboard/settings/ai'],
      [es.settings.location.title, '/dashboard/settings/location'],
      [es.settings.measurements.title, '/dashboard/settings/measurements'],
      [es.settings.colors.title, '/dashboard/settings/colors'],
      [es.settings.recommendations.title, '/dashboard/settings/recommendations'],
      [es.settings.notifications.title, '/dashboard/notifications'],
      [es.settings.integrations.title, '/dashboard/settings/integrations'],
    ]
    for (const [label, href] of rows) {
      expect(rowLink(label).getAttribute('href'), label).toBe(href)
    }
    // No explanations under the title, no global save/reset.
    expect(screen.queryByRole('button', { name: es.common.save })).toBeNull()
    expect(screen.queryByRole('button', { name: es.settings.header.reset })).toBeNull()
  })

  it('shows the current value on the right where it helps', () => {
    render(<SettingsPage />, { wrapper: Providers })
    expect(within(rowLink(es.settings.account.title)).getByText('Andrei')).toBeTruthy()
    expect(within(rowLink(es.settings.appearance.title)).getByText(es.settings.appearance.themeLight)).toBeTruthy()
    expect(within(rowLink(es.settings.security.title)).getByText(es.settings.rows.password)).toBeTruthy()
    expect(within(rowLink(es.settings.rows.stinky)).getByText('Mishi')).toBeTruthy()
    expect(within(rowLink(es.settings.location.title)).getByText('Madrid')).toBeTruthy()
    expect(within(rowLink(es.settings.integrations.title)).getByText('Last.fm')).toBeTruthy()
    // The admin's gift is a grey «Acceso incluido», not a pink badge.
    expect(within(rowLink(es.settings.rows.ai)).getByText(es.aiAccess.access.platform)).toBeTruthy()
    expect(es.aiAccess.access.platform).toBe('Acceso incluido')
  })

  it('registers every subpage as a hidden tab of Ajustes, so nothing shows a tab strip', () => {
    const hrefs = SETTINGS.tabs.map((t) => t.href)
    for (const href of [
      '/dashboard/settings/account',
      '/dashboard/settings/appearance',
      '/dashboard/settings/security',
      '/dashboard/settings/location',
      '/dashboard/settings/measurements',
      '/dashboard/settings/colors',
      '/dashboard/settings/recommendations',
      '/dashboard/notifications',
      '/dashboard/settings/integrations',
    ]) {
      expect(hrefs, href).toContain(href)
    }
    expect(SETTINGS.tabs.filter((t) => !t.hidden).map((t) => t.href)).toEqual(['/dashboard/settings'])
  })
})

describe('Ajustes · Colores', () => {
  it('is one picker with a «Me gustan / Evito» switch, and saves only the colour fields', async () => {
    render(<ColorsSettingsPage />, { wrapper: Providers })

    const like = screen.getByRole('tab', { name: new RegExp(es.settings.colors.segmentLike) })
    const avoid = screen.getByRole('tab', { name: new RegExp(es.settings.colors.segmentAvoid) })
    expect(like.getAttribute('aria-selected')).toBe('true')
    // Only one palette on the page.
    expect(screen.getAllByText(es.colorPicker.allColors)).toHaveLength(1)

    fireEvent.click(avoid)
    // Move «olive» from favourites to the avoid list.
    fireEvent.click(screen.getByRole('button', { name: es.tagValues.colors.olive, pressed: false }))
    fireEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(h.updatePreferences).toHaveBeenCalledTimes(1))
    expect(h.updatePreferences).toHaveBeenCalledWith({
      color_favorites: ['black'],
      color_avoid: ['orange', 'olive'],
    })
  })
})

describe('Ajustes · Recomendaciones', () => {
  it('saves only its own preference fields', async () => {
    render(<RecommendationsSettingsPage />, { wrapper: Providers })
    const days = screen.getByLabelText(es.settings.recommendations.avoidRepeatDays) as HTMLInputElement
    fireEvent.change(days, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(h.updatePreferences).toHaveBeenCalledTimes(1))
    const body = h.updatePreferences.mock.calls[0][0]
    expect(body.avoid_repeat_days).toBe(3)
    expect(body.default_occasion).toBe('casual')
    expect('color_favorites' in body).toBe(false)
    expect('ai_endpoints' in body).toBe(false)
  })
})

describe('Ajustes · Medidas', () => {
  it('saves measurements in metric whatever the display unit', async () => {
    localStorage.setItem('wardrowbe_unit_system', 'metric')
    render(<MeasurementsSettingsPage />, { wrapper: Providers })
    const height = screen.getByLabelText(es.settings.measurements.fields.height) as HTMLInputElement
    expect(height.value).toBe('180')
    fireEvent.change(height, { target: { value: '182' } })
    fireEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(h.updateProfile).toHaveBeenCalledTimes(1))
    expect(h.updateProfile).toHaveBeenCalledWith({ body_measurements: { height: 182, shirt_size: 'M' } })
  })
})

describe('Integraciones', () => {
  it('is a list of rows with a status, and no «Empieza por aquí»', () => {
    render(<IntegrationsIndexPage />, { wrapper: Providers })
    expect(within(rowLink('Last.fm')).getByText(es.integrations.status.connected)).toBeTruthy()
    expect(within(rowLink('Spotify')).getByText(es.integrations.status.unavailable)).toBeTruthy()
    expect(within(rowLink('Pinterest')).getByText(es.integrations.status.pending)).toBeTruthy()
    expect(screen.queryByText(/Empieza por aquí/)).toBeNull()
    expect(es.integrations.status.notConnected).toBe('Conectar')
  })
})
