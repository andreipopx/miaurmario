import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import React from 'react'

import {
  CROP_PRESETS,
  MAX_ZOOM,
  centred,
  clampFrame,
  clampOffset,
  cropRect,
  frameFor,
  isWholeImage,
  normaliseQuarters,
  presetRatio,
  turnedSize,
  zoomAt,
} from '@/lib/image-crop'
import { cropBox, centred as centredSquare } from '@/lib/avatar-crop'
import { garmentTileTint, garmentTint } from '@/lib/garment-tint'
import {
  FORMALITY_LEVELS,
  MAX_STYLES,
  QUICK_STYLES,
  SEASONS,
  asTagList,
  toggleStyle,
} from '@/components/bulk-upload/tag-choices'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

import { UploadQueueList } from '@/components/bulk-upload/upload-queue-list'
import { TagFields } from '@/components/bulk-upload/tag-fields'
import { GarmentThumb } from '@/components/bulk-upload/garment-thumb'
import type { QueuedPhoto } from '@/lib/bulk-upload/queue'

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>
  )
}

const row = (over: Partial<QueuedPhoto>): QueuedPhoto => ({
  id: over.id ?? 'p1',
  name: over.name ?? 'foto.jpg',
  state: over.state ?? 'pending',
  progress: over.progress ?? 0,
  ...over,
})

describe('crop geometry on a rectangular frame', () => {
  const portrait = { width: 300, height: 900 }

  it('starts centred and covering the frame', () => {
    const frame = { width: 200, height: 300 }
    const state = centred(portrait, frame)
    const rect = cropRect(portrait, frame, state)
    // The frame is 2:3; the kept rectangle has the same proportions.
    expect(rect.width / rect.height).toBeCloseTo(frame.width / frame.height, 2)
    // ...and it is vertically centred in a photo three times as tall.
    expect(rect.y + rect.height / 2).toBeCloseTo(portrait.height / 2, 0)
  })

  it('never lets the image leave the frame, at any zoom', () => {
    const frame = { width: 240, height: 180 }
    for (const [x, y, zoom] of [
      [0, 0, 1],
      [-9999, -9999, 3.7],
      [500, 400, 1.4],
      [10, -200, 2],
    ]) {
      const rect = cropRect(portrait, frame, clampOffset(portrait, frame, { x, y, zoom }))
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(portrait.width)
      expect(rect.y + rect.height).toBeLessThanOrEqual(portrait.height)
    }
  })

  it('zooming in keeps the centre and shrinks what is kept', () => {
    const frame = { width: 200, height: 200 }
    const wide = { width: 400, height: 200 }
    const state = zoomAt(wide, frame, centred(wide, frame), 2)
    const rect = cropRect(wide, frame, state)
    expect(rect.width).toBe(100)
    expect(rect.x + rect.width / 2).toBe(200)
    expect(rect.y + rect.height / 2).toBe(100)
  })

  it('clamps zoom to [1, MAX_ZOOM]', () => {
    const frame = { width: 200, height: 200 }
    expect(zoomAt(portrait, frame, centred(portrait, frame), 99).zoom).toBe(MAX_ZOOM)
    expect(zoomAt(portrait, frame, centred(portrait, frame), 0.1).zoom).toBe(1)
  })

  it('knows when the crop is the whole photo, so nothing is sent', () => {
    expect(isWholeImage(portrait, { x: 0, y: 0, width: 300, height: 900 })).toBe(true)
    expect(isWholeImage(portrait, { x: 0, y: 0, width: 300, height: 400 })).toBe(false)
  })

  it('still answers the avatar cropper in its own square terms', () => {
    // The profile photo delegates here now; its contract must not have moved.
    const landscape = { width: 400, height: 200 }
    const state = centredSquare(landscape, 200)
    expect(state).toEqual({ zoom: 1, x: -100, y: 0 })
    expect(cropBox(landscape, 200, state)).toEqual({ x: 100, y: 0, size: 200 })
  })
})

describe('crop presets', () => {
  it('offers free plus the three shapes garments actually need', () => {
    expect([...CROP_PRESETS]).toEqual(['free', 'square', 'portrait', 'landscape'])
    expect(presetRatio('square', null)).toBe(1)
    expect(presetRatio('portrait', null)).toBeCloseTo(3 / 4)
    expect(presetRatio('landscape', null)).toBeCloseTo(4 / 3)
  })

  it('free follows the photo, so nothing is cut off by default', () => {
    expect(presetRatio('free', { width: 900, height: 300 })).toBe(3)
    expect(presetRatio('free', null)).toBe(1)
  })

  it('fits the frame inside the stage whichever way round it is', () => {
    const stage = { width: 300, height: 300 }
    expect(frameFor(stage, 3 / 4)).toEqual({ width: 225, height: 300 })
    expect(frameFor(stage, 4 / 3)).toEqual({ width: 300, height: 225 })
    expect(frameFor(stage, 1)).toEqual({ width: 300, height: 300 })
  })

  it('a hand-dragged frame cannot escape the stage or vanish', () => {
    const stage = { width: 300, height: 200 }
    expect(clampFrame(stage, { width: 9999, height: 9999 })).toEqual({ width: 300, height: 200 })
    expect(clampFrame(stage, { width: 1, height: 1 })).toEqual({ width: 48, height: 48 })
  })
})

describe('quarter turns', () => {
  it('swaps the sides for an odd number of turns', () => {
    const photo = { width: 300, height: 900 }
    expect(turnedSize(photo, 0)).toEqual(photo)
    expect(turnedSize(photo, 1)).toEqual({ width: 900, height: 300 })
    expect(turnedSize(photo, 2)).toEqual(photo)
    expect(turnedSize(photo, 3)).toEqual({ width: 900, height: 300 })
  })

  it('normalises turns in both directions', () => {
    expect(normaliseQuarters(-1)).toBe(3)
    expect(normaliseQuarters(4)).toBe(0)
    expect(normaliseQuarters(5)).toBe(1)
    expect(turnedSize({ width: 2, height: 4 }, -1)).toEqual({ width: 4, height: 2 })
  })
})

describe('garment tint', () => {
  it('is the garment hue as a wash, never as a colour', () => {
    const tint = garmentTint('red')
    expect(tint).not.toBeNull()
    const [saturation, lightness] = tint!.light
      .match(/hsl\(\d+ ([\d.]+)% ([\d.]+)%\)/)!
      .slice(1)
      .map(Number)
    expect(saturation).toBeLessThan(45)
    expect(lightness).toBeGreaterThan(88)
  })

  it('lifts the dull colours a real wardrobe is full of into view', () => {
    // A linear map on chroma leaves navy and olive indistinguishable from the
    // neutral panel, which is the same as having no tint at all.
    for (const value of ['navy', 'olive', 'burgundy', 'teal']) {
      const saturation = Number(garmentTint(value)!.light.match(/hsl\(\d+ ([\d.]+)%/)![1])
      expect(saturation).toBeGreaterThan(8)
    }
  })

  it('keeps a plate light enough in the dark theme for multiply to work', () => {
    const tint = garmentTint('blue')!
    const lightness = Number(tint.dark.match(/([\d.]+)%\)$/)![1])
    expect(lightness).toBeGreaterThan(70)
    expect(lightness).toBeLessThan(90)
  })

  it('is deeper and duller in the dark theme than in the light one', () => {
    const tint = garmentTint('green')!
    const read = (value: string) =>
      value.match(/hsl\(\d+ ([\d.]+)% ([\d.]+)%\)/)!.slice(1).map(Number)
    const [lightS, lightL] = read(tint.light)
    const [darkS, darkL] = read(tint.dark)
    expect(darkL).toBeLessThan(lightL)
    expect(darkS).toBeLessThan(lightS)
  })

  it('leaves the greys alone: a tinted black jumper is just a dirty tile', () => {
    for (const value of ['black', 'white', 'gray', 'charcoal', 'silver']) {
      expect(garmentTint(value)).toBeNull()
    }
  })

  it('falls back to the neutral panel when there is no colour yet', () => {
    expect(garmentTint(null)).toBeNull()
    expect(garmentTint(undefined)).toBeNull()
    expect(garmentTint('not-a-colour')).toBeNull()
    expect(garmentTileTint(null).style).toMatchObject({ '--tile-tint': 'var(--panel)' })
  })

  it('gives every tile a plate, so the dark grid is one surface not a patchwork', () => {
    // A cut-out brings no background of its own: a dark tile would swallow a
    // black jacket, and tinting only the red garments would leave a patchwork.
    const untinted = garmentTileTint('black').style as Record<string, string>
    const tinted = garmentTileTint('red').style as Record<string, string>
    const lightness = (value: string) => Number(value.match(/([\d.]+)%\)$/)![1])
    expect(lightness(untinted['--tile-tint-dark'])).toBeCloseTo(
      lightness(tinted['--tile-tint-dark']),
      1
    )
  })

  it('prefers a measured hex over the named swatch', () => {
    // feat/color-capture stores one; until then the palette swatch stands in.
    const measured = garmentTint('gray', '#2f7fd0')
    expect(measured).not.toBeNull()
    expect(garmentTint('gray')).toBeNull()
  })

  it('hands the tile both themes as custom properties', () => {
    const tint = garmentTileTint('green')
    expect(tint.className).toContain('dark:bg-[var(--tile-tint-dark)]')
    expect(tint.style).toMatchObject({
      '--tile-tint': expect.stringContaining('hsl('),
      '--tile-tint-dark': expect.stringContaining('hsl('),
    })
  })
})

describe('GarmentThumb', () => {
  it('multiplies a white-backed photo so the tint shows through it', () => {
    const { container } = renderWithIntl(
      <GarmentThumb src="/img.jpg" color="red" hasCutout={false} className="h-10 w-10" />
    )
    expect(container.querySelector('img')).toHaveClass('mix-blend-multiply')
  })

  it('leaves a real cut-out alone: multiplying would darken the garment', () => {
    const { container } = renderWithIntl(
      <GarmentThumb src="/img.webp" color="red" hasCutout className="h-10 w-10" />
    )
    expect(container.querySelector('img')).not.toHaveClass('mix-blend-multiply')
  })

  it('shows the turns already saved, without waiting for a refetch', () => {
    const { container } = renderWithIntl(
      <GarmentThumb src="/img.jpg" color="red" quarterTurns={1} className="h-10 w-10" />
    )
    expect(container.querySelector('img')).toHaveStyle({ transform: 'rotate(90deg)' })
  })
})

describe('style and formality choices', () => {
  it('keeps at most two styles, dropping the oldest', () => {
    expect(toggleStyle([], 'casual')).toEqual(['casual'])
    expect(toggleStyle(['casual'], 'sporty')).toEqual(['casual', 'sporty'])
    expect(toggleStyle(['casual', 'sporty'], 'elegant')).toEqual(['sporty', 'elegant'])
    expect(toggleStyle(['casual', 'sporty'], 'casual')).toEqual(['sporty'])
    expect(MAX_STYLES).toBe(2)
  })

  it('reads a tag list whatever shape it arrived in', () => {
    // `tags` is free-form JSON: the tagger is asked for a list, but a model that
    // answers with a bare string lands here too, and one odd garment must not
    // take a screen down with it.
    expect(asTagList(['casual', 'sporty'])).toEqual(['casual', 'sporty'])
    expect(asTagList('pumps')).toEqual(['pumps'])
    expect(asTagList(undefined)).toEqual([])
    expect(asTagList(null)).toEqual([])
    expect(asTagList(42)).toEqual([])
    expect(asTagList(['casual', 7, null])).toEqual(['casual'])
  })

  it('treats a missing list as empty, which is the no-AI case', () => {
    expect(toggleStyle(null, 'casual')).toEqual(['casual'])
    expect(toggleStyle(undefined, 'casual')).toEqual(['casual'])
  })

  it('only offers values the tagger and the scorer understand', () => {
    for (const style of QUICK_STYLES) {
      expect(es.tagValues.styles).toHaveProperty(style)
      expect(en.tagValues.styles).toHaveProperty(style)
    }
    for (const level of FORMALITY_LEVELS) {
      expect(es.tagValues.formality).toHaveProperty(level)
      expect(en.tagValues.formality).toHaveProperty(level)
    }
    for (const season of SEASONS) {
      expect(es.tagValues.seasons).toHaveProperty(season)
      expect(en.tagValues.seasons).toHaveProperty(season)
    }
  })
})

describe('TagFields', () => {
  it('asks all four tags, each one tap away', () => {
    renderWithIntl(<TagFields draft={{}} onChange={vi.fn()} idPrefix="t" />)
    for (const legend of ['Tipo', 'Color principal', /^Estilo/, 'Formalidad']) {
      expect(screen.getByText(legend)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Vaqueros' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Elegante' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Oficina informal' })).toBeInTheDocument()
  })

  it('pre-fills nothing when the tagger never ran', () => {
    renderWithIntl(<TagFields draft={{}} onChange={vi.fn()} idPrefix="t" />)
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('shows what is already tagged as pressed', () => {
    renderWithIntl(
      <TagFields
        draft={{ type: 'jeans', style: ['elegant'], formality: 'formal' }}
        onChange={vi.fn()}
        idPrefix="t"
      />
    )
    expect(screen.getByRole('button', { name: 'Vaqueros' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Elegante' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Formal' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says a colour was picked and lets the caller move on', () => {
    const onChange = vi.fn()
    const onColorPicked = vi.fn()
    renderWithIntl(
      <TagFields draft={{}} onChange={onChange} onColorPicked={onColorPicked} idPrefix="t" />
    )
    screen.getByRole('button', { name: 'Negro' }).click()
    // Off the swatches the user named a family and nothing more, so a shade
    // sampled against the old family goes with it rather than contradicting it.
    expect(onChange).toHaveBeenCalledWith({ primaryColor: 'black', primaryColorHex: null })
    expect(onColorPicked).toHaveBeenCalled()
  })

  it('reports touching style, so the stepper does not move under the user', () => {
    const onDetailsTouched = vi.fn()
    renderWithIntl(
      <TagFields draft={{}} onChange={vi.fn()} onDetailsTouched={onDetailsTouched} idPrefix="t" />
    )
    screen.getByRole('button', { name: 'Elegante' }).click()
    expect(onDetailsTouched).toHaveBeenCalled()
  })
})

describe('rotating from the upload queue', () => {
  it('offers it once the garment exists', () => {
    renderWithIntl(
      <UploadQueueList
        photos={[row({ state: 'done', itemId: 'i1', name: 'jeans.jpg' })]}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onRotate={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Girar jeans.jpg a la derecha' })).toBeInTheDocument()
  })

  it('does not offer it for a photo still on its way up', () => {
    renderWithIntl(
      <UploadQueueList
        photos={[row({ state: 'uploading', name: 'jeans.jpg' })]}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onRotate={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /Girar/ })).not.toBeInTheDocument()
  })

  it('turns the row thumbnail to match what was saved', () => {
    const { container } = renderWithIntl(
      <UploadQueueList
        photos={[row({ state: 'done', itemId: 'i1', previewUrl: 'blob:x' })]}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onRotate={vi.fn()}
        turns={{ p1: 3 }}
      />
    )
    expect(container.querySelector('img')).toHaveStyle({ transform: 'rotate(270deg)' })
  })

  it('says which way each button goes, per photo', () => {
    const onRotate = vi.fn()
    renderWithIntl(
      <UploadQueueList
        photos={[row({ state: 'done', itemId: 'i1', name: 'abrigo.jpg' })]}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onRotate={onRotate}
      />
    )
    screen.getByRole('button', { name: 'Girar abrigo.jpg a la izquierda' }).click()
    expect(onRotate).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'i1' }), 'ccw')
  })
})

describe('i18n parity for the photo copy', () => {
  it('has every crop key in both languages', () => {
    expect(Object.keys(es.imageCrop).sort()).toEqual(Object.keys(en.imageCrop).sort())
    expect(Object.keys(es.imageCrop.presets).sort()).toEqual(
      Object.keys(en.imageCrop.presets).sort()
    )
  })

  it('has every review and stepper key in both languages', () => {
    expect(Object.keys(es.bulkUpload.review).sort()).toEqual(
      Object.keys(en.bulkUpload.review).sort()
    )
    expect(Object.keys(es.bulkUpload.stepper).sort()).toEqual(
      Object.keys(en.bulkUpload.stepper).sort()
    )
  })

  it('has every item toolbar and form key in both languages', () => {
    expect(Object.keys(es.wardrobe.item.toolbar).sort()).toEqual(
      Object.keys(en.wardrobe.item.toolbar).sort()
    )
    expect(Object.keys(es.wardrobe.item.form).sort()).toEqual(
      Object.keys(en.wardrobe.item.form).sort()
    )
  })

  it('names the crop presets the owner asked for, in Spanish', () => {
    expect(es.imageCrop.presets.square).toBe('Cuadrado')
    expect(es.imageCrop.presets.portrait).toBe('Vertical')
    expect(es.imageCrop.presets.landscape).toBe('Apaisado')
  })

  it('says out loud that straightening saves', () => {
    expect(es.bulkUpload.review.rotated).toMatch(/guardad/i)
    expect(es.imageCrop.willSave).toMatch(/guardar/i)
  })

  it('labels the edit affordance with a word, not a pencil', () => {
    expect(es.wardrobe.item.toolbar.editTags.length).toBeGreaterThan(6)
    expect(en.wardrobe.item.toolbar.editTags.length).toBeGreaterThan(6)
  })
})
