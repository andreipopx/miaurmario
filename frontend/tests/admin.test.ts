import { afterEach, describe, expect, it } from 'vitest';

import {
  barHeights,
  deletionConfirmMatches,
  deletionConfirmTarget,
  dismissAnnouncement,
  formatBytes,
  formatEur,
  inviteFromSearch,
  isAnnouncementDismissed,
  parseAdminTab,
  parseCap,
  parseDecimal,
  toDateTimeLocal,
} from '@/lib/admin';
import { buildFeedbackForm } from '@/lib/hooks/use-admin';

describe('parseAdminTab', () => {
  it('defaults to summary for unknown values', () => {
    expect(parseAdminTab(null)).toBe('summary');
    expect(parseAdminTab('nope')).toBe('summary');
    expect(parseAdminTab('inbox')).toBe('inbox');
  });
});

describe('inviteFromSearch', () => {
  it('normalises valid codes and rejects junk', () => {
    expect(inviteFromSearch('abcd2345')).toBe('ABCD2345');
    expect(inviteFromSearch('  K7P-Q_9X ')).toBe('K7P-Q_9X');
    expect(inviteFromSearch(null)).toBeNull();
    expect(inviteFromSearch('')).toBeNull();
    expect(inviteFromSearch('<script>')).toBeNull();
    expect(inviteFromSearch('abc')).toBeNull();
  });
});

describe('deletion confirmation', () => {
  const withUsername = { username: 'lucia', email: 'Lucia@Example.com' };
  const withoutUsername = { username: null, email: 'Lucia@Example.com' };

  it('uses the username, falling back to the email', () => {
    expect(deletionConfirmTarget(withUsername)).toBe('lucia');
    expect(deletionConfirmTarget(withoutUsername)).toBe('lucia@example.com');
  });

  it('accepts @, case and whitespace variations only', () => {
    expect(deletionConfirmMatches(withUsername, ' @Lucia ')).toBe(true);
    expect(deletionConfirmMatches(withUsername, 'luci')).toBe(false);
    expect(deletionConfirmMatches(withoutUsername, 'lucia@example.com')).toBe(true);
    expect(deletionConfirmMatches(withoutUsername, 'lucia')).toBe(false);
  });
});

describe('number parsing', () => {
  it('parseDecimal accepts comma or dot', () => {
    expect(parseDecimal('0,15')).toBeCloseTo(0.15);
    expect(parseDecimal('0.6')).toBeCloseTo(0.6);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('-1')).toBeNaN();
  });

  it('parseCap', () => {
    expect(parseCap('')).toBeNull();
    expect(parseCap('50')).toBe(50);
    expect(parseCap('5.5')).toBe('invalid');
  });
});

describe('formatting', () => {
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3, 'en')).toBe('5 GB');
  });

  it('formatEur keeps precision for tiny amounts', () => {
    expect(formatEur(0.0042, 'en')).toContain('0.0042');
    expect(formatEur(12.5, 'en')).toContain('12.50');
  });

  it('barHeights scales to the busiest day', () => {
    expect(barHeights([0, 2, 4])).toEqual([0, 0.5, 1]);
    expect(barHeights([0, 0])).toEqual([0, 0]);
  });

  it('toDateTimeLocal round-trips through the local zone', () => {
    const local = toDateTimeLocal('2026-09-21T10:30:00Z');
    expect(new Date(local).toISOString()).toBe('2026-09-21T10:30:00.000Z');
    expect(toDateTimeLocal(null)).toBe('');
  });
});

describe('announcement dismissal', () => {
  afterEach(() => window.localStorage.clear());

  it('remembers only the last dismissed id', () => {
    expect(isAnnouncementDismissed('a1')).toBe(false);
    dismissAnnouncement('a1');
    expect(isAnnouncementDismissed('a1')).toBe(true);
    // A new announcement (new id) shows again.
    expect(isAnnouncementDismissed('b2')).toBe(false);
  });
});

describe('buildFeedbackForm', () => {
  it('includes context fields and the screenshot only when present', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
    const form = buildFeedbackForm({
      kind: 'bug',
      text: 'Se cuelga',
      screenshot: file,
      page_url: 'https://app/dashboard',
      build_id: 'abc',
    });
    expect(form.get('kind')).toBe('bug');
    expect(form.get('text')).toBe('Se cuelga');
    expect(form.get('page_url')).toBe('https://app/dashboard');
    expect(form.get('build_id')).toBe('abc');
    expect(form.get('screenshot')).toBeInstanceOf(File);

    const bare = buildFeedbackForm({ kind: 'other', text: 'x' });
    expect(bare.has('screenshot')).toBe(false);
    expect(bare.has('build_id')).toBe(false);
  });
});
