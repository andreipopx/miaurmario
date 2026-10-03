'use client';

import { UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/hooks/use-auth';
import { PersonAvatar } from '@/components/social/person-avatar';

/**
 * The signed-in user's avatar for the app chrome (header, profile menu): their
 * profile photo, or without one their initial on their colour, exactly as their
 * friends see them. Stinky is the stylist, not the user, so he doesn't stand in.
 */
export function ProfileAvatar({ size = 44, className }: { size?: number; className?: string }) {
  const { user } = useAuth();
  if (!user) {
    // Not loaded yet: a neutral "no photo" circle of the same size.
    return (
      <span
        aria-hidden
        className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-panel text-muted-foreground', className)}
        style={{ width: size, height: size }}
      >
        <UserRound style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <PersonAvatar
      user={{
        username: user.username ?? '',
        display_name: user.display_name,
        avatar_url: user.avatar_url ?? null,
        avatar_thumb_url: user.avatar_thumb_url ?? null,
      }}
      size={size}
      className={className}
    />
  );
}
