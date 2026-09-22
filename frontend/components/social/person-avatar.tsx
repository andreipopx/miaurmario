'use client';

/* eslint-disable @next/next/no-img-element -- signed API URLs / external (OIDC) avatars */

import { useEffect, useState } from 'react';
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
  const source = (user.username || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 1);
  return letters.toUpperCase();
}

type AvatarUser = Pick<PublicUser, 'display_name' | 'username' | 'avatar_url'> & {
  avatar_thumb_url?: string | null;
};

/** Small sizes use the 128px thumb; big ones (profile header) the 512px photo. */
export function avatarSrcFor(user: AvatarUser, size: number): string | null {
  if (size <= 64) return user.avatar_thumb_url || user.avatar_url || null;
  return user.avatar_url || user.avatar_thumb_url || null;
}

/** A person's avatar: their photo, or their initial on a pop-colour circle. */
export function PersonAvatar({
  user,
  size = 40,
  className,
}: {
  user: AvatarUser;
  size?: number;
  className?: string;
}) {
  const src = avatarSrcFor(user, size);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showPhoto = !!src && !failed;
  const color = popColorAt(colorIndexFor(user.username || user.display_name));
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-extrabold text-pop-foreground',
        showPhoto ? 'bg-panel' : POP_BG[color],
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {showPhoto ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full select-none object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        initialsFor(user)
      )}
    </span>
  );
}
