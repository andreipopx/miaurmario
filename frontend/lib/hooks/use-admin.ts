'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, ApiError, getAccessToken, NetworkError, setAccessToken } from '@/lib/api';
import type {
  AccountDeletion,
  AdminOverview,
  AdminUserDetail,
  AIPricing,
  Announcement,
  AnnouncementLevel,
  AuditEntry,
  FeedbackItem,
  FeedbackKind,
  FeedbackStatus,
  Invite,
  SignupMode,
  SystemStatus,
} from '@/lib/admin';
import { useAIStatus } from '@/lib/hooks/use-ai-access';

function useToken() {
  const { data: session, status } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
  return status;
}

/** True once we know the signed-in user is a site admin (ADMIN_EMAILS). */
export function useIsSiteAdmin(): boolean {
  const { data } = useAIStatus();
  return Boolean(data?.is_admin);
}

const silent = { silentStatuses: [403] };

function useAdminQuery<T>(key: readonly unknown[], path: string, enabled = true, params?: Record<string, string>) {
  const status = useToken();
  return useQuery({
    queryKey: key,
    queryFn: () => api.get<T>(path, params ? { params } : undefined),
    enabled: enabled && status === 'authenticated',
    meta: silent,
  });
}

export const adminKeys = {
  all: ['admin'] as const,
  overview: ['admin', 'overview'] as const,
  user: (id: string) => ['admin', 'user', id] as const,
  deletions: ['admin', 'deletions'] as const,
  signup: ['admin', 'signup'] as const,
  invites: ['admin', 'invites'] as const,
  feedback: (status: string) => ['admin', 'feedback', status] as const,
  badge: ['admin', 'badge'] as const,
  system: ['admin', 'system'] as const,
  announcement: ['admin', 'announcement'] as const,
  pricing: ['admin', 'pricing'] as const,
  audit: ['admin', 'audit'] as const,
};

export const useAdminOverview = (enabled: boolean) =>
  useAdminQuery<AdminOverview>(adminKeys.overview, '/admin/overview', enabled);

export const useAdminUserDetail = (id: string | null) =>
  useAdminQuery<AdminUserDetail>(adminKeys.user(id ?? ''), `/admin/users/${id}`, Boolean(id));

export const useAdminDeletions = (enabled: boolean) =>
  useAdminQuery<AccountDeletion[]>(adminKeys.deletions, '/admin/deletions', enabled);

export const useSignupMode = (enabled: boolean) =>
  useAdminQuery<{ mode: SignupMode }>(adminKeys.signup, '/admin/signup', enabled);

export const useInvites = (enabled: boolean) =>
  useAdminQuery<Invite[]>(adminKeys.invites, '/admin/invites', enabled);

export const useAdminFeedback = (status: FeedbackStatus | 'all', enabled: boolean) =>
  useAdminQuery<{ items: FeedbackItem[]; total: number; new_count: number }>(
    adminKeys.feedback(status),
    '/admin/feedback',
    enabled,
    status === 'all' ? undefined : { status }
  );

export const useSystemStatus = (enabled: boolean) =>
  useAdminQuery<SystemStatus>(adminKeys.system, '/admin/system', enabled);

export const useAdminAnnouncement = (enabled: boolean) =>
  useAdminQuery<{ announcement: Announcement | null }>(
    adminKeys.announcement,
    '/admin/announcement',
    enabled
  );

export const useAIPricing = (enabled: boolean) =>
  useAdminQuery<AIPricing>(adminKeys.pricing, '/admin/settings/ai-pricing', enabled);

export const useAuditLog = (enabled: boolean) =>
  useAdminQuery<AuditEntry[]>(adminKeys.audit, '/admin/audit', enabled, { limit: '30' });

/** New-feedback counter for the profile menu (admins only, polled lazily). */
export function useAdminBadge() {
  const isAdmin = useIsSiteAdmin();
  const status = useToken();
  return useQuery({
    queryKey: adminKeys.badge,
    queryFn: () => api.get<{ feedback_new: number }>('/admin/badge'),
    enabled: isAdmin && status === 'authenticated',
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    meta: silent,
  });
}

function useAdminMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    meta: { silentErrors: true },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.all });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
}

export const useRemovePassword = () =>
  useAdminMutation((id: string) => api.delete<AdminUserDetail>(`/admin/users/${id}/password`));

export const useDeleteAccount = () =>
  useAdminMutation(({ id, confirm }: { id: string; confirm: string }) =>
    api.post<AccountDeletion>(`/admin/users/${id}/delete`, { confirm })
  );

export const useRetryDeletion = () =>
  useAdminMutation((id: string) => api.post<AccountDeletion>(`/admin/deletions/${id}/retry`));

export const useSetSignupMode = () =>
  useAdminMutation((mode: SignupMode) => api.put<{ mode: SignupMode }>('/admin/signup', { mode }));

export const useCreateInvite = () =>
  useAdminMutation(
    (data: { note?: string | null; max_uses?: number | null; expires_at?: string | null }) =>
      api.post<Invite>('/admin/invites', data)
  );

export const useRevokeInvite = () =>
  useAdminMutation((id: string) => api.post<Invite>(`/admin/invites/${id}/revoke`));

export const useUpdateFeedback = () =>
  useAdminMutation(
    ({ id, ...data }: { id: string; status?: FeedbackStatus; admin_note?: string | null }) =>
      api.patch<FeedbackItem>(`/admin/feedback/${id}`, data)
  );

export const useSaveAIPricing = () =>
  useAdminMutation((data: AIPricing) => api.put<AIPricing>('/admin/settings/ai-pricing', data));

export const useSaveAnnouncement = () =>
  useAdminMutation(
    (data: { text: string; level: AnnouncementLevel; expires_at: string | null }) =>
      api.put<{ announcement: Announcement }>('/admin/announcement', data)
  );

export const useClearAnnouncement = () =>
  useAdminMutation(() => api.delete<{ announcement: null }>('/admin/announcement'));

/** Object URL for an admin-only screenshot (needs the bearer token, so no <img src>). */
export function useFeedbackScreenshot(id: string | null) {
  useToken();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let revoked = false;
    let objectUrl: string | null = null;
    const token = getAccessToken();
    fetch(`/api/v1/admin/feedback/${id}/screenshot`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [id]);
  return url;
}

// --- User-facing: feedback + announcement ----------------------------------------------

export interface FeedbackPayload {
  kind: FeedbackKind;
  text: string;
  screenshot?: File | null;
  page_url?: string | null;
  build_id?: string | null;
}

export function buildFeedbackForm(payload: FeedbackPayload): FormData {
  const form = new FormData();
  form.append('kind', payload.kind);
  form.append('text', payload.text);
  if (payload.page_url) form.append('page_url', payload.page_url);
  if (payload.build_id) form.append('build_id', payload.build_id);
  if (payload.screenshot) form.append('screenshot', payload.screenshot);
  return form;
}

export function useSubmitAppFeedback() {
  const { data: session } = useSession();
  return useMutation({
    meta: { silentErrors: true },
    mutationFn: async (payload: FeedbackPayload) => {
      const token = (session?.accessToken as string | undefined) || getAccessToken();
      let response: Response;
      try {
        response = await fetch('/api/v1/feedback', {
          method: 'POST',
          body: buildFeedbackForm(payload),
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } catch {
        throw new NetworkError();
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message =
          (typeof data.detail === 'string' ? data.detail : data.detail?.message) || 'Error';
        throw new ApiError(message, response.status, data);
      }
      return response.json() as Promise<{ id: string }>;
    },
  });
}

export function useAnnouncement() {
  return useQuery({
    queryKey: ['announcement'],
    queryFn: () => api.get<{ announcement: Announcement | null }>('/announcement'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    meta: { silentStatuses: [404, 500, 502, 503, 504] },
  });
}
