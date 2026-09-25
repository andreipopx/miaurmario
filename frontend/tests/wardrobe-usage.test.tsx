/**
 * «Cuánto la usas» y «Tu armario en números».
 *
 * What these hold the UI to: the numbers read in plain Spanish, a garment with
 * no price says so instead of inventing a cost per use, a rescue that cannot
 * happen explains itself, the per-garment setting is saved as one PATCH, and
 * nothing anywhere suggests buying something.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import es from '@/messages/es.json'
import en from '@/messages/en.json'
import type { Item, ItemUsage } from '@/lib/types'
import type { UsageSummary } from '@/lib/hooks/use-analytics'

// ---- mocks -----------------------------------------------------------------------

const h = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' }, status: 'authenticated' }),
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === 'string' ? src : ''} />
  ),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, get: h.get, patch: h.patch, post: h.post } }
})

import { ItemUsagePanel } from '@/components/item-usage-panel'
import { WardrobeNumbers } from '@/components/analytics/wardrobe-numbers'

// ---- helpers ---------------------------------------------------------------------

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  )
}

const item = (over: Partial<Item> = {}): Item =>
  ({
    id: 'item-1',
    user_id: 'u1',
    type: 'shirt',
    name: 'Camisa verde',
    favorite: false,
    image_path: 'a.jpg',
    tags: {},
    colors: ['green'],
    primary_color: 'green',
    status: 'ready',
    ai_processed: true,
    tagging_status: 'tagged',
    wear_count: 4,
    usage_preference: 'normal',
    suggestion_count: 0,
    acceptance_count: 0,
    wears_since_wash: 1,
    needs_wash: false,
    effective_wash_interval: 2,
    care_hints: [],
    additional_images: [],
    is_archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as Item

const usage = (over: Partial<ItemUsage> = {}): ItemUsage => ({
  wear_count: 4,
  last_worn_at: '2026-09-23',
  days_since_last_worn: 2,
  purchase_price: '49.90',
  cost_per_wear: '12.48',
  usage_preference: 'normal',
  co_worn: [],
  co_worn_looks: 0,
  ...over,
})

function renderPanel(over: Partial<Item> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="es" messages={es}>
        <ItemUsagePanel item={item(over)} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  h.get.mockReset().mockResolvedValue(usage())
  h.patch.mockReset().mockResolvedValue(item())
  h.post.mockReset()
})

// ---- copy ------------------------------------------------------------------------

describe('usage copy', () => {
  it('has the same keys in Spanish and English', () => {
    const esUsage = es.wardrobe.item.usage as unknown as Record<string, unknown>
    const enUsage = en.wardrobe.item.usage as unknown as Record<string, unknown>
    expect(flatten(enUsage).sort()).toEqual(flatten(esUsage).sort())

    const esNumbers = es.analytics.numbers as unknown as Record<string, unknown>
    const enNumbers = en.analytics.numbers as unknown as Record<string, unknown>
    expect(flatten(enNumbers).sort()).toEqual(flatten(esNumbers).sort())
  })

  it('names every refusal reason the backend can send', () => {
    // Mirrors app/services/item_rescue.py — a code with no copy renders raw.
    for (const messages of [es, en]) {
      const hints = messages.wardrobe.item.usage.hints as Record<string, unknown>
      for (const code of [
        'too_few_items',
        'all_need_wash',
        'missing_role',
        'only_color',
        'formality_gap',
        'unknown',
      ]) {
        expect(hints[code], code).toBeTruthy()
      }
      const roles = messages.wardrobe.item.usage.hintRoles as Record<string, unknown>
      for (const role of ['base_top', 'bottom', 'full_body', 'footwear']) {
        expect(roles[role], role).toBeTruthy()
      }
    }
  })

  it('never tells the owner to buy anything, in either language', () => {
    const suspect = /\b(compra|comprar|cómprate|invierte|hazte con|buy|purchase|shop for)\b/i
    for (const messages of [es, en]) {
      const copy = [
        messages.wardrobe.item.usage as unknown as Record<string, unknown>,
        messages.analytics.numbers as unknown as Record<string, unknown>,
      ]
      for (const block of copy) {
        for (const key of flatten(block)) {
          const text = key
            .split('.')
            .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], block)
          expect(String(text), key).not.toMatch(suspect)
        }
      }
    }
  })

  it('has Spanish copy for the item_not_found code the rescue route can send', () => {
    expect((es.errors.api as Record<string, string>).item_not_found).toBeTruthy()
    expect((en.errors.api as Record<string, string>).item_not_found).toBeTruthy()
  })
})

// ---- the panel -------------------------------------------------------------------

describe('cuánto la usas', () => {
  it('reads the wears, the last time and the cost per use', async () => {
    renderPanel()
    expect(await screen.findByText('4 veces')).toBeInTheDocument()
    expect(await screen.findByText('Hace 2 días')).toBeInTheDocument()
    expect(await screen.findByText(/12,48/)).toBeInTheDocument()
  })

  it('says «sin estrenar» rather than a cost, for a garment never worn', async () => {
    h.get.mockResolvedValue(
      usage({ wear_count: 0, cost_per_wear: null, days_since_last_worn: null, last_worn_at: null })
    )
    renderPanel({ wear_count: 0 })
    expect(await screen.findByText('Sin estrenar')).toBeInTheDocument()
    expect(await screen.findByText('Aún sin estrenar')).toBeInTheDocument()
    expect(await screen.findByText('Nunca')).toBeInTheDocument()
  })

  it('offers to work out the cost per use instead of inventing one, with no price', async () => {
    h.get.mockResolvedValue(usage({ purchase_price: null, cost_per_wear: null }))
    renderPanel()
    expect(await screen.findByText('Sin precio')).toBeInTheDocument()
    expect(screen.getByText(es.wardrobe.item.usage.noPriceHelp)).toBeInTheDocument()
  })

  it('lists what it goes out with, and how many worn looks that is from', async () => {
    h.get.mockResolvedValue(
      usage({
        co_worn: [
          {
            id: 'p1',
            name: 'Vaqueros',
            type: 'jeans',
            thumbnail_path: null,
            thumbnail_url: null,
            times: 3,
          },
        ],
        co_worn_looks: 4,
      })
    )
    renderPanel()
    expect(await screen.findByText('Vaqueros')).toBeInTheDocument()
    expect(screen.getByText('3 veces')).toBeInTheDocument()
    expect(
      screen.getByText('Sobre 4 looks que marcaste como puestos')
    ).toBeInTheDocument()
  })

  it('says plainly that nothing is logged yet rather than showing an empty list', async () => {
    renderPanel()
    expect(await screen.findByText(es.wardrobe.item.usage.goesWithEmpty)).toBeInTheDocument()
  })
})

// ---- the per-garment setting -----------------------------------------------------

describe('qué hago con ella', () => {
  it('offers the three settings and marks the saved one', async () => {
    renderPanel({ usage_preference: 'rest' })
    const group = await screen.findByRole('radiogroup')
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Déjala tranquila' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'Sácala más' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('saves the choice as one PATCH on the garment', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('radio', { name: 'Sácala más' }))
    await waitFor(() =>
      expect(h.patch).toHaveBeenCalledWith('/items/item-1', { usage_preference: 'more' })
    )
  })

  it('does not re-save the setting already stored', async () => {
    renderPanel({ usage_preference: 'normal' })
    fireEvent.click(await screen.findByRole('radio', { name: 'Normal' }))
    expect(h.patch).not.toHaveBeenCalled()
  })

  it('promises the setting only reorders, never hides', () => {
    for (const messages of [es, en]) {
      expect(messages.wardrobe.item.usage.prefHelp).toBeTruthy()
    }
    expect(es.wardrobe.item.usage.prefHelp).toMatch(/no la esconde/i)
  })
})

// ---- «Rescátala» -----------------------------------------------------------------

describe('rescátala', () => {
  it('asks for a look with this garment and shows what came back', async () => {
    h.post.mockResolvedValue({
      rescued: true,
      engine: 'heuristic',
      reason: null,
      hints: [],
      outfit: {
        id: 'o1',
        items: [
          { id: 'item-1', type: 'shirt', name: 'Camisa verde', thumbnail_url: null },
          { id: 'p1', type: 'jeans', name: 'Vaqueros', thumbnail_url: null },
        ],
      },
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Rescátala/ }))

    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith('/outfits/rescue', {
        item_id: 'item-1',
        occasion: null,
      })
    )
    expect(await screen.findByText('Un look con esta prenda')).toBeInTheDocument()
    // It says which engine built it, so "sin IA" never passes for the stylist.
    expect(screen.getByText('Montado sin IA, con lo que tienes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver el look/ })).toHaveAttribute(
      'href',
      '/dashboard/outfits/o1'
    )
  })

  it('credits the stylist when the stylist built it', async () => {
    h.post.mockResolvedValue({
      rescued: true,
      engine: 'ai',
      reason: null,
      hints: [],
      outfit: { id: 'o2', items: [{ id: 'item-1', type: 'shirt', thumbnail_url: null }] },
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Rescátala/ }))
    expect(await screen.findByText('Montado por el Estilista')).toBeInTheDocument()
  })

  it('explains a refusal in plain Spanish, naming the colour it is alone in', async () => {
    h.post.mockResolvedValue({
      rescued: false,
      engine: null,
      outfit: null,
      reason: 'no_combination',
      hints: [{ code: 'only_color', value: 'green' }],
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Rescátala/ }))

    expect(
      await screen.findByText('Ahora mismo no la puedo combinar con nada')
    ).toBeInTheDocument()
    expect(screen.getByText(/única prenda verde/i)).toBeInTheDocument()
  })

  it('names the half of the look that is missing', async () => {
    h.post.mockResolvedValue({
      rescued: false,
      engine: null,
      outfit: null,
      reason: 'no_combination',
      hints: [{ code: 'missing_role', value: 'bottom' }],
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Rescátala/ }))
    expect(await screen.findByText('No tienes nada de abajo para ponerle.')).toBeInTheDocument()
  })

  it('says an archived garment is put away rather than blaming the wardrobe', async () => {
    h.post.mockResolvedValue({
      rescued: false,
      engine: null,
      outfit: null,
      reason: 'item_unavailable',
      hints: [],
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Rescátala/ }))
    expect(
      await screen.findByText(es.wardrobe.item.usage.unavailableTitle)
    ).toBeInTheDocument()
  })
})

// ---- «Tu armario en números» ------------------------------------------------------

describe('tu armario en números', () => {
  const summary = (over: Partial<UsageSummary> = {}): UsageSummary => ({
    tracked_items: 40,
    never_worn: 6,
    idle_3m: 18,
    idle_6m: 9,
    worn_recently: 14,
    idle_percentage: 45,
    total_wears: 120,
    tracking_days: 200,
    enough_data: true,
    idle_days: 90,
    long_idle_days: 180,
    recent_days: 30,
    min_tracking_days: 14,
    ...over,
  })

  function renderNumbers(over: Partial<UsageSummary> = {}) {
    return render(
      <NextIntlClientProvider locale="es" messages={es}>
        <WardrobeNumbers usage={summary(over)} />
      </NextIntlClientProvider>
    )
  }

  it('reports the idle share, the never-worn count and the three/six month marks', () => {
    renderNumbers()
    expect(screen.getByText('45%')).toBeInTheDocument()
    expect(screen.getByText('Sin salir en 3 meses • de 40 prendas')).toBeInTheDocument()
    expect(screen.getByText('6 prendas que nunca te has puesto')).toBeInTheDocument()
    expect(screen.getByText('Sin usar en 3 meses')).toBeInTheDocument()
    expect(screen.getByText('Sin usar en 6 meses')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
  })

  it('says so plainly instead of drawing a percentage from nothing', () => {
    renderNumbers({ enough_data: false })
    expect(screen.getByText(es.analytics.numbers.notEnoughTitle)).toBeInTheDocument()
    expect(screen.getByText(es.analytics.numbers.notEnough)).toBeInTheDocument()
    expect(screen.queryByText('45%')).not.toBeInTheDocument()
  })

  it('says the good news out loud when nothing is standing still', () => {
    renderNumbers({ idle_3m: 0, idle_percentage: 0, never_worn: 0 })
    expect(screen.getByText(/Todo tu armario ha salido/)).toBeInTheDocument()
  })

  it('takes the month marks from the payload rather than hardcoding them', () => {
    renderNumbers({ idle_days: 60, long_idle_days: 120 })
    expect(screen.getByText('Sin salir en 2 meses • de 40 prendas')).toBeInTheDocument()
  })

  it('has the plain-Spanish "not enough yet" line the honest branch needs', () => {
    expect(es.analytics.numbers.notEnough).toMatch(/dos semanas/i)
    expect(es.analytics.numbers.notEnough).not.toMatch(/[A-Z]{3,}/)
  })
})
