'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ImagePlus, Loader2, RotateCcw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAIStatus } from '@/lib/hooks/use-ai-access';
import { useBatchItems, useBatchTagItems, useUntaggedItems } from '@/lib/hooks/use-wardrobe-stats';
import { useMergeItemInto } from '@/lib/hooks/use-items';
import { useRotationQueue } from '@/lib/hooks/use-rotation-queue';
import { useBulkUpload } from '@/lib/bulk-upload/bulk-upload-context';
import { PhotoPicker } from '@/components/bulk-upload/photo-picker';
import { UploadQueueList } from '@/components/bulk-upload/upload-queue-list';
import { QuickReview, type ReviewEdit, draftOf } from '@/components/bulk-upload/quick-review';
import { TagStepper } from '@/components/bulk-upload/tag-stepper';
import { needsType } from '@/components/bulk-upload/tag-choices';
import type { TagChanges } from '@/components/bulk-upload/tag-fields';
import type { QueuedPhoto } from '@/lib/bulk-upload/queue';
import type { BackPairings } from '@/lib/bulk-upload/back-pairing';
import { MAX_BATCH_PHOTOS } from '@/lib/bulk-upload/queue';

type Phase = 'pick' | 'queue' | 'review' | 'stepper';

/**
 * An edit worth sending. An empty style list is a deliberate "none", and so is a
 * `null` shade: pointing at the garment to get the real brown is a change even
 * when the family stays "marrón", and so is dropping that shade again.
 */
function hasContent(edit: ReviewEdit): boolean {
  return (
    Boolean(edit.type || edit.primaryColor || edit.formality || edit.style) ||
    edit.primaryColorHex !== undefined ||
    // `null` is a real answer here too: "it is a plain one of its type after all".
    edit.subtype !== undefined
  );
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
  /** Which review tile has its tag editor open. */
  const [openTile, setOpenTile] = useState<string | null>(null);
  /**
   * Straightening, optimistically.
   *
   * The signed image URL changes on every read, so a refetch does show the turned
   * photo — but not before it arrives, and waiting for it made rotating a batch a
   * sequence of little waits. The queue turns the thumbnail the instant the button
   * is pressed and settles the server up behind it, collapsing a flurry of taps into
   * one request per garment.
   */
  /**
   * One "girada y guardada" per flurry, not one per garment.
   *
   * Straightening eight photos in a queue produced eight identical toasts stacked up
   * the screen, while the failure path in the queue itself is deliberately throttled
   * to one — twenty toasts is not twenty pieces of information either way round.
   */
  const savedToast = useRef(false);
  const rotation = useRotationQueue({
    onSaved: () => {
      if (savedToast.current) return;
      savedToast.current = true;
      toast.success(t('review.rotated'));
      setTimeout(() => {
        savedToast.current = false;
      }, 4000);
    },
  });
  const turns = rotation.turns;
  /**
   * "Esta es la espalda de aquella", as drafts.
   *
   * Held here rather than sent as the user taps, which is the whole reason "deshacer"
   * costs nothing on this screen: the photo has not moved and the garment has not been
   * deleted until the pass is saved. Everywhere else in the app the same operation is
   * final, and says so.
   */
  const [backPairings, setBackPairings] = useState<BackPairings>({});
  const mergeInto = useMergeItemInto();

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

  const editOne = useCallback((itemId: string, changes: TagChanges) => {
    setEdits((current) => ({ ...current, [itemId]: { ...current[itemId], ...changes } }));
  }, []);

  const pairBack = useCallback((sourceId: string, targetId: string) => {
    setBackPairings((current) => ({ ...current, [sourceId]: { targetId, view: 'back' } }));
    // Its tags are about to stop existing along with it, so stop carrying them.
    setEdits((current) => {
      if (!(sourceId in current)) return current;
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
    setOpenTile((open) => (open === sourceId ? null : open));
  }, []);

  const unpairBack = useCallback((sourceId: string) => {
    setBackPairings((current) => {
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
  }, []);

  /**
   * Straightening is the one change on this screen that is not a draft: it is a
   * file on disk. It is saved on the spot, but it never makes the user wait — the
   * photo turns now and the queue catches the server up.
   */
  const rotate = rotation.rotate;

  const rotatePhoto = useCallback(
    (photo: QueuedPhoto, direction: 'cw' | 'ccw') => {
      // One key per garment, not per queue row: the same garment shows up in the
      // queue, in the review grid and in the stepper, and all three have to agree
      // about which way up it is.
      if (photo.itemId) rotation.rotate(photo.itemId, direction);
    },
    [rotation]
  );

  const save = useCallback(async () => {
    // The merges go first and one at a time: each one deletes a garment, and a tag
    // edit for a garment that is about to stop existing has nothing to write to.
    let merged = 0;
    // Only the pairs that actually landed are forgotten. Clearing all of them on any
    // success made the failed ones vanish from the screen under a toast saying N were
    // moved, so the user had no way to see which one to try again.
    const moved = new Set<string>();
    for (const [sourceId, pairing] of Object.entries(backPairings)) {
      try {
        await mergeInto.mutateAsync({
          itemId: pairing.targetId,
          sourceItemId: sourceId,
          view: pairing.view,
        });
        merged += 1;
        moved.add(sourceId);
      } catch {
        toast.error(t('review.mergeFailed'));
      }
    }
    const pairsLeft = Object.keys(backPairings).filter((id) => !moved.has(id));
    if (merged > 0) {
      toast.success(t('review.mergedCount', { count: merged }));
      setBackPairings((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => !moved.has(id)))
      );
    }

    const entries = Object.entries(edits)
      .filter(([itemId, edit]) => hasContent(edit) && !(itemId in backPairings))
      .map(([itemId, edit]) => ({
        item_id: itemId,
        type: edit.type,
        // Sent even when null, so clearing a subtype the tagger guessed wrong really
        // does clear it.
        subtype: edit.subtype ?? null,
        primary_color: edit.primaryColor,
        // `null` is meaningful here — "drop the shade the tagger sampled" — so it
        // goes over the wire, while `undefined` means the user never touched it.
        primary_color_hex: edit.primaryColorHex ?? null,
        style: edit.style,
        formality: edit.formality,
      }));
    if (entries.length === 0) {
      // A merge that failed is unfinished business, so the sheet stays open on it
      // rather than closing over an error toast as though the save had worked.
      if (pairsLeft.length > 0) return;
      if (!reviewingBacklog) reset();
      onClose();
      return;
    }
    try {
      const result = await batchTag.mutateAsync(entries);
      // What the server says it wrote, not what we asked it to write. A 200 carrying
      // `failed: 3` used to be reported as a complete success and the edits thrown
      // away with it, so three garments silently kept the tagger's guesses.
      const updated = result?.updated ?? entries.length;
      const failed = result?.failed ?? 0;
      if (updated > 0) toast.success(t('review.saved', { count: updated }));
      if (failed > 0) {
        toast.error(t('review.saveFailedCount', { count: failed }));
        // Keep the whole draft: we are not told which rows failed, and dropping the
        // ones that worked would leave the user unable to retry the rest.
        return;
      }
      setEdits({});
      // The backlog pass owns no photos, so there is no queue to clear.
      if (!reviewingBacklog) reset();
      onClose();
    } catch {
      // The provider's mutation surfaces its own toast; the sheet stays open so
      // nothing the user typed is thrown away.
    }
  }, [backPairings, batchTag, edits, mergeInto, onClose, reset, reviewingBacklog, t]);

  const resetTurns = rotation.reset;
  const startOver = useCallback(() => {
    reset();
    setEdits({});
    setBackPairings({});
    setOpenTile(null);
    resetTurns();
    setPhase('pick');
  }, [reset, resetTurns]);

  const busy = counts.busy > 0;
  const pairCount = Object.keys(backPairings).length;
  const editCount =
    Object.entries(edits).filter(([itemId, edit]) => hasContent(edit) && !(itemId in backPairings))
      .length + pairCount;
  const hasEdits = editCount > 0;

  return (
    <div className="flex min-w-0 flex-col" data-testid="bulk-panel">
      {/* In the backlog pass the dialog header already says this; repeating it
          costs a line of a phone screen that the garments could be using. */}
      {!(reviewingBacklog && (phase === 'review' || phase === 'stepper')) && (
        <p className="pb-3 text-[13px] leading-snug text-muted-foreground">
          {phase === 'review' || phase === 'stepper' ? t('reviewSubtitle') : t('subtitle')}
        </p>
      )}

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

                <UploadQueueList
                  photos={photos}
                  onRetry={retry}
                  onRemove={remove}
                  onRotate={rotatePhoto}
                  turns={turns}
                  rotating={(photo) => Boolean(photo.itemId) && rotation.isBusy(photo.itemId!)}
                />

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
                  openId={openTile}
                  onOpen={setOpenTile}
                  onEdit={editOne}
                  onRotate={rotate}
                  rotating={rotation.isBusy}
                  turns={turns}
                  onStartStepper={() => setPhase('stepper')}
                  backPairings={backPairings}
                  onPairBack={pairBack}
                  onUnpairBack={unpairBack}
                />
              ))}

            {phase === 'stepper' && (
              <TagStepper
                drafts={items
                  .filter((item) => !(item.id in backPairings))
                  .map((item) => draftOf(item, edits[item.id]))}
                onChange={editOne}
                onRotate={rotate}
                rotating={rotation.isBusy}
                turns={turns}
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
              <Button
                type="button"
                onClick={save}
                disabled={batchTag.isPending || mergeInto.isPending}
              >
                {batchTag.isPending || mergeInto.isPending ? (
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
