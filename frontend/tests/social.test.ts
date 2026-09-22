import { describe, expect, it, vi } from 'vitest';
import { dayKind, localIsoDate, parseLocalDay, shareOrCopy } from '@/lib/social';
import { normalizeUsernameQuery, profileShareUrl } from '@/lib/hooks/use-social';
import { colorIndexFor, initialsFor } from '@/components/social/person-avatar';

describe('dayKind', () => {
  const now = new Date(2026, 8, 21, 10, 0, 0); // 21 Sep 2026, local

  it('recognises today and yesterday in local time', () => {
    expect(dayKind('2026-09-21', now)).toBe('today');
    expect(dayKind('2026-09-20', now)).toBe('yesterday');
    expect(dayKind('2026-09-19', now)).toBe('date');
  });

  it('handles month boundaries', () => {
    expect(dayKind('2026-08-31', new Date(2026, 8, 1, 0, 30))).toBe('yesterday');
  });

  it('parses YYYY-MM-DD as a local date without UTC shift', () => {
    const d = parseLocalDay('2026-01-05');
    expect(localIsoDate(d)).toBe('2026-01-05');
    expect(d.getHours()).toBe(0);
  });
});

describe('normalizeUsernameQuery', () => {
  it('strips @, lowercases and drops characters usernames cannot contain', () => {
    expect(normalizeUsernameQuery('  @Ana_Pop ')).toBe('ana_pop');
    expect(normalizeUsernameQuery('ana%pop')).toBe('anapop');
    expect(normalizeUsernameQuery('@@')).toBe('');
  });
});

describe('profileShareUrl', () => {
  it('builds /u/{username} on the given origin and encodes it', () => {
    expect(profileShareUrl('ana_pop', 'https://miau.example')).toBe('https://miau.example/u/ana_pop');
    expect(profileShareUrl('a b', 'https://x')).toBe('https://x/u/a%20b');
  });
});

describe('shareOrCopy', () => {
  const data = { url: 'https://x/u/ana' };

  it('uses the native share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    await expect(shareOrCopy(data, { share, clipboard: { writeText } } as never)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('treats a dismissed share sheet as cancelled (no copy)', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    const writeText = vi.fn();
    const nav = { share: vi.fn().mockRejectedValue(abort), clipboard: { writeText } };
    await expect(shareOrCopy(data, nav as never)).resolves.toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to copying the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareOrCopy(data, { clipboard: { writeText } } as never)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it('reports failure when nothing works', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    await expect(shareOrCopy(data, { clipboard: { writeText } } as never)).resolves.toBe('failed');
    await expect(shareOrCopy(data, {} as never)).resolves.toBe('failed');
  });
});

describe('PersonAvatar helpers', () => {
  it('initials come from the handle, never the (email-derived) display name', () => {
    expect(initialsFor({ display_name: 'martingomezlucia8', username: 'lumago' })).toBe('L');
    expect(initialsFor({ display_name: '', username: 'bea' })).toBe('B');
  });

  it('stable colour index in range', () => {
    expect(colorIndexFor('ana')).toBe(colorIndexFor('ana'));
    for (const u of ['a', 'bea', 'zz_top', '']) {
      expect(colorIndexFor(u)).toBeGreaterThanOrEqual(0);
      expect(colorIndexFor(u)).toBeLessThan(4);
    }
  });
});
