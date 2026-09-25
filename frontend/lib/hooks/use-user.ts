'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken, getAccessToken, ApiError, NetworkError } from '@/lib/api';

export interface UserProfile {
  id: string;
  email: string;
  username?: string | null;
  bio?: string | null;
  display_name: string;
  avatar_url?: string | null;
  avatar_thumb_url?: string | null;
  /** True when avatar_url is a photo the user uploaded (can be removed). */
  has_avatar_photo?: boolean;
  timezone: string;
  /**
   * "auto" when we detected the zone, "manual" once the user picked one.
   * Absent on old backends, which means "treat it as manual" (never clobber).
   */
  timezone_source?: 'auto' | 'manual' | string;
  location_lat?: number;
  location_lon?: number;
  location_name?: string;
  family_id?: string;
  role: string;
  onboarding_completed: boolean;
  body_measurements?: Record<string, number | string> | null;
  has_password?: boolean;
  password_updated_at?: string | null;
  /** First-run guidance already shown (welcome tour, area tips). Absent on old backends. */
  seen_tips?: string[];
}

export interface UserProfileUpdate {
  display_name?: string;
  username?: string;
  bio?: string | null;
  timezone?: string;
  location_lat?: number;
  location_lon?: number;
  location_name?: string;
  body_measurements?: Record<string, number | string> | null;
}

function useSetTokenIfAvailable() {
  const { data: session } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
}

export function useUserProfile() {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['user-profile'],
    queryFn: () => api.get<UserProfile>('/users/me'),
    enabled: status !== 'loading',
  });
}

export function useUpdateUserProfile() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (data: UserProfileUpdate) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.patch<UserProfile>('/users/me', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
    },
  });
}

export interface AvatarCrop {
  x: number;
  y: number;
  size: number;
}

function invalidateAvatarViews(queryClient: ReturnType<typeof useQueryClient>, profile: UserProfile) {
  queryClient.setQueryData(['auth-user'], profile);
  queryClient.setQueryData(['user-profile'], profile);
  // Friends lists, feed and profiles embed the photo URL.
  queryClient.invalidateQueries({ queryKey: ['friends'] });
  queryClient.invalidateQueries({ queryKey: ['social'] });
  queryClient.invalidateQueries({ queryKey: ['family'] });
}

/** Upload (or replace) the profile photo; `crop` is in pixels of the upright image. */
export function useUploadAvatar() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ file, crop }: { file: Blob; crop?: AvatarCrop | null }) => {
      const token = (session?.accessToken as string | undefined) || getAccessToken();
      const form = new FormData();
      form.append('image', file, file instanceof File ? file.name : 'avatar');
      if (crop) {
        form.append('crop_x', String(crop.x));
        form.append('crop_y', String(crop.y));
        form.append('crop_size', String(crop.size));
      }
      let response: Response;
      try {
        response = await fetch('/api/v1/users/me/avatar', {
          method: 'PUT',
          body: form,
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } catch {
        throw new NetworkError();
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(
          typeof data.detail === 'string' ? data.detail : 'upload_failed',
          response.status,
          data
        );
      }
      return (await response.json()) as UserProfile;
    },
    onSuccess: (profile) => invalidateAvatarViews(queryClient, profile),
  });
}

export function useDeleteAvatar() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async () => {
      if (session?.accessToken) setAccessToken(session.accessToken as string);
      return api.delete<UserProfile>('/users/me/avatar');
    },
    onSuccess: (profile) => invalidateAvatarViews(queryClient, profile),
  });
}
