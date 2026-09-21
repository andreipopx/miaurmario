import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { enUS, es } from 'date-fns/locale'
import React from 'react'

import {
  capitalizeFirst,
  formatDateLocalized,
  getDateFnsLocale,
  useDateFnsLocale,
  useFormatDate,
} from '@/lib/date-locale'

// Monday, 21 September 2026 (local time)
const DATE = new Date(2026, 8, 21)

function wrapperFor(locale: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={{}}>
        {children}
      </NextIntlClientProvider>
    )
  }
}

describe('getDateFnsLocale', () => {
  it('maps es and en (including region variants)', () => {
    expect(getDateFnsLocale('es')).toBe(es)
    expect(getDateFnsLocale('es-ES')).toBe(es)
    expect(getDateFnsLocale('en')).toBe(enUS)
    expect(getDateFnsLocale('en_GB')).toBe(enUS)
  })

  it('falls back to enUS for unknown or missing locales', () => {
    expect(getDateFnsLocale('fr')).toBe(enUS)
    expect(getDateFnsLocale(undefined)).toBe(enUS)
    expect(getDateFnsLocale(null)).toBe(enUS)
    expect(getDateFnsLocale('')).toBe(enUS)
  })
})

describe('formatDateLocalized', () => {
  it('keeps the original English formats', () => {
    expect(formatDateLocalized(DATE, 'long', 'en')).toBe('September 21, 2026')
    expect(formatDateLocalized(DATE, 'weekdayLong', 'en')).toBe('Monday, September 21')
    expect(formatDateLocalized(DATE, 'medium', 'en')).toBe('Sep 21, 2026')
    expect(formatDateLocalized(DATE, 'short', 'en')).toBe('Sep 21')
    expect(formatDateLocalized(DATE, 'monthYear', 'en')).toBe('September 2026')
  })

  it('uses Spanish names and Spanish word order', () => {
    expect(formatDateLocalized(DATE, 'long', 'es')).toBe('21 de septiembre de 2026')
    expect(formatDateLocalized(DATE, 'weekdayLong', 'es')).toBe('lunes, 21 de septiembre')
    expect(formatDateLocalized(DATE, 'medium', 'es')).toBe('21 sep 2026')
    expect(formatDateLocalized(DATE, 'short', 'es')).toBe('21 sep')
    expect(formatDateLocalized(DATE, 'monthYear', 'es')).toBe('septiembre de 2026')
  })
})

describe('capitalizeFirst', () => {
  it('upper-cases only the first character', () => {
    expect(capitalizeFirst('lunes, 21 de septiembre')).toBe('Lunes, 21 de septiembre')
    expect(capitalizeFirst('')).toBe('')
  })
})

describe('hooks', () => {
  it('useDateFnsLocale follows the next-intl locale', () => {
    expect(renderHook(() => useDateFnsLocale(), { wrapper: wrapperFor('es') }).result.current).toBe(es)
    expect(renderHook(() => useDateFnsLocale(), { wrapper: wrapperFor('en') }).result.current).toBe(enUS)
  })

  it('useFormatDate formats with the active locale', () => {
    const { result } = renderHook(() => useFormatDate(), { wrapper: wrapperFor('es') })
    expect(result.current(DATE, 'long')).toBe('21 de septiembre de 2026')
  })
})
