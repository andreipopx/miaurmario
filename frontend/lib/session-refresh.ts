// Sliding sessions for the backend API token stored in the NextAuth JWT.
//
// The backend issues HS256 access tokens that live ACCESS_TOKEN_DAYS (30 by
// default). The NextAuth session cookie lives SESSION_MAX_AGE_SECONDS and is
// re-issued on every session fetch, and the jwt callback swaps the backend
// token for a fresh one (POST /api/v1/auth/refresh) once it is older than
// REFRESH_AFTER_MS. Net effect: an active user is never logged out, an idle
// session dies when either lifetime runs out, and rotating SECRET_KEY still
// invalidates everything (refresh then answers 401 and the token is dropped,
// which makes useAuth sign the user out).
import type { JWT } from 'next-auth/jwt';

export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
export const REFRESH_RETRY_BACKOFF_MS = 5 * 60 * 1000;

export interface TokenTimes {
  issuedAt?: number; // ms since epoch
  expiresAt?: number; // ms since epoch
}

/** Read iat/exp from a JWT without verifying it (the backend is the verifier). */
export function decodeJwtTimes(token: string | undefined): TokenTimes {
  if (!token) return {};
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const payload = JSON.parse(json) as { iat?: unknown; exp?: unknown };
    return {
      issuedAt: typeof payload.iat === 'number' ? payload.iat * 1000 : undefined,
      expiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : undefined,
    };
  } catch {
    return {};
  }
}

/** Fields to merge into the NextAuth JWT whenever a new backend token is stored. */
export function backendTokenFields(accessToken: string | undefined): Partial<JWT> {
  const { issuedAt, expiresAt } = decodeJwtTimes(accessToken);
  return {
    accessToken,
    accessTokenIssuedAt: issuedAt ?? Date.now(),
    accessTokenExpiresAt: expiresAt,
    refreshFailedAt: undefined,
  };
}

export function shouldRefreshBackendToken(token: JWT, now = Date.now()): boolean {
  if (!token.accessToken) return false;
  // Sessions created before this field existed: fall back to the token itself.
  const issuedAt = token.accessTokenIssuedAt ?? decodeJwtTimes(token.accessToken).issuedAt;
  const expiresAt = token.accessTokenExpiresAt ?? decodeJwtTimes(token.accessToken).expiresAt;
  if (expiresAt !== undefined && expiresAt <= now) return false; // useAuth's 401 path handles it
  if (token.refreshFailedAt && now - token.refreshFailedAt < REFRESH_RETRY_BACKOFF_MS) return false;
  if (issuedAt === undefined) return true;
  return now - issuedAt >= REFRESH_AFTER_MS;
}

interface RefreshResponse {
  access_token: string;
}

/**
 * Refresh the backend token when due. Never throws.
 * - success: new token + times stored;
 * - 401/403 (expired, SECRET_KEY rotated, user deactivated): accessToken is
 *   dropped, so useAuth sees an authenticated session without a token and
 *   signs out to /login;
 * - anything else (network, 429, 5xx): keep the current token, retry later.
 */
export async function refreshBackendTokenIfDue(
  token: JWT,
  apiUrl: string,
  now = Date.now(),
): Promise<JWT> {
  if (!shouldRefreshBackendToken(token, now)) return token;
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.accessToken}` },
      cache: 'no-store',
    });
    if (response.ok) {
      const data = (await response.json()) as RefreshResponse;
      if (data?.access_token) {
        return { ...token, ...backendTokenFields(data.access_token) };
      }
    } else if (response.status === 401 || response.status === 403) {
      return {
        ...token,
        accessToken: undefined,
        accessTokenIssuedAt: undefined,
        accessTokenExpiresAt: undefined,
      };
    }
  } catch (error) {
    console.error('Backend token refresh failed:', error);
  }
  return { ...token, refreshFailedAt: now };
}
