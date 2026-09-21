import { NextAuthOptions } from 'next-auth';
import type { OAuthConfig } from 'next-auth/providers/oauth';
import CredentialsProvider from 'next-auth/providers/credentials';

interface OIDCProfile {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  picture?: string;
}

const OIDCProvider: OAuthConfig<OIDCProfile> = {
  id: 'oidc',
  name: 'SSO',
  type: 'oauth',
  wellKnown: `${process.env.OIDC_ISSUER_URL?.replace(/\/+$/, '')}/.well-known/openid-configuration`,
  clientId: process.env.OIDC_CLIENT_ID!,
  clientSecret: process.env.OIDC_CLIENT_SECRET!,
  authorization: {
    params: {
      scope: 'openid email profile',
    },
  },
  checks: ['pkce', 'state'],
  async profile(profile, tokens) {
    let email = profile.email;
    let name = profile.name || profile.preferred_username;

    if (!email && tokens.access_token && process.env.OIDC_ISSUER_URL) {
      try {
        const issuer = process.env.OIDC_ISSUER_URL.replace(/\/+$/, '');
        const discoveryRes = await fetch(`${issuer}/.well-known/openid-configuration`);
        if (discoveryRes.ok) {
          const discovery = await discoveryRes.json() as { userinfo_endpoint?: string };
          if (discovery.userinfo_endpoint) {
            const infoRes = await fetch(discovery.userinfo_endpoint, {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            if (infoRes.ok) {
              const info = await infoRes.json() as { email?: string; name?: string; preferred_username?: string };
              email = info.email;
              name = name || info.name || info.preferred_username;
            }
          }
        }
      } catch {}
    }

    return {
      id: profile.sub,
      name,
      email,
      image: profile.picture,
    };
  },
};

// Dev credentials provider - for local development only
const DevCredentialsProvider = CredentialsProvider({
  id: 'dev-credentials',
  name: 'Dev Login',
  credentials: {
    email: { label: 'Email', type: 'email', placeholder: 'dev@example.com' },
    name: { label: 'Name', type: 'text', placeholder: 'Dev User' },
  },
  async authorize(credentials) {
    if (!credentials?.email) {
      return null;
    }

    // In dev mode, accept any email/name combination
    const email = credentials.email;
    const name = credentials.name || email.split('@')[0];
    const id = email.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    return {
      id,
      email,
      name,
      image: null,
    };
  },
});

function backendUrl(): string {
  return (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:8000').replace(
    /\/+$/,
    '',
  );
}

interface MagicLinkVerifyResponse {
  id: string;
  external_id: string;
  email: string;
  display_name: string;
  username?: string | null;
  avatar_url?: string | null;
  is_new_user: boolean;
  onboarding_completed: boolean;
  needs_username: boolean;
  access_token: string;
}

// Magic link provider: the emailed link lands on /auth/callback, which calls
// signIn('magic-link', { token }). authorize() exchanges the single-use token
// with the backend for an API access token, which the jwt callback stores in
// the NextAuth session (same shape as the OIDC/dev flows). The backend is the
// gate: if magic link is not configured it answers 503 and sign-in fails.
export const MagicLinkProvider = CredentialsProvider({
  id: 'magic-link',
  name: 'Magic link',
  credentials: {
    token: { label: 'Token', type: 'text' },
  },
  async authorize(credentials, req) {
    const token = credentials?.token;
    if (typeof token !== 'string' || token.length < 16 || token.length > 512) {
      return null;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Preserve the end-user IP so the backend's per-IP rate limit is not
    // applied to the frontend container as a whole.
    const xff = req?.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff) {
      headers['X-Forwarded-For'] = xff;
    }

    let response: Response;
    try {
      response = await fetch(`${backendUrl()}/api/v1/auth/magic-link/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token }),
        cache: 'no-store',
      });
    } catch (error) {
      console.error('Magic link verify: backend unreachable', error);
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as MagicLinkVerifyResponse;
    return {
      id: data.external_id,
      email: data.email,
      name: data.display_name,
      image: data.avatar_url ?? null,
      backendAccessToken: data.access_token,
      backendUserId: data.id,
      isNewUser: data.is_new_user,
      onboardingCompleted: data.onboarding_completed,
      needsUsername: data.needs_username,
    };
  },
});

function getProviders() {
  const providers = [];

  if (process.env.OIDC_ISSUER_URL) {
    providers.push(OIDCProvider);
  }

  // Always registered (unless explicitly disabled): availability is decided by
  // the backend (RESEND_API_KEY), which the login page reads from
  // /api/v1/auth/config. Must NOT depend on DEV_MODE.
  if (process.env.MAGIC_LINK_ENABLED !== 'false') {
    providers.push(MagicLinkProvider);
  }

  // Dev credentials accept ANY email without verification. Never enable in a
  // publicly reachable deployment.
  if (process.env.DEV_MODE === 'true' || process.env.NODE_ENV === 'development') {
    providers.push(DevCredentialsProvider);
  }
  return providers;
}

export const authOptions: NextAuthOptions = {
  providers: getProviders(),
  callbacks: {
    async jwt({ token, user, account, trigger }) {
      const apiUrl = backendUrl();

      // Session update triggered - refresh user data from backend
      if (trigger === 'update' && token.accessToken) {
        try {
          const response = await fetch(`${apiUrl}/api/v1/users/me`, {
            headers: {
              'Authorization': `Bearer ${token.accessToken}`,
            },
          });

          if (response.ok) {
            const userData = await response.json();
            return {
              ...token,
              onboardingCompleted: userData.onboarding_completed,
              needsUsername: !userData.username,
            };
          }
        } catch (error) {
          console.error('Failed to refresh user data:', error);
        }
        return token;
      }

      // Magic link sign in - the backend already verified the token and issued
      // an API access token in authorize(); no /auth/sync round-trip.
      if (user && account?.provider === 'magic-link') {
        return {
          ...token,
          accessToken: user.backendAccessToken,
          sub: user.id,
          backendUserId: user.backendUserId,
          isNewUser: user.isNewUser,
          onboardingCompleted: user.onboardingCompleted,
          needsUsername: user.needsUsername,
          syncError: undefined,
        };
      }

      // Initial sign in (OIDC / dev) - sync with backend and get API token
      if (user) {
        try {
          const response = await fetch(`${apiUrl}/api/v1/auth/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              external_id: user.id,
              email: user.email,
              display_name: user.name || user.email?.split('@')[0] || 'User',
              avatar_url: user.image,
              id_token: account?.id_token,
            }),
          });

          if (response.ok) {
            const syncData = await response.json();
            return {
              ...token,
              accessToken: syncData.access_token,
              sub: user.id,
              backendUserId: syncData.id,
              isNewUser: syncData.is_new_user,
              onboardingCompleted: syncData.onboarding_completed,
            };
          }

          const errorData = await response.json().catch(() => ({}));
          const syncError = errorData.detail || `Backend sync failed (${response.status})`;
          console.error('Failed to sync user to backend:', syncError);
          return {
            ...token,
            sub: user.id,
            syncError,
          };
        } catch (error) {
          console.error('Failed to sync user to backend:', error);
        }

        return {
          ...token,
          sub: user.id,
          syncError: 'Unable to connect to backend server',
        };
      }
      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub,
        },
        accessToken: token.accessToken,
        isNewUser: token.isNewUser,
        onboardingCompleted: token.onboardingCompleted,
        needsUsername: token.needsUsername,
        syncError: token.syncError,
      };
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
  // Origin handling (next-auth v4): callback/redirect URLs and the Secure flag
  // on session cookies come from NEXTAUTH_URL, unless the env var
  // AUTH_TRUST_HOST=true is set, in which case the origin is derived per
  // request from X-Forwarded-Host (or Host) + X-Forwarded-Proto. That env var
  // is what lets the LAN (http://miaurmario.home) and public
  // (https://miaurmario.andreipop.org) hostnames coexist. The `trustHost`
  // option is Auth.js v5 only and is ignored by v4, so it is not set here.
};
