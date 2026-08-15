'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { usePinterestPins } from '@/lib/hooks/use-pinterest';

// TODO(sprint-future): allow dropping a pin into the Outfit Studio as an
// inspiration layer. Deferred so this sprint doesn't touch outfit models.

const PAGE_SIZE = 60;

export default function PinsPage() {
  const t = useTranslations('pins');
  const [offset, setOffset] = useState(0);
  const query = usePinterestPins(PAGE_SIZE, offset);

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="font-serif text-3xl">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="ghost" asChild>
          <Link href="/dashboard/settings/integrations/pinterest">{t('manageConnection')}</Link>
        </Button>
      </div>

      {query.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
        </div>
      )}

      {query.data && query.data.items.length === 0 && (
        <div className="rounded border border-border-solid/40 p-8 text-center text-muted-foreground">
          <p>{t('empty')}</p>
          <Button asChild className="mt-4">
            <Link href="/dashboard/settings/integrations/pinterest">{t('connectCta')}</Link>
          </Button>
        </div>
      )}

      {query.data && query.data.items.length > 0 && (
        <>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
          >
            {query.data.items.map((pin) => (
              <a
                key={pin.id}
                href={pin.source_link ?? pin.image_url}
                target="_blank"
                rel="noreferrer noopener"
                className="group relative block overflow-hidden rounded"
                style={{ backgroundColor: pin.dominant_color ?? 'transparent' }}
              >
                <div className="relative aspect-[3/4]">
                  <Image
                    src={pin.image_url}
                    alt={pin.description ?? ''}
                    fill
                    sizes="(max-width: 768px) 50vw, 180px"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                {pin.source_link && (
                  <span className="absolute right-2 top-2 rounded bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <ExternalLink className="h-3 w-3" />
                  </span>
                )}
                {pin.description && (
                  <p className="line-clamp-2 px-2 py-1 text-xs text-foreground">
                    {pin.description}
                  </p>
                )}
              </a>
            ))}
          </div>

          <div className="flex justify-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
            >
              {t('previous')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={query.data.items.length < PAGE_SIZE}
            >
              {t('next')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
