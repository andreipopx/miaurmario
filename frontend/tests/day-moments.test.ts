import { describe, expect, it } from 'vitest';
import {
  MOMENT_OCCASIONS,
  MOMENT_PRESETS,
  nextPreset,
  shortTime,
  transitionSource,
  transitionSummary,
  type DayMoment,
} from '@/lib/day-moments';
import type { Outfit } from '@/lib/hooks/use-outfits';

function outfit(itemIds: string[]): Outfit {
  return { id: `o-${itemIds.join('')}`, items: itemIds.map((id) => ({ id })) } as unknown as Outfit;
}

function moment(order: number, patch: Partial<DayMoment> = {}): DayMoment {
  return {
    order,
    label: null,
    time: null,
    occasion: 'casual',
    outfit: null,
    is_worn: false,
    transition_from_order: null,
    shared_item_ids: [],
    look_count: 1,
    ...patch,
  };
}

describe('shortTime', () => {
  it('trims seconds and tolerates empty values', () => {
    expect(shortTime('09:00:00')).toBe('09:00');
    expect(shortTime('20:30')).toBe('20:30');
    expect(shortTime(null)).toBeNull();
    expect(shortTime('')).toBeNull();
    expect(shortTime('late')).toBeNull();
  });
});

describe('nextPreset', () => {
  it('starts with the morning', () => {
    expect(nextPreset([]).key).toBe('morning');
  });

  it('proposes the first preset after the latest moment', () => {
    expect(nextPreset([{ time: '09:00:00' }]).key).toBe('afternoon');
    expect(nextPreset([{ time: '09:00:00' }, { time: '16:00:00' }]).key).toBe('evening');
    expect(nextPreset([{ time: '22:00:00' }]).key).toBe('evening');
  });

  it('without times, walks the presets by count', () => {
    expect(nextPreset([{ time: null }]).key).toBe('afternoon');
    expect(nextPreset([{ time: null }, { time: null }, { time: null }]).key).toBe('evening');
  });
});

describe('transitionSource', () => {
  it('is the closest earlier moment that has a look', () => {
    const moments = [
      moment(0, { outfit: outfit(['a']) }),
      moment(1),
      moment(2, { outfit: outfit(['b']) }),
    ];
    expect(transitionSource(moments)?.order).toBe(2);
    expect(transitionSource(moments, 2)?.order).toBe(0);
    expect(transitionSource(moments, 0)).toBeNull();
    expect(transitionSource([])).toBeNull();
  });
});

describe('transitionSummary', () => {
  it('counts kept and changed pieces', () => {
    const m = moment(1, { outfit: outfit(['a', 'b', 'c', 'd']), shared_item_ids: ['a', 'b', 'c'] });
    expect(transitionSummary(m)).toEqual({ kept: 3, changed: 1 });
  });

  it('is null without a look or shared pieces', () => {
    expect(transitionSummary(moment(1))).toBeNull();
    expect(transitionSummary(moment(1, { outfit: outfit(['a']) }))).toBeNull();
  });
});

describe('presets and occasions', () => {
  it('offer only occasions the backend accepts', () => {
    const valid = new Set(['casual', 'work', 'date', 'dinner', 'party', 'sport', 'formal', 'outdoor', 'office']);
    for (const o of MOMENT_OCCASIONS) expect(valid.has(o)).toBe(true);
    for (const p of MOMENT_PRESETS) expect(valid.has(p.occasion)).toBe(true);
  });
});
