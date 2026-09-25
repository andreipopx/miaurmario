/**
 * The Ajustes page is where five branches all added a card, so the seam worth
 * guarding is the page as a whole: every card has to be on it at once.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import es from '@/messages/es.json'

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
  location_name: 'Madrid',
  location_lat: 40.4,
  location_lon: -3.7,
  has_password: true,
  body_measurements: null,
}))

const preferences = vi.hoisted(() => ({
  preferred_styles: [],
  disliked_colors: [],
  preferred_colors: [],
  temperature_unit: 'celsius',
  cold_tolerance: 3,
  heat_tolerance: 3,
  formality_preference: 3,
  default_occasion: 'casual',
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'token' }, status: 'authenticated' }),
  signOut: vi.fn(),
}))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme: vi.fn() }) }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}))
vi.mock('@/lib/hooks/use-preferences', () => ({
  usePreferences: () => ({ data: preferences, isLoading: false }),
  useUpdatePreferences: mutation,
  useResetPreferences: mutation,
}))
vi.mock('@/lib/hooks/use-user', () => ({
  useUserProfile: () => ({ data: profile, isLoading: false }),
  useUpdateUserProfile: mutation,
  useUploadAvatar: mutation,
  useDeleteAvatar: mutation,
}))
vi.mock('@/lib/hooks/use-location', async (original) => ({
  ...((await original()) as Record<string, unknown>),
  useAutoTimezone: mutation,
  useDeleteLocation: mutation,
}))
vi.mock('@/lib/hooks/use-password', () => ({
  useSetPassword: mutation,
  useRemovePassword: mutation,
  PasswordRequestError: class extends Error {},
}))
vi.mock('@/lib/hooks/use-ai-access', () => ({
  useAIStatus: () => ({ data: { enabled: true, has_access: true }, isLoading: false }),
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

describe('Ajustes', () => {
  it('shows every card, whichever branch added it', () => {
    render(<SettingsPage />, { wrapper: Providers })

    for (const title of [
      es.settings.account.title,
      es.settings.appearance.title,
      es.settings.haptics.title,
      es.settings.styleQuiz.title,
      es.settings.stinkyMemory.title,
      es.settings.integrations.title,
      es.aiAccess.title,
      es.settings.security.title,
      es.settings.location.title,
      es.settings.colors.title,
      es.settings.styleProfile.title,
      es.settings.comfort.title,
      es.settings.recommendations.title,
    ]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0)
    }
  })
})
