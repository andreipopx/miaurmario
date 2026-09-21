'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';
import type {
  AdminUser,
  AIStatus,
  AITestResponse,
  ByokPayload,
} from '@/lib/ai-access';

function useToken() {
  const { data: session, status } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
  return status;
}

export const AI_STATUS_KEY = ['ai-status'] as const;

export function useAIStatus() {
  const status = useToken();
  return useQuery({
    queryKey: AI_STATUS_KEY,
    queryFn: () => api.get<AIStatus>('/users/me/ai'),
    enabled: status === 'authenticated',
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveByok() {
  useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ByokPayload) => api.put<AIStatus>('/users/me/ai', payload),
    onSuccess: (data) => {
      queryClient.setQueryData(AI_STATUS_KEY, data);
    },
  });
}

export function useDeleteByok() {
  useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<AIStatus>('/users/me/ai'),
    onSuccess: (data) => {
      queryClient.setQueryData(AI_STATUS_KEY, data);
    },
  });
}

export function useTestByok() {
  useToken();
  return useMutation({
    mutationFn: (payload: Partial<ByokPayload> | undefined) =>
      api.post<AITestResponse>('/users/me/ai/test', payload ?? {}),
  });
}

export function useAdminUsers(search: string, enabled: boolean) {
  const status = useToken();
  return useQuery({
    queryKey: ['admin-users', search],
    queryFn: () =>
      api.get<{ users: AdminUser[]; total: number }>('/admin/users', {
        params: search ? { search } : undefined,
      }),
    enabled: enabled && status === 'authenticated',
    meta: { silentStatuses: [403] },
  });
}

export function useUpdateAdminUser() {
  useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { ai_access?: 'none' | 'platform'; monthly_request_cap?: number | null; is_active?: boolean };
    }) => api.patch<AdminUser>(`/admin/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    meta: { silentErrors: true },
  });
}
