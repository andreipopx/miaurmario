'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
  BookmarkPlus,
  CalendarPlus,
  ChevronLeft,
  Loader2,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useDateFnsLocale, useFormatDate } from '@/lib/date-locale';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LineageCard } from '@/components/shared/lineage-card';
import { OutfitSharingPanel } from '@/components/social/outfit-sharing-panel';
import { StinkyTip } from '@/components/stinky-tip';
import { CloneToLookbookDialog } from '@/components/shared/clone-to-lookbook-dialog';
import { CanvasPreview } from '@/components/studio/canvas-panel';
import { hasCanvasLayout } from '@/lib/studio/editor-state';
import { useDeleteOutfit, useOutfit, useOutfits } from '@/lib/hooks/use-outfits';
import { useWearToday } from '@/lib/hooks/use-studio';
import { getErrorMessage } from '@/lib/api';

export default function OutfitDetailPage() {
  const t = useTranslations('outfitDetail');
  const tOccasions = useTranslations('suggest.occasions');
  const dateFnsLocale = useDateFnsLocale();
  const formatDate = useFormatDate();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const outfitId = params?.id;

  const { data: outfit, isLoading } = useOutfit(outfitId);
  const deleteMutation = useDeleteOutfit();
  const wearTodayMutation = useWearToday(outfitId ?? '');

  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);

  const isTemplate =
    outfit !== undefined && outfit !== null && outfit.scheduled_for === null;
  const isWorn = !!outfit?.feedback?.worn_at;

  const { data: wearInstancesData } = useOutfits(
    isTemplate && outfitId ? { cloned_from_outfit_id: outfitId } : {},
    1,
    10
  );

  if (isLoading || !outfit) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-40 rounded-full" />
        <Skeleton className="h-9 w-64 rounded-full" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  const handleWearToday = async () => {
    try {
      const result = await wearTodayMutation.mutateAsync({});
      toast.success(t('toast.addedToday'));
      router.push(`/dashboard/outfits/${result.id}`);
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.addedTodayFailed')));
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('confirmDelete'))) return;
    try {
      await deleteMutation.mutateAsync(outfit.id);
      toast.success(t('toast.deleted'));
      router.push('/dashboard/outfits');
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.deleteFailed')));
    }
  };

  const occasionLabel = tOccasions.has(outfit.occasion as never)
    ? tOccasions(outfit.occasion as never)
    : outfit.occasion;
  const sourceLabel = t.has(`source.${outfit.source}` as never)
    ? t(`source.${outfit.source}` as never)
    : outfit.source.replace('_', ' ');
  const title = outfit.name || outfit.reasoning || t('titleFallback', { occasion: occasionLabel });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 h-11">
          <Link href="/dashboard/outfits">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            {t('backToOutfits')}
          </Link>
        </Button>
      </div>

      <div className="space-y-3">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] first-letter:uppercase sm:text-3xl">
          {title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="amber">{occasionLabel}</Badge>
          <Badge variant="secondary">{sourceLabel}</Badge>
          <span className="text-sm text-muted-foreground">
            {outfit.scheduled_for
              ? formatDistanceToNow(parseISO(outfit.scheduled_for), {
                  addSuffix: true,
                  locale: dateFnsLocale,
                })
              : t('lookbookTemplate')}
          </span>
        </div>

        {/* AI reasoning */}
        {((outfit.name && outfit.reasoning) ||
          (outfit.highlights && outfit.highlights.length > 0)) && (
          <div className="space-y-2 text-sm">
            {outfit.name && outfit.reasoning && (
              <p className="break-words font-medium text-foreground">{outfit.reasoning}</p>
            )}
            {outfit.highlights && outfit.highlights.length > 0 && (
              <ul className="space-y-1">
                {outfit.highlights.slice(0, 3).map((highlight, index) => (
                  <li key={index} className="flex items-start gap-2 text-muted-foreground">
                    <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-signature" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Styling tip */}
        {outfit.style_notes && (
          <StinkyTip className="bg-panel">{outfit.style_notes}</StinkyTip>
        )}
      </div>

      <LineageCard outfit={outfit} />

      {hasCanvasLayout(outfit.items) && (
        <div className="pb-2">
          <CanvasPreview
            items={outfit.items.map((item) => ({
              id: item.id,
              type: item.type,
              name: item.name,
              thumbnail_url: item.thumbnail_url ?? null,
              image_url: item.image_url ?? null,
              primary_color: item.primary_color,
              pos_x: item.pos_x ?? null,
              pos_y: item.pos_y ?? null,
              scale: item.scale,
              rotation: item.rotation,
              z_index: item.z_index,
            }))}
          />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">
          {t('itemsCount', { count: outfit.items.length })}
        </h2>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {outfit.items.map((item) => (
            <Link
              key={item.id}
              href={`/dashboard/wardrobe?itemId=${item.id}`}
              className="group rounded-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="relative aspect-square overflow-hidden rounded-tile bg-panel">
                {item.thumbnail_url || item.image_url ? (
                  <Image
                    src={(item.thumbnail_url || item.image_url)!}
                    alt={item.name || item.type}
                    fill
                    className="object-contain p-2 transition-transform duration-200 group-hover:scale-[1.03]"
                    sizes="(max-width: 640px) 33vw, 20vw"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-xs text-muted-foreground">
                      {item.type}
                    </span>
                  </div>
                )}
              </div>
              <p className="mt-1.5 truncate text-[13px] font-semibold">
                {item.name || item.type}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {isTemplate && (
          <Button onClick={handleWearToday} disabled={wearTodayMutation.isPending}>
            {wearTodayMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CalendarPlus className="h-4 w-4" />
            )}
            {t('wearToday')}
          </Button>
        )}
        {!isTemplate && (
          <Button variant="secondary" onClick={() => setCloneDialogOpen(true)}>
            <BookmarkPlus className="h-4 w-4" />
            {t('saveToLookbook')}
          </Button>
        )}
        {!isWorn && (
          <Button variant="secondary" asChild>
            <Link href={`/dashboard/outfits/new?edit=${outfit.id}`}>
              <Pencil className="h-4 w-4" />
              {t('edit')}
            </Link>
          </Button>
        )}
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="h-4 w-4" />
          {t('delete')}
        </Button>
      </div>

      <OutfitSharingPanel outfitId={outfit.id} visibility={outfit.visibility ?? 'private'} />

      {isTemplate && wearInstancesData && wearInstancesData.total > 0 && (
        <Card className="border-0 bg-panel">
          <CardContent className="p-4 sm:p-5">
            <h2 className="mb-3 text-lg font-bold">
              {t('wornCount', { count: wearInstancesData.total })}
            </h2>
            <div className="space-y-2">
              {wearInstancesData.outfits.map((wear) => (
                <Link
                  key={wear.id}
                  href={`/dashboard/outfits/${wear.id}`}
                  className="flex min-h-[44px] items-center justify-between rounded-full bg-background px-4 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="text-sm font-medium">
                    {wear.scheduled_for
                      ? formatDate(parseISO(wear.scheduled_for), 'medium')
                      : t('undated')}
                  </span>
                  {wear.feedback?.rating && (
                    <div className="flex items-center gap-1 text-xs font-semibold">
                      <Star className="h-3.5 w-3.5 fill-pop-amber text-pop-amber" />
                      {wear.feedback.rating}
                    </div>
                  )}
                </Link>
              ))}
            </div>
            {wearInstancesData.has_more && (
              <Button variant="link" size="sm" asChild className="mt-3">
                <Link href={`/dashboard/outfits?filter=worn&cloned_from=${outfit.id}`}>
                  {t('seeAll')}
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {isTemplate && wearInstancesData && wearInstancesData.total === 0 && (
        <Alert variant="signature">
          <AlertDescription className="text-sm text-foreground">
            {t('notWornYet')}
          </AlertDescription>
        </Alert>
      )}

      {!isTemplate && (
        <CloneToLookbookDialog
          open={cloneDialogOpen}
          sourceOutfitId={outfit.id}
          sourceOccasion={outfit.occasion}
          onClose={() => setCloneDialogOpen(false)}
          onSuccess={(newId) => router.push(`/dashboard/outfits/${newId}`)}
        />
      )}
    </div>
  );
}
