'use client';

/* eslint-disable @next/next/no-img-element -- album covers and pins come from their services' CDNs */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, Music, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { StinkyTip } from '@/components/stinky-tip';
import { ServiceLogo, type Service } from '@/components/brand/service-logos';
import { useInspiration } from '@/lib/hooks/use-inspiration';

/** Up to four square pictures in a row: what he picked up from that service lately. */
function Strip({ images, rounded = 'rounded-[12px]' }: { images: string[]; rounded?: string }) {
  if (images.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-4 gap-2">
      {images.slice(0, 4).map((src, i) => (
        <img
          key={`${src}-${i}`}
          src={src}
          alt=""
          loading="lazy"
          className={cn('aspect-square w-full bg-background object-cover', rounded)}
        />
      ))}
    </div>
  );
}

function SourceCard({
  href,
  icon: Icon,
  tint,
  title,
  line,
  logos,
  images,
}: {
  href: string;
  icon: typeof Music;
  tint: string;
  title: string;
  line: string;
  logos: Service[];
  images: string[];
}) {
  return (
    <Link
      href={href}
      className="pressable block rounded-lg bg-panel p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center gap-4">
        <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-pop-foreground', tint)}>
          <Icon className="h-6 w-6" strokeWidth={2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold">{title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            {logos.map((s) => (
              <ServiceLogo key={s} service={s} size={18} />
            ))}
            <span className="truncate">{line}</span>
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      </span>
      <Strip images={images} />
    </Link>
  );
}

/**
 * What Stinky takes inspiration from besides your wardrobe: what you listen to
 * and what you pin. Each card shows what he picked up lately and opens its own
 * screen; without a connection it says which service to connect.
 */
export default function InspirationPage() {
  const t = useTranslations('inspiration');
  const { music, pins } = useInspiration();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={t('title')} />
      <StinkyTip className="bg-panel">{t('tip')}</StinkyTip>
      <div className="space-y-3">
        <SourceCard
          href="/dashboard/music"
          icon={Music}
          tint="bg-pop-mint"
          title={t('music.title')}
          logos={music.loaded ? music.services : []}
          line={
            !music.connected
              ? t('music.connect')
              : music.latest
                ? t(music.playing ? 'music.playing' : 'music.last', {
                    track: music.latest.name,
                    artist: music.latest.artists[0] ?? '',
                  })
                : t('music.body')
          }
          images={music.covers}
        />
        <SourceCard
          href="/dashboard/pins"
          icon={Pin}
          tint="bg-pop-pink"
          title={t('pins.title')}
          logos={pins.loaded ? ['pinterest'] : []}
          line={pins.connected ? t('pins.count', { count: pins.count }) : t('pins.connect')}
          images={pins.images}
        />
      </div>
    </div>
  );
}
