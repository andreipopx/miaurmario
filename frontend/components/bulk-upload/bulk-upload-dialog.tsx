'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ImagePlus, Loader2, RotateCcw } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAIStatus } from '@/lib/hooks/use-ai-access';
import { useBatchItems, useBatchTagItems, useUntaggedItems } from '@/lib/hooks/use-wardrobe-stats';
import { useBulkUpload } from '@/lib/bulk-upload/bulk-upload-context';
import { PhotoPicker } from '@/components/bulk-upload/photo-picker';
import { UploadQueueList } from '@/components/bulk-upload/upload-queue-list';
import { QuickReview, type ReviewEdit, draftOf } from '@/components/bulk-upload/quick-review';
import { TagStepper } from '@/components/bulk-upload/tag-stepper';
import { needsType } from '@/components/bulk-upload/tag-choices';
import { MAX_BATCH_PHOTOS } from '@/lib/bulk-upload/queue';

type Phase = 'pick' | 'queue' | 'review' | 'stepper';

/**
 * The whole bulk flow in one sheet: pick many photos, watch the queue, then run
 * the quick pass over what landed.
 *
 * The queue itself lives in BulkUploadProvider, above the router, so closing this
 * sheet does not stop the upload — it keeps going behind the floating status bar
 * and the sheet reopens onto the same batch.
 */
export function BulkUploadDialog({
  open,
  onOpenChange,
  mode = 'batch',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `batch` is the upload flow. `untagged` opens straight into the quick pass over
   * every garment the tagger never named — the same screen, pointed at the backlog
   * instead of at the batch just uploaded.
   */
  mode?: 'batch' | 'untagged';
}) {
  const t = useTranslations('bulkUpload');
  const {
    photos,
    counts,
    itemIds,
    skipAi,
    setSkipAi,
    lastRejected,
    addFiles,
    retry,
    retryFailed,
    remove,
    reset,
    resumedBatch,
    acknowledgeResume,
  } = useBulkUpload();
  const { data: aiStatus } = useAIStatus();
  const hasVision = aiStatus?.capabilities?.vision !== false;
  const batchTag = useBatchTagItems();

  const [phase, setPhase] = useState<Phase>('pick');
  const [edits, setEdits] = useState<Record<string, ReviewEdit>>({});
  const [stepperStart, setStepperStart] = useState(0);

  // Read back from the server, so the grid shows the tags the worker wrote rather
  // than whatever the client happened to see last.
  const reviewingBacklog = mode === 'untagged';
  const batch = useBatchItems(reviewingBacklog ? [] : itemIds);
  const backlog = useUntaggedItems(reviewingBacklog && open);
  const loadingBatch = reviewingBacklog ? backlog.isLoading : batch.isLoading;

  const items = useMemo(() => {
    const source = reviewingBacklog ? (backlog.data?.items ?? []) : (batch.data?.items ?? []);
    const byId = new Map(source.map((item) => [item.id, item]));
    const ordered = reviewingBacklog
      ? source
      : itemIds.map((id) => byId.get(id)).filter((item) => item !== undefined);
    // The ones that still need a type come first: that is the actual work.
    return [
      ...ordered.filter((item) => needsType(edits[item.id]?.type ?? item.type)),
      ...ordered.filter((item) => !needsType(edits[item.id]?.type ?? item.type)),
    ];
  }, [backlog.data, batch.data, itemIds, edits, reviewingBacklog]);

  // Only on the way in: once the sheet is open the user drives the phase, so
  // "Subir prendas" from the backlog pass really does reach the picker.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current) {
      wasOpen.current = true;
      setPhase(reviewingBacklog ? 'review' : photos.length === 0 ? 'pick' : 'queue');
      return;
    }
    if (!reviewingBacklog && phase === 'pick' && photos.length > 0) setPhase('queue');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, photos.length, reviewingBacklog]);

  useEffect(() => {
    if (open && resumedBatch) {
      toast.info(t('resumed', { count: photos.length }));
      acknowledgeResume();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resumedBatch]);

  const editOne = useCallback((itemId: string, changes: ReviewEdit) => {
    setEdits((current) => ({ ...current, [itemId]: { ...current[itemId], ...changes } }));
  }, []);

  const save = useCallback(async () => {
    const entries = Object.entries(edits)
      .filter(([, edit]) => edit.type || edit.primaryColor)
      .map(([itemId, edit]) => ({
        item_id: itemId,
        type: edit.type,
        primary_color: edit.primaryColor,
      }));
    if (entries.length === 0) {
      if (!reviewingBacklog) reset();
      onOpenChange(false);
      return;
    }
    try {
      await batchTag.mutateAsync(entries);
      toast.success(t('review.saved', { count: entries.length }));
      setEdits({});
      // The backlog pass owns no photos, so there is no queue to clear.
      if (!reviewingBacklog) reset();
      onOpenChange(false);
    } catch {
      // The provider's mutation surfaces its own toast; the sheet stays open so
      // nothing the user typed is thrown away.
    }
  }, [batchTag, edits, onOpenChange, reset, reviewingBacklog, t]);

  const startOver = useCallback(() => {
    reset();
    setEdits({});
    setPhase('pick');
  }, [reset]);

  const busy = counts.busy > 0;
  const editCount = Object.values(edits).filter((edit) => edit.type || edit.primaryColor).length;
  const hasEdits = editCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="px-4 pb-2 pt-5 text-left sm:px-6">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {phase === 'review' || phase === 'stepper' ? t('reviewSubtitle') : t('subtitle')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-4 sm:px-6">
          <div className="pb-4">
            {phase === 'pick' && (
              <PhotoPicker
                onPick={addFiles}
                queued={photos.length}
                rejected={lastRejected}
                canSkipAi={hasVision}
                skipAi={skipAi}
                onSkipAiChange={setSkipAi}
              />
            )}

            {phase === 'queue' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 rounded-lg bg-panel px-3 py-2">
                  <p className="text-[14px] font-semibold" aria-live="polite">
                    {busy
                      ? t('progress', { done: counts.saved + counts.duplicate, total: counts.total })
                      : t('finished', { saved: counts.saved, total: counts.total })}
                  </p>
                  {busy && (
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
                      aria-hidden
                    />
                  )}
                </div>

                {!hasVision && (
                  <Alert variant="signature">
                    <AlertDescription className="text-[13px] leading-snug">
                      {t('noAiNotice')}
                    </AlertDescription>
                  </Alert>
                )}

                {counts.failed > 0 && (
                  <Button type="button" variant="secondary" size="sm" onClick={retryFailed}>
                    <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden />
                    {t('retryAll', { count: counts.failed })}
                  </Button>
                )}

                <UploadQueueList photos={photos} onRetry={retry} onRemove={remove} />

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPhase('pick')}
                  disabled={photos.length >= MAX_BATCH_PHOTOS}
                >
                  <ImagePlus className="h-4 w-4" strokeWidth={2} aria-hidden />
                  {t('addMore')}
                </Button>
              </div>
            )}

            {phase === 'review' &&
              (loadingBatch && items.length === 0 ? (
                <p className="py-6 text-center text-[14px] text-muted-foreground">{t('loading')}</p>
              ) : (
                <QuickReview
                  items={items}
                  edits={edits}
                  onEditOne={(index) => {
                    setStepperStart(index);
                    setPhase('stepper');
                  }}
                  onStartStepper={() => {
                    setStepperStart(0);
                    setPhase('stepper');
                  }}
                />
              ))}

            {phase === 'stepper' && (
              <TagStepper
                drafts={items.map((item) => draftOf(item, edits[item.id]))}
                startAt={stepperStart}
                onChange={editOne}
                onDone={() => setPhase('review')}
              />
            )}
          </div>
        </ScrollArea>

        <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
          {phase === 'queue' && (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {busy ? t('keepInBackground') : t('close')}
              </Button>
              <Button
                type="button"
                onClick={() => setPhase('review')}
                disabled={counts.saved === 0}
              >
                {busy
                  ? t('reviewSoFar', { count: counts.saved })
                  : t('reviewCta', { count: counts.saved })}
              </Button>
            </>
          )}

          {phase === 'review' && (
            <>
              <Button type="button" variant="ghost" onClick={startOver}>
                {reviewingBacklog ? t('cta') : t('uploadMore')}
              </Button>
              <Button type="button" onClick={save} disabled={batchTag.isPending}>
                {batchTag.isPending ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" aria-hidden />
                ) : null}
                {hasEdits ? t('review.save', { count: editCount }) : t('review.done')}
              </Button>
            </>
          )}

          {phase === 'stepper' && (
            <Button type="button" variant="secondary" onClick={() => setPhase('review')}>
              {t('stepper.backToGrid')}
            </Button>
          )}

          {phase === 'pick' && photos.length > 0 && (
            <Button type="button" onClick={() => setPhase('queue')}>
              {t('seeQueue')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
