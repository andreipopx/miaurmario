'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, Music, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';

const SOURCES = [
  { key: 'music', href: '/dashboard/music', icon: Music, tint: 'bg-pop-mint' },
  { key: 'pins', href: '/dashboard/pins', icon: Pin, tint: 'bg-pop-sky' },
] as const;

/**
 * What Stinky takes inspiration from besides your wardrobe: what you listen to
 * and what you pin. Each opens its own screen (connect, see what he picked up).
 */
export default function InspirationPage() {
  const t = useTranslations('inspiration');
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={t('title')} description={t('description')} />
      <ul className="space-y-3">
        {SOURCES.map(({ key, href, icon: Icon, tint }) => (
          <li key={key}>
            <Link
              href={href}
              className="pressable flex items-center gap-4 rounded-lg bg-panel p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-pop-foreground', tint)}>
                <Icon className="h-6 w-6" strokeWidth={2} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-bold">{t(`${key}.title`)}</span>
                <span className="block text-sm text-muted-foreground">{t(`${key}.body`)}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
