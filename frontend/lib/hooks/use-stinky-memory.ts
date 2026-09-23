'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';

const ENDPOINT = '/stinky/memory';
export const STINKY_MEMORY_KEY = ['stinky-memory'] as const;

/** The kinds Stinky files a note under. `name` has its own field in the API. */
export const MEMORY_KINDS = ['preference', 'dislike', 'context', 'plan', 'fact'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface StinkyMemory {
  id: string;
  kind: string;
  text: string;
  /** "chat" = Stinky wrote it talking to you, "user" = you edited it. */
  source: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface StinkyMemoryList {
  /** What you asked Stinky to call you — not your account name. */
  call_name: string | null;
  memories: StinkyMemory[];
  max_entries: number;
  max_text_chars: number;
}

function useToken() {
  const { data: session, status } = useSession();
  if (session?.accessToken) setAccessToken(session.accessToken as string);
  return status;
}

/** Everything Stinky remembers about you (Ajustes → Stinky recuerda). */
export function useStinkyMemory(enabled = true) {
  const status = useToken();
  return useQuery({
    queryKey: STINKY_MEMORY_KEY,
    queryFn: () => api.get<StinkyMemoryList>(ENDPOINT),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

export interface MemoryPatch {
  id: string;
  text?: string;
  pinned?: boolean;
}

/** Rewrite a note or (un)pin it. */
export function useUpdateStinkyMemory() {
  useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: MemoryPatch) =>
      api.patch<StinkyMemory>(`${ENDPOINT}/${id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<StinkyMemoryList>(STINKY_MEMORY_KEY, (prev) =>
        prev
          ? { ...prev, memories: prev.memories.map((m) => (m.id === updated.id ? updated : m)) }
          : prev
      );
    },
  });
}

export function useDeleteStinkyMemory() {
  useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`${ENDPOINT}/${id}`),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<StinkyMemoryList>(STINKY_MEMORY_KEY, (prev) =>
        prev ? { ...prev, memories: prev.memories.filter((m) => m.id !== id) } : prev
      );
    },
  });
}

/** «Borrar todo»: Stinky forgets everything, the preferred name included. */
export function useClearStinkyMemory() {
  useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ deleted: number }>(ENDPOINT),
    onSuccess: () => {
      queryClient.setQueryData<StinkyMemoryList>(STINKY_MEMORY_KEY, (prev) =>
        prev ? { ...prev, call_name: null, memories: [] } : prev
      );
    },
  });
}

/** «¿Cómo quieres que te llame?» — an empty string clears it. */
export function useSetStinkyCallName() {
  useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.put<StinkyMemoryList>(`${ENDPOINT}/name`, { name }),
    onSuccess: (res) => queryClient.setQueryData(STINKY_MEMORY_KEY, res),
  });
}

/** Group notes by kind, in the order the page shows them. */
export function groupByKind(memories: StinkyMemory[]): [MemoryKind, StinkyMemory[]][] {
  return MEMORY_KINDS.map(
    (kind) => [kind, memories.filter((m) => m.kind === kind)] as [MemoryKind, StinkyMemory[]]
  ).filter(([, rows]) => rows.length > 0);
}
