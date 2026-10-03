'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import type { UserProfile } from '@/lib/hooks/use-user';
import {
  DEFAULT_STINKY_PERSONA,
  STINKY_PERSONA_COOKIE,
  isDefaultPersona,
  personaFromProfile,
  samePersona,
  serializePersona,
  type StinkyPersona,
} from '@/lib/stinky-persona';

/**
 * Which Stinky this person has (name + coat). The server reads it from the
 * cookie for the first render; StinkyPersonaSync keeps cookie and context in
 * line with the account, so another device's change, a sign-out or a new
 * account all land without a reload.
 */
const PersonaContext = createContext<{
  persona: StinkyPersona;
  apply: (next: StinkyPersona) => void;
}>({ persona: DEFAULT_STINKY_PERSONA, apply: () => {} });

function writeCookie(p: StinkyPersona) {
  document.cookie = isDefaultPersona(p)
    ? `${STINKY_PERSONA_COOKIE}=; path=/; max-age=0; samesite=lax`
    : `${STINKY_PERSONA_COOKIE}=${serializePersona(p)}; path=/; max-age=31536000; samesite=lax`;
}

export function StinkyPersonaProvider({
  initial,
  children,
}: {
  initial: StinkyPersona;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [persona, setPersona] = useState(initial);
  const current = useRef(initial);

  const apply = useCallback(
    (next: StinkyPersona) => {
      const prev = current.current;
      if (samePersona(prev, next)) return;
      current.current = next;
      writeCookie(next);
      setPersona(next);
      // Every text was rendered with the old name: fetch them again with the new one.
      if (prev.name !== next.name) router.refresh();
    },
    [router]
  );

  const value = useMemo(() => ({ persona, apply }), [persona, apply]);
  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export const useStinkyPersona = () => useContext(PersonaContext).persona;
export const useApplyStinkyPersona = () => useContext(PersonaContext).apply;

/**
 * Follows the account: its cat once signed in, the default cat once signed out.
 * Reads the profile the app already loads (useAuth) without fetching it itself.
 */
export function StinkyPersonaSync() {
  const { status } = useSession();
  const { data: user } = useQuery<UserProfile>({ queryKey: ['auth-user'], enabled: false });
  const apply = useApplyStinkyPersona();

  useEffect(() => {
    if (user) apply(personaFromProfile(user));
    // Offline the session reads as signed out while the saved account is still in use.
    else if (status === 'unauthenticated' && navigator.onLine) apply(DEFAULT_STINKY_PERSONA);
  }, [user, status, apply]);

  return null;
}
