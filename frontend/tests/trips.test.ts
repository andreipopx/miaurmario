import { describe, it, expect } from 'vitest'

import { dayItems, formatTripDates, formatTripDay, timesWorn, tripTemperatures } from '@/lib/trips'
import type { Item } from '@/lib/types'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

describe('«Modo viaje» helpers', () => {
  it('writes the dates the short way', () => {
    expect(formatTripDates('2026-10-12', '2026-10-15', 'es')).toBe('12 – 15 oct')
    expect(formatTripDates('2026-10-28', '2026-11-02', 'es')).toBe('28 oct – 2 nov')
    expect(formatTripDates('2026-10-12', '2026-10-12', 'es')).toBe('12 oct')
    // a calendar day, never shifted by the timezone
    expect(formatTripDay('2026-10-17', 'es')).toBe('sábado 17')
  })

  it('gets the day’s min and max back from the forecast', () => {
    expect(
      tripTemperatures({ temperature: 15, feels_like: 19, precipitation_chance: 0, condition: 'sunny', condition_code: 0 })
    ).toEqual({ min: 11, max: 19 })
  })

  it('lists a day’s garments in plan order and counts reuse for the suitcase', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Item[]
    const days = [
      { date: '2026-10-12', weather: null, item_ids: ['b', 'a', 'gone'], note: null },
      { date: '2026-10-13', weather: null, item_ids: ['c', 'a'], note: null },
    ]
    expect(dayItems(days[0], { items }).map((i) => i.id)).toEqual(['b', 'a'])
    expect(timesWorn({ days }).get('a')).toBe(2)
  })

  it('has its copy in both languages', () => {
    for (const m of [es, en]) {
      expect(m.trips.title).toBeTruthy()
      expect(m.trips.detail.suitcase).toBeTruthy()
      expect(m.nav.trips).toBeTruthy()
    }
  })
})
