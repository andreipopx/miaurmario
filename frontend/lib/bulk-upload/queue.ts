/**
 * The pure parts of the bulk-upload queue: what a row can be, which photos the
 * picker accepts, and how the counts read. Kept free of React and of fetch so the
 * rules can be tested without a DOM.
 */

/** Backend: config.max_bulk_upload_count. */
export const MAX_BATCH_PHOTOS = 30;
/** Backend: config.max_upload_size_mb. */
export const MAX_PHOTO_MB = 10;
/** Two at a time: the server takes the background off each photo synchronously. */
export const UPLOAD_CONCURRENCY = 2;

export const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'] as const;

/**
 * What a queue row is doing, in the order the user sees it. `tagging` is the only
 * state the server owns: the item exists and a worker is looking at it.
 */
export type PhotoState =
  | 'pending'
  | 'uploading'
  | 'removing-bg'
  | 'tagging'
  | 'done'
  | 'duplicate'
  | 'error';

export type RejectReason = 'too-many' | 'too-big' | 'wrong-type';

export interface QueuedPhoto {
  id: string;
  name: string;
  state: PhotoState;
  /** 0–100 for the bytes; only meaningful while `uploading`. */
  progress: number;
  /** Set once the garment exists (including when it turned out to be a duplicate). */
  itemId?: string;
  /** Object URL of the local file, for the thumbnail before the server has one. */
  previewUrl?: string;
  /**
   * Why it failed, as a code the UI turns into a specific sentence: too_big,
   * invalid_format, rate_limited, offline, network, unauthorized, failed. A row
   * that only says "error" is a row the user cannot act on.
   */
  errorCode?: string;
  /** The server's English message, shown only when there is no better wording. */
  error?: string;
  /** True for a row restored from IndexedDB after a reload. */
  resumed?: boolean;
}

export interface QueueCounts {
  total: number;
  /** Uploaded and past the server: the garment exists. */
  saved: number;
  duplicate: number;
  failed: number;
  /** Still doing something. */
  busy: number;
  /** Nothing left to do. */
  settled: boolean;
}

const TERMINAL: readonly PhotoState[] = ['done', 'duplicate', 'error'];

export function isTerminal(state: PhotoState): boolean {
  return TERMINAL.includes(state);
}

/** A row whose garment exists, whether or not it is tagged yet. */
export function hasItem(photo: QueuedPhoto): boolean {
  return Boolean(photo.itemId) && photo.state !== 'error';
}

export function countQueue(photos: readonly QueuedPhoto[]): QueueCounts {
  const counts: QueueCounts = {
    total: photos.length,
    saved: 0,
    duplicate: 0,
    failed: 0,
    busy: 0,
    settled: true,
  };
  for (const photo of photos) {
    if (photo.state === 'duplicate') counts.duplicate += 1;
    else if (photo.state === 'error') counts.failed += 1;
    else if (photo.state === 'done') counts.saved += 1;
    if (!isTerminal(photo.state)) {
      counts.busy += 1;
      counts.settled = false;
    }
  }
  // A photo whose garment exists but is still being tagged already counts as saved:
  // it is in the wardrobe, and the review screen can show it.
  counts.saved += photos.filter((p) => p.state === 'tagging').length;
  return counts;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

export interface Screening {
  accepted: File[];
  rejected: RejectReason[];
}

/**
 * Which of the picked files go in the queue.
 *
 * A camera roll multi-select is a blunt instrument — screenshots, videos and
 * 40-megapixel panoramas come along with the garments — so the picker says what
 * it dropped instead of failing the whole selection.
 */
export function screenFiles(files: readonly File[], alreadyQueued: number): Screening {
  const accepted: File[] = [];
  const rejected: RejectReason[] = [];
  for (const file of files) {
    if (alreadyQueued + accepted.length >= MAX_BATCH_PHOTOS) {
      rejected.push('too-many');
      continue;
    }
    const looksLikeAnImage =
      file.type.startsWith('image/') ||
      (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));
    if (!looksLikeAnImage) {
      rejected.push('wrong-type');
      continue;
    }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
      rejected.push('too-big');
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

let counter = 0;

export function nextPhotoId(): string {
  counter += 1;
  return `p${Date.now().toString(36)}-${counter}`;
}

export function nextBatchId(): string {
  return `b${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
