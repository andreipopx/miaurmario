// Post-login redirect helpers (login page and magic-link landing page).

/**
 * Normalise a post-login destination to a relative path on the current origin.
 *
 * Absolute URLs (e.g. a callbackUrl NextAuth built from NEXTAUTH_URL, which may
 * be the *other* hostname) are reduced to their path, so we never bounce the
 * user to a different origin and cannot be used as an open redirect.
 */
export function safeCallbackPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback;
  let path = value;
  if (!value.startsWith('/')) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
      path = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return fallback;
    }
  }
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
    return fallback;
  }
  // Never "return" to the auth pages themselves (redirect loops / token reuse).
  if (/^\/(login|auth\/callback)(\/|\?|#|$)/.test(path)) {
    return fallback;
  }
  return path;
}

export interface MagicLinkSessionState {
  needsUsername?: boolean;
  onboardingCompleted?: boolean;
}

/**
 * Where to send the user after a successful magic-link sign-in. Returns a
 * relative path so the browser stays on whichever origin it is already on
 * (LAN or public) regardless of NEXTAUTH_URL.
 */
export function magicLinkLanding(state: MagicLinkSessionState, callbackUrl?: string | null): string {
  if (state.needsUsername) return '/onboarding/username';
  if (state.onboardingCompleted === false) return '/onboarding';
  return safeCallbackPath(callbackUrl);
}
