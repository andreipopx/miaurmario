'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePairings } from '@/lib/hooks/use-pairings';
import { useItemTypes } from '@/lib/hooks/use-items';
import { PairingCard } from '@/components/pairing-card';
import { FeedbackDialog } from '@/components/feedback-dialog';
import { OutfitPreviewDialog } from '@/components/outfit-preview-dialog';
import { Pairing } from '@/lib/types';
import { Outfit } from '@/lib/hooks/use-outfits';
import { useTranslations } from 'next-intl';

function EmptyPairings() {
  const t = useTranslations('pairings');
  return (
    <EmptyState
      state="sleepy"
      title={t('emptyTitle')}
      description={t('emptyBody')}
      action={
        <Button variant="signature" asChild>
          <Link href="/dashboard/wardrobe">{t('goToWardrobe')}</Link>
        </Button>
      }
    />
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i}>
          <CardContent className="p-4 sm:p-4">
            <div className="mb-3 flex items-start justify-between">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-6 rounded-full" />
            </div>
            <Skeleton className="mb-3 h-16 w-full rounded-[18px]" />
            <div className="flex gap-2">
              {[1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-16 w-16 rounded-[14px]" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function PairingsPage() {
  const t = useTranslations('pairings');
  const [page, setPage] = useState(1);
  const [sourceType, setSourceType] = useState<string | undefined>(undefined);
  const [feedbackOutfit, setFeedbackOutfit] = useState<Outfit | null>(null);
  const [previewOutfit, setPreviewOutfit] = useState<Outfit | null>(null);

  const { data, isLoading, isError } = usePairings(page, 20, sourceType);
  const { data: itemTypes } = useItemTypes();

  const handleSourceTypeChange = (value: string) => {
    setSourceType(value === 'all' ? undefined : value);
    setPage(1);
  };

  if (isError) {
    return (
      <EmptyState state="sad" title={t('loadError')} />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={sourceType || 'all'} onValueChange={handleSourceTypeChange}>
          <SelectTrigger className="h-11 w-[200px]" aria-label={t('allItemTypes')}>
            <SelectValue placeholder={t('allItemTypes')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allItemTypes')}</SelectItem>
            {itemTypes?.map((type) => (
              <SelectItem key={type.type} value={type.type}>
                {t('itemTypeOption', { type: type.type, count: type.count })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data && (
          <p className="text-sm font-medium text-muted-foreground">
            {t('pairingCount', { count: data.total })}
          </p>
        )}
      </div>

      {/* Pairings grid */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : !data || data.pairings.length === 0 ? (
        <EmptyPairings />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.pairings.map((pairing) => (
              <PairingCard
                key={pairing.id}
                pairing={pairing}
                onFeedback={() => setFeedbackOutfit(pairing as unknown as Outfit)}
                onPreview={() => setPreviewOutfit(pairing as unknown as Outfit)}
              />
            ))}
          </div>

          {/* Pagination */}
          {data.has_more && (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                onClick={() => setPage((p) => p + 1)}
              >
                {t('loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Feedback dialog */}
      {feedbackOutfit && (
        <FeedbackDialog
          outfit={feedbackOutfit}
          open={!!feedbackOutfit}
          onClose={() => setFeedbackOutfit(null)}
        />
      )}

      {/* Preview dialog */}
      {previewOutfit && (
        <OutfitPreviewDialog
          outfit={previewOutfit}
          open={!!previewOutfit}
          onClose={() => setPreviewOutfit(null)}
        />
      )}
    </div>
  );
}
