import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import { formatPrice, garmentFormData, normalizePrice } from '@/lib/intake/garment-form'
import { ScreenshotImportTab } from '@/components/add-item/screenshot-import-tab'
import { LinkImportTab } from '@/components/add-item/link-import-tab'
import type { LinkPreview, ScreenshotGarment } from '@/lib/hooks/use-intake'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

const h = vi.hoisted(() => ({
  readScreenshot: vi.fn(),
  preview: vi.fn(),
  createItem: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

vi.mock('@/components/native/lazy-stinky', () => ({
  LazyStinky: () => null,
}))

vi.mock('@/lib/hooks/use-items', () => ({
  useCreateItem: () => ({ mutateAsync: h.createItem, isPending: false }),
}))

vi.mock('@/lib/hooks/use-habitual-sizes', () => ({
  useHabitualSizes: () => ({ saved: {} }),
}))

vi.mock('@/lib/hooks/use-intake', async (orig) => {
  const actual = await orig<typeof import('@/lib/hooks/use-intake')>()
  return {
    ...actual,
    useScreenshotRead: () => ({ mutateAsync: h.readScreenshot, isPending: false }),
    useLinkPreview: () => ({ mutateAsync: h.preview, isPending: false }),
    dataUrlToFile: async (_url: string, name: string) => new File(['x'], `${name}.jpg`, { type: 'image/jpeg' }),
  }
})

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={es}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

const img = (n: number) => ({ data_url: `data:image/jpeg;base64,${n}`, content_type: 'image/jpeg', size_bytes: 10 })

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  )
}

beforeEach(() => {
  h.readScreenshot.mockReset()
  h.preview.mockReset()
  h.createItem.mockReset()
})

describe('photos inlined by the server', () => {
  it('become a File without fetch(), which the CSP blocks for data: URLs', async () => {
    const actual = await vi.importActual<typeof import('@/lib/hooks/use-intake')>('@/lib/hooks/use-intake')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const file = await actual.dataUrlToFile('data:image/png;base64,iVBORw0KGgo=', 'prenda')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(file.name).toBe('prenda.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(8) // the 8-byte PNG signature, decoded
    fetchSpy.mockRestore()
  })
})

describe('garment form', () => {
  it('formats a shop price the Spanish way', () => {
    expect(formatPrice('59.99', 'EUR', 'es')?.replace(/\s/g, ' ')).toBe('59,99 €')
    expect(formatPrice(null, 'EUR', 'es')).toBeNull()
  })

  it('normalises prices', () => {
    expect(normalizePrice('29,95')).toBe('29.95')
    expect(normalizePrice(39.99)).toBe('39.99')
    expect(normalizePrice('gratis')).toBeNull()
    expect(normalizePrice('0')).toBeNull()
    expect(normalizePrice(null)).toBeNull()
  })

  it('builds the body POST /items expects, with how it got in', () => {
    const form = garmentFormData({
      file: new File(['x'], 'p.jpg'),
      type: 'coat',
      primaryColor: 'beige',
      primaryColorHex: '#c4b6a6',
      colors: ['beige', 'brown'],
      name: 'Abrigo largo',
      brand: 'Bershka',
      sourceUrl: 'https://www.bershka.com/es/x-c0p1.html',
      price: '59,99',
      createdVia: 'screenshot',
    })
    expect(form.get('type')).toBe('coat')
    expect(form.get('primary_color_hex')).toBe('#c4b6a6')
    expect(form.get('colors')).toBe('beige,brown')
    expect(form.get('purchase_price')).toBe('59.99')
    expect(form.get('created_via')).toBe('screenshot')
    expect(form.get('subtype')).toBeNull()
  })
})

const GARMENTS: ScreenshotGarment[] = [
  {
    type: 'coat',
    primary_color: 'beige',
    colors: ['beige'],
    name: 'Abrigo largo cuello funnel',
    brand: 'Bershka',
    price: '59.99',
    currency: 'EUR',
    source_url: 'https://www.bershka.com/es/x-c0p1.html',
    from_shop: true,
    images: [img(1), img(2), img(3)],
  },
  { type: 'sneakers', primary_color: 'white', colors: ['white'], from_shop: false, images: [img(4)] },
]

describe('screenshot tab', () => {
  it('reads the screenshot, lets you choose the photo and adds what is ticked', async () => {
    h.readScreenshot.mockResolvedValue({ garments: GARMENTS })
    h.createItem.mockResolvedValue({ id: 'x' })
    const onDone = vi.fn()
    renderWithProviders(<ScreenshotImportTab onCancel={vi.fn()} onDone={onDone} />)

    const file = new File(['png'], 'captura.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('screenshot-input'), { target: { files: [file] } })

    expect(await screen.findByText('He encontrado 2 prendas')).toBeInTheDocument()
    expect(screen.getByText('Foto de Bershka')).toBeInTheDocument()

    // The trainers are not wanted; the coat keeps the shop's second photo.
    fireEvent.click(screen.getByRole('checkbox', { name: /Zapatillas/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Foto 2 de la tienda' }))
    fireEvent.click(screen.getByRole('button', { name: 'Añadir la prenda' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(h.createItem).toHaveBeenCalledTimes(1)
    const body = h.createItem.mock.calls[0][0] as FormData
    expect(body.get('created_via')).toBe('screenshot')
    expect(body.get('brand')).toBe('Bershka')
    expect(body.get('source_url')).toBe('https://www.bershka.com/es/x-c0p1.html')
  })

  it('says so when there is nothing to add', async () => {
    h.readScreenshot.mockResolvedValue({ garments: [] })
    renderWithProviders(<ScreenshotImportTab onCancel={vi.fn()} onDone={vi.fn()} />)
    fireEvent.change(screen.getByTestId('screenshot-input'), {
      target: { files: [new File(['png'], 'c.png', { type: 'image/png' })] },
    })
    expect(await screen.findByText('No veo ninguna prenda')).toBeInTheDocument()
  })
})

describe('link tab', () => {
  const PREVIEW: LinkPreview = {
    source_url: 'https://shop.mango.com/es/es/p/x/37057941',
    extracted: true,
    name: 'Pantalón recto cordón',
    brand: 'Mango',
    price: '39.99',
    currency: 'EUR',
    primary_color: 'navy',
    primary_color_hex: '#21272c',
    type: 'pants',
    image: img(1),
    images: [img(1), img(2)],
  }

  it('accepts a whole shared sentence and hands over type, price and the chosen photo', async () => {
    h.preview.mockResolvedValue(PREVIEW)
    const onUse = vi.fn()
    renderWithProviders(<LinkImportTab onUse={onUse} onCancel={vi.fn()} />)
    const input = screen.getByLabelText('Enlace de la tienda')
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.change(input, { target: { value: 'Mira esto https://shop.mango.com/es/es/p/x/37057941' } })
    fireEvent.click(screen.getByRole('button', { name: 'Leer enlace' }))
    expect(await screen.findByText('Pantalón recto cordón')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Foto 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Usar estos datos' }))
    await waitFor(() => expect(onUse).toHaveBeenCalled())
    expect(onUse.mock.calls[0][0]).toMatchObject({ type: 'pants', price: '39.99', primaryColorHex: '#21272c' })
  })

  it('points to a screenshot when the shop will not be read', async () => {
    h.preview.mockResolvedValue({ source_url: 'https://www.zalando.es/x.html', extracted: false, reason: 'fetch_failed' })
    const onScreenshot = vi.fn()
    renderWithProviders(<LinkImportTab onUse={vi.fn()} onCancel={vi.fn()} onScreenshot={onScreenshot} />)
    fireEvent.change(screen.getByLabelText('Enlace de la tienda'), { target: { value: 'https://www.zalando.es/x.html' } })
    fireEvent.click(screen.getByRole('button', { name: 'Leer enlace' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Usar una captura' }))
    expect(onScreenshot).toHaveBeenCalled()
  })
})

describe('translations', () => {
  it('has the screenshot tab and the funnel in both languages', () => {
    for (const pick of [
      (m: typeof es) => m.wardrobe.add.screenshot,
      (m: typeof es) => m.admin.summary.funnel,
      (m: typeof es) => m.wardrobe.add.link,
      (m: typeof es) => m.firstRun.firstSteps,
    ]) {
      expect(flatten(pick(es) as Record<string, unknown>).sort()).toEqual(
        flatten(pick(en as typeof es) as Record<string, unknown>).sort()
      )
    }
    expect(es.wardrobe.add.tabShot).toBeTruthy()
    expect(en.wardrobe.add.tabShot).toBeTruthy()
  })
})
