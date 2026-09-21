import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FALLBACK_TIMEZONES,
  canonicalTimezone,
  getBrowserTimezone,
  buildTimezoneOptions,
  filterTimezoneOptions,
  formatOffset,
  formatTimezoneLabel,
  formatTimezoneName,
  getAllTimezones,
  getOffsetMinutes,
} from '@/lib/timezones'

const SUMMER = new Date('2026-07-01T12:00:00Z')
const WINTER = new Date('2026-01-15T12:00:00Z')

describe('timezone list', () => {
  afterEach(() => vi.restoreAllMocks())

  it('includes every IANA zone, Madrid and UTC, with current names only', () => {
    const zones = getAllTimezones()
    expect(zones).toContain('Asia/Kolkata')
    expect(zones).not.toContain('Asia/Calcutta')
    expect(zones).toContain('Europe/Kyiv')
    expect(new Set(zones).size).toBe(zones.length)
    expect(zones.length).toBeGreaterThan(300)
    expect(zones).toContain('Europe/Madrid')
    expect(zones).toContain('Atlantic/Canary')
    expect(zones).toContain('UTC')
  })

  it('falls back to a curated list without Intl.supportedValuesOf', () => {
    const intl = Intl as unknown as { supportedValuesOf?: unknown }
    const original = intl.supportedValuesOf
    intl.supportedValuesOf = undefined
    try {
      const zones = getAllTimezones()
      expect(zones).toEqual([...FALLBACK_TIMEZONES])
      expect(zones).toContain('Europe/Madrid')
    } finally {
      intl.supportedValuesOf = original
    }
  })
})

describe('canonical names', () => {
  it('maps legacy ICU ids to current IANA ids', () => {
    expect(canonicalTimezone('Asia/Calcutta')).toBe('Asia/Kolkata')
    expect(canonicalTimezone('America/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires')
    expect(canonicalTimezone('Europe/Madrid')).toBe('Europe/Madrid')
  })

  it('canonicalises the browser zone', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Asia/Calcutta',
    } as Intl.ResolvedDateTimeFormatOptions)
    expect(getBrowserTimezone()).toBe('Asia/Kolkata')
    spy.mockRestore()
  })
})

describe('labels', () => {
  it('computes DST-aware offsets', () => {
    expect(getOffsetMinutes('Europe/Madrid', SUMMER)).toBe(120)
    expect(getOffsetMinutes('Europe/Madrid', WINTER)).toBe(60)
    expect(getOffsetMinutes('Asia/Kathmandu', WINTER)).toBe(345)
    expect(getOffsetMinutes('America/New_York', WINTER)).toBe(-300)
    expect(getOffsetMinutes('UTC', WINTER)).toBe(0)
  })

  it('formats offsets', () => {
    expect(formatOffset(120)).toBe('UTC+2')
    expect(formatOffset(-300)).toBe('UTC-5')
    expect(formatOffset(345)).toBe('UTC+5:45')
    expect(formatOffset(0)).toBe('UTC')
  })

  it('uses Spanish region and city names', () => {
    expect(formatTimezoneLabel('Europe/Madrid', 'es', SUMMER)).toBe('Europa/Madrid (UTC+2)')
    expect(formatTimezoneLabel('Atlantic/Canary', 'es', SUMMER)).toBe('Atlántico/Canarias (UTC+1)')
    expect(formatTimezoneName('America/New_York', 'es')).toBe('América/Nueva York')
    expect(formatTimezoneName('America/Argentina/Buenos_Aires', 'es')).toBe('América/Argentina/Buenos Aires')
    expect(formatTimezoneName('Asia/Tokyo', 'en')).toBe('Asia/Tokyo')
    expect(formatTimezoneLabel('UTC', 'es')).toBe('UTC')
  })
})

describe('search', () => {
  const options = buildTimezoneOptions('es', SUMMER)

  it('finds zones by Spanish name, IANA id, accents and offset', () => {
    expect(filterTimezoneOptions(options, 'madrid').map((o) => o.value)).toContain('Europe/Madrid')
    expect(filterTimezoneOptions(options, 'canarias').map((o) => o.value)).toEqual(['Atlantic/Canary'])
    expect(filterTimezoneOptions(options, 'canary').map((o) => o.value)).toEqual(['Atlantic/Canary'])
    expect(filterTimezoneOptions(options, 'nueva york').map((o) => o.value)).toContain('America/New_York')
    expect(filterTimezoneOptions(options, 'Atlantico').map((o) => o.value)).toContain('Atlantic/Canary')
    expect(filterTimezoneOptions(options, 'utc+5:45').map((o) => o.value)).toContain('Asia/Kathmandu')
  })

  it('caps the number of results', () => {
    expect(filterTimezoneOptions(options, '', 20)).toHaveLength(20)
    expect(filterTimezoneOptions(options, 'zzzz-nope')).toEqual([])
  })
})
