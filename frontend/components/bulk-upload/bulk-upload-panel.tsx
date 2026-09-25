'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ImagePlus, Loader2, RotateCcw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
 * Whether a row is worth sending. A shade on its own counts: tapping the photo to
 * get the real brown is a change even when the family stays "marrón".
 */
function hasEdit(edit: ReviewEdit): boolean {
  return Boolean(edit.type || edit.primaryColor || edit.primaryColorHex);
}

/**
 * The "muchas prendas" tab of the add dialog: pick many photos, watch the queue,
 * then run the quick pass over what landed.
 *
 * The queue itself lives in BulkUploadProvider, above the router, so closing the
 * dialog does not stop the upload — it keeps going behind the floating status bar
 * and the tab reopens onto the same batch.
 */
export function BulkUploadPanel({
  open,
  onClose,
  mode = 'batch',
}: {
  /** Whether this tab is the visible one, so the phase only resets on the way in. */
  open: boolean;
  onClose: () => void;
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
      .filter(([, edit]) => hasEdit(edit))
      .map(([itemId, edit]) => ({
        item_id: itemId,
        type: edit.type,
        primary_color: edit.primaryColor,
        // `null` is meaningful here — "drop the shade the tagger sampled" — so it
        // goes over the wire, while `undefined` means the user never touched it.
        primary_color_hex: edit.primaryColorHex ?? null,
      }));
    if (entries.length === 0) {
      if (!reviewingBacklog) reset();
      onClose();
      return;
    }
    try {
      await batchTag.mutateAsync(entries);
      toast.success(t('review.saved', { count: entries.length }));
      setEdits({});
      // The backlog pass owns no photos, so there is no queue to clear.
      if (!reviewingBacklog) reset();
      onClose();
    } catch {
      // The provider's mutation surfaces its own toast; the sheet stays open so
      // nothing the user typed is thrown away.
    }
  }, [batchTag, edits, onClose, reset, reviewingBacklog, t]);

  const startOver = useCallback(() => {
    reset();
    setEdits({});
    setPhase('pick');
  }, [reset]);

  const busy = counts.busy > 0;
  const editCount = Object.values(edits).filter(hasEdit).length;
  const hasEdits = editCount > 0;

  return (
    <div className="flex min-w-0 flex-col" data-testid="bulk-panel">
      <p className="pb-3 text-[13px] leading-snug text-muted-foreground">
        {phase === 'review' || phase === 'stepper' ? t('reviewSubtitle') : t('subtitle')}
      </p>

      {/* A plain scroller rather than ScrollArea: Radix lays its viewport out as
          a table, which lets wide rows push past the dialog at 320 px. */}
      <div className="-mx-1 min-w-0 max-h-[55vh] overflow-y-auto overflow-x-hidden px-1">
        <div className="min-w-0 pb-4">
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
                  onPickColor={(itemId, color, hex) =>
                    editOne(itemId, { primaryColor: color, primaryColorHex: hex })
                  }
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
      </div>

      {/* The picker with an empty queue has nothing to put here. */}
      {!(phase === 'pick' && photos.length === 0) && (
        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
          {phase === 'queue' && (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>
                {busy ? t('keepInBackground') : t('close')}
              </Button>
              {/* Counted from the garments, not from the queue rows: a resumed
                  batch has items whose photo rows are already gone. */}
              <Button
                type="button"
                onClick={() => setPhase('review')}
                disabled={itemIds.length === 0}
              >
                {busy
                  ? t('reviewSoFar', { count: itemIds.length })
                  : t('reviewCta', { count: itemIds.length })}
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
      )}
    </div>
  );
}
