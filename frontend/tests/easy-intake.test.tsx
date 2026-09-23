import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'

import { firstUrlIn } from '@/lib/shared-intake'
import { localCareHints } from '@/lib/care-labels'
import { supportsShareTarget } from '@/lib/pwa/platform'
import { CareLabelField } from '@/components/add-item/care-label-field'
import { CarePanel } from '@/components/care-panel'
import type { CareDraft } from '@/lib/hooks/use-intake'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

// ---- mocks -----------------------------------------------------------------------

const h = vi.hoisted(() => ({
  vision: true,
  readCareLabel: vi.fn(),
}))

vi.mock('@/lib/hooks/use-ai-access', () => ({
  useAIStatus: () => ({
    data: { server_ai_enabled: true, capabilities: { vision: h.vision, text: true } },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/lib/hooks/use-intake', async (orig) => {
  const actual = await orig<typeof import('@/lib/hooks/use-intake')>()
  return {
    ...actual,
    useCareLabel: () => ({ mutateAsync: h.readCareLabel, isPending: false }),
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

const ROOT = path.resolve(__dirname, '..')

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  )
}

// ---- Web Share Target --------------------------------------------------------------

describe('web share target', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, 'public/manifest.webmanifest'), 'utf8')
  )
  const sw = readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8')

  it('declares a POST share target that accepts an image, a link and text', () => {
    expect(manifest.share_target).toMatchObject({
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
    })
    expect(manifest.share_target.params).toMatchObject({
      title: 'title',
      text: 'text',
      url: 'url',
    })
    expect(manifest.share_target.params.files[0].name).toBe('image')
    expect(manifest.share_target.params.files[0].accept).toContain('image/jpeg')
  })

  it('has the service worker handling exactly that path', () => {
    expect(sw).toContain(`const SHARE_TARGET_PATH = '${manifest.share_target.action}'`)
    expect(sw).toContain("req.method === 'POST'")
    // The share stash must survive the per-version cache sweep in `activate`.
    expect(sw).toContain('k !== CACHE && k !== SHARE_CACHE')
    // And it must land in the add flow, never save anything on its own.
    expect(sw).toContain("SHARE_LANDING = '/dashboard/wardrobe?add=1&shared=1'")
  })

  it('knows which platforms can share into the app', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile Safari/604.1'
    const androidChrome =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
    const desktopChrome =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0'
    const ipadOS =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15'

    expect(supportsShareTarget(iphone)).toBe(false)
    expect(supportsShareTarget(ipadOS, 5)).toBe(false)
    expect(supportsShareTarget(firefox)).toBe(false)
    expect(supportsShareTarget(androidChrome)).toBe(true)
    expect(supportsShareTarget(desktopChrome)).toBe(true)
  })

  it('finds the link inside a shared text', () => {
    expect(firstUrlIn(undefined, 'Mira esto https://tienda.example/p/1 ¿te gusta?')).toBe(
      'https://tienda.example/p/1'
    )
    expect(firstUrlIn('https://tienda.example/p/2', 'ignored')).toBe(
      'https://tienda.example/p/2'
    )
    expect(firstUrlIn('sin enlaces', null)).toBeNull()
  })
})

// ---- Care ----------------------------------------------------------------------------

describe('care hints', () => {
  it('maps stored care onto hint codes', () => {
    expect(
      localCareHints({
        composition: [],
        wash: { max_temp_c: 30, cycle: 'delicate' },
        dry: { tumble_dry: false },
        iron: { allowed: false },
        bleach: 'none',
        source: 'ai',
      })
    ).toEqual(['wash_30', 'cycle_delicate', 'no_tumble', 'no_iron', 'no_bleach'])
    expect(localCareHints(null)).toEqual([])
  })

  it('shows composition and hints on the item detail', () => {
    renderWithProviders(
      <CarePanel
        care={{
          composition: [{ fiber: 'cotton', percent: 60 }, { fiber: 'polyester', percent: 40 }],
          wash: { max_temp_c: 30 },
          source: 'ai',
        }}
        hints={['wash_30', 'no_tumble']}
      />
    )
    expect(screen.getByText('60% algodón, 40% poliéster')).toBeInTheDocument()
    expect(screen.getByText('Lavar a 30°')).toBeInTheDocument()
    expect(screen.getByText('Nada de secadora')).toBeInTheDocument()
  })

  it('renders nothing when the garment has no care data', () => {
    const { container } = renderWithProviders(<CarePanel care={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('care label field', () => {
  it('lets a wardrobe with no AI type the composition in', async () => {
    h.vision = false
    const onChange = vi.fn<(care: CareDraft | null) => void>()
    renderWithProviders(<CareLabelField value={null} onChange={onChange} />)

    expect(screen.queryByRole('button', { name: 'Leer etiqueta' })).not.toBeInTheDocument()
    expect(screen.getByText('Escribe lo que ponga la etiqueta de lavado.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Composición'), {
      target: { value: '60% algodón, 40% poliéster' },
    })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({
      source: 'manual',
      composition: '60% algodón, 40% poliéster',
    })
  })

  it('offers the label scan when vision AI is available', () => {
    h.vision = true
    renderWithProviders(<CareLabelField value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Leer etiqueta' })).toBeInTheDocument()
  })

  it('starts from the care already stored on the item', () => {
    h.vision = true
    renderWithProviders(
      <CareLabelField
        value={null}
        onChange={vi.fn()}
        initialValue={{
          composition: [{ fiber: 'wool', percent: 100 }],
          wash: { hand_wash: true },
          source: 'manual',
        }}
      />
    )
    expect(screen.getByLabelText('Composición')).toHaveValue('100% lana')
    expect(screen.getByLabelText('Lavado')).toHaveTextContent('Lavar a mano')
  })
})

// ---- i18n ------------------------------------------------------------------------------

describe('intake translations', () => {
  it('keeps the new namespaces in both languages', () => {
    for (const namespace of ['care', 'share'] as const) {
      const esKeys = flatten(es.wardrobe[namespace] as Record<string, unknown>).sort()
      const enKeys = flatten(en.wardrobe[namespace] as Record<string, unknown>).sort()
      expect(esKeys).toEqual(enKeys)
      expect(esKeys.length).toBeGreaterThan(0)
    }
    const esLink = flatten(es.wardrobe.add.link as Record<string, unknown>).sort()
    const enLink = flatten(en.wardrobe.add.link as Record<string, unknown>).sort()
    expect(esLink).toEqual(enLink)
    expect(es.wardrobe.add.tabLink).toBeTruthy()
    expect(en.wardrobe.add.tabLink).toBeTruthy()
  })

  it('has a message for every refusal the backend can answer with', () => {
    // Mirrors link_import.LinkImportError reasons surfaced as 400s, plus the
    // generic fallback used for everything else.
    for (const code of [
      'invalid_url',
      'https_required',
      'private_address',
      'unresolvable',
      'fetch_failed',
      'link_import_disabled',
    ]) {
      expect((es.wardrobe.add.link.errors as Record<string, string>)[code]).toBeTruthy()
      expect((en.wardrobe.add.link.errors as Record<string, string>)[code]).toBeTruthy()
    }
  })

  it('has a label for every care hint the backend emits', () => {
    // app/utils/care.py::care_hints — the temperature ones are parameterised.
    for (const hint of [
      'hand_wash',
      'machine_wash',
      'do_not_wash',
      'cycle_gentle',
      'cycle_delicate',
      'no_tumble',
      'tumble_low',
      'tumble_medium',
      'tumble_high',
      'flat_dry',
      'line_dry',
      'no_iron',
      'dry_clean',
      'no_dry_clean',
      'no_bleach',
      'washTemp',
      'ironTemp',
    ]) {
      expect((es.wardrobe.care.hints as Record<string, string>)[hint]).toBeTruthy()
      expect((en.wardrobe.care.hints as Record<string, string>)[hint]).toBeTruthy()
    }
  })
})
