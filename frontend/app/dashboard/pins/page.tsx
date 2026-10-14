'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Loader2, Wand2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { usePinterestPins } from '@/lib/hooks/use-pinterest';

// A pin opens «Recrea este look con mi ropa» (/dashboard/pins/recreate); the corner
// button still opens it on Pinterest.

const PAGE_SIZE = 60;

export default function PinsPage() {
  const t = useTranslations('pins');
  const [offset, setOffset] = useState(0);
  const query = usePinterestPins(PAGE_SIZE, offset);

  return (
    <div className="space-y-6 py-2 sm:py-4">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <Button variant="outline" asChild>
            <Link href="/dashboard/settings/integrations/pinterest">{t('manageConnection')}</Link>
          </Button>
        }
      />

      {query.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
        </div>
      )}

      {query.data && query.data.items.length === 0 && (
        <EmptyState
          state="sleepy"
          title={t('empty')}
          action={
            <Button asChild>
              <Link href="/dashboard/settings/integrations/pinterest">{t('connectCta')}</Link>
            </Button>
          }
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <>
          <div
            className="grid grid-cols-1 gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
          >
            {query.data.items.map((pin) => (
              <div key={pin.id} className="group relative">
                {/* The pin itself opens «Recrea este look con mi ropa». */}
                <Link
                  href={`/dashboard/pins/recreate?pin=${pin.id}`}
                  aria-label={t('recreateLabel', { what: pin.description || t('thisPin') })}
                  className="block overflow-hidden rounded-tile bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div
                    className="relative aspect-[3/4] overflow-hidden rounded-tile"
                    style={{ backgroundColor: pin.dominant_color ?? undefined }}
                  >
                    <Image
                      src={pin.image_url}
                      alt={pin.description ?? ''}
                      fill
                      sizes="(max-width: 768px) 50vw, 180px"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                    <span className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1.5 rounded-full bg-background/95 px-3 py-2 text-xs font-bold shadow-sm">
                      <Wand2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      {t('recreate')}
                    </span>
                  </div>
                  {pin.description && (
                    <p className="line-clamp-2 px-3 py-2 text-xs text-foreground">{pin.description}</p>
                  )}
                </Link>
                <a
                  href={pin.source_link ?? pin.image_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={t('openPin')}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                </a>
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
            >
              {t('previous')}
            </Button>
            <Button
              variant="secondary"
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
