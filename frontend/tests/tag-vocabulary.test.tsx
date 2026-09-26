import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import React from 'react'

import {
  ALL_COLORS,
  ALL_TYPES,
  DEFAULT_QUICK_COLORS,
  DEFAULT_QUICK_TYPES,
  QUICK_CHOICE_COUNT,
  quickChoicesFor,
  quickColorsFor,
  quickTypesFor,
} from '@/components/bulk-upload/tag-choices'
import {
  ALL_SUBTYPES,
  SUBTYPES,
  isKnownSubtype,
  subtypeAfterTypeChange,
  subtypesFor,
} from '@/lib/subtypes'
import { SubtypeField } from '@/components/bulk-upload/subtype-field'
import { resetTagUsageCache } from '@/lib/hooks/use-tag-usage'
import { TagFields } from '@/components/bulk-upload/tag-fields'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('quickTypesFor', () => {
  it('gives a brand-new wardrobe the defaults, `top` included', () => {
    // The bug this exists for: `top` is the type this owner reaches for most and it
    // was not on the row at all.
    for (const usage of [undefined, null, []] as const) {
      const types = quickTypesFor(usage)
      expect(types).toEqual([...DEFAULT_QUICK_TYPES])
      expect(types).toContain('top')
    }
  })

  it('puts the owner’s own most-worn type first', () => {
    const types = quickTypesFor([
      { type: 'top', count: 41 },
      { type: 'skirt', count: 12 },
      { type: 'boots', count: 3 },
    ])
    expect(types.slice(0, 3)).toEqual(['top', 'skirt', 'boots'])
    // The rest of the row is padded out of the defaults, in the defaults' order.
    expect(types).toHaveLength(QUICK_CHOICE_COUNT)
    expect(types[3]).toBe('t-shirt')
  })

  it('sorts by count even when the API does not', () => {
    const types = quickTypesFor([
      { type: 'boots', count: 2 },
      { type: 'top', count: 40 },
    ])
    expect(types.slice(0, 2)).toEqual(['top', 'boots'])
  })

  it('ignores anything outside the tag vocabulary', () => {
    const types = quickTypesFor([
      { type: 'kimono', count: 99 },
      { type: 'unknown', count: 80 },
      { type: '', count: 70 },
      { type: null as unknown as string, count: 60 },
      { type: 'top', count: 5 },
    ])
    expect(types).not.toContain('kimono')
    expect(types).not.toContain('unknown')
    expect(types).not.toContain('')
    expect(types[0]).toBe('top')
    for (const type of types) expect(ALL_TYPES).toContain(type)
  })

  it('keeps a stable length and never repeats a value', () => {
    const cases = [
      undefined,
      [],
      [{ type: 'top', count: 3 }],
      // A wardrobe of nothing but tops: the row is still full, still 12 long.
      [{ type: 'top', count: 3 }, { type: 'top', count: 3 }],
      ALL_TYPES.map((type, i) => ({ type, count: ALL_TYPES.length - i })),
    ]
    for (const usage of cases) {
      const types = quickTypesFor(usage)
      expect(types).toHaveLength(QUICK_CHOICE_COUNT)
      expect(new Set(types).size).toBe(types.length)
    }
  })

  it('is a pure function of its input, so the row cannot move on its own', () => {
    const usage = [{ type: 'top', count: 7 }, { type: 'dress', count: 2 }]
    expect(quickTypesFor(usage)).toEqual(quickTypesFor(usage))
    expect(quickTypesFor([...usage].reverse())).toEqual(quickTypesFor(usage))
  })
})

describe('quickColorsFor', () => {
  it('defaults for an empty wardrobe and adapts for a full one', () => {
    expect(quickColorsFor()).toEqual([...DEFAULT_QUICK_COLORS])
    const colors = quickColorsFor([
      { color: 'burgundy', count: 9 },
      { color: 'fuchsia', count: 8 },
    ])
    expect(colors[0]).toBe('burgundy')
    expect(colors).not.toContain('fuchsia')
    expect(colors).toHaveLength(QUICK_CHOICE_COUNT)
    for (const color of colors) expect(ALL_COLORS).toContain(color)
  })
})

describe('quickChoicesFor', () => {
  it('fills a short row out of the vocabulary rather than leaving it ragged', () => {
    expect(quickChoicesFor(['top'], ['shirt'], ALL_TYPES, 4)).toEqual([
      'top',
      'shirt',
      // ALL_TYPES order, minus the two already taken.
      't-shirt',
      'polo',
    ])
  })
})

describe('subtype vocabulary', () => {
  it('offers the words a top actually comes in', () => {
    // The AI kept answering `wrap` for a halter top because nothing else was on
    // offer; these are the ones the owner needs.
    for (const subtype of [
      'halter',
      'straps',
      'bandeau',
      'corset',
      'cropped',
      'long-sleeve',
      'sleeveless',
      'asymmetric',
      'wrap',
    ]) {
      expect(subtypesFor('top')).toContain(subtype)
    }
  })

  it('keeps every subtype the prompt already had', () => {
    // Slugs are a data contract: dropping one orphans every garment tagged with it.
    expect(subtypesFor('shirt')).toEqual(
      expect.arrayContaining(['henley', 'button-down', 'oxford', 'flannel', 'hawaiian', 'camp-collar'])
    )
    expect(subtypesFor('dress')).toEqual(
      expect.arrayContaining(['sundress', 'slip-dress', 'maxi', 'midi', 'wrap', 'shirt-dress', 'a-line'])
    )
    expect(subtypesFor('skirt')).toEqual(
      expect.arrayContaining(['mini', 'midi', 'maxi', 'pleated', 'wrap', 'pencil'])
    )
    expect(subtypesFor('boots')).toEqual(
      expect.arrayContaining(['ankle', 'chelsea', 'combat', 'knee-high', 'rain'])
    )
  })

  it('uses English, lowercase, hyphenated slugs throughout', () => {
    for (const slug of ALL_SUBTYPES) expect(slug).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })

  it('has no duplicates within a type, and no subtypes for a type that needs none', () => {
    for (const [type, subtypes] of Object.entries(SUBTYPES)) {
      expect(new Set(subtypes).size, type).toBe(subtypes.length)
    }
    expect(subtypesFor('jeans')).toEqual([])
    expect(subtypesFor('hoodie')).toEqual([])
    expect(subtypesFor(null)).toEqual([])
    expect(subtypesFor(undefined)).toEqual([])
  })

  it('knows a stored slug from a legacy free-text one', () => {
    expect(isKnownSubtype('top', 'halter')).toBe(true)
    expect(isKnownSubtype('top', 'HALTER')).toBe(true)
    expect(isKnownSubtype('top', 'boho-wrap-thing')).toBe(false)
    expect(isKnownSubtype('jeans', 'halter')).toBe(false)
    expect(isKnownSubtype('top', null)).toBe(false)
  })

  it('retires a subtype the new type cannot own', () => {
    // dress → skirt: both are midi, so it stays.
    expect(subtypeAfterTypeChange('skirt', 'midi')).toBe('midi')
    // dress → jeans: a pair of jeans is not a wrap.
    expect(subtypeAfterTypeChange('jeans', 'wrap')).toBeNull()
    // A legacy free-text word goes too rather than following the garment silently.
    expect(subtypeAfterTypeChange('skirt', 'boho-wrap-thing')).toBeNull()
    expect(subtypeAfterTypeChange('top', null)).toBeNull()
  })
})

describe('subtype labels', () => {
  it('translates every slug in both locales', () => {
    for (const slug of ALL_SUBTYPES) {
      expect(es.tagValues.subtypes, slug).toHaveProperty(slug)
      expect(en.tagValues.subtypes, slug).toHaveProperty(slug)
    }
  })

  it('keeps es and en in step', () => {
    expect(Object.keys(es.tagValues.subtypes).sort()).toEqual(
      Object.keys(en.tagValues.subtypes).sort()
    )
  })

  it('says the Spanish people actually say, and keeps the loanwords', () => {
    const subtypes = es.tagValues.subtypes as Record<string, string>
    expect(subtypes['wrap']).toBe('Cruzado')
    expect(subtypes['pleated']).toBe('Plisada')
    expect(subtypes['turtleneck']).toBe('Cuello alto')
    expect(subtypes['sleeveless']).toBe('Sin mangas')
    expect(subtypes['straps']).toBe('De tirantes')
    expect(subtypes['long-sleeve']).toBe('Manga larga')
    // Loanwords stay loanwords; nobody says "sujetador sin tirantes" for a bandeau.
    expect(subtypes['halter']).toBe('Halter')
    expect(subtypes['bandeau']).toBe('Bandeau')
    expect(subtypes['cropped']).toBe('Crop')
  })
})

describe('SubtypeField', () => {
  it('offers the chosen type’s subtypes in Spanish', () => {
    renderWithIntl(<SubtypeField type="top" value={null} onChange={vi.fn()} idPrefix="t" />)
    expect(screen.getByRole('button', { name: 'Halter' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'De tirantes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cruzado' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Otro' })).toBeTruthy()
  })

  it('writes the English slug, not the label', () => {
    const onChange = vi.fn()
    renderWithIntl(<SubtypeField type="top" value={null} onChange={onChange} idPrefix="t" />)
    fireEvent.click(screen.getByRole('button', { name: 'Halter' }))
    expect(onChange).toHaveBeenCalledWith('halter')
  })

  it('shows which one is chosen and lets the same tap clear it', () => {
    const onChange = vi.fn()
    renderWithIntl(<SubtypeField type="top" value="halter" onChange={onChange} idPrefix="t" />)
    expect(screen.getByRole('button', { name: 'Halter' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Halter' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('keeps a legacy free-text subtype and preloads it into "otro"', () => {
    // An item tagged before there was a vocabulary must stay editable, not vanish.
    renderWithIntl(
      <SubtypeField type="top" value="boho-wrap-thing" onChange={vi.fn()} idPrefix="t" />
    )
    const other = screen.getByRole('button', { name: 'Otro' })
    expect(other.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Otro detalle')).toHaveValue('boho-wrap-thing')
    // ...and the buttons are right there beside it.
    expect(screen.getByRole('button', { name: 'Halter' })).toBeTruthy()
  })

  it('takes a typed word through "otro"', () => {
    const onChange = vi.fn()
    renderWithIntl(<SubtypeField type="top" value={null} onChange={onChange} idPrefix="t" />)
    fireEvent.click(screen.getByRole('button', { name: 'Otro' }))
    fireEvent.change(screen.getByLabelText('Otro detalle'), { target: { value: 'peplum' } })
    expect(onChange).toHaveBeenLastCalledWith('peplum')
  })

  it('still offers the escape hatch for a type with no subtypes at all', () => {
    renderWithIntl(<SubtypeField type="jeans" value={null} onChange={vi.fn()} idPrefix="t" />)
    expect(screen.getByRole('button', { name: 'Otro' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Halter' })).toBeNull()
  })

  it('stays out of the way until there is a garment to detail', () => {
    const { container, rerender } = renderWithIntl(
      <SubtypeField type={null} value={null} onChange={vi.fn()} idPrefix="t" />
    )
    expect(container.querySelector('[data-testid="subtype-field"]')).toBeNull()
    // ...but a stored value is always visible and editable, type or no type.
    rerender(
      <NextIntlClientProvider locale="es" messages={es}>
        <SubtypeField type={null} value="boho" onChange={vi.fn()} idPrefix="t" />
      </NextIntlClientProvider>
    )
    expect(screen.getByLabelText('Otro detalle')).toHaveValue('boho')
  })

  it('gives every control a 44 px target', () => {
    renderWithIntl(<SubtypeField type="top" value="boho" onChange={vi.fn()} idPrefix="t" />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-[44px]')
    }
    expect(screen.getByLabelText('Otro detalle').className).toContain('h-11')
  })
})

describe('TagFields adapts its buttons to the wardrobe', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    resetTagUsageCache()
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('/items/types')
        ? [
            { type: 'top', count: 30 },
            { type: 'skirt', count: 8 },
          ]
        : [{ color: 'burgundy', count: 12 }]
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response)
    })
  })

  afterEach(() => {
    resetTagUsageCache()
  })

  it('shows `top` from the defaults before the wardrobe has answered', () => {
    renderWithIntl(<TagFields draft={{}} onChange={vi.fn()} idPrefix="t" />)
    expect(screen.getByRole('button', { name: es.clothingTypes.top })).toBeTruthy()
  })

  it('moves the owner’s most-worn type to the front once it knows', async () => {
    renderWithIntl(<TagFields draft={{}} onChange={vi.fn()} idPrefix="t" />)
    await waitFor(() => {
      // The chip row is the legend's sibling; the "más tipos" select comes after it.
      const row = screen.getByText(es.bulkUpload.stepper.typeLegend).nextElementSibling
      const labels = Array.from(row?.querySelectorAll('button') ?? []).map((b) => b.textContent)
      expect(labels[0]).toBe(es.clothingTypes.top)
      expect(labels[1]).toBe(es.clothingTypes.skirt)
      expect(labels).toHaveLength(QUICK_CHOICE_COUNT)
    })
  })

  it('mounts the subtype row and emits a subtype change', () => {
    const onChange = vi.fn()
    renderWithIntl(<TagFields draft={{ type: 'top' }} onChange={onChange} idPrefix="t" />)
    expect(screen.getByTestId('subtype-field')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Halter' }))
    expect(onChange).toHaveBeenCalledWith({ subtype: 'halter' })
  })

  it('drops a subtype the new type cannot own, and keeps one it can', () => {
    const onChange = vi.fn()
    const { rerender } = renderWithIntl(
      <TagFields draft={{ type: 'dress', subtype: 'wrap' }} onChange={onChange} idPrefix="t" />
    )
    fireEvent.click(screen.getByRole('button', { name: es.clothingTypes.jeans }))
    expect(onChange).toHaveBeenCalledWith({ type: 'jeans', subtype: null })

    onChange.mockClear()
    rerender(
      <NextIntlClientProvider locale="es" messages={es}>
        <TagFields draft={{ type: 'dress', subtype: 'midi' }} onChange={onChange} idPrefix="t" />
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: es.clothingTypes.skirt }))
    // A midi dress becomes a midi skirt; nothing to retire, so nothing is sent.
    expect(onChange).toHaveBeenCalledWith({ type: 'skirt' })
  })
})
