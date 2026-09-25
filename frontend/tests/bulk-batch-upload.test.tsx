import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import React from 'react'

import {
  MAX_BATCH_PHOTOS,
  MAX_PHOTO_MB,
  countQueue,
  hasItem,
  isTerminal,
  screenFiles,
  type QueuedPhoto,
} from '@/lib/bulk-upload/queue'
import { OTHER_COLORS, OTHER_TYPES, QUICK_COLORS, QUICK_TYPES, needsType } from '@/components/bulk-upload/tag-choices'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

vi.mock('@/components/native/lazy-stinky', () => ({
  LazyStinky: () => <span data-testid="lazy-stinky" />,
}))

import { UploadQueueList } from '@/components/bulk-upload/upload-queue-list'

function fileOf(name: string, bytes: number, type = 'image/jpeg'): File {
  const file = new File([new Uint8Array(1)], name, { type })
  // A real multi-megabyte buffer per test file would be wasteful.
  Object.defineProperty(file, 'size', { value: bytes })
  return file
}

const row = (over: Partial<QueuedPhoto>): QueuedPhoto => ({
  id: over.id ?? 'p1',
  name: over.name ?? 'foto.jpg',
  state: over.state ?? 'pending',
  progress: over.progress ?? 0,
  ...over,
})

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('screenFiles', () => {
  it('keeps the garments and says what it dropped', () => {
    const { accepted, rejected } = screenFiles(
      [
        fileOf('camisa.jpg', 1_000),
        fileOf('panorama.jpg', (MAX_PHOTO_MB + 1) * 1024 * 1024),
        fileOf('notas.txt', 100, 'text/plain'),
        fileOf('falda.heic', 2_000, ''),
      ],
      0
    )
    expect(accepted.map((f) => f.name)).toEqual(['camisa.jpg', 'falda.heic'])
    expect(rejected).toEqual(['too-big', 'wrong-type'])
  })

  it('caps the batch and counts what is already queued', () => {
    const many = Array.from({ length: MAX_BATCH_PHOTOS + 5 }, (_, i) => fileOf(`p${i}.jpg`, 1_000))
    expect(screenFiles(many, 0).accepted).toHaveLength(MAX_BATCH_PHOTOS)
    expect(screenFiles(many, 0).rejected).toContain('too-many')

    const nearlyFull = screenFiles(many, MAX_BATCH_PHOTOS - 2)
    expect(nearlyFull.accepted).toHaveLength(2)
    expect(nearlyFull.rejected).toContain('too-many')
  })

  it('accepts a HEIC the browser gives no mime type for', () => {
    expect(screenFiles([fileOf('IMG_0042.HEIC', 500, '')], 0).accepted).toHaveLength(1)
  })
})

describe('countQueue', () => {
  it('counts a garment being tagged as already saved', () => {
    // The item exists in the wardrobe the moment the upload returns; tagging is
    // the worker's problem, and the review screen can already show it.
    const counts = countQueue([
      row({ id: 'a', state: 'done' }),
      row({ id: 'b', state: 'tagging', itemId: 'i2' }),
      row({ id: 'c', state: 'duplicate', itemId: 'i3' }),
      row({ id: 'd', state: 'error', error: 'boom' }),
      row({ id: 'e', state: 'uploading' }),
    ])
    expect(counts).toMatchObject({ total: 5, saved: 2, duplicate: 1, failed: 1, settled: false })
    expect(counts.busy).toBe(2)
  })

  it('is settled only when nothing is in flight', () => {
    expect(countQueue([row({ state: 'done' }), row({ id: 'b', state: 'error' })]).settled).toBe(true)
    expect(countQueue([row({ state: 'tagging' })]).settled).toBe(false)
  })

  it('treats duplicates and errors as finished, and counts a duplicate as owned', () => {
    expect(isTerminal('duplicate')).toBe(true)
    expect(isTerminal('removing-bg')).toBe(false)
    expect(hasItem(row({ state: 'duplicate', itemId: 'i1' }))).toBe(true)
    expect(hasItem(row({ state: 'error', itemId: 'i1' }))).toBe(false)
    expect(hasItem(row({ state: 'done' }))).toBe(false)
  })
})

describe('needsType', () => {
  it('treats the tagger placeholder as no type at all', () => {
    expect(needsType('unknown')).toBe(true)
    expect(needsType('')).toBe(true)
    expect(needsType(null)).toBe(true)
    expect(needsType('jeans')).toBe(false)
  })
})

describe('quick tag shortlists', () => {
  it('never offers the same value twice', () => {
    expect(OTHER_TYPES.filter((t) => (QUICK_TYPES as readonly string[]).includes(t))).toEqual([])
    expect(OTHER_COLORS.filter((c) => (QUICK_COLORS as readonly string[]).includes(c))).toEqual([])
  })

  it('offers every shortlisted value as a real tag value', () => {
    // The shortlist is a subset of the tag vocabulary, or the stepper would write
    // types the scorer has never heard of.
    for (const type of QUICK_TYPES) {
      expect(es.clothingTypes).toHaveProperty(type)
    }
    for (const color of QUICK_COLORS) {
      expect(es.tagValues.colors).toHaveProperty(color)
    }
  })
})

describe('UploadQueueList', () => {
  it('names every state a photo can be in, and only offers retry on failure', () => {
    renderWithIntl(
      <UploadQueueList
        photos={[
          row({ id: 'a', name: 'uno.jpg', state: 'uploading', progress: 40 }),
          row({ id: 'b', name: 'dos.jpg', state: 'removing-bg' }),
          row({ id: 'c', name: 'tres.jpg', state: 'tagging' }),
          row({ id: 'd', name: 'cuatro.jpg', state: 'error' }),
        ]}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    )
    expect(screen.getByText('Subiendo')).toBeInTheDocument()
    expect(screen.getByText('Quitando fondo')).toBeInTheDocument()
    expect(screen.getByText('Etiquetando')).toBeInTheDocument()
    expect(screen.getByText('No se pudo subir')).toBeInTheDocument()

    expect(screen.getAllByRole('button', { name: /Reintentar cuatro\.jpg/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Reintentar uno\.jpg/ })).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
  })

  it('does not offer to cancel a photo that is already a garment', () => {
    renderWithIntl(
      <UploadQueueList
        photos={[row({ id: 'a', name: 'uno.jpg', state: 'done', itemId: 'i1' })]}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
  })
})

describe('bulk upload copy', () => {
  it('has the same keys in both locales', () => {
    const flat = (o: unknown, p = ''): string[] =>
      typeof o === 'object' && o
        ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k))
        : [p]
    expect(flat(en.bulkUpload).sort()).toEqual(flat(es.bulkUpload).sort())
  })

  it('names a state for every state the queue can report', () => {
    const states = ['pending', 'uploading', 'removing-bg', 'tagging', 'done', 'duplicate', 'error']
    for (const state of states) {
      expect(es.bulkUpload.queue.states).toHaveProperty(state)
      expect(en.bulkUpload.queue.states).toHaveProperty(state)
    }
  })

  it('keeps the batch cap in the copy honest', () => {
    expect(es.bulkUpload.picker.hint).toContain('{max}')
    expect(MAX_BATCH_PHOTOS).toBe(30)
  })
})
