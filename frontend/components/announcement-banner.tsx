'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Megaphone, X } from 'lucide-react';

import { dismissAnnouncement, isAnnouncementDismissed } from '@/lib/admin';
import { useAnnouncement } from '@/lib/hooks/use-admin';
import { cn } from '@/lib/utils';

/** Global admin announcement, dismissible per announcement id (stored locally). */
export function AnnouncementBanner() {
  const t = useTranslations('announcement');
  const { data } = useAnnouncement();
  const announcement = data?.announcement ?? null;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(announcement ? isAnnouncementDismissed(announcement.id) : true);
  }, [announcement]);

  if (!announcement || dismissed) return null;
  if (announcement.expires_at && new Date(announcement.expires_at) <= new Date()) return null;

  const warning = announcement.level === 'warning';
  const Icon = warning ? AlertTriangle : Megaphone;

  return (
    <div
      role={warning ? 'alert' : 'status'}
      className={cn(
        'mb-3 flex items-start gap-3 rounded-lg p-3 pl-4 text-sm',
        warning ? 'bg-pop-amber text-pop-foreground' : 'bg-signature-soft text-foreground'
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words font-medium">{announcement.text}</p>
      <button
        type="button"
        onClick={() => {
          dismissAnnouncement(announcement.id);
          setDismissed(true);
        }}
        className="-my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('dismiss')}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
