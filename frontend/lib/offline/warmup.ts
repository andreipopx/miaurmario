'use client';

/**
 * Offline warm-up for the installed app: while online, quietly load the
 * screens people open without a connection (the whole wardrobe, the looks, this
 * month's history) and their photos, so they're there offline even if they
 * weren't visited. The queries land in the cache React Query copies to
 * IndexedDB; the photos pass through the service worker, which keeps them.
 *
 * The keys must be exactly the ones those screens use, hence the shared
 * *QueryOptions and the defaults below.
 */

import type { QueryClient } from '@tanstack/react-query';
import { itemsQueryOptions } from '@/lib/hooks/use-items';
import { calendarOutfitsQueryOptions, outfitsQueryOptions } from '@/lib/hooks/use-outfits';
import type { ItemFilter } from '@/lib/types';

/** The wardrobe as it opens (app/dashboard/wardrobe/page.tsx): not archived, newest first. */
export const WARDROBE_DEFAULT_FILTERS: ItemFilter = {
  is_archived: false,
  sort_by: 'created_at',
  sort_order: 'desc',
};
export const WARDROBE_PAGE_SIZE = 20;
/** Looks list as it opens (app/dashboard/outfits/page.tsx, chip "Todos"). */
const LOOKS_PAGE_SIZE = 24;
/** Don't page through more than this many garments on a warm-up. */
const MAX_WARDROBE_PAGES = 15;
/** Once in a while is enough; every screen also refreshes what it shows. */
export const WARMUP_EVERY_MS = 6 * 60 * 60 * 1000;
const STAMP_KEY = 'miaurmario.offlineWarmedAt';

type Photo = { thumbnail_url?: string | null; image_url?: string | null };

function photoOf(p: Photo | null | undefined): string | null {
  return p?.thumbnail_url || p?.image_url || null;
}

/** Thumbnails of a list of garments or looks, deduplicated. */
export function photosToKeep(
  items: Photo[],
  looks: { items?: Photo[] | null }[]
): string[] {
  const urls = new Set<string>();
  for (const item of items) {
    const url = photoOf(item);
    if (url) urls.add(url);
  }
  for (const look of looks) {
    for (const piece of look.items ?? []) {
      const url = photoOf(piece);
      if (url) urls.add(url);
    }
  }
  return Array.from(urls);
}

export function warmupDue(now = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(STAMP_KEY) || 0);
    return now - last > WARMUP_EVERY_MS;
  } catch {
    return true;
  }
}

function markWarmed(now = Date.now()) {
  try {
    localStorage.setItem(STAMP_KEY, String(now));
  } catch {
    /* fine: it just runs again next time */
  }
}

/** Fetch photos a few at a time; the service worker keeps every one that arrives. */
async function fetchPhotos(urls: string[], concurrency = 4) {
  for (let i = 0; i < urls.length; i += concurrency) {
    await Promise.all(
      urls.slice(i, i + concurrency).map((url) =>
        fetch(url, { credentials: 'same-origin' }).then(
          (r) => r.blob(),
          () => undefined
        )
      )
    );
  }
}

export async function warmOfflineData(queryClient: QueryClient): Promise<void> {
  const fresh = { staleTime: 60 * 1000 };
  const items: Photo[] = [];

  const first = await queryClient.fetchQuery({
    ...itemsQueryOptions(WARDROBE_DEFAULT_FILTERS, 1, WARDROBE_PAGE_SIZE),
    ...fresh,
  });
  items.push(...first.items);
  const pages = Math.min(Math.ceil(first.total / WARDROBE_PAGE_SIZE) || 1, MAX_WARDROBE_PAGES);
  for (let page = 2; page <= pages; page++) {
    const next = await queryClient.fetchQuery({
      ...itemsQueryOptions(WARDROBE_DEFAULT_FILTERS, page, WARDROBE_PAGE_SIZE),
      ...fresh,
    });
    items.push(...next.items);
  }

  const now = new Date();
  const [looks, month] = await Promise.all([
    queryClient.fetchQuery({ ...outfitsQueryOptions({}, 1, LOOKS_PAGE_SIZE), ...fresh }),
    queryClient.fetchQuery({
      ...calendarOutfitsQueryOptions(now.getFullYear(), now.getMonth() + 1, {}),
      ...fresh,
    }),
  ]);

  await fetchPhotos(photosToKeep(items, [...looks.outfits, ...month.outfits]));
  markWarmed();
}
