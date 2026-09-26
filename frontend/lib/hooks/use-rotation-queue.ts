'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useRotateImage } from '@/lib/hooks/use-items';
import {
  applyTurn,
  clearTurns,
  entryOf,
  isSettling,
  markBusy,
  pendingRequest,
  rollBack,
  settle,
  turnsShown,
  type RotationState,
  type TurnDirection,
} from '@/lib/rotation-queue';

/**
 * Straighten photos without ever waiting for one.
 *
 * Tapping the button turns the preview immediately and leaves a note for the server;
 * a worker drains those notes, one request per photo at a time but several photos at
 * once, and collapses however many taps happened in between into a single turn. A
 * failure puts that photo's preview back where the server actually has it and says so
 * once, rather than leaving the user looking at a turn that was never saved.
 *
 * `turns` is exactly what the existing thumbnails already take: quarter turns to
 * apply as a CSS transform on top of whatever the cached image shows.
 */
export function useRotationQueue({
  onSaved,
  target,
}: {
  /** Called after a photo's turns are all safely stored. */
  onSaved?: (itemId: string) => void;
  /**
   * Which photo a key stands for, when the key is not simply a garment id.
   *
   * The queue's bookkeeping only ever needs a key to tell one photo from another, so
   * a screen that shows several photos of the same garment keys them by photo and
   * says here where each one lives. Left out, a key is a garment id and the turn
   * lands on that garment's own photo, which is what the batch review pass wants.
   */
  target?: (key: string) => { id: string; imageId?: string | null };
} = {}) {
  const tReview = useTranslations('bulkUpload.review');
  const rotateImage = useRotateImage();
  const [state, setState] = useState<RotationState>(() => clearTurns());

  // The worker reads the latest state through a ref: it is started from an effect,
  // and closing over a snapshot would make it send a turn the user has already
  // undone.
  const latest = useRef(state);
  latest.current = state;
  const inFlight = useRef(new Set<string>());
  const mutate = useRef(rotateImage.mutateAsync);
  mutate.current = rotateImage.mutateAsync;
  const notify = useRef(onSaved);
  notify.current = onSaved;
  const resolve = useRef(target);
  resolve.current = target;
  const warned = useRef(false);

  const drain = useCallback(
    async (itemId: string) => {
      if (inFlight.current.has(itemId)) return;
      inFlight.current.add(itemId);
      try {
        // Keep going while the user is still tapping: each pass sends the gap that
        // exists at that moment, so a long flurry of taps costs a couple of requests
        // rather than one per tap.
        for (;;) {
          const request = pendingRequest(latest.current, itemId);
          if (!request) break;
          const applied = request.direction === 'cw' ? request.quarters : -request.quarters;
          setState((current) => markBusy(current, itemId, true));
          const photo = resolve.current?.(itemId) ?? { id: itemId };
          try {
            await mutate.current({
              id: photo.id,
              imageId: photo.imageId ?? null,
              direction: request.direction,
              quarters: request.quarters,
            });
            setState((current) => settle(current, itemId, applied));
          } catch {
            setState((current) => rollBack(current, itemId));
            if (!warned.current) {
              warned.current = true;
              toast.error(tReview('rotateFailed'));
              // One warning per flurry, not one per photo: a batch failing is one
              // problem, and twenty toasts is not twenty pieces of information.
              setTimeout(() => {
                warned.current = false;
              }, 4000);
            }
            return;
          }
        }
        notify.current?.(itemId);
      } finally {
        inFlight.current.delete(itemId);
      }
    },
    [tReview]
  );

  /** Turn a photo. Returns immediately; the preview has already moved. */
  const rotate = useCallback(
    (itemId: string, direction: TurnDirection) => {
      setState((current) => applyTurn(current, itemId, direction));
      // After the state update, so the worker reads the tap it was called for.
      queueMicrotask(() => void drain(itemId));
    },
    [drain]
  );

  // A photo whose worker exited while more taps were arriving needs picking up
  // again; this is the safety net rather than the normal path.
  useEffect(() => {
    for (const itemId of Object.keys(state)) {
      if (pendingRequest(state, itemId) && !inFlight.current.has(itemId)) {
        void drain(itemId);
      }
    }
  }, [state, drain]);

  const reset = useCallback(() => setState(clearTurns()), []);

  /** Exactly what the thumbnails already take: quarter turns per photo. */
  const turns = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(state).map(([itemId, entry]) => [itemId, entry.shown])
      ) as Readonly<Record<string, number>>,
    [state]
  );

  return {
    turns,
    rotate,
    reset,
    /** True while any photo is still catching up, for a quiet "guardando" hint. */
    settling: isSettling(state),
    /** Whether this one photo has a request in the air. */
    isBusy: (itemId: string) => entryOf(state, itemId).busy,
    turnsFor: (itemId: string) => turnsShown(state, itemId),
  };
}
