import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ApiError,
  NetworkError,
  getApiErrorCode,
  getErrorMessage,
  resolveErrorMessage,
  setApiErrorCatalogue,
} from '@/lib/api'
import { OCCASIONS } from '@/lib/types'
import { MOMENT_OCCASIONS } from '@/lib/day-moments'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

/** Every occasion the API accepts (backend app/utils/occasions.py VALID_OCCASIONS). */
const API_OCCASIONS = [
  'casual', 'office', 'work', 'formal', 'smart-casual', 'business-casual', 'date',
  'party', 'sporty', 'sport', 'outdoor', 'travel', 'lounge', 'beach', 'interview',
  'wedding', 'dinner', 'brunch', 'gym', 'running', 'hiking', 'weekend',
] as const

/** What the Spanish UI must never show, whatever the backend sends. */
const READS_ENGLISH =
  /\b(not enough|please (add|try|set|check)|could not|unable to|failed to|wardrobe for|adjust filters|an error occurred)\b/i

function apiError(detail: unknown, status = 400) {
  // Shaped exactly like fetchApi builds it: prose in `message`, machine code in `data`.
  const message =
    typeof detail === 'string'
      ? detail
      : ((detail as { message?: string })?.message ?? 'Request failed')
  return new ApiError(message, status, { detail })
}

describe('API error codes', () => {
  it('reads detail.code', () => {
    expect(getApiErrorCode(apiError({ code: 'insufficient_wardrobe', message: 'x' }))).toBe(
      'insufficient_wardrobe'
    )
  })

  it('also reads detail.error_code (days/studio endpoints)', () => {
    expect(getApiErrorCode(apiError({ error_code: 'MOMENT_WORN', message: 'x' }))).toBe('MOMENT_WORN')
  })

  it('has no code for bare-string details', () => {
    expect(getApiErrorCode(apiError('Not enough items in wardrobe'))).toBeNull()
    expect(getApiErrorCode(new Error('boom'))).toBeNull()
  })

  it('maps network failures to a code', () => {
    expect(getApiErrorCode(new NetworkError('offline'))).toBe('network_offline')
    expect(getApiErrorCode(new NetworkError())).toBe('network_unreachable')
  })
})

describe('error copy shown to the user', () => {
  beforeEach(() => {
    // What <ApiErrorMessages> registers at runtime, with the real Spanish catalogue.
    setApiErrorCatalogue({
      translate: (code) => (es.errors.api as Record<string, string>)[code] ?? null,
      generic: es.errors.generic,
    })
  })

  afterEach(() => setApiErrorCatalogue(null))

  it('translates the code the suggest endpoint returns', () => {
    const err = apiError({
      code: 'insufficient_wardrobe',
      message: 'Not enough items in the wardrobe to build an outfit.',
    })
    expect(getErrorMessage(err, 'fallback')).toBe(es.errors.api.insufficient_wardrobe)
  })

  it('never renders the backend prose, even for a 4xx with no code', () => {
    const err = apiError('Not enough items in wardrobe for recommendation. Please add more items.')
    const shown = getErrorMessage(err, es.suggest.generateError)
    expect(shown).toBe(es.suggest.generateError)
    expect(shown).not.toMatch(READS_ENGLISH)
  })

  it('falls back to the caller copy for an unknown code', () => {
    const err = apiError({ code: 'brand_new_backend_code', message: 'Something in English.' })
    expect(getErrorMessage(err, es.suggest.generateError)).toBe(es.suggest.generateError)
  })

  it('translates network errors', () => {
    expect(getErrorMessage(new NetworkError('offline'), 'fallback')).toBe(
      es.errors.api.network_offline
    )
  })

  it('resolves nothing when the catalogue is not registered', () => {
    setApiErrorCatalogue(null)
    expect(resolveErrorMessage(apiError({ code: 'insufficient_wardrobe' }))).toBeNull()
    expect(getErrorMessage(apiError({ code: 'insufficient_wardrobe' }), 'fallback')).toBe('fallback')
  })
})

describe('error message catalogue', () => {
  it('keeps es and en in parity', () => {
    expect(Object.keys(es.errors.api).sort()).toEqual(Object.keys(en.errors.api).sort())
  })

  it('is Spanish on the Spanish side', () => {
    for (const [code, text] of Object.entries(es.errors.api as Record<string, string>)) {
      expect(text, code).not.toMatch(READS_ENGLISH)
    }
  })

  it('covers the codes the suggestion and pairing paths send', () => {
    for (const code of [
      'insufficient_wardrobe',
      'insufficient_items_for_pairing',
      'pairing_source_not_found',
      'location_not_set',
      'location_unresolved',
      'weather_unavailable',
      'ai_recommendation_failed',
      'ai_pairing_failed',
      'ai_internal_disabled',
      'invalid_request',
      'network_offline',
      'network_unreachable',
      'network_cancelled',
    ]) {
      expect(es.errors.api, code).toHaveProperty(code)
      expect(en.errors.api, code).toHaveProperty(code)
    }
  })
})

describe('occasion labels', () => {
  it('translates every occasion the API accepts', () => {
    for (const slug of API_OCCASIONS) {
      expect(es.suggest.occasions, slug).toHaveProperty(slug)
      expect(en.suggest.occasions, slug).toHaveProperty(slug)
      expect(es.tagValues.occasions, slug).toHaveProperty(slug)
      expect(en.tagValues.occasions, slug).toHaveProperty(slug)
    }
  })

  it('translates the occasions the pickers offer', () => {
    for (const { value } of OCCASIONS) expect(es.suggest.occasions).toHaveProperty(value)
    for (const value of MOMENT_OCCASIONS) expect(es.suggest.occasions).toHaveProperty(value)
  })

  it('carries no English label of its own', () => {
    // The picker used to ship `{ label: 'Office' }`; labels now live in the catalogue.
    for (const occasion of OCCASIONS) expect(occasion).not.toHaveProperty('label')
    expect(es.suggest.occasions.wedding).toBe('Boda')
    expect(es.suggest.occasions.brunch).toBe('Brunch')
    expect(es.suggest.occasions.interview).toBe('Entrevista')
  })
})
