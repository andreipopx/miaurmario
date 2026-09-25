import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, renderHook, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import {
  FLAT_LAY_ASPECT,
  FLAT_LAY_MAX_PIECES,
  buildFlatLay,
  dominantGarmentColor,
  fitToFrame,
  flatLayRole,
  flatLayTint,
  flatLayTintFor,
  type FlatLayInput,
  type FlatLayPiece,
  type FlatLayRole,
} from '@/lib/outfit-flat-lay'
import { CLOTHING_TYPES } from '@/lib/types'
import { useClothingTypeLabel } from '@/lib/clothing-type-label'
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
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === 'string' ? src : ''} />
  ),
}))

import { OutfitFlatLay } from '@/components/outfits/outfit-flat-lay'

const SLUGS = CLOTHING_TYPES.map((t) => t.value)

const item = (id: string, type: string, extra: Partial<FlatLayInput> = {}): FlatLayInput => ({
  id,
  type,
  name: null,
  primary_color: null,
  thumbnail_url: `https://example.test/${id}.png`,
  ...extra,
})

function boundingBox(pieces: FlatLayPiece[], aspect = FLAT_LAY_ASPECT) {
  const left = Math.min(...pieces.map((p) => p.x - p.width / 2))
  const right = Math.max(...pieces.map((p) => p.x + p.width / 2))
  const top = Math.min(...pieces.map((p) => p.y - (p.width * aspect) / 2))
  const bottom = Math.max(...pieces.map((p) => p.y + (p.width * aspect) / 2))
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function roleOf(pieces: FlatLayPiece[], role: FlatLayRole) {
  const piece = pieces.find((p) => p.role === role)
  if (!piece) throw new Error(`no ${role} in layout`)
  return piece
}

const FULL_LOOK = [
  item('a', 'blazer'),
  item('b', 't-shirt'),
  item('c', 'jeans'),
  item('d', 'sneakers'),
  item('e', 'hat'),
  item('f', 'bag'),
]

// -- role → slot ---------------------------------------------------------------

describe('flatLayRole', () => {
  it('gives every type in the vocabulary a slot', () => {
    const known: FlatLayRole[] = [
      'full_body',
      'outer_layer',
      'mid_layer',
      'base_top',
      'bottom',
      'footwear',
      'socks',
      'neckwear',
      'accessory',
    ]
    for (const slug of SLUGS) {
      expect(known, slug).toContain(flatLayRole(slug))
    }
  })

  it('reads the garment, not the word', () => {
    expect(flatLayRole('t-shirt')).toBe('base_top')
    expect(flatLayRole('jeans')).toBe('bottom')
    expect(flatLayRole('sneakers')).toBe('footwear')
    expect(flatLayRole('coat')).toBe('outer_layer')
    expect(flatLayRole('dress')).toBe('full_body')
    expect(flatLayRole('cardigan')).toBe('mid_layer')
    expect(flatLayRole('tie')).toBe('neckwear')
    expect(flatLayRole('bag')).toBe('accessory')
    // "suit" is missing from the backend's body-slot map; it still gets a slot.
    expect(flatLayRole('suit')).toBe('full_body')
  })

  it('tucks anything it has never heard of beside the look', () => {
    expect(flatLayRole('kimono')).toBe('accessory')
    expect(flatLayRole('')).toBe('accessory')
    expect(flatLayRole(null)).toBe('accessory')
    expect(flatLayRole('T-Shirt')).toBe('base_top')
  })
})

// -- the arrangement ----------------------------------------------------------

describe('buildFlatLay', () => {
  it('lays the look out top, bottom, shoes, down the frame', () => {
    const { pieces } = buildFlatLay(FULL_LOOK)
    const top = roleOf(pieces, 'base_top')
    const bottom = roleOf(pieces, 'bottom')
    const shoes = roleOf(pieces, 'footwear')
    expect(top.y).toBeLessThan(bottom.y)
    expect(bottom.y).toBeLessThan(shoes.y)
  })

  it('overlaps the top and the bottom instead of stacking them apart', () => {
    const { pieces } = buildFlatLay([item('b', 't-shirt'), item('c', 'jeans')])
    const top = roleOf(pieces, 'base_top')
    const bottom = roleOf(pieces, 'bottom')
    const topEdge = top.y + (top.width * FLAT_LAY_ASPECT) / 2
    const bottomEdge = bottom.y - (bottom.width * FLAT_LAY_ASPECT) / 2
    expect(topEdge).toBeGreaterThan(bottomEdge)
  })

  it('paints the outer layer under the top and the bottom under it too', () => {
    const { pieces } = buildFlatLay(FULL_LOOK)
    expect(roleOf(pieces, 'outer_layer').z).toBeLessThan(roleOf(pieces, 'base_top').z)
    expect(roleOf(pieces, 'bottom').z).toBeLessThan(roleOf(pieces, 'base_top').z)
    expect(roleOf(pieces, 'accessory').z).toBeGreaterThan(roleOf(pieces, 'base_top').z)
  })

  it('returns the pieces in canonical order whatever order they arrive in', () => {
    const forwards = buildFlatLay(FULL_LOOK)
    expect(forwards.pieces.map((p) => p.role)).toEqual([
      'base_top',
      'outer_layer',
      'bottom',
      'footwear',
      'accessory',
      'accessory',
    ])
    // One garment per role: reversing the API's order changes nothing at all.
    // (Two garments sharing a role keep the order they came in, deliberately.)
    const distinct = [item('a', 'blazer'), item('b', 't-shirt'), item('c', 'jeans'), item('d', 'sneakers')]
    const shuffled = buildFlatLay([...distinct].reverse())
    expect(shuffled.pieces.map((p) => p.item.id)).toEqual(
      buildFlatLay(distinct).pieces.map((p) => p.item.id)
    )
    expect(shuffled.pieces.map((p) => [p.x, p.y, p.width])).toEqual(
      buildFlatLay(distinct).pieces.map((p) => [p.x, p.y, p.width])
    )
  })

  it('is deterministic — no randomness anywhere', () => {
    expect(buildFlatLay(FULL_LOOK)).toEqual(buildFlatLay(FULL_LOOK))
  })

  it('keeps every piece inside the frame', () => {
    for (const look of [
      FULL_LOOK,
      [item('b', 't-shirt'), item('c', 'jeans')],
      [item('d', 'dress')],
      [item('e', 'hat'), item('f', 'scarf'), item('g', 'belt')],
      [item('h', 'boots'), item('i', 'socks')],
    ]) {
      const { pieces } = buildFlatLay(look)
      const box = boundingBox(pieces)
      expect(box.left).toBeGreaterThanOrEqual(-0.001)
      expect(box.right).toBeLessThanOrEqual(1.001)
      expect(box.top).toBeGreaterThanOrEqual(-0.001)
      expect(box.bottom).toBeLessThanOrEqual(1.001)
    }
  })

  it('fills the frame when roles are missing instead of leaving a corner look', () => {
    // No shoes, no jacket: the two garments grow to occupy the frame.
    const sparse = buildFlatLay([item('b', 't-shirt'), item('c', 'jeans')])
    const box = boundingBox(sparse.pieces)
    expect(Math.max(box.width, box.height)).toBeGreaterThan(0.75)
  })

  it('makes a two-piece look bigger than the same pieces in a six-piece look', () => {
    const two = buildFlatLay([item('b', 't-shirt'), item('c', 'jeans')])
    const six = buildFlatLay(FULL_LOOK)
    expect(roleOf(two.pieces, 'base_top').width).toBeGreaterThan(
      roleOf(six.pieces, 'base_top').width
    )
  })

  it('gives each accessory its own place', () => {
    const { pieces } = buildFlatLay([
      item('a', 'hat'),
      item('b', 'scarf'),
      item('c', 'belt'),
      item('d', 'bag'),
    ])
    const spots = pieces.map((p) => `${p.x},${p.y}`)
    expect(new Set(spots).size).toBe(spots.length)
    expect(new Set(pieces.map((p) => p.z)).size).toBe(pieces.length)
  })

  it('nudges a second garment in the same role apart from the first', () => {
    const { pieces } = buildFlatLay([item('a', 'shirt'), item('b', 'sweater')])
    expect(pieces).toHaveLength(2)
    expect(pieces[0].x).not.toBe(pieces[1].x)
  })

  it('shows six and counts the rest', () => {
    const many = [
      ...FULL_LOOK,
      item('g', 'belt'),
      item('h', 'scarf'),
      item('i', 'socks'),
    ]
    const { pieces, overflow } = buildFlatLay(many)
    expect(pieces).toHaveLength(FLAT_LAY_MAX_PIECES)
    expect(overflow).toBe(many.length - FLAT_LAY_MAX_PIECES)
    // The big garments survive the cut; trinkets are what gets counted away.
    expect(pieces.map((p) => p.role)).toContain('bottom')
    expect(pieces.map((p) => p.role)).toContain('footwear')
  })

  it('honours a lower cap', () => {
    const { pieces, overflow } = buildFlatLay(FULL_LOOK, { max: 3 })
    expect(pieces).toHaveLength(3)
    expect(overflow).toBe(3)
  })

  it('has nothing to say about nothing', () => {
    expect(buildFlatLay([])).toEqual({ pieces: [], overflow: 0 })
    expect(buildFlatLay(null)).toEqual({ pieces: [], overflow: 0 })
    expect(buildFlatLay(undefined)).toEqual({ pieces: [], overflow: 0 })
  })

  it('composes a single garment in the middle of the frame', () => {
    const { pieces } = buildFlatLay([item('a', 'dress')])
    expect(pieces).toHaveLength(1)
    expect(pieces[0].x).toBeCloseTo(0.5, 5)
    expect(pieces[0].y).toBeCloseTo(0.5, 5)
  })

  it('adapts the arrangement to the frame it is given', () => {
    const portrait = buildFlatLay(FULL_LOOK, { aspect: 4 / 5 })
    const square = buildFlatLay(FULL_LOOK, { aspect: 1 })
    expect(square.pieces.map((p) => p.width)).not.toEqual(portrait.pieces.map((p) => p.width))
    expect(boundingBox(square.pieces, 1).bottom).toBeLessThanOrEqual(1.001)
  })
})

describe('fitToFrame', () => {
  it('centres whatever it is handed', () => {
    const fitted = fitToFrame([
      { item: item('a', 'hat'), role: 'accessory', x: 0.1, y: 0.1, width: 0.2, z: 1 },
    ])
    expect(fitted[0].x).toBeCloseTo(0.5, 5)
    expect(fitted[0].y).toBeCloseTo(0.5, 5)
  })

  it('leaves an empty frame empty', () => {
    expect(fitToFrame([])).toEqual([])
  })
})

// -- the tint ----------------------------------------------------------------

describe('dominantGarmentColor', () => {
  it('lets the big garments decide', () => {
    const look = [
      item('a', 'coat', { primary_color: 'navy' }),
      item('b', 'hat', { primary_color: 'red' }),
      item('c', 'belt', { primary_color: 'red' }),
      item('d', 'scarf', { primary_color: 'red' }),
    ]
    expect(dominantGarmentColor(look)).toBe('navy')
  })

  it('adds up repeats of the same colour', () => {
    const look = [
      item('a', 't-shirt', { primary_color: 'white' }),
      item('b', 'jeans', { primary_color: 'navy' }),
      item('c', 'blazer', { primary_color: 'navy' }),
    ]
    expect(dominantGarmentColor(look)).toBe('navy')
  })

  it('does not depend on the order the API returns', () => {
    const look = [
      item('a', 'jeans', { primary_color: 'black' }),
      item('b', 't-shirt', { primary_color: 'white' }),
    ]
    expect(dominantGarmentColor(look)).toBe(dominantGarmentColor([...look].reverse()))
  })

  it('says nothing when nothing is tagged', () => {
    expect(dominantGarmentColor([item('a', 'jeans')])).toBeNull()
    expect(dominantGarmentColor([])).toBeNull()
  })
})

describe('flatLayTint', () => {
  it('softens a named colour into a light and a dark surface', () => {
    const tint = flatLayTint('navy')
    expect(tint).not.toBeNull()
    expect(tint!.light).toMatch(/^#[0-9a-f]{6}$/i)
    expect(tint!.dark).toMatch(/^#[0-9a-f]{6}$/i)
    expect(tint!.light).not.toBe(tint!.dark)
  })

  it('stays soft — the tint never becomes the colour itself', () => {
    expect(flatLayTint('red')!.light.toLowerCase()).not.toBe('#c44536')
  })

  it('falls back to no tint for colours outside the palette', () => {
    expect(flatLayTint('chartreuse')).toBeNull()
    expect(flatLayTint(null)).toBeNull()
    expect(flatLayTint('')).toBeNull()
  })

  it('reads the look in one call', () => {
    expect(flatLayTintFor([item('a', 'coat', { primary_color: 'olive' })])).toEqual(
      flatLayTint('olive')
    )
  })
})

// -- no English slug ever reaches the screen ---------------------------------

function renderEs(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  )
}

describe('garment labels', () => {
  it('has a Spanish and an English label for every type in the vocabulary', () => {
    for (const slug of SLUGS) {
      const esLabel = (es.clothingTypes as Record<string, string>)[slug]
      const enLabel = (en.clothingTypes as Record<string, string>)[slug]
      expect(esLabel, slug).toBeTruthy()
      expect(enLabel, slug).toBeTruthy()
      // A label that is still the slug is the bug this guards against.
      expect(esLabel, slug).not.toBe(slug)
      // English labels are the same words, but written for a reader ("T-Shirt").
      expect(enLabel, slug).not.toBe(slug)
    }
  })

  it('never hands back a raw slug for a known type', () => {
    const { result } = renderHook(() => useClothingTypeLabel(), {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
          {children}
        </NextIntlClientProvider>
      ),
    })
    for (const slug of SLUGS) {
      expect(result.current(slug), slug).not.toBe(slug)
    }
  })

  it('labels every piece of a flat lay in Spanish, never with the backend slug', () => {
    // The stylist result used to print "t-shirt", "jeans", "sneakers", "hat".
    const look = [
      item('a', 'blazer'),
      item('b', 't-shirt'),
      item('c', 'jeans'),
      item('d', 'sneakers'),
      item('e', 'hat'),
      item('f', 'bag'),
    ]
    renderEs(<OutfitFlatLay items={look} hrefForItem={(i) => `/dashboard/wardrobe?item=${i.id}`} />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(look.length)
    const shown = links.flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? ''])
    for (const text of shown) {
      expect(text).not.toBe('')
      for (const slug of SLUGS) {
        expect(text.toLowerCase(), slug).not.toContain(slug)
      }
    }
    expect(shown.some((t) => t.includes('Camiseta'))).toBe(true)
    expect(shown.some((t) => t.includes('Vaqueros'))).toBe(true)
    expect(shown.some((t) => t.includes('Zapatillas'))).toBe(true)
    expect(shown.some((t) => t.includes('Sombrero'))).toBe(true)
  })

  it("prefers the garment's own name when it has one", () => {
    renderEs(
      <OutfitFlatLay
        items={[item('a', 't-shirt', { name: 'La de rayas' })]}
        hrefForItem={(i) => `/item/${i.id}`}
      />
    )
    expect(screen.getByRole('link').getAttribute('title')).toBe('La de rayas')
  })

  it('describes the pieces to a screen reader when they are not links', () => {
    renderEs(<OutfitFlatLay items={[item('a', 'jeans'), item('b', 'boots')]} />)
    expect(screen.getByAltText('Vaqueros')).toBeInTheDocument()
    expect(screen.getByAltText('Botas')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

// -- rendering the frame -----------------------------------------------------

describe('OutfitFlatLay', () => {
  it('renders a garment with no photo without breaking the composition', () => {
    renderEs(
      <OutfitFlatLay
        items={[
          { id: 'a', type: 'jeans', name: null, thumbnail_url: null, image_url: null },
          item('b', 'boots'),
        ]}
      />
    )
    expect(screen.getByAltText('Botas')).toBeInTheDocument()
    expect(screen.queryByAltText('Vaqueros')).toBeNull()
  })

  it('says how many garments it could not fit', () => {
    const many = [
      ...FULL_LOOK,
      item('g', 'belt'),
      item('h', 'scarf'),
    ]
    renderEs(<OutfitFlatLay items={many} />)
    expect(screen.getByText('+2 más')).toBeInTheDocument()
  })

  it('shows an empty frame rather than nothing when the look has no garments', () => {
    renderEs(<OutfitFlatLay items={[]} />)
    expect(screen.getByRole('img', { name: es.flatLay.empty })).toBeInTheDocument()
  })

  it('paints pieces in role order, not in the order they arrived', () => {
    renderEs(<OutfitFlatLay items={[item('a', 'sneakers'), item('b', 'blazer'), item('c', 't-shirt')]} />)
    const alts = screen.getAllByRole('img').map((el) => el.getAttribute('alt'))
    expect(alts).toEqual(['Camiseta', 'Americana', 'Zapatillas'])
  })
})
