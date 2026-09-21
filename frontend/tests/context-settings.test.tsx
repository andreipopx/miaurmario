import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import es from '@/messages/es.json'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAccessToken: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}))

import { api } from '@/lib/api'
import { LocationPicker } from '@/components/settings/location-picker'
import { TimezoneCombobox } from '@/components/settings/timezone-combobox'
import { ColorPreferences } from '@/components/settings/color-preferences'
import { humanizeTagValue, useTagLabel } from '@/lib/tag-labels'
import { useClothingTypeLabel } from '@/lib/clothing-type-label'

const MADRID = {
  name: 'Madrid',
  admin1: 'Comunidad de Madrid',
  country: 'España',
  country_code: 'ES',
  latitude: 40.4165,
  longitude: -3.70256,
  timezone: 'Europe/Madrid',
  label: 'Madrid, Comunidad de Madrid, España',
}

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

const getMock = api.get as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  getMock.mockReset()
  // Radix Slider (lightness) constructs a ResizeObserver.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

describe('useTagLabel', () => {
  it('shows AI tag values in Spanish', () => {
    const { result } = renderHook(() => useTagLabel(), { wrapper: Providers })
    const label = result.current
    expect(label('colors', 'tan')).toBe('Camel')
    expect(label('colors', 'navy')).toBe('Azul marino')
    expect(label('materials', 'leather')).toBe('Cuero')
    expect(label('patterns', 'polka-dot')).toBe('Lunares')
    expect(label('seasons', 'all-season')).toBe('Todo el año')
    expect(label('formality', 'smart-casual')).toBe('Smart casual')
    expect(label('styles', 'classic')).toBe('Clásico')
    expect(label('fit', 'relaxed')).toBe('Holgado')
    expect(label('types', 't-shirt')).toBe('Camiseta')
    expect(label('colors', 'Chartreuse-ish')).toBe('Chartreuse ish')
    expect(label('materials', 'a.b')).toBe('A.b')
    expect(label('colors', undefined)).toBe('')
  })

  it('keeps useClothingTypeLabel on the same map', () => {
    const { result } = renderHook(() => useClothingTypeLabel(), { wrapper: Providers })
    expect(result.current('sneakers')).toBe('Zapatillas')
    expect(result.current('cape-coat')).toBe('Cape coat')
  })

  it('humanizes unknown values', () => {
    expect(humanizeTagValue('army-green')).toBe('Army green')
    expect(humanizeTagValue('')).toBe('')
  })
})

describe('LocationPicker', () => {
  it('searches cities and saves name, coordinates and timezone', async () => {
    getMock.mockResolvedValue({ results: [MADRID] })
    const onChange = vi.fn()
    render(<LocationPicker value={{ name: '', lat: null, lon: null }} onChange={onChange} />, {
      wrapper: Providers,
    })

    const input = screen.getByRole('combobox', { name: 'Ciudad' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Madr' } })

    const option = await screen.findByRole('option', { name: /Madrid/ })
    expect(option).toHaveTextContent('Comunidad de Madrid, España')
    expect(getMock).toHaveBeenCalledWith('/geo/search', { params: { q: 'Madr', lang: 'es' } })

    fireEvent.mouseDown(option)
    expect(onChange).toHaveBeenCalledWith({
      name: 'Madrid, Comunidad de Madrid, España',
      lat: 40.4165,
      lon: -3.70256,
      timezone: 'Europe/Madrid',
    })
  })

  it('shows the chosen city with a change action and hides coordinates by default', () => {
    render(
      <LocationPicker
        value={{ name: 'Madrid, Comunidad de Madrid, España', lat: 40.4, lon: -3.7 }}
        onChange={vi.fn()}
      />,
      { wrapper: Providers }
    )
    expect(screen.getByTestId('chosen-city')).toHaveTextContent('Madrid, Comunidad de Madrid, España')
    expect(screen.queryByLabelText('Latitud')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Avanzado: coordenadas' }))
    expect(screen.getByLabelText('Latitud')).toHaveValue(40.4)

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }))
    expect(screen.getByRole('combobox', { name: 'Ciudad' })).toBeInTheDocument()
  })

  it('"Usar mi ubicación" reverse-geocodes the device position', async () => {
    getMock.mockResolvedValue(MADRID)
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: 40.41678, longitude: -3.70379 } } as GeolocationPosition)
    )
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    })
    const onChange = vi.fn()
    render(<LocationPicker value={{ name: '', lat: null, lon: null }} onChange={onChange} />, {
      wrapper: Providers,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(getMock).toHaveBeenCalledWith('/geo/reverse', {
      params: { lat: '40.41678', lon: '-3.70379', lang: 'es' },
    })
    expect(onChange).toHaveBeenCalledWith({
      name: 'Madrid, Comunidad de Madrid, España',
      lat: 40.41678,
      lon: -3.70379,
      timezone: 'Europe/Madrid',
    })
  })
})

describe('TimezoneCombobox', () => {
  it('shows a friendly label, filters every IANA zone and offers the city zone', () => {
    const onChange = vi.fn()
    render(
      <TimezoneCombobox
        value="UTC"
        onChange={onChange}
        cityTimezone="Europe/Madrid"
        cityName="Madrid"
      />,
      { wrapper: Providers }
    )
    const input = screen.getByRole('combobox', { name: 'Zona horaria' })
    expect(input).toHaveValue('UTC')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'canarias' } })
    const option = screen.getByRole('option', { name: /Atlántico\/Canarias \(UTC\+\d\)/ })
    fireEvent.mouseDown(option)
    expect(onChange).toHaveBeenLastCalledWith('Atlantic/Canary')

    fireEvent.click(screen.getByRole('button', { name: /Usar la de Madrid: Europa\/Madrid/ }))
    expect(onChange).toHaveBeenLastCalledWith('Europe/Madrid')
  })
})

describe('ColorPreferences', () => {
  it('toggles named swatches with Spanish labels and adds preset palettes', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ColorPreferences label="Colores favoritos" selected={['tan']} onChange={onChange} />,
      { wrapper: Providers }
    )
    // Chosen chip with Spanish name + remove action.
    expect(screen.getByRole('button', { name: 'Quitar Camel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Camel', pressed: true })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Azul marino', pressed: false }))
    expect(onChange).toHaveBeenLastCalledWith(['tan', 'navy'])

    fireEvent.click(screen.getByRole('button', { name: /Añadir la paleta Monocromo/ }))
    expect(onChange).toHaveBeenLastCalledWith(['tan', 'black', 'charcoal', 'gray', 'white'])

    rerender(<ColorPreferences label="Colores favoritos" selected={[]} onChange={onChange} />)
    expect(screen.getByText('Aún no has elegido ninguno')).toBeInTheDocument()
  })

  it('snaps the wheel colour to the nearest named colour and adds it', () => {
    const onChange = vi.fn()
    render(<ColorPreferences label="Colores a evitar" selected={[]} onChange={onChange} tone="avoid" />, {
      wrapper: Providers,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Elegir en la rueda' }))
    const wheel = screen.getByRole('slider', { name: /Rueda de color/ })
    // Default wheel colour is a warm orange; rotate the hue to blue with the keyboard.
    for (let i = 0; i < 20; i++) fireEvent.keyDown(wheel, { key: 'ArrowRight' })
    const add = screen.getAllByRole('button').find((b) => b.textContent?.startsWith('Añadir '))!
    const name = add.textContent!.replace('Añadir ', '')
    expect(screen.getByText(`Lo más parecido: ${name}`)).toBeInTheDocument()
    fireEvent.click(add)
    expect(onChange).toHaveBeenCalledTimes(1)
    const [[colors]] = onChange.mock.calls
    expect(colors).toHaveLength(1)
    expect(['blue', 'light-blue', 'teal', 'navy']).toContain(colors[0])
  })
})
