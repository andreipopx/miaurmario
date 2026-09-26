'use client';

import { useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Loader2, Search, Shirt } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PhotoViewPicker } from '@/components/photo-view-picker';
import { useItems, useMergeItemInto } from '@/lib/hooks/use-items';
import { useTagLabel } from '@/lib/tag-labels';
import { ApiError, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ImageView, Item } from '@/lib/types';

/** What we can offer: the back and the detail. "Delante" is what the keeper already has. */
const OFFERED: readonly ImageView[] = ['back', 'detail'] as const;

/**
 * «Esta es la espalda de otra prenda»: hand one garment's photo to another.
 *
 * The reason this screen exists rather than only a tick in the post-batch pass:
 * people have been photographing fronts and backs as separate garments for as long
 * as the app has existed, and those garments are already in the wardrobe. This is
 * how they get put back together, one pair at a time, from the garment that turned
 * out to be a back.
 *
 * It says plainly which garment keeps its data and that only the photo moves,
 * because the thing that would frighten someone here is the suspicion that their
 * tags are about to be blended. They are not: the garment they pick keeps its name,
 * its type, its colour and its history, untouched, and this one's tags are dropped
 * along with it.
 *
 * One confirmation, no undo, and it says so. (The post-batch pass is the one place
 * this is reversible, because there it is still a draft until the pass is saved.)
 */
const PAGE_SIZE = 30;

export function MergeBackDialog({
  source,
  open,
  onOpenChange,
  onMerged,
}: {
  /** The garment that turns out to be a photo of another one. It will be deleted. */
  source: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: (targetId: string) => void;
}) {
  const t = useTranslations('mergeBack');
  const tagLabel = useTagLabel();
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [view, setView] = useState<ImageView>('back');
  const merge = useMergeItemInto();

  // Most recent first: the other half of a pair was almost certainly photographed
  // in the same sitting. One page used to be the whole list, which quietly hid
  // every garment past the first thirty — so the list grows on demand instead.
  const [pages, setPages] = useState(1);
  const { data, isLoading } = useItems(
    { search: query.trim() || undefined, sort_by: 'created_at', sort_order: 'desc' },
    1,
    PAGE_SIZE * pages,
    // Only while it is on screen: this dialog is mounted by the wardrobe page whether
    // or not anybody has opened it, and it was polling the whole time.
    { enabled: open }
  );

  const candidates = useMemo(
    () => (data?.items ?? []).filter((item) => item.id !== source?.id),
    [data, source?.id]
  );
  const total = Math.max(0, (data?.total ?? candidates.length) - (source ? 1 : 0));
  const hasMore = candidates.length < total;
  /**
   * The garment that was chosen, kept even when it falls out of the search.
   *
   * `target` used to be looked up in the *current* results, so picking a garment and
   * then typing in the search box made the choice evaporate: the confirm button went
   * quietly disabled and the explanation reverted to the generic one, with nothing
   * saying the selection had gone.
   */
  const chosen = useRef<Item | null>(null);
  const fromList = candidates.find((item) => item.id === targetId) ?? null;
  if (fromList) chosen.current = fromList;
  if (targetId === null) chosen.current = null;
  const target = fromList ?? (chosen.current?.id === targetId ? chosen.current : null);

  const close = () => {
    onOpenChange(false);
    setQuery('');
    setPages(1);
    setTargetId(null);
    setView('back');
  };

  const run = async () => {
    if (!source || !target) return;
    try {
      const result = await merge.mutateAsync({
        itemId: target.id,
        sourceItemId: source.id,
        view: view === 'detail' ? 'detail' : 'back',
      });
      toast.success(result.merged ? t('done', { name: nameOf(target) }) : t('nothingToDo'));
      onMerged?.(target.id);
      close();
    } catch (error) {
      // The API refuses by name when the garment has a past of its own, and that
      // refusal is the useful message — it says what is in the way.
      const blockers =
        error instanceof ApiError
          ? ((error.data as { detail?: { blockers?: string[] } } | undefined)?.detail?.blockers ??
            [])
          : [];
      if (blockers.length > 0) {
        toast.error(t('inUse', { what: blockers.map((b) => t(`blocker.${b}` as never)).join(', ') }));
      } else {
        toast.error(getErrorMessage(error, t('failed')));
      }
    }
  };

  function nameOf(item: Item): string {
    return item.name || tagLabel('types', item.type);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="px-5 pb-3 pt-5">
          <DialogTitle className="text-left">{t('title')}</DialogTitle>
          <DialogDescription className="text-left">{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
          {source && (
            <div className="mb-3 flex min-w-0 items-center gap-3 rounded-tile bg-panel p-2.5">
              <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[14px] bg-background">
                {source.thumbnail_url || source.image_url ? (
                  <Image
                    src={source.thumbnail_url || source.image_url || ''}
                    alt=""
                    fill
                    sizes="56px"
                    className="object-contain p-1"
                  />
                ) : (
                  <Shirt className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground" aria-hidden />
                )}
              </span>
              <p className="min-w-0 text-[13px] font-semibold leading-snug">
                {t('thisPhoto', { name: nameOf(source) })}
              </p>
            </div>
          )}

          <PhotoViewPicker
            idPrefix="merge-back"
            value={view}
            onChange={setView}
            className="mb-3"
            offer={OFFERED}
          />

          <label className="relative mb-2 block">
            <span className="sr-only">{t('searchLabel')}</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPages(1);
              }}
              placeholder={t('searchPlaceholder')}
              className="pl-9"
              autoComplete="off"
            />
          </label>

          {isLoading && candidates.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-muted-foreground">{t('loading')}</p>
          ) : candidates.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-muted-foreground">{t('noneFound')}</p>
          ) : (
            <ul role="radiogroup" aria-label={t('searchLabel')} className="space-y-1.5">
              {candidates.map((item) => {
                const chosen = item.id === targetId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => setTargetId(item.id)}
                      className={cn(
                        'flex min-h-[56px] w-full min-w-0 items-center gap-3 rounded-tile p-2 text-left',
                        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        chosen ? 'bg-signature-soft ring-2 ring-signature' : 'bg-panel hover:bg-accent'
                      )}
                    >
                      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[12px] bg-background">
                        {item.thumbnail_url || item.image_url ? (
                          <Image
                            src={item.thumbnail_url || item.image_url || ''}
                            alt=""
                            fill
                            sizes="44px"
                            className="object-contain p-1"
                          />
                        ) : (
                          <Shirt
                            className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground"
                            aria-hidden
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">
                          {nameOf(item)}
                        </span>
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {[
                            item.primary_color ? tagLabel('colors', item.primary_color) : null,
                            item.back_image ? t('alreadyHasBack') : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hasMore && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => setPages((p) => p + 1)}
            >
              {t('loadMore', { count: total - candidates.length })}
            </Button>
          )}
        </div>

        {/* Said before the button, not after: the one thing to understand here is
            which garment survives and that its own data is not touched. */}
        <div className="border-t border-border px-5 py-3">
          <Alert variant="signature" className="mb-3">
            <AlertDescription className="text-[13px] leading-snug">
              {target && source
                ? t('explain', { keeper: nameOf(target), gone: nameOf(source) })
                : t('explainGeneric')}
            </AlertDescription>
          </Alert>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={close}>
              {t('cancel')}
            </Button>
            <Button type="button" onClick={run} disabled={!target || merge.isPending}>
              {merge.isPending ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" aria-hidden />
              ) : null}
              {t('confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
