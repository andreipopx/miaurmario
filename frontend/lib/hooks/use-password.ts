'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, ApiError, setAccessToken } from '@/lib/api';

/**
 * API failure re-thrown as a non-ApiError so the global MutationCache toast
 * (app/providers.tsx) skips it: SecurityCard shows these errors inline,
 * translated, instead of the raw backend code.
 */
export class PasswordRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PasswordRequestError';
    this.status = status;
  }
}

async function inline<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError) throw new PasswordRequestError(error.message, error.status);
    throw error;
  }
}

export interface PasswordStatus {
  has_password: boolean;
  password_updated_at?: string | null;
  /** Set after a change: the other devices were signed out, this is ours. */
  access_token?: string | null;
}

export interface SetPasswordInput {
  current_password?: string;
  new_password: string;
}

function useInvalidateProfile() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['user-profile'] });
    queryClient.invalidateQueries({ queryKey: ['auth-user'] });
  };
}

/** PUT /users/me/password: set a first password, or change it (current required). */
export function useSetPassword() {
  const { data: session, update } = useSession();
  const invalidate = useInvalidateProfile();
  return useMutation({
    mutationFn: (data: SetPasswordInput) => {
      if (session?.accessToken) setAccessToken(session.accessToken as string);
      return inline(api.put<PasswordStatus>('/users/me/password', data));
    },
    onSuccess: async (status) => {
      // Every other device was just signed out; keep this one with its new token.
      if (status.access_token) {
        setAccessToken(status.access_token);
        await update({ accessToken: status.access_token });
      }
      invalidate();
    },
  });
}

/** POST /auth/logout-everywhere: every device, this one included, signs in again. */
export function useLogoutEverywhere() {
  const { data: session } = useSession();
  return useMutation({
    mutationFn: () => {
      if (session?.accessToken) setAccessToken(session.accessToken as string);
      return inline(api.post<void>('/auth/logout-everywhere'));
    },
  });
}

/** DELETE /users/me/password: back to magic-link-only login. */
export function useRemovePassword() {
  const { data: session } = useSession();
  const invalidate = useInvalidateProfile();
  return useMutation({
    mutationFn: () => {
      if (session?.accessToken) setAccessToken(session.accessToken as string);
      return inline(api.delete<void>('/users/me/password'));
    },
    onSuccess: invalidate,
  });
}
