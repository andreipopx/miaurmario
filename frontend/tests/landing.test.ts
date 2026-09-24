import { describe, it, expect, vi, afterEach } from 'vitest'

import { fetchSignupMode, isInviteOnly, parseSignupMode, signupHref } from '@/lib/signup-mode'
import esMessages from '@/messages/es.json'
import enMessages from '@/messages/en.json'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('signup mode', () => {
  it('only treats an explicit "open" as open sign-up', () => {
    expect(parseSignupMode({ signup_mode: 'open' })).toBe('open')
    expect(parseSignupMode({ signup_mode: 'invite_only' })).toBe('invite_only')
    expect(parseSignupMode({})).toBe('invite_only')
    expect(parseSignupMode(null)).toBe('invite_only')
    expect(parseSignupMode('nonsense')).toBe('invite_only')
  })

  it('sends "Crear cuenta" to the waitlist while the beta is closed', () => {
    expect(signupHref('invite_only')).toBe('/login?waitlist=1')
    expect(isInviteOnly('invite_only')).toBe(true)
  })

  it('sends "Crear cuenta" straight to the login page once sign-up is open', () => {
    expect(signupHref('open')).toBe('/login')
    expect(isInviteOnly('open')).toBe(false)
  })
})

describe('fetchSignupMode', () => {
  it('reads signup_mode from the public auth config', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ signup_mode: 'open' }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchSignupMode()).resolves.toBe('open')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/auth/config')
  })

  it('falls back to the closed beta when the backend errors or is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    await expect(fetchSignupMode()).resolves.toBe('invite_only')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(fetchSignupMode()).resolves.toBe('invite_only')
  })
})

describe('landing copy', () => {
  const es = esMessages.landing
  const en = enMessages.landing

  const flatten = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
      : [prefix]

  it('has the same keys in Spanish and English', () => {
    expect(flatten(es).sort()).toEqual(flatten(en).sort())
  })

  it('says what the app is, that it is a beta and that we will get in touch', () => {
    expect(es.hero.pitch).toMatch(/armario/i)
    expect(es.hero.signUp).toBe('Crear cuenta')
    expect(es.hero.signIn).toBe('Iniciar sesión')
    expect(es.hero.betaInviteOnly).toMatch(/beta/i)
    expect(es.hero.betaInviteOnly).toMatch(/avisamos/i)
  })

  it('answers the "is it an app?" confusion without sending anyone to a store', () => {
    const install = `${es.install.lead} ${es.install.lead2}`
    expect(install).toMatch(/no hay nada que descargar/i)
    expect(install).toMatch(/App Store/i)
    expect(install).toMatch(/pantalla de inicio/i)
    expect(es.install.iosStep2).toMatch(/Compartir/)
    expect(es.install.androidStep2).toMatch(/Instalar/)
  })
})
