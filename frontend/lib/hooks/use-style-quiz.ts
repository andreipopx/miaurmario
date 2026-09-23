'use client';

import { useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';
import type { RestyleMode, StyleQuizProfile, StyleQuizResponse } from '@/lib/style-quiz/cards';

const ENDPOINT = '/users/me/preferences/style-quiz';
export const STYLE_QUIZ_QUERY_KEY = ['style-quiz'] as const;

function useToken() {
  const { data: session } = useSession();
  if (session?.accessToken) setAccessToken(session.accessToken as string);
}

/** The saved «Tu estilo con Stinky» answers and the summary Stinky reads back. */
export function useStyleQuiz(enabled = true) {
  const { status } = useSession();
  useToken();

  return useQuery({
    queryKey: STYLE_QUIZ_QUERY_KEY,
    queryFn: () => api.get<StyleQuizResponse>(ENDPOINT),
    enabled: enabled && status === 'authenticated',
    staleTime: 60 * 1000,
  });
}

/** Save the whole profile (PUT replaces: the deck and the form both send it all). */
export function useSaveStyleQuiz() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: (profile: StyleQuizProfile) => {
      if (session?.accessToken) setAccessToken(session.accessToken as string);
      return api.put<StyleQuizResponse>(ENDPOINT, profile);
    },
    onSuccess: (res) => {
      queryClient.setQueryData(STYLE_QUIZ_QUERY_KEY, res);
      // The stylist reads the quiz, so today's cached suggestions are stale.
      queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });
}

// ---- "Repetir el test": open the quiz from anywhere (Ajustes, profile menu) ----

export interface StyleQuizRequest {
  /** Increments on every request, so the dialog can tell repeats apart. */
  n: number;
  /** How the user chose to re-run it in Ajustes. */
  mode: RestyleMode;
}

const IDLE: StyleQuizRequest = { n: 0, mode: 'fresh' };
let current: StyleQuizRequest = IDLE;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Open the swipe deck over whatever page the user is on.
 *
 * `fresh` ignores the saved answers, `merge` keeps them and lets the new
 * swipes win. ("adjust" never opens the deck — that is the inline editor on
 * Ajustes → Tu estilo.)
 */
export function openStyleQuiz(mode: RestyleMode = 'fresh') {
  current = { n: current.n + 1, mode };
  listeners.forEach((l) => l());
}

/** The latest request to open the quiz. */
export function useStyleQuizRequest(): StyleQuizRequest {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => IDLE
  );
}
