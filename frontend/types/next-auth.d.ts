import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
    accessToken?: string;
    isNewUser?: boolean;
    onboardingCompleted?: boolean;
    needsUsername?: boolean;
    syncError?: string;
  }

  // Extra fields returned by the magic-link CredentialsProvider.authorize()
  interface User {
    backendAccessToken?: string;
    backendUserId?: string;
    isNewUser?: boolean;
    onboardingCompleted?: boolean;
    needsUsername?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    sub?: string;
    backendUserId?: string;
    isNewUser?: boolean;
    onboardingCompleted?: boolean;
    needsUsername?: boolean;
    syncError?: string;
    // Backend API token lifetime (ms since epoch), for the sliding refresh.
    accessTokenIssuedAt?: number;
    accessTokenExpiresAt?: number;
    refreshFailedAt?: number;
  }
}
