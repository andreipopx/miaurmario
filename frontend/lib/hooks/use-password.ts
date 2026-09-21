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
  const { data: session } = useSession();
  const invalidate = useInvalidateProfile();
  return useMutation({
    mutationFn: (data: SetPasswordInput) => {
      if (session?.accessToken) setAccessToken(session.accessToken as string);
      return inline(api.put<PasswordStatus>('/users/me/password', data));
    },
    onSuccess: invalidate,
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
