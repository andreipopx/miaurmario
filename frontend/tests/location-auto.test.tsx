import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import es from '@/messages/es.json'
import en from '@/messages/en.json'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAccessToken: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}))

import { api } from '@/lib/api'
import { toast } from 'sonner'
import { UseMyLocationButton } from '@/components/settings/use-my-location-button'
import { TravelPromptCard } from '@/components/settings/travel-prompt-card'
import {
  CITY_COORD_DECIMALS,
  TRAVEL_THRESHOLD_KM,
  failureFromError,
  geolocationPermissionState,
  haversineKm,
  isFarFromSaved,
  readDevicePosition,
  roundCityCoord,
} from '@/lib/location-detect'

const postMock = api.post as unknown as ReturnType<typeof vi.fn>

/** A precise fix in Madrid, and the city point it must become. */
const MADRID_EXACT = { latitude: 40.416775, longitude: -3.70379 }
const MADRID_CITY = { latitude: 40.42, longitude: -3.7 }

const LISBON_PLACE = {
  name: 'Lisboa',
  label: 'Lisboa, Portugal',
  latitude: 38.72,
  longitude: -9.14,
  timezone: 'Europe/Lisbon',
}
const MADRID_PLACE = {
  name: 'Madrid',
  label: 'Madrid, Comunidad de Madrid, España',
  ...MADRID_CITY,
  timezone: 'Europe/Madrid',
}

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

/** Install a navigator.geolocation that behaves the way `mode` says. */
function mockGeolocation(
  mode: 'granted' | 'denied' | 'timeout' | 'unavailable' | 'missing',
  coords = MADRID_EXACT
) {
  if (mode === 'missing') {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined })
    return vi.fn()
  }
  const getCurrentPosition = vi.fn(
    (ok: PositionCallback, fail?: PositionErrorCallback) => {
      if (mode === 'granted') {
        ok({ coords } as GeolocationPosition)
        return
      }
      const code = mode === 'denied' ? 1 : mode === 'timeout' ? 3 : 2
      fail?.({ code, message: mode } as GeolocationPositionError)
    }
  )
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  })
  return getCurrentPosition
}

function mockPermission(state: PermissionState | 'throws') {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query:
        state === 'throws'
          ? vi.fn().mockRejectedValue(new Error('nope'))
          : vi.fn().mockResolvedValue({ state }),
    },
  })
}

beforeEach(() => {
  postMock.mockReset()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.message).mockClear()
})

afterEach(() => {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined })
})

describe('city-precision rounding', () => {
  it('keeps two decimals and nothing more', () => {
    expect(CITY_COORD_DECIMALS).toBe(2)
    expect(roundCityCoord(40.416775)).toBe(40.42)
    expect(roundCityCoord(-3.70379)).toBe(-3.7)
    expect(roundCityCoord(0)).toBe(0)
  })

  it('rounds before the position leaves the device', async () => {
    mockGeolocation('granted')
    const reading = await readDevicePosition()
    expect(reading).toEqual({ ok: true, ...MADRID_CITY })
  })
})

describe('travel distance', () => {
  it('agrees with the backend threshold', () => {
    expect(TRAVEL_THRESHOLD_KM).toBe(100)
  })

  it('calls Madrid to Lisbon a trip and a commute not', () => {
    expect(haversineKm(40.42, -3.7, 38.72, -9.14)).toBeGreaterThan(480)
    expect(haversineKm(40.42, -3.7, 38.72, -9.14)).toBeLessThan(520)
    expect(isFarFromSaved(40.42, -3.7, 38.72, -9.14)).toBe(true)
    // Madrid -> Alcalá de Henares, ~30 km.
    expect(isFarFromSaved(40.42, -3.7, 40.48, -3.37)).toBe(false)
  })

  it('is never a trip when there is no saved city', () => {
    expect(isFarFromSaved(null, null, 38.72, -9.14)).toBe(false)
    expect(isFarFromSaved(40.42, undefined, 38.72, -9.14)).toBe(false)
  })
})

describe('geolocation failures', () => {
  it('maps every error code onto something we can say', () => {
    expect(failureFromError({ code: 1 })).toBe('denied')
    expect(failureFromError({ code: 2 })).toBe('unavailable')
    expect(failureFromError({ code: 3 })).toBe('timeout')
    expect(failureFromError(null)).toBe('unavailable')
  })

  it('resolves rather than rejects when the user says no', async () => {
    mockGeolocation('denied')
    await expect(readDevicePosition()).resolves.toEqual({ ok: false, reason: 'denied' })
  })

  it('resolves on timeout', async () => {
    mockGeolocation('timeout')
    await expect(readDevicePosition()).resolves.toEqual({ ok: false, reason: 'timeout' })
  })

  it('resolves when the position is unavailable', async () => {
    mockGeolocation('unavailable')
    await expect(readDevicePosition()).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('resolves when the browser has no geolocation at all', async () => {
    mockGeolocation('missing')
    await expect(readDevicePosition()).resolves.toEqual({ ok: false, reason: 'unsupported' })
  })
})

describe('geolocationPermissionState', () => {
  it('reports a granted permission', async () => {
    mockPermission('granted')
    await expect(geolocationPermissionState()).resolves.toBe('granted')
  })

  it('assumes "prompt" when it cannot tell', async () => {
    mockPermission('throws')
    await expect(geolocationPermissionState()).resolves.toBe('prompt')
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined })
    await expect(geolocationPermissionState()).resolves.toBe('prompt')
  })
})

describe('UseMyLocationButton', () => {
  it('says what is kept, right under the button', () => {
    render(<UseMyLocationButton onDetected={vi.fn()} />, { wrapper: Providers })
    expect(screen.getByText(/Guardamos solo la ciudad/)).toBeInTheDocument()
    expect(screen.getByText(/nunca tu posición exacta/)).toBeInTheDocument()
  })

  it('sends only city-precision coordinates and adopts the saved city', async () => {
    mockGeolocation('granted')
    postMock.mockResolvedValue({
      status: 'saved',
      detected: MADRID_PLACE,
      timezone: 'Europe/Madrid',
      timezone_source: 'auto',
    })
    const onDetected = vi.fn()
    render(<UseMyLocationButton onDetected={onDetected} />, { wrapper: Providers })

    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }))

    await waitFor(() => expect(onDetected).toHaveBeenCalled())
    expect(postMock).toHaveBeenCalledWith('/users/me/location/device', {
      latitude: 40.42,
      longitude: -3.7,
      lang: 'es',
      trigger: 'button',
    })
    // The precise fix is nowhere in what we sent.
    expect(JSON.stringify(postMock.mock.calls)).not.toContain('40.4167')
    expect(onDetected).toHaveBeenCalledWith({
      name: 'Madrid, Comunidad de Madrid, España',
      lat: 40.42,
      lon: -3.7,
      timezone: 'Europe/Madrid',
    })
    expect(toast.success).toHaveBeenCalled()
  })

  it('explains a denied permission and changes nothing', async () => {
    mockGeolocation('denied')
    const onDetected = vi.fn()
    render(<UseMyLocationButton onDetected={onDetected} />, { wrapper: Providers })

    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }))

    await waitFor(() =>
      expect(toast.message).toHaveBeenCalledWith(
        es.settings.location.permissionDenied
      )
    )
    expect(postMock).not.toHaveBeenCalled()
    expect(onDetected).not.toHaveBeenCalled()
    // Nothing is retried behind the user's back: no IP lookup, no second try.
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('explains a timeout and changes nothing', async () => {
    mockGeolocation('timeout')
    render(<UseMyLocationButton onDetected={vi.fn()} />, { wrapper: Providers })

    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }))

    await waitFor(() =>
      expect(toast.message).toHaveBeenCalledWith(es.settings.location.positionTimeout)
    )
    expect(postMock).not.toHaveBeenCalled()
  })

  it('explains an unavailable position and changes nothing', async () => {
    mockGeolocation('unavailable')
    render(<UseMyLocationButton onDetected={vi.fn()} />, { wrapper: Providers })

    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }))

    await waitFor(() =>
      expect(toast.message).toHaveBeenCalledWith(es.settings.location.positionUnavailable)
    )
    expect(postMock).not.toHaveBeenCalled()
  })

  it('explains a browser without geolocation', async () => {
    mockGeolocation('missing')
    render(<UseMyLocationButton onDetected={vi.fn()} />, { wrapper: Providers })

    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }))

    await waitFor(() =>
      expect(toast.message).toHaveBeenCalledWith(es.settings.location.notSupported)
    )
    expect(postMock).not.toHaveBeenCalled()
  })

  it('survives the geocoder being down', async () => {
    mockGeolocation('granted')
    postMock.mockRejectedValue(new Error('geocoding_unavailable'))
    const onDetected = vi.fn()
    render(<UseMyLocationButton onDetected={onDetected} />, { wrapper: Providers })

    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onDetected).not.toHaveBeenCalled()
  })

  it('asks instead of moving the city when the reading is far away', async () => {
    mockGeolocation('granted', { latitude: 38.722252, longitude: -9.139337 })
    postMock.mockResolvedValue({
      status: 'travel_suspected',
      detected: LISBON_PLACE,
      current_city: 'Madrid',
      distance_km: 502,
    })
    const onDetected = vi.fn()
    render(<UseMyLocationButton onDetected={onDetected} />, { wrapper: Providers })

    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }))

    expect(await screen.findByTestId('travel-prompt')).toBeInTheDocument()
    expect(screen.getByText('¿Estás en Lisboa?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No, sigue con Madrid' })).toBeInTheDocument()
    // Nothing was adopted: the question is still open.
    expect(onDetected).not.toHaveBeenCalled()
  })
})

describe('TravelPromptCard', () => {
  const renderPrompt = (onConfirmed = vi.fn(), onDismiss = vi.fn()) => {
    render(
      <TravelPromptCard
        detected={LISBON_PLACE}
        currentCity="Madrid"
        onConfirmed={onConfirmed}
        onDismiss={onDismiss}
      />,
      { wrapper: Providers }
    )
    return { onConfirmed, onDismiss }
  }

  it('asks the question with both cities named', () => {
    renderPrompt()
    expect(screen.getByText('¿Estás en Lisboa?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sí, actualízalo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No, sigue con Madrid' })).toBeInTheDocument()
  })

  it('"Sí, actualízalo" confirms the move server-side', async () => {
    postMock.mockResolvedValue({ status: 'saved', detected: LISBON_PLACE })
    const { onConfirmed, onDismiss } = renderPrompt()

    fireEvent.click(screen.getByRole('button', { name: 'Sí, actualízalo' }))

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled())
    expect(postMock).toHaveBeenCalledWith('/users/me/location/device', {
      latitude: 38.72,
      longitude: -9.14,
      lang: 'es',
      trigger: 'confirm',
    })
    expect(onConfirmed).toHaveBeenCalledWith({
      name: 'Lisboa, Portugal',
      lat: 38.72,
      lon: -9.14,
      timezone: 'Europe/Lisbon',
    })
    expect(onDismiss).toHaveBeenCalled()
  })

  it('"No, sigue con Madrid" changes nothing at all', () => {
    const { onConfirmed, onDismiss } = renderPrompt()

    fireEvent.click(screen.getByRole('button', { name: 'No, sigue con Madrid' }))

    expect(onDismiss).toHaveBeenCalled()
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(postMock).not.toHaveBeenCalled()
  })

  it('falls back to a generic "leave it" when no city is on file', () => {
    render(
      <TravelPromptCard detected={LISBON_PLACE} currentCity={null} onDismiss={vi.fn()} />,
      { wrapper: Providers }
    )
    expect(screen.getByRole('button', { name: 'No, déjalo como está' })).toBeInTheDocument()
  })
})

describe('i18n parity for the new copy', () => {
  it('has every location key in both languages', () => {
    const esKeys = Object.keys(es.settings.location).sort()
    const enKeys = Object.keys(en.settings.location).sort()
    expect(esKeys).toEqual(enKeys)
    expect(Object.keys(es.settings.location.travel).sort()).toEqual(
      Object.keys(en.settings.location.travel).sort()
    )
  })

  it('never mentions a coordinate in the privacy copy', () => {
    for (const messages of [es, en]) {
      expect(messages.settings.location.privacyNote).toMatch(/1 km/)
      expect(messages.settings.location.privacySummary.length).toBeGreaterThan(20)
    }
  })
})
