'use client';

import { useTranslations } from 'next-intl';
import { useFeedToday } from '@/lib/hooks/use-social';
import { OutfitCard } from '@/components/outfit-card';
import { Button } from '@/components/ui/button';

export default function FeedPage() {
  const t = useTranslations('feed');
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, error } = useFeedToday();

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display italic text-3xl sm:text-4xl">{t('title')}</h1>
        <p className="label-editorial text-muted-foreground">{t('subtitle')}</p>
      </header>

      {isLoading && <p className="label-editorial text-muted-foreground">{t('loading')}</p>}
      {error && <p className="label-editorial text-destructive">{t('error')}</p>}
      {!isLoading && items.length === 0 && (
        <p className="label-editorial text-muted-foreground">{t('empty')}</p>
      )}

      <div className="flex flex-col gap-4">
        {items.map((outfit) => (
          <OutfitCard key={outfit.id} outfit={outfit} />
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            variant="ghost"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
