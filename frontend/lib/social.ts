// Pure helpers for the social layer (kept framework-free so they're unit-testable).

export type DayKind = 'today' | 'yesterday' | 'date';

/** Local calendar date as YYYY-MM-DD. */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Is a feed day (YYYY-MM-DD) today, yesterday or another date, in the viewer's local time? */
export function dayKind(dayIso: string, now: Date = new Date()): DayKind {
  if (dayIso === localIsoDate(now)) return 'today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (dayIso === localIsoDate(y)) return 'yesterday';
  return 'date';
}

/** Parse YYYY-MM-DD as a local date (no UTC shift). */
export function parseLocalDay(dayIso: string): Date {
  const [y, m, d] = dayIso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export type ShareOutcome = 'shared' | 'copied' | 'failed' | 'cancelled';

/**
 * Share a link with the native share sheet when available (mobile), falling
 * back to copying it to the clipboard.
 */
export async function shareOrCopy(
  data: { url: string; title?: string; text?: string },
  nav: Pick<Navigator, 'share' | 'clipboard'> | undefined = typeof navigator !== 'undefined' ? navigator : undefined
): Promise<ShareOutcome> {
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      // fall through to copy
    }
  }
  try {
    if (!nav?.clipboard) return 'failed';
    await nav.clipboard.writeText(data.url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
