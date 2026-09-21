'use client';

/* eslint-disable @next/next/no-img-element -- avatars may be external (OIDC) URLs */

import { cn } from '@/lib/utils';
import { POP_BG, popColorAt } from '@/components/chip';
import type { PublicUser } from '@/lib/hooks/use-social';

/** Stable pop colour per username (amber → sky → pink → mint). */
export function colorIndexFor(username: string): number {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0;
  return Math.abs(h) % 4;
}

export function initialsFor(user: Pick<PublicUser, 'display_name' | 'username'>): string {
  const source = (user.display_name || user.username || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 1);
  return letters.toUpperCase();
}

/** A friend's avatar: their picture, or their initial on a pop-colour circle. */
export function PersonAvatar({
  user,
  size = 40,
  className,
}: {
  user: Pick<PublicUser, 'display_name' | 'username' | 'avatar_url'>;
  size?: number;
  className?: string;
}) {
  const color = popColorAt(colorIndexFor(user.username || user.display_name));
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-extrabold text-pop-foreground',
        !user.avatar_url && POP_BG[color],
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {user.avatar_url ? (
        <img src={user.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initialsFor(user)
      )}
    </span>
  );
}
