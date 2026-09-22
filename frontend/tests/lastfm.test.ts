import { describe, it, expect } from 'vitest'

import { ApiError } from '@/lib/api'
import {
  LASTFM_USERNAME_RE,
  lastfmErrorCode,
  normaliseLastfmUsername,
} from '@/lib/hooks/use-lastfm'
import { sourceSettingsHref } from '@/lib/music'
import esMessages from '@/messages/es.json'
import enMessages from '@/messages/en.json'

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  )

describe('Last.fm helpers', () => {
  it('accepts a bare username, an @handle or a pasted profile URL', () => {
    expect(normaliseLastfmUsername('  rj ')).toBe('rj')
    expect(normaliseLastfmUsername('@stinky_cat')).toBe('stinky_cat')
    expect(normaliseLastfmUsername('https://www.last.fm/user/Stinky-Cat')).toBe('Stinky-Cat')
    expect(normaliseLastfmUsername('https://www.last.fm/es/user/stinky.cat/library')).toBe('stinky.cat')
  })

  it('validates usernames like the backend', () => {
    expect(LASTFM_USERNAME_RE.test('rj')).toBe(true)
    expect(LASTFM_USERNAME_RE.test('a')).toBe(false)
    expect(LASTFM_USERNAME_RE.test('_nope')).toBe(false)
    expect(LASTFM_USERNAME_RE.test('with space')).toBe(false)
  })

  it('reads the error code of a failed connect', () => {
    const err = new ApiError('x', 404, { detail: { code: 'lastfm_user_not_found', message: 'x' } })
    expect(lastfmErrorCode(err)).toBe('lastfm_user_not_found')
    expect(lastfmErrorCode(new ApiError('x', 500, { detail: 'boom' }))).toBeNull()
    expect(lastfmErrorCode(new Error('x'))).toBeNull()
  })

  it('links "Gestionar" to the primary source', () => {
    expect(sourceSettingsHref('lastfm')).toBe('/dashboard/settings/integrations/lastfm')
    expect(sourceSettingsHref('spotify')).toBe('/dashboard/settings/integrations/spotify')
    expect(sourceSettingsHref(null)).toBe('/dashboard/settings/integrations')
  })

  it('has the same integrations keys in es and en', () => {
    expect(keys(esMessages.integrations).sort()).toEqual(keys(enMessages.integrations).sort())
  })

  it('describes the music, never the listener, in the Spanish mood lines', () => {
    const lines = keys(esMessages.music.oneLiner).map((k) =>
      k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], esMessages.music.oneLiner)
    ) as string[]
    for (const line of lines) {
      expect(line).not.toMatch(/\b(estás|te sientes|triste|ánimo|regazo)\b/i)
    }
  })
})
