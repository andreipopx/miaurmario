'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

import { api, setAccessToken } from '@/lib/api';
import {
  quickColorsFor,
  quickTypesFor,
  type ColorUsage,
  type TypeUsage,
} from '@/components/bulk-upload/tag-choices';

/**
 * What this owner actually wears, so the quick-tag buttons can be their garments
 * and not a guess we hardcoded.
 *
 * Deliberately not a react-query hook, for two reasons:
 *
 * 1. **The shortlist must not move.** A person tagging a batch taps the same
 *    button twenty times; if the row reordered mid-batch — and `['items']` is
 *    invalidated on every save, so a query would refetch constantly — they would
 *    tag a coat as a dress. The answer is cached in the module for the life of the
 *    page: fetched once, frozen, never refetched. It is a shortlist, not a
 *    reading; being an hour stale costs nothing.
 * 2. **Nothing may depend on it.** The review grid renders one `TagFields` per
 *    garment and the stepper renders it again; this must work with or without a
 *    QueryClient overhead in the tree, and it must degrade to the defaults
 *    silently when the call fails, is unauthenticated, or is offline.
 */

export interface TagUsage {
  types: TypeUsage[];
  colors: ColorUsage[];
}

/** The frozen answer for this page, and the call that is fetching it. */
let cached: TagUsage | null = null;
let inflight: Promise<TagUsage | null> | null = null;

/** Tests only: forget the frozen shortlist between cases. */
export function resetTagUsageCache(): void {
  cached = null;
  inflight = null;
}

async function loadTagUsage(): Promise<TagUsage | null> {
  try {
    // Both rows are tiny and independent; one failing should not cost the other.
    const [types, colors] = await Promise.all([
      api.get<TypeUsage[]>('/items/types').catch(() => []),
      api.get<ColorUsage[]>('/items/colors').catch(() => []),
    ]);
    const usage: TagUsage = {
      types: Array.isArray(types) ? types : [],
      colors: Array.isArray(colors) ? colors : [],
    };
    cached = usage;
    return usage;
  } catch {
    // Offline, 401, a proxy in a bad mood: the defaults are a perfectly good
    // shortlist, so a failure here is not worth a word on screen.
    return null;
  } finally {
    inflight = null;
  }
}

/**
 * The raw usage, or `null` until it is known. `null` is not an error state — it
 * is "use the defaults", which is what the pure selectors do with it.
 */
export function useTagUsage(): TagUsage | null {
  const { data: session, status } = useSession();
  if (session?.accessToken) setAccessToken(session.accessToken as string);
  const [usage, setUsage] = useState<TagUsage | null>(cached);

  useEffect(() => {
    if (usage || status === 'loading') return;
    if (cached) {
      setUsage(cached);
      return;
    }
    let alive = true;
    inflight ??= loadTagUsage();
    void inflight.then((loaded) => {
      // Only an answer with something in it moves the buttons. A failure, or a
      // wardrobe that is still empty, leaves the defaults already on screen — and
      // costs no re-render, which matters when the review grid has thirty of these.
      if (alive && loaded && (loaded.types.length > 0 || loaded.colors.length > 0)) {
        setUsage(loaded);
      }
    });
    return () => {
      alive = false;
    };
  }, [usage, status]);

  return usage;
}

/**
 * The shortlists to put on screen: this owner's most-used types and colours,
 * padded from the defaults, always `QUICK_CHOICE_COUNT` long.
 *
 * They settle once, before the first tap, and then never change for the session.
 */
export function useQuickTagChoices(): { types: string[]; colors: string[] } {
  const usage = useTagUsage();
  // Not memoised on purpose: the input is a frozen object, so this is two passes
  // over a 31-word list, and a `useMemo` keyed on it would only hide that.
  return { types: quickTypesFor(usage?.types), colors: quickColorsFor(usage?.colors) };
}
