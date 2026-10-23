'use client';

/* eslint-disable @next/next/no-img-element -- album covers and pins come from their services' CDNs */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Music, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInspiration } from '@/lib/hooks/use-inspiration';

function Tile({
  href,
  icon: Icon,
  tint,
  title,
  line,
  images,
}: {
  href: string;
  icon: typeof Music;
  tint: string;
  title: string;
  line: string;
  images: string[];
}) {
  return (
    <Link
      href={href}
      className={cn(
        'pressable flex min-h-[112px] flex-col justify-between rounded-lg p-3.5 text-pop-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tint
      )}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[15px] font-bold">
          <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
          {title}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[12.5px] font-semibold leading-snug opacity-80">{line}</span>
      </span>
      {images.length > 0 && (
        <span className="mt-2 flex -space-x-2" aria-hidden>
          {images.slice(0, 3).map((src, i) => (
            <img
              key={`${src}-${i}`}
              src={src}
              alt=""
              loading="lazy"
              className="h-9 w-9 rounded-[10px] object-cover ring-2 ring-white/70"
            />
          ))}
        </span>
      )}
    </Link>
  );
}

/** Hoy: your music and your Pinterest boards, one tap away, in their colours. */
export function InspirationTiles() {
  const t = useTranslations('inspiration');
  const { music, pins } = useInspiration();
  if (!music.loaded && !pins.loaded) return null;

  return (
    <section aria-label={t('title')} className="grid grid-cols-2 gap-3" data-testid="inspiration-tiles">
      <Tile
        href="/dashboard/music"
        icon={Music}
        tint="bg-pop-mint"
        title={t('music.title')}
        line={
          !music.connected
            ? t('music.connect')
            : music.latest
              ? `${music.latest.name} · ${music.latest.artists[0] ?? ''}`
              : t('music.body')
        }
        images={music.covers}
      />
      <Tile
        href="/dashboard/pins"
        icon={Pin}
        tint="bg-pop-pink"
        title={t('pins.title')}
        line={pins.connected ? t('pins.count', { count: pins.count }) : t('pins.connect')}
        images={pins.images}
      />
    </section>
  );
}
