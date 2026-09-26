import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import { normalizeHex, nearestClothingColor, swatchHex, clothingColorHex } from '@/lib/colors'
import { QuickReview, draftOf } from '@/components/bulk-upload/quick-review'
import type { Item } from '@/lib/types'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

vi.mock('@/lib/hooks/use-ai-access', () => ({
  useAIStatus: () => ({
    data: { server_ai_enabled: true, capabilities: { vision: true, text: true } },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('@/components/native/lazy-stinky', () => ({
  LazyStinky: () => <span data-testid="lazy-stinky" />,
}))

import { AddItemDialog } from '@/components/add-item-dialog'

// Two browns a person calls the same thing and a screen shows differently.
const CHOCOLATE = '#4a2c1a'
const CAMEL = '#a9764b'

function itemOf(over: Partial<Item>): Item {
  return {
    id: over.id ?? 'i1',
    user_id: 'u1',
    type: 'coat',
    favorite: false,
    image_path: 'x.jpg',
    thumbnail_url: 'https://example.test/x_thumb.jpg',
    image_url: 'https://example.test/x.jpg',
    tags: { colors: [], style: [], season: [] },
    colors: [],
    status: 'ready',
    ai_processed: true,
    tagging_status: 'tagged',
    wear_count: 0,
    suggestion_count: 0,
    acceptance_count: 0,
    wears_since_wash: 0,
    needs_wash: false,
    effective_wash_interval: 5,
    care_hints: [],
    additional_images: [],
    is_archived: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as Item
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('normalizeHex', () => {
  it('accepts the shapes a browser or a person produces', () => {
    expect(normalizeHex('#4A2C1A')).toBe(CHOCOLATE)
    expect(normalizeHex('4a2c1a')).toBe(CHOCOLATE)
    expect(normalizeHex(' #abc ')).toBe('#aabbcc')
  })

  it('refuses anything that is not a colour', () => {
    // The result goes into a `style` attribute, so a near-miss has to be a
    // rejection and not a best guess.
    for (const junk of [null, undefined, '', '   ', '#12345', '#1234567', 'red', 'rgb(1,2,3)']) {
      expect(normalizeHex(junk as string | null | undefined)).toBeUndefined()
    }
  })
})

describe('two different browns are both marrón', () => {
  it('classifies both shades into the same family', () => {
    // This is the whole point of keeping the hex separately: the family is what
    // the filters, the scorer and the stylist read, and a shade must not split
    // one garment away from another the user would name the same way.
    //
    // Two browns a person really would both call "marrón" — one a shade darker,
    // one a shade lighter than the palette's brown — land on the same family.
    const darker = nearestClothingColor('#7d5136')
    const lighter = nearestClothingColor('#966444')
    expect(darker).toBe('brown')
    expect(lighter).toBe('brown')
    expect(darker).toBe(lighter)

    // And the family survives the round trip: the shade is not what decides it.
    expect(nearestClothingColor('#7d5136')).toBe(nearestClothingColor('#8B5A3C'))
  })

  it('shows each garment its own shade while the family stays put', () => {
    // Same named family, different swatch: the label reads "marrón" for both,
    // the dot does not.
    expect(swatchHex('brown', CHOCOLATE)).toBe(CHOCOLATE)
    expect(swatchHex('brown', CAMEL)).toBe(CAMEL)
    expect(swatchHex('brown', CHOCOLATE)).not.toBe(swatchHex('brown', CAMEL))
  })

  it('falls back to the palette for an item that has no shade', () => {
    // Every item uploaded before the column existed.
    expect(swatchHex('brown', null)).toBe(clothingColorHex('brown'))
    expect(swatchHex('brown', undefined)).toBe(clothingColorHex('brown'))
    // And a shade the server should never have sent does not leak into CSS.
    expect(swatchHex('brown', 'chocolate')).toBe(clothingColorHex('brown'))
  })

  it('has nothing to show for an item with no colour at all', () => {
    expect(swatchHex(null, null)).toBeUndefined()
    expect(swatchHex(undefined, undefined)).toBeUndefined()
    // A shade with no family still paints, because that is all we were given.
    expect(swatchHex(null, CAMEL)).toBe(CAMEL)
  })
})

describe('draftOf', () => {
  it('prefers the shade the user just sampled over the stored one', () => {
    const item = itemOf({ primary_color: 'brown', primary_color_hex: CAMEL })
    expect(draftOf(item, undefined).primaryColorHex).toBe(CAMEL)
    expect(draftOf(item, { primaryColorHex: CHOCOLATE }).primaryColorHex).toBe(CHOCOLATE)
  })

  it('treats an explicit null as "the user dropped the shade"', () => {
    // Picking a family off the swatches says nothing about the shade, so `null`
    // has to survive the merge instead of falling back to what was stored.
    const item = itemOf({ primary_color: 'brown', primary_color_hex: CAMEL })
    expect(draftOf(item, { primaryColor: 'black', primaryColorHex: null }).primaryColorHex).toBeNull()
  })

  it('samples from the largest image and shows the thumbnail', () => {
    const draft = draftOf(itemOf({}), undefined)
    expect(draft.imageUrl).toBe('https://example.test/x_thumb.jpg')
    expect(draft.fullImageUrl).toBe('https://example.test/x.jpg')
  })
})

describe('the review grid', () => {
  it('makes the photo its own target for picking a colour', () => {
    renderWithIntl(
      <QuickReview
        items={[itemOf({ primary_color: 'brown', primary_color_hex: CAMEL })]}
        edits={{}}
        openId={null}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onRotate={vi.fn()}
        rotating={() => false}
        onStartStepper={vi.fn()}
      />
    )
    // The pipette on the corner of the photo goes straight to the colour; the tile
    // itself opens the garment's tags. Both are real buttons, so a keyboard reaches
    // them, and neither is nested inside the other.
    const pipette = screen.getByRole('button', { name: es.bulkUpload.review.pickColour })
    const tile = screen.getByTestId('bulk-review-tile')
    expect(pipette).toBeTruthy()
    expect(tile).toBeTruthy()
    expect(tile.contains(pipette)).toBe(false)
    expect(pipette.contains(tile)).toBe(false)
  })

  it('paints the garment’s own shade, not the palette’s', () => {
    const { container } = renderWithIntl(
      <QuickReview
        items={[itemOf({ primary_color: 'brown', primary_color_hex: CAMEL })]}
        edits={{}}
        openId={null}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onRotate={vi.fn()}
        rotating={() => false}
        onStartStepper={vi.fn()}
      />
    )
    const swatch = container.querySelector('[style*="background-color"]')
    expect(swatch?.getAttribute('style')).toContain('169, 118, 75')
  })

  it('still paints an item that has no shade', () => {
    const { container } = renderWithIntl(
      <QuickReview
        items={[itemOf({ primary_color: 'brown', primary_color_hex: null })]}
        edits={{}}
        openId={null}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onRotate={vi.fn()}
        rotating={() => false}
        onStartStepper={vi.fn()}
      />
    )
    expect(container.querySelector('[style*="background-color"]')).toBeTruthy()
    expect(screen.getByText(es.tagValues.colors.brown)).toBeTruthy()
  })
})

describe('the add form', () => {
  function renderAddDialog() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="es" messages={es}>
          <AddItemDialog open onOpenChange={vi.fn()} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    )
  }

  it('offers taking a photo beside choosing one', () => {
    renderAddDialog()
    expect(screen.getByText(es.wardrobe.add.takePhoto)).toBeTruthy()
    expect(screen.getByText(es.wardrobe.add.choosePhoto)).toBeTruthy()
  })

  it('asks the phone for the camera, and degrades to the picker without one', () => {
    renderAddDialog()
    // The dialog renders into a portal, so this looks at the document and not at
    // the render container.
    const camera = screen.getByTestId('single-camera-input') as HTMLInputElement
    // `capture` is the whole mechanism: a phone opens the camera, a laptop with
    // no camera ignores it and shows the same file picker.
    expect(camera.getAttribute('capture')).toBe('environment')
    expect(camera.getAttribute('accept')).toBe('image/*')
    // One garment per trip through this form, so no multiple here — the bulk tab
    // is the one that takes a whole roll.
    expect(camera.multiple).toBe(false)
  })

  it('says the eyedropper needs a photo before there is one', () => {
    renderAddDialog()
    expect(screen.getByText(es.color.capture.needsPhoto)).toBeTruthy()
    const dropper = screen.getByRole('button', { name: es.color.capture.fromPhoto })
    expect((dropper as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers the wheel whether or not there is a photo', () => {
    renderAddDialog()
    expect(screen.getByRole('button', { name: es.color.capture.fromWheel })).toBeTruthy()
  })
})

describe('colour capture copy', () => {
  it('has the same keys in both locales', () => {
    expect(Object.keys(es.color.capture).sort()).toEqual(Object.keys(en.color.capture).sort())
  })

  it('offers taking the photo as well as choosing one, in both locales', () => {
    for (const messages of [es, en]) {
      expect(messages.wardrobe.add.takePhoto).toBeTruthy()
      expect(messages.wardrobe.add.choosePhoto).toBeTruthy()
      expect(messages.wardrobe.add.takePhoto).not.toBe(messages.wardrobe.add.choosePhoto)
      // The bulk tab already had its own camera button; both tabs must say it.
      expect(messages.bulkUpload.picker.camera).toBeTruthy()
    }
  })

  it('names the photo target wherever a photo can be tapped', () => {
    for (const messages of [es, en]) {
      expect(messages.bulkUpload.review.pickColour).toBeTruthy()
      expect(messages.bulkUpload.stepper.pickColour).toBeTruthy()
    }
  })

  it('says «Hacer foto» in Spanish and not in English', () => {
    expect(es.wardrobe.add.takePhoto).toBe('Hacer foto')
    expect(es.wardrobe.add.takePhoto).toBe(es.bulkUpload.picker.camera)
    expect(en.wardrobe.add.takePhoto).not.toBe(es.wardrobe.add.takePhoto)
  })
})

/**
 * Where the colour work and the photo work meet.
 *
 * Two features landed on the same tiles: one gives a garment a plate the colour of
 * the garment, the other gives it the shade actually sampled off its photo. They
 * have to agree — one measurement, read by both — and the tags the review grid
 * gained must still be reachable now that the colour field is there.
 */
describe('the tile and its swatch', () => {
  function tileTintOf(item: Item): string {
    const { container } = renderWithIntl(
      <QuickReview
        items={[item]}
        edits={{}}
        openId={null}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onRotate={vi.fn()}
        rotating={() => false}
        onStartStepper={vi.fn()}
      />
    )
    const plate = container.querySelector('[style*="--tile-tint"]')
    return plate?.getAttribute('style') ?? ''
  }

  it('plates the garment with the shade it shows, not with the family average', () => {
    // Two garments a person calls «marrón». The palette has one brown, so before
    // this the two tiles were identical; the measurement is what tells them apart.
    const chocolate = tileTintOf(itemOf({ primary_color: 'brown', primary_color_hex: CHOCOLATE }))
    const camel = tileTintOf(itemOf({ id: 'i2', primary_color: 'brown', primary_color_hex: CAMEL }))
    expect(chocolate).toContain('--tile-tint')
    expect(camel).toContain('--tile-tint')
    expect(chocolate).not.toBe(camel)
  })

  it('still plates a garment that was never sampled', () => {
    // Every garment uploaded before the column existed: the family's own hex is
    // what the plate is derived from, exactly as it was.
    const named = tileTintOf(itemOf({ primary_color: 'brown', primary_color_hex: null }))
    expect(named).toContain('--tile-tint')
    expect(named).toContain('hsl(')
  })

  it('shows the plate and the measured dot at the same time', () => {
    const { container } = renderWithIntl(
      <QuickReview
        items={[itemOf({ primary_color: 'brown', primary_color_hex: CAMEL })]}
        edits={{}}
        openId={null}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onRotate={vi.fn()}
        rotating={() => false}
        onStartStepper={vi.fn()}
      />
    )
    expect(container.querySelector('[style*="--tile-tint"]')).toBeTruthy()
    const dot = container.querySelector('[style*="background-color"]')
    expect(dot?.getAttribute('style')).toContain('169, 118, 75')
  })
})

describe('the review grid, with the colour field on it', () => {
  function openTile(item: Item) {
    const onEdit = vi.fn()
    const rendered = renderWithIntl(
      <QuickReview
        items={[item]}
        edits={{}}
        openId={item.id}
        onOpen={vi.fn()}
        onEdit={onEdit}
        onRotate={vi.fn()}
        rotating={() => false}
        onStartStepper={vi.fn()}
      />
    )
    return { ...rendered, onEdit }
  }

  it('still asks tipo, color, estilo and formalidad', () => {
    openTile(itemOf({ primary_color: 'brown' }))
    expect(screen.getByTestId('tag-fields')).toBeTruthy()
    for (const legend of [
      es.bulkUpload.stepper.typeLegend,
      es.bulkUpload.stepper.colorLegend,
      es.bulkUpload.stepper.styleLegend,
      es.bulkUpload.stepper.formalityLegend,
    ]) {
      expect(screen.getAllByText(legend, { exact: false }).length).toBeGreaterThan(0)
    }
  })

  it('offers the eyedropper in the colour row, beside the swatches', () => {
    openTile(itemOf({ primary_color: 'brown' }))
    // Two of them now: the pipette on the photo and the one in the colour row.
    // Both lead to the same picker.
    expect(
      screen.getAllByRole('button', { name: es.bulkUpload.stepper.pickColour }).length
    ).toBeGreaterThanOrEqual(1)
  })

  it('drops the sampled shade when a family is picked off the swatches', () => {
    const { onEdit } = openTile(itemOf({ primary_color: 'brown', primary_color_hex: CAMEL }))
    screen.getByRole('button', { name: es.tagValues.colors.black }).click()
    expect(onEdit).toHaveBeenCalledWith('i1', {
      primaryColor: 'black',
      primaryColorHex: null,
    })
  })

  it('keeps editing the other tags without touching the colour', () => {
    const { onEdit } = openTile(itemOf({ primary_color: 'brown', primary_color_hex: CAMEL }))
    screen.getByRole('button', { name: es.tagValues.styles.elegant }).click()
    expect(onEdit).toHaveBeenCalledWith('i1', { style: ['elegant'] })
  })
})
