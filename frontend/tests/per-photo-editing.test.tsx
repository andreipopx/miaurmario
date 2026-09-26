/**
 * The seam between "every photo knows its side" and "the user can fix a photo".
 *
 * Two features met on the same two screens. One gave a garment several photos, each
 * labelled with the side it shows and each with its own cut-out. The other gave the
 * user an eraser and a rotation queue — both of which, written when a garment had one
 * photo worth editing, reached for the garment's *own* photo. Put together
 * unexamined, a user looking at the back of a jumper and pressing either control
 * would have edited the front and been shown no sign of it.
 *
 * What is pinned here:
 *
 * * the eraser and the rotation both act on the photo that is on screen;
 * * the flat lay's layering and its "ver por detrás" toggle do not fight: a look
 *   turned around is still laid out as a layered look.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import React from 'react'

import { buildFlatLay, flatLayFace, type FlatLayInput } from '@/lib/outfit-flat-lay'
import es from '@/messages/es.json'
import type { Item } from '@/lib/types'

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
  default: ({ alt, src, className }: { alt: string; src: string; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === 'string' ? src : ''} className={className} />
  ),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

/**
 * The eraser reports the photo it was handed rather than drawing it.
 *
 * It paints on a canvas, which jsdom does not have — and the question here is not
 * how it paints but *which photo* it was pointed at, which is exactly what a stub
 * can answer without pretending to be a canvas.
 */
vi.mock('@/components/shared/alpha-brush', () => ({
  AlphaBrush: ({
    src,
    restoreSrc,
    canReset,
    onApply,
    onReset,
  }: {
    src: string
    restoreSrc?: string | null
    canReset?: boolean
    onApply: (r: { mask: Blob; width: number; height: number }) => void
    onReset?: () => void
  }) => (
    <div data-testid="alpha-brush" data-src={src} data-restore={restoreSrc ?? ''} data-can-reset={String(Boolean(canReset))}>
      <button
        type="button"
        data-testid="brush-apply"
        onClick={() => onApply({ mask: new Blob(['x']), width: 10, height: 10 })}
      >
        aplicar
      </button>
      <button type="button" data-testid="brush-reset" onClick={() => onReset?.()}>
        automático
      </button>
    </div>
  ),
}))

const h = vi.hoisted(() => ({
  brush: vi.fn(),
  reset: vi.fn(),
  rotate: vi.fn(),
  reanalyze: vi.fn(),
  remove: vi.fn(),
}))

const idleQuery = { data: undefined, isLoading: false, isError: false }
const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }

vi.mock('@/lib/hooks/use-items', () => ({
  useUpdateItem: () => idle,
  useDeleteItem: () => idle,
  useReanalyzeItem: () => ({
    mutate: h.reanalyze,
    mutateAsync: h.reanalyze,
    isPending: false,
  }),
  useRotateImage: () => ({ mutate: h.rotate, mutateAsync: h.rotate, isPending: false }),
  useBrushCutout: () => ({ mutate: h.brush, mutateAsync: h.brush, isPending: false }),
  useResetCutout: () => ({ mutate: h.reset, mutateAsync: h.reset, isPending: false }),
  useRemoveBackground: () => ({ mutate: h.remove, mutateAsync: h.remove, isPending: false }),
  useRestoreOriginal: () => idle,
  useReplaceItemImage: () => idle,
  useLogWash: () => idle,
  useAddItemImage: () => idle,
  useDeleteItemImage: () => idle,
  useSetPrimaryImage: () => idle,
  useSetItemImageView: () => idle,
  useMergeItemInto: () => idle,
  useItems: () => idleQuery,
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

import { OutfitFlatLay } from '@/components/outfits/outfit-flat-lay'
import { ItemDetailDialog } from '@/components/item-detail-dialog'

// ---- the item page: two photos, each edited on its own ---------------------------

/** A jumper photographed from both sides, both sides cut out, both with an original. */
function jumperWithABack(): Item {
  return {
    id: 'i1',
    user_id: 'u1',
    type: 'sweater',
    favorite: false,
    image_path: 'front.webp',
    image_url: 'https://img/front.webp',
    thumbnail_url: 'https://img/front_thumb.webp',
    original_image_url: 'https://img/front_orig.jpg',
    original_image_path: 'front_orig.jpg',
    has_cutout: true,
    image_view: 'front',
    additional_images: [
      {
        id: 'img-back',
        item_id: 'i1',
        image_path: 'back.webp',
        image_url: 'https://img/back.webp',
        thumbnail_url: 'https://img/back_thumb.webp',
        original_image_url: 'https://img/back_orig.jpg',
        position: 0,
        image_view: 'back',
        has_cutout: true,
        can_restore_original: true,
        created_at: '2026-09-01T00:00:00Z',
      },
    ],
    tags: {},
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
  // Edit mode brings the care-label field along, and that field owns a mutation of
  // its own, so the dialog needs a real query client even though every hook this
  // test cares about is stubbed above.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={es}>
        <ItemDetailDialog item={item} open onOpenChange={vi.fn()} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

/** Walk to the back photo the way a user does: the next arrow over the gallery. */
function showTheBack() {
  fireEvent.click(screen.getByRole('button', { name: es.common.aria.nextImage }))
}

/**
 * The pencil, which is now the only door to the tools that rewrite a photo.
 *
 * Turning a photo and erasing part of it are one stray tap away from something the
 * owner cannot undo, so they are not offered until he says he is editing. Every test
 * below goes through here for the same reason he has to.
 */
function startEditing() {
  fireEvent.click(screen.getByRole('button', { name: es.wardrobe.item.toolbar.editTags }))
}

function openTheEraser() {
  startEditing()
  fireEvent.click(screen.getByRole('button', { name: es.imageBrush.open }))
}

function turnRight() {
  fireEvent.click(screen.getByRole('button', { name: es.wardrobe.item.toolbar.rotateRight }))
}

describe('the eraser edits the photo on screen', () => {
  beforeEach(() => {
    h.brush.mockReset().mockResolvedValue({})
    h.reset.mockReset().mockResolvedValue({})
    h.rotate.mockReset().mockResolvedValue({})
  })

  it('is pointed at the garment’s own photo while that is what is shown', () => {
    renderDetail(jumperWithABack())
    openTheEraser()

    const brush = screen.getByTestId('alpha-brush')
    expect(brush.getAttribute('data-src')).toContain('https://img/front.webp')
    expect(brush.getAttribute('data-restore')).toBe('https://img/front_orig.jpg')
  })

  it('is pointed at the back photo once the back is what is shown', () => {
    renderDetail(jumperWithABack())
    showTheBack()
    openTheEraser()

    const brush = screen.getByTestId('alpha-brush')
    expect(brush.getAttribute('data-src')).toBe('https://img/back.webp')
    // Its own untouched original, so "devolver" brings back the back's pixels.
    expect(brush.getAttribute('data-restore')).toBe('https://img/back_orig.jpg')
  })

  it('sends the strokes against that photo, not against the garment', () => {
    renderDetail(jumperWithABack())
    showTheBack()
    openTheEraser()
    fireEvent.click(screen.getByTestId('brush-apply'))

    expect(h.brush).toHaveBeenCalledTimes(1)
    expect(h.brush.mock.calls[0][0]).toMatchObject({ id: 'i1', imageId: 'img-back' })
  })

  it('sends no image id at all for the garment’s own photo', () => {
    renderDetail(jumperWithABack())
    openTheEraser()
    fireEvent.click(screen.getByTestId('brush-apply'))

    expect(h.brush.mock.calls[0][0]).toMatchObject({ id: 'i1', imageId: null })
  })

  it('goes back to automatic on the photo on screen', () => {
    renderDetail(jumperWithABack())
    showTheBack()
    openTheEraser()
    fireEvent.click(screen.getByTestId('brush-reset'))

    expect(h.reset).toHaveBeenCalledWith({ id: 'i1', imageId: 'img-back' })
  })
})

describe('straightening the photo on screen', () => {
  beforeEach(() => {
    h.brush.mockReset().mockResolvedValue({})
    h.reset.mockReset().mockResolvedValue({})
    h.rotate.mockReset().mockResolvedValue({})
  })

  it('turns the garment’s own photo when that is what is shown', async () => {
    renderDetail(jumperWithABack())
    startEditing()
    turnRight()

    await vi.waitFor(() => expect(h.rotate).toHaveBeenCalledTimes(1))
    expect(h.rotate.mock.calls[0][0]).toMatchObject({
      id: 'i1',
      imageId: null,
      direction: 'cw',
      quarters: 1,
    })
  })

  it('turns the back photo once the back is what is shown', async () => {
    renderDetail(jumperWithABack())
    startEditing()
    showTheBack()
    turnRight()

    await vi.waitFor(() => expect(h.rotate).toHaveBeenCalledTimes(1))
    expect(h.rotate.mock.calls[0][0]).toMatchObject({ id: 'i1', imageId: 'img-back' })
  })

  it('keeps each photo’s turns to itself', async () => {
    renderDetail(jumperWithABack())
    startEditing()
    // One turn on the front, then two on the back: three requests for two photos,
    // and the back's are the back's.
    turnRight()
    await vi.waitFor(() => expect(h.rotate).toHaveBeenCalledTimes(1))
    showTheBack()
    turnRight()

    await vi.waitFor(() => expect(h.rotate).toHaveBeenCalledTimes(2))
    expect(h.rotate.mock.calls[0][0].imageId).toBeNull()
    expect(h.rotate.mock.calls[1][0].imageId).toBe('img-back')
  })
})


// ---- what one stray tap can reach -----------------------------------------------

describe('the garment dialog keeps the dangerous things out of reach', () => {
  beforeEach(() => {
    h.brush.mockReset().mockResolvedValue({})
    h.reset.mockReset().mockResolvedValue({})
    h.rotate.mockReset().mockResolvedValue({})
    h.reanalyze.mockReset()
    h.remove.mockReset().mockResolvedValue({})
  })

  it('offers only the two harmless things before you say you are editing', () => {
    renderDetail(jumperWithABack())

    expect(screen.getByRole('button', { name: es.wardrobe.item.toolbar.favoriteAdd })).toBeTruthy()
    expect(screen.getByRole('button', { name: es.wardrobe.item.toolbar.pairings })).toBeTruthy()
    // Everything that rewrites a photo is behind the pencil.
    for (const name of [
      es.imageBrush.open,
      es.wardrobe.item.toolbar.rotateRight,
      es.wardrobe.item.toolbar.rotateLeft,
      es.wardrobe.item.toolbar.removeBackground,
      es.wardrobe.item.toolbar.replaceImage,
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('unlocks the photo tools with the pencil, and not before', () => {
    renderDetail(jumperWithABack())
    startEditing()

    expect(screen.getByRole('button', { name: es.imageBrush.open })).toBeTruthy()
    expect(screen.getByRole('button', { name: es.wardrobe.item.toolbar.rotateRight })).toBeTruthy()
  })

  it('keeps the rest folded away until asked, and re-analysis behind a question', () => {
    renderDetail(jumperWithABack())
    // Folded: not in the document at all, so there is nothing to catch a thumb.
    expect(screen.queryByRole('button', { name: es.wardrobe.item.deleteButton })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: es.wardrobe.item.toolbar.more }))
    // An overflow row is named by its title *and* the sentence under it, which is the
    // whole point of the row, so match on the title.
    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(`^${es.wardrobe.item.toolbar.reanalyzeWithAi}`),
      })
    )

    // One tap raises the question rather than overwriting the owner's own tags.
    expect(h.reanalyze).not.toHaveBeenCalled()
    expect(screen.getByText(es.wardrobe.item.reanalyzeConfirm.title)).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: es.wardrobe.item.reanalyzeConfirm.confirm })
    )
    expect(h.reanalyze).toHaveBeenCalledWith('i1')
  })
})
// ---- the flat lay: layered, and seen from behind ---------------------------------

const piece = (id: string, type: string, extra: Partial<FlatLayInput> = {}): FlatLayInput => ({
  id,
  type,
  name: null,
  thumbnail_url: `https://img/${id}-front.webp`,
  image_url: `https://img/${id}-front.webp`,
  has_cutout: true,
  ...extra,
})

const withBack = (id: string, type: string, extra: Partial<FlatLayInput> = {}) =>
  piece(id, type, {
    back_image: {
      thumbnail_url: `https://img/${id}-back.webp`,
      image_url: `https://img/${id}-back.webp`,
      has_cutout: true,
    },
    ...extra,
  })

function renderEs(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('layering and “ver por detrás” in the same frame', () => {
  it('lays the look out from the garments, so turning it round cannot move anything', () => {
    // The geometry is decided by what the garments *are*; the toggle decides only
    // which photo goes in each place. Same pieces, same z, either way round.
    const items = [piece('d', 'dress'), piece('j', 'jeans')]
    const { pieces } = buildFlatLay(items)
    const zOf = (id: string) => pieces.find((p) => p.item.id === id)!.z
    expect(zOf('d')).toBeGreaterThan(zOf('j'))

    const faces = pieces.map((p) => flatLayFace(p.item, true))
    expect(faces).toHaveLength(2)
    expect(zOf('d')).toBeGreaterThan(zOf('j'))
  })

  it('keeps the dress over the trousers when the look is turned around', () => {
    const { container } = renderEs(
      <OutfitFlatLay items={[withBack('d', 'dress'), withBack('j', 'jeans')]} />
    )
    const zBefore = Array.from(container.querySelectorAll('span[style*="z-index"]')).map(
      (el) => (el as HTMLElement).style.zIndex
    )

    fireEvent.click(screen.getByRole('switch'))

    const zAfter = Array.from(container.querySelectorAll('span[style*="z-index"]')).map(
      (el) => (el as HTMLElement).style.zIndex
    )
    expect(zAfter).toEqual(zBefore)
  })

  it('shows every garment’s own back photo, layered as before', () => {
    renderEs(<OutfitFlatLay items={[withBack('d', 'dress'), withBack('j', 'jeans')]} />)
    fireEvent.click(screen.getByRole('switch'))

    const srcs = screen.getAllByRole('img').map((img) => img.getAttribute('src'))
    expect(srcs).toContain('https://img/d-back.webp')
    expect(srcs).toContain('https://img/j-back.webp')
    expect(srcs).not.toContain('https://img/d-front.webp')
  })

  it('fades only the layered garment whose back nobody photographed', () => {
    // The dress turns round; the trousers underneath it cannot, and say so — while
    // still being drawn underneath, which is the part the layering owns.
    const { container } = renderEs(
      <OutfitFlatLay items={[withBack('d', 'dress'), piece('j', 'jeans')]} />
    )
    fireEvent.click(screen.getByRole('switch'))

    expect(container.querySelectorAll('span[class*="opacity-40"]')).toHaveLength(1)
    const srcs = screen.getAllByRole('img').map((img) => img.getAttribute('src'))
    expect(srcs).toContain('https://img/d-back.webp')
    expect(srcs).toContain('https://img/j-front.webp')
  })

  it('takes the clip from the photo it drew, not from the garment', () => {
    // A cut-out front with a white-backed back is a real state now that each photo
    // is cut out on its own, and drawing one by the other's flag is what would put
    // a white rectangle over the look.
    const white = withBack('d', 'dress', {
      back_image: {
        thumbnail_url: 'https://img/d-back.jpg',
        image_url: 'https://img/d-back.jpg',
        has_cutout: false,
      },
    })
    const { container } = renderEs(<OutfitFlatLay items={[white]} />)
    expect(container.querySelector('span[class*="rounded-tile"][class*="overflow-hidden"]')).toBeNull()

    fireEvent.click(screen.getByRole('switch'))

    expect(
      container.querySelector('span[class*="rounded-tile"][class*="overflow-hidden"]')
    ).not.toBeNull()
  })
})
