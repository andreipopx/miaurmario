/**
 * The item page survives a tag that is not the shape it was promised.
 *
 * `clothing_items.tags` is free-form JSON. The tagger is asked for
 * `"style": ["pumps"]` and answers `"style": "pumps"` often enough that it has to
 * be a shape the screen reads: calling `.map` on a string throws
 * `TypeError: x.map is not a function`, the error bubbles out of the dialog, and
 * the whole dashboard goes to its error page over one odd garment.
 *
 * Every read-only chip list goes through `asTagList`, so a bare string is shown as
 * the one tag it is.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import React from 'react'

import es from '@/messages/es.json'
import type { Item } from '@/lib/types'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' }, status: 'authenticated' }),
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === 'string' ? src : ''} />
  ),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const idleMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }
const idleQuery = { data: undefined, isLoading: false, isError: false }

vi.mock('@/lib/hooks/use-items', () => ({
  useUpdateItem: () => idleMutation,
  useDeleteItem: () => idleMutation,
  useReanalyzeItem: () => idleMutation,
  useRotateImage: () => idleMutation,
  useRemoveBackground: () => idleMutation,
  useRestoreOriginal: () => idleMutation,
  useReplaceItemImage: () => idleMutation,
  useLogWash: () => idleMutation,
  useAddItemImage: () => idleMutation,
  useDeleteItemImage: () => idleMutation,
  useSetPrimaryImage: () => idleMutation,
  useWashHistory: () => idleQuery,
  useItemWearStats: () => idleQuery,
  useItemWearHistory: () => idleQuery,
}))

vi.mock('@/lib/hooks/use-features', () => ({
  useFeatures: () => ({ data: undefined, features: {} }),
}))

vi.mock('@/components/item-usage-panel', () => ({
  ItemUsagePanel: () => <div data-testid="usage-panel" />,
}))

vi.mock('@/components/generate-pairings-dialog', () => ({
  GeneratePairingsDialog: () => null,
}))

import { ItemDetailDialog } from '@/components/item-detail-dialog'

function itemWith(tags: Record<string, unknown>): Item {
  return {
    id: 'i1',
    user_id: 'u1',
    type: 'shoes',
    favorite: false,
    image_path: 'x.jpg',
    image_url: 'https://example.test/x.jpg',
    thumbnail_url: 'https://example.test/x_thumb.jpg',
    tags,
    colors: [],
    status: 'ready',
    ai_processed: true,
    ai_confidence: 0.9,
    tagging_status: 'tagged',
    wear_count: 0,
    suggestion_count: 0,
    acceptance_count: 0,
    wears_since_wash: 0,
    needs_wash: false,
    is_archived: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  } as unknown as Item
}

function renderDetail(item: Item) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      <ItemDetailDialog item={item} open onOpenChange={vi.fn()} />
    </NextIntlClientProvider>
  )
}

describe('the read-only tag chips', () => {
  it('shows a bare string as the one tag it is, instead of throwing', () => {
    // Exactly the payload that took the dashboard down: every list field is a
    // string. One of these on one garment was enough.
    renderDetail(
      itemWith({
        colors: 'black',
        style: 'elegant',
        season: 'summer',
        occasion: 'work',
        features: 'punta fina',
      })
    )

    expect(screen.getByText(es.tagValues.colors.black)).toBeTruthy()
    expect(screen.getByText(es.tagValues.styles.elegant)).toBeTruthy()
    expect(screen.getByText(es.tagValues.seasons.summer)).toBeTruthy()
    // `occasion` and `features` are free text the tagger invents; they are shown
    // as they came.
    expect(screen.getByText('punta fina')).toBeTruthy()
  })

  it('still shows a real list, and a value outside the vocabulary', () => {
    renderDetail(itemWith({ style: ['elegant', 'classic'], features: ['hebilla'] }))
    expect(screen.getByText(es.tagValues.styles.elegant)).toBeTruthy()
    expect(screen.getByText(es.tagValues.styles.classic)).toBeTruthy()
    expect(screen.getByText('hebilla')).toBeTruthy()
  })

  it('renders a garment with no tags at all', () => {
    // The AI block is not shown, and nothing throws on the way to deciding that.
    renderDetail(itemWith({}))
    expect(screen.queryByText(es.wardrobe.item.ai.title)).toBeNull()
  })

  it('does not mistake a string for a list when deciding to show the block', () => {
    // `hasAiTags` reads the same normalised lists, so a bare string still counts
    // as a tag worth showing.
    renderDetail(itemWith({ style: 'elegant' }))
    expect(screen.getByText(es.wardrobe.item.ai.title)).toBeTruthy()
  })
})
