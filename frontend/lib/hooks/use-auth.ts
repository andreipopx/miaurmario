'use client';

import { useEffect, useRef, useState } from 'react';
import { useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSession, useSession, signOut } from 'next-auth/react';
import { api, holdRequestsForSession, setAccessToken, ApiError } from '@/lib/api';
import { clearOfflineData } from '@/lib/offline/persist';
import { useOnline } from './use-online';
import type { UserProfile } from './use-user';

/** How long, back online, the saved account keeps standing in while the session is re-checked. */
const RECONNECT_GRACE_MS = 10000;

let recheck: Promise<boolean> | null = null;

/**
 * Back online after starting (or dropping) offline: NextAuth gave up on the
 * session while there was no network, and it never asks the server again on
 * its own once it believes there is none. So ask, once for every caller: if
 * the session is still good, reload so the whole app picks it up (nothing
 * could be saved offline, so nothing is lost); if not, it really is signed out.
 */
function recheckSession(): Promise<boolean> {
  recheck ??= getSession()
    .then((session) => {
      if (session?.accessToken) {
        window.location.reload();
        return true;
      }
      return false;
    })
    .catch(() => false)
    .finally(() => {
      recheck = null;
    });
  return recheck;
}

export function useAuth() {
  const { data: session, status } = useSession();
  const signingOut = useRef(false);
  const queryClient = useQueryClient();
  const online = useOnline();
  // The saved offline copy is still being read back from IndexedDB.
  const restoring = useIsRestoring();

  // Set access token if available from NextAuth
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }

  const hasToken = !!session?.accessToken;
  const syncError = session?.syncError;

  const userQuery = useQuery({
    queryKey: ['auth-user'],
    queryFn: () => api.get<UserProfile>('/users/me'),
    // Only fetch when session is loaded AND we have an access token
    enabled: status === 'authenticated' && hasToken,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (signingOut.current) return;

    if (userQuery.error instanceof ApiError && userQuery.error.status === 401) {
      signingOut.current = true;
      void clearOfflineData(queryClient)
        .then(() => signOut({ redirect: false }))
        .then(() => {
          signingOut.current = false;
        });
      return;
    }

    if (status === 'authenticated' && !hasToken) {
      signingOut.current = true;
      const callbackUrl = syncError
        ? `/login?syncError=${encodeURIComponent(syncError)}`
        : '/login';
      void clearOfflineData(queryClient)
        .then(() => signOut({ callbackUrl }))
        .then(() => {
          signingOut.current = false;
        });
    }
  }, [userQuery.error, status, hasToken, syncError, queryClient]);

  // Back online after an offline stretch: until the session has been
  // re-checked, "unauthenticated" only means "couldn't ask yet", not "signed out".
  const [reconnecting, setReconnecting] = useState(false);
  const wasOnline = useRef(online);
  const graceTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const cameBack = online && !wasOnline.current;
    wasOnline.current = online;
    if (!cameBack || status === 'authenticated' || !userQuery.data) return;
    setReconnecting(true);
    window.clearTimeout(graceTimer.current);
    graceTimer.current = window.setTimeout(() => setReconnecting(false), RECONNECT_GRACE_MS);
    void recheckSession().then((stillSignedIn) => {
      if (!stillSignedIn) setReconnecting(false);
    });
  }, [online, status, userQuery.data]);
  useEffect(() => () => window.clearTimeout(graceTimer.current), []);

  // Offline the session can't be confirmed (NextAuth reports "unauthenticated"
  // when its request fails), so the account saved for offline use stands in:
  // you can look at your wardrobe, and the server checks again on reconnect.
  const offlineUser =
    (!online || reconnecting) && status !== 'authenticated' ? userQuery.data : undefined;
  // Cold start with a saved account: open on it straight away instead of a spinner
  // while NextAuth asks for the session; API calls wait for its token meanwhile.
  // If the session turns out to be gone, the layout sends the user to /login.
  const startingUp = status === 'loading' && !!userQuery.data;
  holdRequestsForSession(startingUp);
  const isAuthenticated =
    (status === 'authenticated' && userQuery.isSuccess && !!userQuery.data) ||
    !!offlineUser ||
    startingUp;

  const isLoading =
    restoring ||
    (status === 'loading' && !userQuery.data) ||
    (status === 'authenticated' && userQuery.isPending);

  return {
    user: userQuery.data,
    isAuthenticated,
    isLoading,
    error: userQuery.error,
    // For components that still need session info
    session,
    sessionStatus: status,
  };
}
