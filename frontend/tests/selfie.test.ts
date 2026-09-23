import { describe, expect, it } from 'vitest';

import es from '@/messages/es.json';
import en from '@/messages/en.json';
import {
  chosenItemIds,
  initialPicks,
  itemsById,
  optionsFor,
  setPick,
  unmatchedGarments,
  type SelfieGarment,
  type SelfieItemSummary,
} from '@/lib/selfie';

function item(id: string, type: string, name?: string): SelfieItemSummary {
  return {
    id,
    name: name ?? null,
    type,
    subtype: null,
    primary_color: 'navy',
    colors: ['navy'],
    pattern: 'solid',
    thumbnail_url: null,
    image_url: null,
  };
}

function garment(index: number, type: string, match: SelfieItemSummary | null, alternatives: SelfieItemSummary[] = []): SelfieGarment {
  return {
    index,
    type,
    subtype: null,
    primary_color: 'navy',
    colors: ['navy'],
    pattern: 'solid',
    material: null,
    match,
    alternatives,
  };
}

const hoodie = item('i1', 'hoodie', 'Sudadera azul');
const otherHoodie = item('i2', 'hoodie', 'Sudadera roja');
const jeans = item('i3', 'jeans');

describe('selfie result state', () => {
  it('starts from what the server matched', () => {
    const garments = [garment(0, 'hoodie', hoodie, [otherHoodie]), garment(1, 'sneakers', null)];
    expect(initialPicks(garments)).toEqual({ 0: 'i1', 1: null });
    expect(chosenItemIds(garments, initialPicks(garments))).toEqual(['i1']);
  });

  it('lets the user correct a match', () => {
    const picks = setPick({ 0: 'i1' }, 0, 'i2');
    expect(picks[0]).toBe('i2');
  });

  it('clears the pick when the same item is chosen again', () => {
    expect(setPick({ 0: 'i1' }, 0, 'i1')).toEqual({ 0: null });
  });

  it('never wears one garment twice', () => {
    // Two detections both pointing at the same wardrobe item: the last wins.
    const picks = setPick({ 0: 'i1', 1: null }, 1, 'i1');
    expect(picks).toEqual({ 0: null, 1: 'i1' });
  });

  it('lists unmatched garments for the "add to wardrobe" flow', () => {
    const garments = [garment(0, 'hoodie', hoodie), garment(1, 'sneakers', null)];
    const picks = initialPicks(garments);
    expect(unmatchedGarments(garments, picks).map((g) => g.type)).toEqual(['sneakers']);
    // Once the user adds it, it stops being unmatched.
    expect(unmatchedGarments(garments, setPick(picks, 1, 'i9'))).toEqual([]);
  });

  it('keeps chosen ids unique and in garment order', () => {
    const garments = [garment(0, 'hoodie', hoodie), garment(1, 'jeans', jeans)];
    expect(chosenItemIds(garments, { 0: 'i1', 1: 'i3' })).toEqual(['i1', 'i3']);
    expect(chosenItemIds(garments, { 0: 'i1', 1: 'i1' })).toEqual(['i1']);
  });

  it('indexes every item the answer mentions, plus ones picked later', () => {
    const garments = [garment(0, 'hoodie', hoodie, [otherHoodie])];
    const map = itemsById(garments, [jeans]);
    expect(Array.from(map.keys()).sort()).toEqual(['i1', 'i2', 'i3']);
  });

  it('offers the match, the current pick and the alternatives without repeats', () => {
    const g = garment(0, 'hoodie', hoodie, [otherHoodie, hoodie]);
    expect(optionsFor(g, jeans).map((o) => o.id)).toEqual(['i1', 'i3', 'i2']);
    expect(optionsFor(g, null).map((o) => o.id)).toEqual(['i1', 'i2']);
  });
});

describe('selfie copy', () => {
  it('has the same keys in both languages', () => {
    const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === 'object'
          ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
          : [`${prefix}${k}`]
      );
    expect(flatten(en.selfie as Record<string, unknown>).sort()).toEqual(
      flatten(es.selfie as Record<string, unknown>).sort()
    );
  });

  it('tells the user in plain Spanish what happens to the photo', () => {
    const body = es.selfie.privacy.body;
    expect(body).toMatch(/no se guarda/i);
    expect(body).toMatch(/fecha y ubicación/i);
  });

  it('explains the feature when there is no AI', () => {
    expect(es.aiAccess.notice.feature.selfie).toBeTruthy();
    expect(en.aiAccess.notice.feature.selfie).toBeTruthy();
  });
});
