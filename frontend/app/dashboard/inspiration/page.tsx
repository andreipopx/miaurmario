'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, Music, Pin } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

const SOURCES = [
  { key: 'music', href: '/dashboard/music', icon: Music },
  { key: 'pins', href: '/dashboard/pins', icon: Pin },
] as const;

/**
 * What Stinky takes inspiration from besides your wardrobe: what you listen to
 * and what you pin. A flat list — each row opens its own screen (connect, see
 * what he picked up), and the one line under the name says which service.
 */
export default function InspirationPage() {
  const t = useTranslations('inspiration');
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={t('title')} />
      <ul className="divide-y divide-border">
        {SOURCES.map(({ key, href, icon: Icon }) => (
          <li key={key}>
            <Link
              href={href}
              className="pressable flex min-h-[64px] items-center gap-3.5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel text-foreground">
                <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-bold leading-tight">{t(`${key}.title`)}</span>
                <span className="block text-[13px] text-muted-foreground">{t(`${key}.service`)}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
