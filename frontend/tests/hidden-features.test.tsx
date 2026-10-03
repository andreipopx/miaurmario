/**
 * Laundry tracking and Familia are hidden on purpose, behind lib/features.ts.
 *
 * Hidden, not deleted: flipping a flag brings the screen back exactly as it was,
 * so every surface here is checked both ways. `FEATURES` is mocked with a mutable
 * object; components read it at render time, nav-items at import time (hence
 * the fresh import there).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import React from 'react'

import es from '@/messages/es.json'
import type { Item } from '@/lib/types'

const flags = vi.hoisted(() => ({ laundry: false, families: false }))
vi.mock('@/lib/features', () => ({ FEATURES: flags }))

const replace = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('token=abc'),
  usePathname: () => '/dashboard',
}))

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
const useItems = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/use-items', () => ({
  useUpdateItem: () => idleMutation,
  useDeleteItem: () => idleMutation,
  useReanalyzeItem: () => idleMutation,
  useRotateImage: () => idleMutation,
  useBrushCutout: () => idleMutation,
  useResetCutout: () => idleMutation,
  useRemoveBackground: () => idleMutation,
  useRestoreOriginal: () => idleMutation,
  useReplaceItemImage: () => idleMutation,
  useLogWash: () => idleMutation,
  useAddItemImage: () => idleMutation,
  useDeleteItemImage: () => idleMutation,
  useSetPrimaryImage: () => idleMutation,
  useSetItemImageView: () => idleMutation,
  useMergeItemInto: () => idleMutation,
  useItems,
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
import { ItemPicker } from '@/components/shared/item-picker'
import FamilyPage from '@/app/dashboard/family/page'
import FamilyFeedPage from '@/app/dashboard/family/feed/page'
import InvitePage from '@/app/invite/page'

const item = {
  id: 'i1',
  user_id: 'u1',
  type: 'jeans',
  favorite: false,
  image_path: 'x.jpg',
  image_url: 'https://example.test/x.jpg',
  thumbnail_url: 'https://example.test/x_thumb.jpg',
  tags: {},
  colors: [],
  status: 'ready',
  ai_processed: true,
  ai_confidence: 0.9,
  tagging_status: 'tagged',
  wear_count: 0,
  suggestion_count: 0,
  acceptance_count: 0,
  wears_since_wash: 3,
  needs_wash: true,
  effective_wash_interval: 3,
  is_archived: false,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
} as unknown as Item

function withIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      {node}
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  flags.laundry = false
  flags.families = false
  replace.mockClear()
  useItems.mockReset()
  useItems.mockReturnValue(idleQuery)
})

describe('the flags themselves', () => {
  it('ship with both features hidden', async () => {
    const actual = await vi.importActual<typeof import('@/lib/features')>('@/lib/features')
    expect(actual.FEATURES).toEqual({ laundry: false, families: false })
  })
})

describe('laundry tracking', () => {
  it('shows no wash status, no "mark as washed" and no wash interval while hidden', () => {
    withIntl(<ItemDetailDialog item={item} open onOpenChange={vi.fn()} />)
    expect(screen.queryByText(es.wardrobe.item.wash.sectionTitle)).toBeNull()
    expect(screen.queryByText(es.wardrobe.item.wash.markWashed)).toBeNull()
    expect(screen.queryByText(es.wardrobe.item.wash.needsWashing)).toBeNull()
  })

  it('comes back as it was when the flag is on', () => {
    flags.laundry = true
    withIntl(<ItemDetailDialog item={item} open onOpenChange={vi.fn()} />)
    expect(screen.getByText(es.wardrobe.item.wash.sectionTitle)).toBeTruthy()
    expect(screen.getByText(es.wardrobe.item.wash.markWashed)).toBeTruthy()
  })

  it.each([
    [false, undefined],
    [true, false],
  ])('the item picker leaves dirty garments out only with laundry on (%s)', (on, expected) => {
    flags.laundry = on
    withIntl(<ItemPicker selectedIds={new Set()} onToggle={vi.fn()} />)
    expect(useItems).toHaveBeenCalled()
    expect(useItems.mock.calls[0][0].needs_wash).toBe(expected)
  })
})

describe('Familia', () => {
  it('keeps both family tabs out of the nav while hidden, and back when on', async () => {
    for (const on of [false, true]) {
      flags.families = on
      vi.resetModules()
      const { INSPO, SETTINGS } = await import('@/components/nav-items')
      const visible = [...INSPO.tabs, ...SETTINGS.tabs].filter((t) => !t.hidden).map((t) => t.key)
      expect(visible.includes('family')).toBe(on)
      expect(visible.includes('familySettings')).toBe(on)
    }
  })

  it.each([
    ['family settings', FamilyPage],
    ['family feed', FamilyFeedPage],
    ['family invite link', InvitePage],
  ])('the %s page sends you to Amigos while hidden', (_name, Page) => {
    const { container } = withIntl(<Page />)
    expect(replace).toHaveBeenCalledWith('/dashboard/friends')
    expect(container.textContent).toBe('')
  })
})
