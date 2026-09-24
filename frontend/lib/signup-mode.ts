// Public sign-up mode, read from the backend at request time.
//
// The landing page has to offer the right "Crear cuenta" destination without a
// redeploy: while the beta is closed (`invite_only`) the button lands on the
// login page with the waitlist form already open; once the owner flips sign-up
// to `open` in the admin panel, the very same button just goes to /login.

export type SignupMode = 'open' | 'invite_only';

/** Where "Crear cuenta" should take someone. `?waitlist=1` opens the waitlist form on /login. */
export function signupHref(mode: SignupMode): string {
  return mode === 'open' ? '/login' : '/login?waitlist=1';
}

/** True while the beta is closed, i.e. the page must explain the waiting list. */
export function isInviteOnly(mode: SignupMode): boolean {
  return mode !== 'open';
}

/** Narrow whatever /api/v1/auth/config returned; anything unexpected means "closed beta". */
export function parseSignupMode(payload: unknown): SignupMode {
  const mode = (payload as { signup_mode?: unknown } | null)?.signup_mode;
  return mode === 'open' ? 'open' : 'invite_only';
}

function backendUrl(): string {
  const url = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:8000';
  return url.replace(/\/+$/, '');
}

/**
 * Server-side read of the public auth config. Never throws: if the backend is
 * slow or down the landing page still renders, assuming the closed beta (the
 * safe answer — it sends people to the waitlist instead of a dead end).
 * Cached for 5 minutes so a burst of visitors does not hammer the backend.
 */
export async function fetchSignupMode(): Promise<SignupMode> {
  try {
    const res = await fetch(`${backendUrl()}/api/v1/auth/config`, {
      signal: AbortSignal.timeout(2500),
      next: { revalidate: 300 },
    });
    if (!res.ok) return 'invite_only';
    return parseSignupMode(await res.json());
  } catch {
    return 'invite_only';
  }
}
