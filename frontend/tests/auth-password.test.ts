// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { JWT } from 'next-auth/jwt'
import {
  authOptions,
  PasswordProvider,
  PASSWORD_ERROR_RATE_LIMITED,
  PASSWORD_ERROR_UNAVAILABLE,
} from '@/lib/auth'
import {
  REFRESH_AFTER_MS,
  REFRESH_RETRY_BACKOFF_MS,
  SESSION_MAX_AGE_SECONDS,
  decodeJwtTimes,
  refreshBackendTokenIfDue,
  shouldRefreshBackendToken,
} from '@/lib/session-refresh'

type Authorize = (
  credentials: Record<string, string> | undefined,
  req: { headers?: Record<string, string> },
) => Promise<Record<string, unknown> | null>

const authorize = (PasswordProvider as unknown as { options: { authorize: Authorize } }).options
  .authorize

const DAY = 24 * 60 * 60 * 1000

/** Unsigned JWT with the given iat/exp (seconds); only the payload is read client-side. */
function fakeJwt(iatMs: number, expMs: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'x', iat: Math.floor(iatMs / 1000), exp: Math.floor(expMs / 1000) })}.sig`
}

const LOGIN_RESPONSE = {
  id: 'uuid-1',
  external_id: 'magic:a@b.c',
  email: 'a@b.c',
  display_name: 'a',
  username: 'ana',
  avatar_url: null,
  is_new_user: false,
  onboarding_completed: true,
  needs_username: false,
  access_token: 'api-jwt',
}

describe('password credentials provider', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.BACKEND_URL = 'http://backend-test:8000/'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('posts identifier + password to the backend and forwards the client IP', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify(LOGIN_RESPONSE), { status: 200 }))
    global.fetch = spy as unknown as typeof fetch

    const user = await authorize(
      { identifier: '  Ana ', password: 'gatito-con-criterio' },
      { headers: { 'x-forwarded-for': '203.0.113.9, 172.18.0.2' } },
    )

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://backend-test:8000/api/v1/auth/password/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      identifier: 'Ana',
      password: 'gatito-con-criterio',
    })
    expect((init.headers as Record<string, string>)['X-Forwarded-For']).toBe(
      '203.0.113.9, 172.18.0.2',
    )
    expect(user).toMatchObject({
      id: 'magic:a@b.c',
      backendAccessToken: 'api-jwt',
      backendUserId: 'uuid-1',
      needsUsername: false,
      onboardingCompleted: true,
    })
  })

  it('returns null (generic CredentialsSignin) on 401', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{"detail":"Invalid credentials"}', { status: 401 })) as unknown as typeof fetch
    expect(await authorize({ identifier: 'a@b.c', password: 'nope-nope-nope' }, {})).toBeNull()
  })

  it('surfaces rate limiting and outages as distinct errors', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 429 })) as unknown as typeof fetch
    await expect(authorize({ identifier: 'a', password: 'b' }, {})).rejects.toThrow(
      PASSWORD_ERROR_RATE_LIMITED,
    )

    global.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 })) as unknown as typeof fetch
    await expect(authorize({ identifier: 'a', password: 'b' }, {})).rejects.toThrow(
      PASSWORD_ERROR_UNAVAILABLE,
    )

    vi.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
    await expect(authorize({ identifier: 'a', password: 'b' }, {})).rejects.toThrow(
      PASSWORD_ERROR_UNAVAILABLE,
    )
  })

  it('rejects empty or oversized input without calling the backend', async () => {
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch
    expect(await authorize(undefined, {})).toBeNull()
    expect(await authorize({ identifier: '  ', password: 'x' }, {})).toBeNull()
    expect(await authorize({ identifier: 'a', password: '' }, {})).toBeNull()
    expect(await authorize({ identifier: 'a', password: 'x'.repeat(129) }, {})).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('is registered and the session slides for 90 days', () => {
    const ids = authOptions.providers.map(
      (p) => (p as unknown as { options?: { id?: string } }).options?.id ?? p.id,
    )
    expect(ids).toContain('password')
    expect(authOptions.session?.maxAge).toBe(SESSION_MAX_AGE_SECONDS)
    expect(SESSION_MAX_AGE_SECONDS).toBe(90 * 24 * 60 * 60)
    expect(authOptions.session?.updateAge).toBe(24 * 60 * 60)
  })
})

describe('jwt callback', () => {
  afterEach(() => vi.restoreAllMocks())
  const jwt = authOptions.callbacks!.jwt!

  it('stores the password-login token with its issue/expiry times', async () => {
    const now = Date.now()
    const apiToken = fakeJwt(now, now + 30 * DAY)
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch

    const token = await jwt({
      token: { sub: 'magic:a@b.c' },
      user: { id: 'magic:a@b.c', backendAccessToken: apiToken, needsUsername: false },
      account: { provider: 'password', type: 'credentials', providerAccountId: 'magic:a@b.c' },
    } as unknown as Parameters<typeof jwt>[0])

    expect(spy).not.toHaveBeenCalled()
    expect(token.accessToken).toBe(apiToken)
    expect(Math.abs((token.accessTokenIssuedAt as number) - now)).toBeLessThan(1000)
    expect(Math.abs((token.accessTokenExpiresAt as number) - (now + 30 * DAY))).toBeLessThan(1000)
  })

  it('refreshes an old backend token on a plain session read', async () => {
    const now = Date.now()
    const old = fakeJwt(now - 2 * DAY, now + 28 * DAY)
    const fresh = fakeJwt(now, now + 30 * DAY)
    const spy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ access_token: fresh }), { status: 200 }))
    global.fetch = spy as unknown as typeof fetch

    const token = await jwt({
      token: { sub: 'magic:a@b.c', accessToken: old },
    } as unknown as Parameters<typeof jwt>[0])

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/auth\/refresh$/)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${old}`)
    expect(token.accessToken).toBe(fresh)
  })

  it('does not call the backend for a recent token', async () => {
    const now = Date.now()
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch
    const recent = fakeJwt(now - 60_000, now + 30 * DAY)
    const token = await jwt({
      token: { sub: 's', accessToken: recent },
    } as unknown as Parameters<typeof jwt>[0])
    expect(spy).not.toHaveBeenCalled()
    expect(token.accessToken).toBe(recent)
  })
})

describe('refreshBackendTokenIfDue', () => {
  afterEach(() => vi.restoreAllMocks())
  const now = Date.UTC(2026, 8, 21)

  it('decodes iat/exp from the API token', () => {
    expect(decodeJwtTimes(fakeJwt(now, now + DAY))).toEqual({ issuedAt: now, expiresAt: now + DAY })
    expect(decodeJwtTimes('not-a-jwt')).toEqual({})
    expect(decodeJwtTimes(undefined)).toEqual({})
  })

  it('only refreshes when due, not expired and not backing off', () => {
    const base: JWT = { accessToken: 'x', accessTokenExpiresAt: now + 10 * DAY }
    expect(shouldRefreshBackendToken({ ...base, accessTokenIssuedAt: now - REFRESH_AFTER_MS + 1 }, now)).toBe(false)
    expect(shouldRefreshBackendToken({ ...base, accessTokenIssuedAt: now - REFRESH_AFTER_MS }, now)).toBe(true)
    expect(
      shouldRefreshBackendToken(
        { ...base, accessTokenIssuedAt: now - 2 * DAY, accessTokenExpiresAt: now - 1 },
        now,
      ),
    ).toBe(false)
    expect(
      shouldRefreshBackendToken(
        { ...base, accessTokenIssuedAt: now - 2 * DAY, refreshFailedAt: now - 1000 },
        now,
      ),
    ).toBe(false)
    expect(
      shouldRefreshBackendToken(
        { ...base, accessTokenIssuedAt: now - 2 * DAY, refreshFailedAt: now - REFRESH_RETRY_BACKOFF_MS },
        now,
      ),
    ).toBe(true)
    expect(shouldRefreshBackendToken({}, now)).toBe(false)
  })

  it('drops the token on 401 so useAuth signs the user out', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 401 })) as unknown as typeof fetch
    const token = await refreshBackendTokenIfDue(
      { sub: 's', accessToken: fakeJwt(now - 2 * DAY, now + DAY) },
      'http://api',
      now,
    )
    expect(token.accessToken).toBeUndefined()
    expect(token.sub).toBe('s')
  })

  it('keeps the token and backs off on transient failures', async () => {
    const current = fakeJwt(now - 2 * DAY, now + DAY)
    global.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 })) as unknown as typeof fetch
    const token = await refreshBackendTokenIfDue({ accessToken: current }, 'http://api', now)
    expect(token.accessToken).toBe(current)
    expect(token.refreshFailedAt).toBe(now)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = vi.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch
    const again = await refreshBackendTokenIfDue({ accessToken: current }, 'http://api', now)
    expect(again.accessToken).toBe(current)
    expect(again.refreshFailedAt).toBe(now)
  })
})
