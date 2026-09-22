'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';

function useSetTokenIfAvailable() {
  const { data: session } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
}

export interface NotificationSettings {
  id: string;
  user_id: string;
  channel: 'ntfy' | 'mattermost' | 'email';
  enabled: boolean;
  priority: number;
  config: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface Schedule {
  id: string;
  user_id: string;
  day_of_week: number;
  notification_time: string;
  occasion: string;
  enabled: boolean;
  notify_day_before: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationHistory {
  id: string;
  user_id: string;
  outfit_id?: string;
  channel: string;
  status: string;
  attempts: number;
  sent_at?: string;
  delivered_at?: string;
  error_message?: string;
  created_at: string;
}

export function useNotificationSettings() {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['notification-settings'],
    queryFn: () => api.get<NotificationSettings[]>('/notifications/settings'),
    enabled: status !== 'loading',
  });
}

export function useCreateNotificationSetting() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (data: {
      channel: 'ntfy' | 'mattermost' | 'email';
      enabled: boolean;
      priority: number;
      config: Record<string, string>;
    }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<NotificationSettings>('/notifications/settings', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
    },
  });
}

export function useUpdateNotificationSetting() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<{ enabled: boolean; priority: number; config: Record<string, string> }>;
    }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.patch<NotificationSettings>(`/notifications/settings/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
    },
  });
}

export function useDeleteNotificationSetting() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (id: string) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.delete(`/notifications/settings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
    },
  });
}

export function useTestNotificationSetting() {
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (id: string) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<{ success: boolean; message: string }>(
        `/notifications/settings/${id}/test`
      );
    },
  });
}

export function useSchedules() {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.get<Schedule[]>('/notifications/schedules'),
    enabled: status !== 'loading',
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (data: {
      day_of_week: number;
      notification_time: string;
      occasion: string;
      enabled: boolean;
      notify_day_before?: boolean;
    }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<Schedule>('/notifications/schedules', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<{ notification_time: string; occasion: string; enabled: boolean; notify_day_before: boolean }>;
    }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.patch<Schedule>(`/notifications/schedules/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (id: string) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.delete(`/notifications/schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useNotificationHistory(limit = 20) {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['notification-history', limit],
    queryFn: () => api.get<NotificationHistory[]>(`/notifications/history?limit=${limit}`),
    enabled: status !== 'loading',
  });
}

// ---- Default channels: account email + Web Push ------------------------------

export type NotificationEvent = 'friend_request' | 'friend_accepted' | 'daily_outfit';
export const NOTIFICATION_EVENTS: NotificationEvent[] = [
  'friend_request',
  'friend_accepted',
  'daily_outfit',
];
export type DefaultChannel = 'email' | 'push';

export type EventToggles = Record<NotificationEvent, boolean>;

export interface NotificationPreferences {
  email: EventToggles;
  push: EventToggles;
  email_address: string;
  email_available: boolean;
  push_available: boolean;
  vapid_public_key: string | null;
  push_devices: number;
}

const PREFS_KEY = ['notification-preferences'];

export function useNotificationPreferences() {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: PREFS_KEY,
    queryFn: () => api.get<NotificationPreferences>('/notifications/preferences'),
    enabled: status !== 'loading',
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (patch: Partial<Record<DefaultChannel, Partial<EventToggles>>>) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.patch<NotificationPreferences>('/notifications/preferences', patch);
    },
    // Optimistic: the switch flips immediately, rolls back on error.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: PREFS_KEY });
      const previous = queryClient.getQueryData<NotificationPreferences>(PREFS_KEY);
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(PREFS_KEY, {
          ...previous,
          email: { ...previous.email, ...patch.email },
          push: { ...previous.push, ...patch.push },
        });
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(PREFS_KEY, context.previous);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PREFS_KEY, data);
    },
  });
}

export function useTestPush() {
  const { data: session } = useSession();
  return useMutation({
    mutationFn: async () => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<{ sent: number; removed: number; failed: number }>(
        '/notifications/push/test'
      );
    },
  });
}
