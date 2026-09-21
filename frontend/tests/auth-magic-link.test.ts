// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { authOptions, MagicLinkProvider } from '@/lib/auth'
import { magicLinkLanding, safeCallbackPath } from '@/lib/magic-link'
import { getRequestOrigin } from '@/lib/request-origin'

type Authorize = (
  credentials: Record<string, string> | undefined,
  req: { headers?: Record<string, string> },
) => Promise<Record<string, unknown> | null>

// CredentialsProvider (next-auth v4) keeps the user-supplied config in `.options`.
const authorize = (MagicLinkProvider as unknown as { options: { authorize: Authorize } }).options
  .authorize

const VALID_TOKEN = 'x'.repeat(43)

describe('magic-link credentials provider', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.BACKEND_URL = 'http://backend-test:8000/'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('exchanges the token with the backend verify endpoint', async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'uuid-1',
          external_id: 'magic:a@b.c',
          email: 'a@b.c',
          display_name: 'a',
          username: null,
          avatar_url: null,
          is_new_user: true,
          onboarding_completed: false,
          needs_username: true,
          access_token: 'api-jwt',
        }),
        { status: 200 },
      ),
    )
    global.fetch = spy as unknown as typeof fetch

    const user = await authorize(
      { token: VALID_TOKEN },
      { headers: { 'x-forwarded-for': '203.0.113.9' } },
    )

    expect(spy).toHaveBeenCalledOnce()
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://backend-test:8000/api/v1/auth/magic-link/verify')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ token: VALID_TOKEN })
    expect((init.headers as Record<string, string>)['X-Forwarded-For']).toBe('203.0.113.9')

    expect(user).toMatchObject({
      id: 'magic:a@b.c',
      email: 'a@b.c',
      backendAccessToken: 'api-jwt',
      backendUserId: 'uuid-1',
      isNewUser: true,
      onboardingCompleted: false,
      needsUsername: true,
    })
  })

  it('returns null when the backend rejects the token', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{"detail":"Invalid or expired link"}', { status: 400 })) as unknown as typeof fetch
    expect(await authorize({ token: VALID_TOKEN }, {})).toBeNull()
  })

  it('returns null when the backend is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
    expect(await authorize({ token: VALID_TOKEN }, {})).toBeNull()
  })

  it('rejects missing or malformed tokens without calling the backend', async () => {
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch
    expect(await authorize(undefined, {})).toBeNull()
    expect(await authorize({ token: 'short' }, {})).toBeNull()
    expect(await authorize({ token: 'y'.repeat(600) }, {})).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('is registered without DEV_MODE', () => {
    // authOptions is built at import time with the test env (no DEV_MODE, no OIDC).
    // CredentialsProvider keeps the real id in `.options.id` until next-auth merges it at runtime.
    const ids = authOptions.providers.map(
      (p) => (p as unknown as { options?: { id?: string } }).options?.id ?? p.id,
    )
    expect(ids).not.toContain('dev-credentials')
    expect(ids).toContain('magic-link')
  })
})

describe('jwt callback for magic-link sign-in', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses the access token from authorize() and skips /auth/sync', async () => {
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch
    const jwt = authOptions.callbacks!.jwt!

    const token = await jwt({
      token: { sub: 'magic:a@b.c' },
      user: {
        id: 'magic:a@b.c',
        email: 'a@b.c',
        backendAccessToken: 'api-jwt',
        backendUserId: 'uuid-1',
        isNewUser: false,
        onboardingCompleted: true,
        needsUsername: false,
      },
      account: { provider: 'magic-link', type: 'credentials', providerAccountId: 'magic:a@b.c' },
    } as unknown as Parameters<typeof jwt>[0])

    expect(spy).not.toHaveBeenCalled()
    expect(token).toMatchObject({
      accessToken: 'api-jwt',
      sub: 'magic:a@b.c',
      backendUserId: 'uuid-1',
      onboardingCompleted: true,
      needsUsername: false,
    })
  })
})

describe('does not set the v5-only trustHost option', () => {
  it('relies on AUTH_TRUST_HOST env instead', () => {
    expect('trustHost' in authOptions).toBe(false)
  })
})

describe('safeCallbackPath', () => {
  it('keeps relative paths', () => {
    expect(safeCallbackPath('/dashboard/wardrobe?x=1')).toBe('/dashboard/wardrobe?x=1')
  })

  it('reduces absolute URLs (any origin) to their path', () => {
    expect(safeCallbackPath('http://miaurmario.home/dashboard/history')).toBe('/dashboard/history')
    expect(safeCallbackPath('https://evil.example/dashboard')).toBe('/dashboard')
  })

  it('rejects protocol-relative, backslash and non-http values', () => {
    expect(safeCallbackPath('//evil.example')).toBe('/dashboard')
    expect(safeCallbackPath('/\\evil.example')).toBe('/dashboard')
    expect(safeCallbackPath('javascript:alert(1)')).toBe('/dashboard')
    expect(safeCallbackPath('not a url')).toBe('/dashboard')
    expect(safeCallbackPath(null)).toBe('/dashboard')
  })

  it('never returns to the auth pages', () => {
    expect(safeCallbackPath('/login?error=x')).toBe('/dashboard')
    expect(safeCallbackPath('/auth/callback?token=abc')).toBe('/dashboard')
    expect(safeCallbackPath('/loginx')).toBe('/loginx')
  })
})

describe('magicLinkLanding', () => {
  it('sends users without a username to username onboarding', () => {
    expect(magicLinkLanding({ needsUsername: true, onboardingCompleted: true })).toBe(
      '/onboarding/username',
    )
  })

  it('sends users with pending onboarding to /onboarding', () => {
    expect(magicLinkLanding({ needsUsername: false, onboardingCompleted: false })).toBe(
      '/onboarding',
    )
  })

  it('sends onboarded users to the (sanitised) callback URL', () => {
    expect(magicLinkLanding({ needsUsername: false, onboardingCompleted: true })).toBe('/dashboard')
    expect(
      magicLinkLanding({ needsUsername: false, onboardingCompleted: true }, '/dashboard/history'),
    ).toBe('/dashboard/history')
    expect(
      magicLinkLanding({ needsUsername: false, onboardingCompleted: true }, 'https://evil.example/x'),
    ).toBe('/x')
  })
})

describe('getRequestOrigin', () => {
  const originalEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('prefers X-Forwarded-Host / X-Forwarded-Proto', () => {
    const h = new Headers({
      host: 'wardrobe_frontend:3000',
      'x-forwarded-host': 'miaurmario.andreipop.org',
      'x-forwarded-proto': 'https',
    })
    expect(getRequestOrigin(h)).toBe('https://miaurmario.andreipop.org')
  })

  it('uses the first value of comma-separated forwarded headers', () => {
    const h = new Headers({
      'x-forwarded-host': 'miaurmario.home, wardrobe_nginx',
      'x-forwarded-proto': 'http, https',
    })
    expect(getRequestOrigin(h)).toBe('http://miaurmario.home')
  })

  it('falls back to Host and the NEXTAUTH_URL scheme', () => {
    process.env.NEXTAUTH_URL = 'https://miaurmario.andreipop.org'
    expect(getRequestOrigin(new Headers({ host: 'miaurmario.home' }))).toBe(
      'https://miaurmario.home',
    )
  })

  it('falls back to NEXTAUTH_URL for garbage hosts', () => {
    process.env.NEXTAUTH_URL = 'https://miaurmario.andreipop.org/'
    expect(getRequestOrigin(new Headers({ host: 'evil.example/path?x' }))).toBe(
      'https://miaurmario.andreipop.org',
    )
  })
})
