/**
 * Delante y detrás: a garment's photos know which side they show, and a look can be
 * turned around.
 *
 * The three things worth pinning, because each of them is a decision someone could
 * reasonably undo by accident:
 *
 * 1. **The toggle is not rendered when there is no back to show.** An inert switch is
 *    worse than no switch, and every look in a wardrobe from before this feature has
 *    no back at all — so on the vast majority of screens this control must simply not
 *    be there.
 * 2. **A garment with no back photo stays on its front and is faded.** Not swapped to
 *    something else, not hidden: shown, and visibly standing in, because "no tengo su
 *    espalda" is a fact about the wardrobe and the viewer has to be able to see it.
 * 3. **Nothing guesses that two photos are one garment.** The suggestion in the batch
 *    pass is a question with a remembered "no", and it only appears when three cheap
 *    facts line up.
 */

import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import {
  backPhotoOf,
  flatLayFace,
  lookHasABack,
  type FlatLayInput,
} from '@/lib/outfit-flat-lay'
import {
  SUGGEST_WINDOW_MS,
  backsPromisedTo,
  mergeTargetsFor,
  pairKey,
  suggestedBackTarget,
  visibleInReview,
  type BackPairings,
} from '@/lib/bulk-upload/back-pairing'
import type { Item } from '@/lib/types'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
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

import { FlatLayBackToggle, OutfitFlatLay } from '@/components/outfits/outfit-flat-lay'
import { PhotoViewPicker } from '@/components/photo-view-picker'

function renderEs(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>
  )
}

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

// ---- which photo of a garment to draw ------------------------------------------

describe('backPhotoOf', () => {
  it('finds the back photo when there is one', () => {
    expect(backPhotoOf(withBack('a', 'sweater'))?.image_url).toBe('https://img/a-back.webp')
  })

  it('says no for a garment with a single photo', () => {
    expect(backPhotoOf(piece('a', 'sweater'))).toBeNull()
  })

  it('says no for a back_image with no URL in it', () => {
    // An empty object from an older API shape is not a photo anybody can draw.
    expect(backPhotoOf(piece('a', 'sweater', { back_image: {} }))).toBeNull()
    expect(backPhotoOf(piece('a', 'sweater', { back_image: null }))).toBeNull()
  })

  it('survives a missing garment', () => {
    expect(backPhotoOf(null)).toBeNull()
    expect(backPhotoOf(undefined)).toBeNull()
  })
})

describe('lookHasABack', () => {
  it('is true as soon as one garment has a back photo', () => {
    expect(lookHasABack([piece('a', 'jeans'), withBack('b', 'sweater')])).toBe(true)
  })

  it('is false for a look where nobody photographed a back', () => {
    // Every look in a wardrobe that predates this feature.
    expect(lookHasABack([piece('a', 'jeans'), piece('b', 'sweater')])).toBe(false)
  })

  it('is false for an empty or missing look', () => {
    expect(lookHasABack([])).toBe(false)
    expect(lookHasABack(null)).toBe(false)
    expect(lookHasABack(undefined)).toBe(false)
  })
})

describe('flatLayFace', () => {
  it('shows the front photo untouched when the look is facing forward', () => {
    const face = flatLayFace(withBack('a', 'sweater'), false)
    expect(face.thumbnail_url).toBe('https://img/a-front.webp')
    expect(face.missingBack).toBe(false)
  })

  it('swaps to the back photo when the look is turned around', () => {
    const face = flatLayFace(withBack('a', 'sweater'), true)
    expect(face.thumbnail_url).toBe('https://img/a-back.webp')
    expect(face.missingBack).toBe(false)
  })

  it('keeps the front photo and marks it when there is no back', () => {
    const face = flatLayFace(piece('a', 'jeans'), true)
    expect(face.thumbnail_url).toBe('https://img/a-front.webp')
    expect(face.missingBack).toBe(true)
  })

  it('takes the alpha flag from the photo it chose, not from the garment', () => {
    // A cut-out back on a white-backed front is a real combination: each photo has
    // its background removed on its own.
    const mixed = piece('a', 'sweater', {
      has_cutout: false,
      back_image: { thumbnail_url: 'https://img/a-back.webp', has_cutout: true },
    })
    expect(flatLayFace(mixed, false).has_cutout).toBe(false)
    expect(flatLayFace(mixed, true).has_cutout).toBe(true)
  })

  it('leaves a single-photo garment exactly as it was', () => {
    const only = piece('a', 'jeans')
    expect(flatLayFace(only, false)).toEqual({
      thumbnail_url: only.thumbnail_url,
      image_url: only.image_url,
      has_cutout: true,
      missingBack: false,
    })
  })
})

// ---- the toggle above the frame ------------------------------------------------

describe('OutfitFlatLay: "ver por detrás"', () => {
  it('is not rendered at all when no garment in the look has a back photo', () => {
    renderEs(<OutfitFlatLay items={[piece('a', 'jeans'), piece('b', 'sweater')]} />)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('appears as soon as one garment has one', () => {
    renderEs(<OutfitFlatLay items={[piece('a', 'jeans'), withBack('b', 'sweater')]} />)
    const toggle = screen.getByRole('switch', { name: es.flatLay.seeBack })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('turns the look around when pressed, and back again', () => {
    renderEs(<OutfitFlatLay items={[withBack('b', 'sweater')]} />)
    const toggle = screen.getByRole('switch')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('img', { name: /Jersey/ }).getAttribute('src')).toBe(
      'https://img/b-back.webp'
    )

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('img', { name: /Jersey/ }).getAttribute('src')).toBe(
      'https://img/b-front.webp'
    )
  })

  it('is a real button, so the keyboard reaches and works it for free', () => {
    // No roving tabindex, no key handlers of our own to get wrong: a <button> is
    // focusable by Tab and activated by Enter and Space by the browser itself.
    renderEs(<OutfitFlatLay items={[withBack('b', 'sweater')]} />)
    const toggle = screen.getByRole('switch')
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle).toHaveAttribute('type', 'button')
    expect(toggle).not.toHaveAttribute('tabindex')
    expect(toggle).not.toBeDisabled()
  })

  it('names the frame it turns around, for assistive tech', () => {
    renderEs(<OutfitFlatLay items={[withBack('b', 'sweater')]} />)
    const controls = screen.getByRole('switch').getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    expect(document.getElementById(controls as string)).not.toBeNull()
  })

  it('fades the garments whose back nobody photographed, and says so', () => {
    const { container } = renderEs(
      <OutfitFlatLay items={[withBack('a', 'sweater'), piece('b', 'jeans')]} />
    )
    fireEvent.click(screen.getByRole('switch'))

    // The trousers are still their front photo, still visible, and dimmed.
    const trousers = screen.getByRole('img', { name: /Vaqueros/ })
    expect(trousers.getAttribute('src')).toBe('https://img/b-front.webp')
    expect(screen.getByAltText(/no tengo su espalda/i)).toBeInTheDocument()
    const faded = Array.from(container.querySelectorAll('span[class*="opacity-40"]'))
    expect(faded).toHaveLength(1)
  })

  it('does not fade the garment it did turn around', () => {
    const { container } = renderEs(<OutfitFlatLay items={[withBack('a', 'sweater')]} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(container.querySelector('span[class*="opacity-40"]')).toBeNull()
  })

  it('renames the frame for a screen reader when it is turned around', () => {
    renderEs(<OutfitFlatLay items={[withBack('a', 'sweater')]} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('group', { name: es.flatLay.labelBack }).tagName).toBe('DIV')
  })

  it('can be suppressed where the frame is a thumbnail inside a link', () => {
    // A button inside an anchor is not valid HTML, and a 160 px tile has no room.
    renderEs(<OutfitFlatLay items={[withBack('a', 'sweater')]} backToggle={false} />)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('lets a caller own the switch and tell the frame what it chose', () => {
    // Hoy's moment card: the whole card is a link, so the switch lives outside it.
    renderEs(<OutfitFlatLay items={[withBack('a', 'sweater')]} showBack />)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByRole('img', { name: /Jersey/ }).getAttribute('src')).toBe(
      'https://img/a-back.webp'
    )
  })

  it('ignores a caller asking for the back of a look that has none', () => {
    renderEs(<OutfitFlatLay items={[piece('a', 'jeans')]} showBack />)
    expect(screen.getByRole('img', { name: 'Vaqueros' }).getAttribute('src')).toBe(
      'https://img/a-front.webp'
    )
  })

  it('does not count a back photo on a garment the frame could not fit', () => {
    // The "+N más" swallowed it, so it is not a back this frame can show.
    const many = [
      piece('a', 't-shirt'),
      piece('b', 'jeans'),
      piece('c', 'sneakers'),
      piece('d', 'blazer'),
      piece('e', 'hat'),
      piece('f', 'bag'),
      withBack('g', 'scarf'),
    ]
    renderEs(<OutfitFlatLay items={many} />)
    expect(screen.queryByRole('switch')).toBeNull()
  })
})

describe('FlatLayBackToggle on its own', () => {
  it('reports its state and reverses it when pressed', () => {
    const onChange = vi.fn()
    renderEs(<FlatLayBackToggle checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

// ---- labelling a photo ---------------------------------------------------------

describe('PhotoViewPicker', () => {
  it('offers the three sides as one choice, in Spanish', () => {
    renderEs(<PhotoViewPicker idPrefix="p" value="front" onChange={() => {}} />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(screen.getByLabelText('Delante')).toBeChecked()
    expect(screen.getByLabelText('Detrás')).not.toBeChecked()
    expect(screen.getByLabelText('Detalle')).not.toBeChecked()
  })

  it('reports the side the user picked', () => {
    const onChange = vi.fn()
    renderEs(<PhotoViewPicker idPrefix="p" value="front" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Detrás'))
    expect(onChange).toHaveBeenCalledWith('back')
  })

  it('can offer only the sides that make sense for the caller', () => {
    // Merging into a garment that already has its front: "delante" is not on offer.
    renderEs(
      <PhotoViewPicker idPrefix="p" value="back" onChange={() => {}} offer={['back', 'detail']} />
    )
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.queryByLabelText('Delante')).toBeNull()
  })
})

// ---- pairing fronts with backs in the batch pass -------------------------------

const batch = (over: Partial<Item> & { id: string }): Item =>
  ({
    user_id: 'u1',
    type: 'sweater',
    favorite: false,
    image_path: `${over.id}.jpg`,
    tags: {},
    colors: [],
    status: 'ready',
    ai_processed: false,
    tagging_status: 'pending',
    wear_count: 0,
    usage_preference: 'normal',
    suggestion_count: 0,
    acceptance_count: 0,
    wears_since_wash: 0,
    needs_wash: false,
    effective_wash_interval: 3,
    care_hints: [],
    additional_images: [],
    is_archived: false,
    created_at: '2026-09-26T10:00:00Z',
    updated_at: '2026-09-26T10:00:00Z',
    ...over,
  }) as Item

describe('the review grid holds the answers as drafts', () => {
  const items = [batch({ id: 'a' }), batch({ id: 'b' }), batch({ id: 'c' })]

  it('takes a garment out of the grid once it has been handed to another', () => {
    const pairings: BackPairings = { b: { targetId: 'a', view: 'back' } }
    expect(visibleInReview(items, pairings).map((i) => i.id)).toEqual(['a', 'c'])
  })

  it('puts it straight back when the answer is undone', () => {
    // Nothing was sent, so there is nothing to undo on the server.
    expect(visibleInReview(items, {}).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('counts the backs promised to each garment', () => {
    const pairings: BackPairings = {
      b: { targetId: 'a', view: 'back' },
      c: { targetId: 'a', view: 'detail' },
    }
    expect(backsPromisedTo(pairings).get('a')).toBe(2)
  })

  it('never offers a garment as the keeper if it is itself being handed away', () => {
    const pairings: BackPairings = { c: { targetId: 'a', view: 'back' } }
    expect(mergeTargetsFor(items, pairings, 'b').map((i) => i.id)).toEqual(['a'])
  })

  it('never offers a garment to itself', () => {
    expect(mergeTargetsFor(items, {}, 'b').map((i) => i.id)).toEqual(['a', 'c'])
  })
})

describe('the quiet suggestion in the batch pass', () => {
  const pair = (over: Partial<Item> = {}) => [
    batch({ id: 'a', type: 'sweater', primary_color: 'navy', created_at: '2026-09-26T10:00:00Z' }),
    batch({
      id: 'b',
      type: 'sweater',
      primary_color: 'navy',
      created_at: '2026-09-26T10:00:20Z',
      ...over,
    }),
  ]

  it('asks about the photo before it when time, type and colour all line up', () => {
    expect(suggestedBackTarget(pair(), 1, new Set())?.id).toBe('a')
  })

  it('treats navy and blue as the same colour', () => {
    // The tagger will call one jumper's front navy and its back blue often enough
    // that insisting on an exact match would throw away most real pairs.
    expect(suggestedBackTarget(pair({ primary_color: 'blue' }), 1, new Set())?.id).toBe('a')
  })

  it('stays quiet when the photos are minutes apart', () => {
    expect(
      suggestedBackTarget(pair({ created_at: '2026-09-26T10:05:00Z' }), 1, new Set())
    ).toBeNull()
  })

  it('stays quiet when the tagger called them different garments', () => {
    expect(suggestedBackTarget(pair({ type: 'jeans' }), 1, new Set())).toBeNull()
  })

  it('stays quiet when the colours are nothing alike', () => {
    expect(suggestedBackTarget(pair({ primary_color: 'red' }), 1, new Set())).toBeNull()
  })

  it('stays quiet when the tagger could not name the type at all', () => {
    // Guessing off an unknown type would be guessing twice.
    const untyped = [
      batch({ id: 'a', type: 'unknown', primary_color: 'navy' }),
      batch({ id: 'b', type: 'unknown', primary_color: 'navy', created_at: '2026-09-26T10:00:20Z' }),
    ]
    expect(suggestedBackTarget(untyped, 1, new Set())).toBeNull()
  })

  it('stays quiet when either garment has no colour to compare', () => {
    const colourless = [
      batch({ id: 'a', type: 'sweater' }),
      batch({ id: 'b', type: 'sweater', created_at: '2026-09-26T10:00:20Z' }),
    ]
    expect(suggestedBackTarget(colourless, 1, new Set())).toBeNull()
  })

  it('never asks again about a pair the user said no to', () => {
    const items = pair()
    const dismissed = new Set([pairKey('a', 'b')])
    expect(suggestedBackTarget(items, 1, dismissed)).toBeNull()
  })

  it('stays quiet when the garment before it already has a back photo', () => {
    const items = pair()
    items[0] = batch({
      id: 'a',
      type: 'sweater',
      primary_color: 'navy',
      back_image: { image_url: 'https://img/a-back.webp' },
    })
    expect(suggestedBackTarget(items, 1, new Set())).toBeNull()
  })

  it('stays quiet when either garment is already spoken for', () => {
    const items = pair()
    expect(suggestedBackTarget(items, 1, new Set(), { b: { targetId: 'a', view: 'back' } })).toBeNull()
  })

  it('has nothing to ask about the first photo of a batch', () => {
    expect(suggestedBackTarget(pair(), 0, new Set())).toBeNull()
  })

  it('uses a window of about a minute', () => {
    expect(SUGGEST_WINDOW_MS).toBe(60_000)
  })
})

// ---- i18n ---------------------------------------------------------------------

describe('i18n parity for the front-and-back copy', () => {
  it('has every flat-lay key in both languages', () => {
    expect(Object.keys(es.flatLay).sort()).toEqual(Object.keys(en.flatLay).sort())
  })

  it('has every photo-view key in both languages', () => {
    expect(Object.keys(es.imageViews).sort()).toEqual(Object.keys(en.imageViews).sort())
  })

  it('has every merge key in both languages', () => {
    expect(Object.keys(es.mergeBack).sort()).toEqual(Object.keys(en.mergeBack).sort())
    expect(Object.keys(es.mergeBack.blocker).sort()).toEqual(
      Object.keys(en.mergeBack.blocker).sort()
    )
  })

  it('has every review key in both languages', () => {
    expect(Object.keys(es.bulkUpload.review).sort()).toEqual(
      Object.keys(en.bulkUpload.review).sort()
    )
  })

  it('names the three sides the way the owner says them', () => {
    expect(es.imageViews.front).toBe('Delante')
    expect(es.imageViews.back).toBe('Detrás')
    expect(es.imageViews.detail).toBe('Detalle')
    expect(es.flatLay.seeBack).toBe('Ver por detrás')
  })

  it('says in Spanish which garment keeps its data and that the photo moves', () => {
    // The thing that would frighten someone here is the suspicion that their tags
    // are about to be blended. The copy has to rule it out.
    expect(es.mergeBack.explain).toContain('se queda con todos sus datos')
    expect(es.mergeBack.explain).toContain('Solo se mueve la foto')
    expect(es.mergeBack.explain).toContain('No se puede deshacer')
    expect(es.mergeBack.explainGeneric).toContain('Solo se mueve la foto')
  })
})
