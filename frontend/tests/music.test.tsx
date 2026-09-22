import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { useState } from 'react'

import {
  buildMoodBars,
  daysBetween,
  moodColor,
  moodLegend,
  relativeTime,
  trackLabel,
  type DayMood,
} from '@/lib/music'
import esMessages from '@/messages/es.json'
import enMessages from '@/messages/en.json'

function mood(date: string, key: DayMood['mood_key'], energy = 0.6): DayMood {
  return {
    date,
    moods: [key],
    mood_keys: [key],
    mood_key: key,
    color: moodColor(key),
    energy,
    valence: 0.5,
    top_genres: [],
    track_count: 3,
    minutes: 10,
    dominant_artists: [],
    one_liner: '',
    method: 'heuristic',
  }
}

describe('lib/music helpers', () => {
  it('lists every day of the range inclusively across month ends', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
  })

  it('builds one bar per day with empty slots for silent days', () => {
    const bars = buildMoodBars([mood('2026-09-02', 'calm', 0.02)], '2026-09-01', '2026-09-03')
    expect(bars.map((b) => b.height)).toEqual([0, 0.08, 0])
    expect(bars[1].color).toBe('mint')
    expect(bars[0].color).toBeNull()
  })

  it('maps moods to the pop palette with a safe fallback', () => {
    expect(moodColor('melancholic')).toBe('sky')
    expect(moodColor('euphoric')).toBe('amber')
    expect(moodColor('electric')).toBe('pink')
    expect(moodColor('nope')).toBe('amber')
  })

  it('orders the legend by frequency', () => {
    const legend = moodLegend([
      mood('2026-09-01', 'calm'),
      mood('2026-09-02', 'dreamy'),
      mood('2026-09-03', 'dreamy'),
    ])
    expect(legend).toEqual(['dreamy', 'calm'])
  })

  it('formats relative times in Spanish and English', () => {
    const now = new Date('2026-09-21T12:00:00Z')
    expect(relativeTime('2026-09-21T11:55:00Z', 'es', 'ahora mismo', now)).toBe('hace 5 minutos')
    expect(relativeTime('2026-09-21T11:55:00Z', 'en', 'just now', now)).toBe('5 minutes ago')
    expect(relativeTime('2026-09-21T11:59:40Z', 'es', 'ahora mismo', now)).toBe('ahora mismo')
  })

  it('labels tracks as "Artist — Title"', () => {
    expect(trackLabel({ name: 'Nights', artists: ['Frank Ocean'] })).toBe('Frank Ocean — Nights')
    expect(trackLabel({ name: 'Nights', artists: [] })).toBe('Nights')
  })

  it('has the same music keys in es and en', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
      )
    expect(keys(esMessages.music).sort()).toEqual(keys(enMessages.music).sort())
  })
})

// --- SongAutocomplete ------------------------------------------------------------------

const apiGet = vi.fn()
vi.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn() },
  setAccessToken: vi.fn(),
}))

import { SongAutocomplete, type SongSelection } from '@/components/music/song-autocomplete'

function Harness({ onSelect, connected = true }: { onSelect: (s: SongSelection) => void; connected?: boolean }) {
  const [value, setValue] = useState<SongSelection>({ text: '', trackId: null, track: null })
  return (
    <SongAutocomplete
      value={value}
      musicConnected={connected}
      onChange={(next) => {
        setValue(next)
        onSelect(next)
      }}
    />
  )
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="es" messages={esMessages}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

const NIGHTS = {
  track_id: '7eqoqGkKwgOaWNNHx90uEZ',
  name: 'Nights',
  artists: ['Frank Ocean'],
  album: 'Blonde',
  image_url: null,
  duration_ms: 300000,
  url: null,
  source: 'spotify',
}

describe('SongAutocomplete', () => {
  beforeEach(() => {
    apiGet.mockReset()
  })

  it('suggests tracks and selecting one sets the exact track id', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/music/search') return Promise.resolve({ source: 'spotify', items: [NIGHTS] })
      return Promise.resolve({ connected: true, track: null })
    })
    const onSelect = vi.fn()
    renderWithProviders(<Harness onSelect={onSelect} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'nights' } })
    const option = await screen.findByRole('option', {}, { timeout: 2000 })
    expect(option).toHaveTextContent('Nights')
    expect(screen.getByText('Resultados de Spotify')).toBeInTheDocument()
    fireEvent.click(option)
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'Frank Ocean — Nights', trackId: NIGHTS.track_id })
    )
    // Typing again goes back to free text (no track id).
    fireEvent.change(input, { target: { value: 'otra cosa' } })
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ trackId: null }))
  })

  it('offers "Lo que suena ahora" when something is playing', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/music/now-playing')
        return Promise.resolve({ connected: true, track: { ...NIGHTS, is_playing: true, progress_ms: 1 } })
      return Promise.resolve({ source: null, items: [] })
    })
    const onSelect = vi.fn()
    renderWithProviders(<Harness onSelect={onSelect} />)
    const chip = await screen.findByRole('button', { name: /Lo que suena ahora/ })
    fireEvent.click(chip)
    await waitFor(() =>
      expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ trackId: NIGHTS.track_id }))
    )
  })

  it('does not ask for now playing when Spotify is not connected', () => {
    apiGet.mockResolvedValue({ source: null, items: [] })
    renderWithProviders(<Harness onSelect={vi.fn()} connected={false} />)
    expect(apiGet).not.toHaveBeenCalledWith('/music/now-playing')
  })
})
