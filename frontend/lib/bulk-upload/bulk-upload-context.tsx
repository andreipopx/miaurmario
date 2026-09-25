'use client';

/**
 * The batch upload queue, hosted above the router.
 *
 * It lives in the dashboard layout rather than in the dialog on purpose: the whole
 * point of a thirty-photo batch is that you can close the sheet, go and look at
 * something else, and come back to a full wardrobe. Client-side navigation keeps
 * this provider mounted, so the uploads simply carry on; a hard reload loses the
 * in-flight requests but not the photos, which are read back out of IndexedDB and
 * resumed.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

import { ApiError, NetworkError, api, getAccessToken } from '@/lib/api';
import { type BulkUploadResult, uploadBulkPhoto } from '@/lib/hooks/use-items';
import type { ItemListResponse } from '@/lib/types';
import {
  MAX_BATCH_PHOTOS,
  type QueueCounts,
  type QueuedPhoto,
  type RejectReason,
  UPLOAD_CONCURRENCY,
  countQueue,
  hasItem,
  isTerminal,
  nextBatchId,
  nextPhotoId,
  screenFiles,
} from '@/lib/bulk-upload/queue';
import {
  type StoredPhoto,
  clearPhotos,
  deletePhoto,
  forgetBatchItems,
  loadBatchItems,
  loadPendingPhotos,
  rememberBatchItem,
  savePhoto,
} from '@/lib/bulk-upload/storage';

/** How often we ask whether the worker has finished tagging the batch. */
const TAGGING_POLL_MS = 3000;
/** A tagging job that never reports back stops being interesting after this. */
const TAGGING_GIVE_UP_MS = 3 * 60 * 1000;

interface BulkUploadContextValue {
  photos: QueuedPhoto[];
  counts: QueueCounts;
  /** Garments this batch put in the wardrobe, in upload order. */
  itemIds: string[];
  /** Opt out of AI tagging for this batch (hidden when the user has no vision AI). */
  skipAi: boolean;
  setSkipAi: (skip: boolean) => void;
  /** What the picker refused, so the sheet can say so once. */
  lastRejected: RejectReason[];
  addFiles: (files: readonly File[]) => void;
  retry: (id: string) => void;
  retryFailed: () => void;
  remove: (id: string) => void;
  /** Forget the batch (after the review, or when the user starts a new one). */
  reset: () => void;
  /** A batch was found in storage and picked back up. */
  resumedBatch: boolean;
  acknowledgeResume: () => void;
}

const BulkUploadContext = createContext<BulkUploadContextValue | null>(null);

export function useBulkUpload(): BulkUploadContextValue {
  const context = useContext(BulkUploadContext);
  if (!context) {
    throw new Error('useBulkUpload must be used inside <BulkUploadProvider>');
  }
  return context;
}

/** Turn a dead request into a row the user can read and act on. */
export function failureOf(error: unknown): { state: 'error'; errorCode: string; error?: string } {
  if (error instanceof ApiError) {
    const detail = (error.data as { detail?: unknown } | undefined)?.detail;
    const code =
      detail && typeof detail === 'object' && 'code' in detail
        ? String((detail as { code: unknown }).code)
        : undefined;
    const message =
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && 'message' in detail
          ? String((detail as { message: unknown }).message)
          : undefined;
    // 429 is the one the user can fix by simply waiting, so it gets its own word.
    if (error.status === 429) return { state: 'error', errorCode: 'rate_limited', error: message };
    if (error.status === 401 || error.status === 403) {
      return { state: 'error', errorCode: 'unauthorized', error: message };
    }
    return { state: 'error', errorCode: code ?? 'failed', error: message };
  }
  if (error instanceof NetworkError) {
    // `code`, not `message`: the message is the internal `network_<code>` string.
    return { state: 'error', errorCode: error.code === 'offline' ? 'offline' : 'network' };
  }
  return { state: 'error', errorCode: 'failed' };
}

export function BulkUploadProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [photos, setPhotos] = useState<QueuedPhoto[]>([]);
  const [skipAi, setSkipAi] = useState(false);
  const [lastRejected, setLastRejected] = useState<RejectReason[]>([]);
  const [resumedBatch, setResumedBatch] = useState(false);
  /** Garments this batch created before a reload; their photos are long gone. */
  const [restoredItemIds, setRestoredItemIds] = useState<string[]>([]);

  const batchIdRef = useRef<string>(nextBatchId());
  /** The bytes of every row still in play, so a retry does not need the picker again. */
  const blobsRef = useRef(new Map<string, Blob>());
  const xhrsRef = useRef(new Map<string, XMLHttpRequest>());
  const previewsRef = useRef(new Set<string>());
  const runningRef = useRef(0);
  /**
   * Ids the pump has already handed to an XHR. `photosRef` only catches up on the
   * next render, and the pump runs again the instant a request settles, so without
   * this a photo could be uploaded twice.
   */
  const startedRef = useRef(new Set<string>());
  const taggingSinceRef = useRef(new Map<string, number>());
  const skipAiRef = useRef(skipAi);
  skipAiRef.current = skipAi;
  /** The pump reads the queue from here so it never double-starts a photo. */
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const tokenRef = useRef<string | null | undefined>(undefined);
  tokenRef.current = (session?.accessToken as string | undefined) ?? getAccessToken();

  const patch = useCallback((id: string, changes: Partial<QueuedPhoto>) => {
    setPhotos((current) =>
      current.map((photo) => (photo.id === id ? { ...photo, ...changes } : photo))
    );
  }, []);

  /**
   * Start whatever the concurrency budget allows. Safe to call as often as you
   * like, and deliberately driven by a ref rather than from inside a state
   * updater: an updater can run twice, and a photo must be uploaded once.
   */
  const pump = useCallback(() => {
    const free = UPLOAD_CONCURRENCY - runningRef.current;
    if (free <= 0) return;
    const starting = photosRef.current
      .filter(
        (photo) =>
          photo.state === 'pending' &&
          blobsRef.current.has(photo.id) &&
          !startedRef.current.has(photo.id)
      )
      .slice(0, free);
    if (starting.length === 0) return;

    runningRef.current += starting.length;
    for (const photo of starting) startedRef.current.add(photo.id);
    const startingIds = new Set(starting.map((photo) => photo.id));
    setPhotos((current) =>
      current.map((photo) =>
        startingIds.has(photo.id) ? { ...photo, state: 'uploading', progress: 0 } : photo
      )
    );

    for (const photo of starting) {
      const blob = blobsRef.current.get(photo.id);
      if (!blob) {
        runningRef.current = Math.max(0, runningRef.current - 1);
        startedRef.current.delete(photo.id);
        continue;
      }
      void uploadBulkPhoto(
        blob,
        photo.name,
        { skipAi: skipAiRef.current, removeBackground: true },
        tokenRef.current,
        (percent) => {
          // The bytes are gone; what happens next is the server cutting the
          // background out, so the row says so rather than sitting at 100%.
          patch(
            photo.id,
            percent >= 100 ? { progress: 100, state: 'removing-bg' } : { progress: percent }
          );
        },
        (xhr) => xhrsRef.current.set(photo.id, xhr)
      )
        .then((result: BulkUploadResult) => {
          blobsRef.current.delete(photo.id);
          void deletePhoto(photo.id);

          if (result.state === 'error' || !result.item) {
            // A refusal the server can name: too big, wrong format. The bytes stay
            // in storage anyway, because a retry after rotating or shrinking the
            // photo is the user's business, not ours to foreclose.
            patch(photo.id, {
              state: 'error',
              errorCode: result.error_code ?? 'failed',
              error: result.error ?? undefined,
            });
            return;
          }

          rememberBatchItem(batchIdRef.current, result.item.id);
          if (result.state === 'duplicate') {
            patch(photo.id, { state: 'duplicate', progress: 100, itemId: result.item.id });
            return;
          }
          if (result.tagging === 'queued') {
            taggingSinceRef.current.set(photo.id, Date.now());
            patch(photo.id, { state: 'tagging', progress: 100, itemId: result.item.id });
          } else {
            patch(photo.id, { state: 'done', progress: 100, itemId: result.item.id });
          }
          queryClient.invalidateQueries({ queryKey: ['items'] });
          queryClient.invalidateQueries({ queryKey: ['wardrobe-stats'] });
        })
        .catch((error: unknown) => {
          // The bytes stay in storage: this row is retryable, and a reload can
          // pick it up even if the user closes the app in frustration.
          patch(photo.id, { ...failureOf(error) });
        })
        .finally(() => {
          startedRef.current.delete(photo.id);
          xhrsRef.current.delete(photo.id);
          runningRef.current = Math.max(0, runningRef.current - 1);
          pump();
        });
    }
  }, [patch, queryClient]);

  const addFiles = useCallback(
    (files: readonly File[]) => {
      // Rows that failed still hold a slot: they are retryable, not gone.
      const queued = photosRef.current.filter(
        (photo) => !isTerminal(photo.state) || photo.state === 'error'
      ).length;
      const { accepted, rejected } = screenFiles(files, queued);
      setLastRejected(rejected);
      if (accepted.length === 0) return;

      const added: QueuedPhoto[] = accepted.map((file) => {
        const id = nextPhotoId();
        const name = file.name || 'foto.jpg';
        blobsRef.current.set(id, file);
        const previewUrl = URL.createObjectURL(file);
        previewsRef.current.add(previewUrl);
        void savePhoto({
          id,
          batchId: batchIdRef.current,
          name,
          blob: file,
          addedAt: Date.now(),
          skipAi: skipAiRef.current,
        });
        return { id, name, state: 'pending', progress: 0, previewUrl };
      });
      setPhotos((current) => [...current, ...added]);
      setTimeout(pump, 0);
    },
    [pump]
  );

  const retry = useCallback(
    (id: string) => {
      if (!blobsRef.current.has(id)) return;
      patch(id, { state: 'pending', progress: 0, error: undefined });
      setTimeout(pump, 0);
    },
    [patch, pump]
  );

  const retryFailed = useCallback(() => {
    setPhotos((current) =>
      current.map((photo) =>
        photo.state === 'error' && blobsRef.current.has(photo.id)
          ? { ...photo, state: 'pending', progress: 0, error: undefined }
          : photo
      )
    );
    setTimeout(pump, 0);
  }, [pump]);

  const remove = useCallback((id: string) => {
    startedRef.current.delete(id);
    xhrsRef.current.get(id)?.abort();
    xhrsRef.current.delete(id);
    blobsRef.current.delete(id);
    void deletePhoto(id);
    const going = photosRef.current.find((photo) => photo.id === id);
    if (going?.previewUrl) {
      URL.revokeObjectURL(going.previewUrl);
      previewsRef.current.delete(going.previewUrl);
    }
    setPhotos((current) => current.filter((photo) => photo.id !== id));
  }, []);

  const reset = useCallback(() => {
    xhrsRef.current.forEach((xhr) => xhr.abort());
    xhrsRef.current.clear();
    void clearPhotos(photosRef.current.map((photo) => photo.id));
    forgetBatchItems();
    setRestoredItemIds([]);
    previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewsRef.current.clear();
    blobsRef.current.clear();
    startedRef.current.clear();
    taggingSinceRef.current.clear();
    batchIdRef.current = nextBatchId();
    setPhotos([]);
    setLastRejected([]);
    setResumedBatch(false);
  }, []);

  const acknowledgeResume = useCallback(() => setResumedBatch(false), []);

  // Pick an interrupted batch back up. Runs once, and only adopts photos that
  // never reached the server — anything already uploaded was deleted on success.
  useEffect(() => {
    let cancelled = false;
    void loadPendingPhotos().then((stored: StoredPhoto[]) => {
      if (cancelled || stored.length === 0) return;
      const rows: QueuedPhoto[] = stored.map((photo) => {
        blobsRef.current.set(photo.id, photo.blob);
        const previewUrl = URL.createObjectURL(photo.blob);
        previewsRef.current.add(previewUrl);
        return {
          id: photo.id,
          name: photo.name,
          state: 'pending',
          progress: 0,
          previewUrl,
          resumed: true,
        };
      });
      batchIdRef.current = stored[stored.length - 1].batchId;
      setSkipAi(stored[stored.length - 1].skipAi);
      // Everything this batch already saved, so the review covers the whole batch
      // and not only the half that was still queued.
      setRestoredItemIds(loadBatchItems(batchIdRef.current));
      setPhotos(rows);
      setResumedBatch(true);
      setTimeout(pump, 0);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask the server when the worker is done with the rows it is tagging. Only the
  // ids of this batch, so this costs one small request however big the wardrobe is.
  const taggingIds = photos.filter((photo) => photo.state === 'tagging').map((photo) => photo.id);
  const taggingKey = taggingIds.join(',');
  useEffect(() => {
    if (taggingKey === '') return;
    let cancelled = false;

    const check = async () => {
      const pending = photos.filter((photo) => photo.state === 'tagging' && photo.itemId);
      if (pending.length === 0) return;
      try {
        const response = await api.get<ItemListResponse>('/items', {
          params: {
            ids: pending.map((photo) => photo.itemId).join(','),
            page_size: '100',
          },
        });
        if (cancelled) return;
        const byId = new Map(response.items.map((item) => [item.id, item]));
        for (const photo of pending) {
          const item = byId.get(photo.itemId as string);
          const stale = Date.now() - (taggingSinceRef.current.get(photo.id) ?? 0) > TAGGING_GIVE_UP_MS;
          if (!item) {
            if (stale) patch(photo.id, { state: 'done' });
            continue;
          }
          if (item.status === 'error') {
            // The garment is in the wardrobe; only its tags are missing, so the
            // row lands on the review screen instead of reading as a lost photo.
            patch(photo.id, { state: 'done' });
          } else if (item.status !== 'processing' || stale) {
            patch(photo.id, { state: 'done' });
          }
        }
        queryClient.invalidateQueries({ queryKey: ['wardrobe-stats'] });
      } catch {
        /* a poll that fails is retried on the next tick */
      }
    };

    void check();
    const timer = setInterval(check, TAGGING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `photos` is read inside `check`; re-running on every progress tick would
    // restart the interval constantly, so the set of tagging ids is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taggingKey, patch, queryClient]);

  useEffect(
    () => () => {
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewsRef.current.clear();
    },
    []
  );

  const counts = useMemo(() => countQueue(photos), [photos]);
  const itemIds = useMemo(() => {
    const fromQueue = photos.filter(hasItem).map((photo) => photo.itemId as string);
    return [...restoredItemIds.filter((id) => !fromQueue.includes(id)), ...fromQueue];
  }, [photos, restoredItemIds]);

  const value = useMemo<BulkUploadContextValue>(
    () => ({
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
    }),
    [
      photos,
      counts,
      itemIds,
      skipAi,
      lastRejected,
      addFiles,
      retry,
      retryFailed,
      remove,
      reset,
      resumedBatch,
      acknowledgeResume,
    ]
  );

  return <BulkUploadContext.Provider value={value}>{children}</BulkUploadContext.Provider>;
}

export { MAX_BATCH_PHOTOS };
