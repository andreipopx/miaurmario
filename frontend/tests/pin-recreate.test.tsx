import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import { SelfieGarmentCard } from '@/components/selfie/selfie-garment-card'
import type { SelfieGarment } from '@/lib/selfie'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="es" messages={es}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

const boots: SelfieGarment = {
  index: 1,
  type: 'boots',
  subtype: null,
  primary_color: 'brown',
  colors: ['brown'],
  pattern: 'solid',
  material: 'leather',
  match: null,
  alternatives: [],
}

describe('«Recrea este look con mi ropa»', () => {
  it('a garment you lack, from a pin, is something you miss — not a photo to add', () => {
    renderWithIntl(
      <ul>
        <SelfieGarmentCard
          garment={boots}
          picked={null}
          options={[]}
          onPick={vi.fn()}
          onBrowse={vi.fn()}
          onAdd={vi.fn()}
          allowAdd={false}
        />
      </ul>
    )
    expect(screen.getByText(es.selfie.notInWardrobe)).toBeTruthy()
    expect(screen.queryByText(es.selfie.addToWardrobe)).toBeNull()
    expect(screen.queryByText(es.selfie.addPhotoLater)).toBeNull()
  })

  it('«Qué llevo» still offers to add it', () => {
    renderWithIntl(
      <ul>
        <SelfieGarmentCard
          garment={boots}
          picked={null}
          options={[]}
          onPick={vi.fn()}
          onBrowse={vi.fn()}
          onAdd={vi.fn()}
        />
      </ul>
    )
    expect(screen.getByText(es.selfie.addToWardrobe)).toBeTruthy()
  })

  it('has its own copy in both languages, keyed like the selfie it borrows from', () => {
    for (const messages of [es, en]) {
      for (const key of Object.keys(messages.selfie.pin)) {
        expect(Object.keys(messages.selfie)).toContain(key)
      }
      expect(messages.pins.recreate).toBeTruthy()
    }
  })
})
