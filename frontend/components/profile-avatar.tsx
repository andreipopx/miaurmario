'use client';

/* eslint-disable @next/next/no-img-element -- signed API URL, already sized server-side */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/hooks/use-auth';
import { StinkyAvatar } from '@/components/brand/stinky-avatar';

/**
 * The signed-in user's avatar for the app chrome (header, profile menu):
 * their profile photo when they uploaded one, otherwise Stinky as before.
 */
export function ProfileAvatar({ size = 44, className }: { size?: number; className?: string }) {
  const { user } = useAuth();
  const src = user?.avatar_thumb_url || user?.avatar_url || null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) return <StinkyAvatar size={size} className={className} />;
  return (
    <span
      className={cn('inline-flex shrink-0 overflow-hidden rounded-full bg-panel', className)}
      style={{ width: size, height: size }}
    >
      <img
        src={src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        draggable={false}
        onError={() => setFailed(true)}
        className="h-full w-full select-none object-cover"
        referrerPolicy="no-referrer"
      />
    </span>
  );
}
