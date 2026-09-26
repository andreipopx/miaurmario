/**
 * Every garment used to be drawn to fill its tile, so a hat came out the size of a
 * coat. These pin the proportions, and — just as importantly — pin that a garment we
 * cannot measure is left exactly as it is today.
 */

import { describe, expect, it } from 'vitest';

import {
  ROLE_FRAME_SHARE,
  garmentFrameScale,
  garmentFrameStyle,
  garmentFramingRole,
} from '@/lib/garment-framing';

describe('garmentFramingRole', () => {
  it('reads the shared role map', () => {
    expect(garmentFramingRole('coat')).toBe('outer_layer');
    expect(garmentFramingRole('jeans')).toBe('bottom');
    expect(garmentFramingRole('dress')).toBe('full_body');
    expect(garmentFramingRole('top')).toBe('base_top');
  });

  it('separates the things the body-slot map lumps together', () => {
    // All three are "accessory" to the backend, because that is about what a garment
    // covers. Here it is about how big it looks, and a hat is nothing like a bag.
    expect(garmentFramingRole('hat')).toBe('headwear');
    expect(garmentFramingRole('scarf')).toBe('neckwear');
    expect(garmentFramingRole('bag')).toBe('accessory');
  });

  it('is case-insensitive and falls back rather than throwing', () => {
    expect(garmentFramingRole('Coat')).toBe('outer_layer');
    expect(garmentFramingRole('something-new')).toBe('accessory');
    expect(garmentFramingRole(null)).toBe('accessory');
    expect(garmentFramingRole(undefined)).toBe('accessory');
  });
});

describe('garmentFrameScale', () => {
  it('leaves a photo with no cut-out completely alone', () => {
    // We have no idea where the garment is inside a white-backed photo, so shrinking
    // it would only shrink the white. Nothing may look worse than it does today.
    expect(garmentFrameScale('hat', false)).toBe(1);
    expect(garmentFrameScale('hat', undefined)).toBe(1);
  });

  it('draws a hat much smaller than a coat', () => {
    const hat = garmentFrameScale('hat', true);
    const coat = garmentFrameScale('coat', true);
    expect(hat).toBeLessThan(coat);
    expect(hat / coat).toBeLessThan(0.6);
  });

  it('puts the roles in a believable order', () => {
    const scale = (type: string) => garmentFrameScale(type, true);
    expect(scale('coat')).toBeGreaterThanOrEqual(scale('jeans'));
    expect(scale('jeans')).toBeGreaterThan(scale('t-shirt'));
    expect(scale('t-shirt')).toBeGreaterThan(scale('sneakers'));
    expect(scale('sneakers')).toBeGreaterThan(scale('socks'));
    expect(scale('socks')).toBeGreaterThan(scale('hat'));
  });

  it('never grows anything past the frame', () => {
    for (const share of Object.values(ROLE_FRAME_SHARE)) {
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the longest things at full size, so nothing shrinks for no reason', () => {
    expect(garmentFrameScale('coat', true)).toBe(1);
    expect(garmentFrameScale('dress', true)).toBe(1);
  });
});

describe('garmentFrameStyle', () => {
  it('is undefined when there is nothing to do, so no style is written at all', () => {
    expect(garmentFrameStyle('coat', true)).toBeUndefined();
    expect(garmentFrameStyle('hat', false)).toBeUndefined();
  });

  it('combines the turn and the scale rather than one replacing the other', () => {
    const style = garmentFrameStyle('hat', true, 1);
    expect(style?.transform).toContain('rotate(90deg)');
    expect(style?.transform).toContain(`scale(${ROLE_FRAME_SHARE.headwear})`);
  });

  it('carries the turn alone for a garment it will not rescale', () => {
    expect(garmentFrameStyle('shirt', false, 3)).toEqual({ transform: 'rotate(270deg)' });
  });

  it('normalises the turns, so a full circle is no transform', () => {
    expect(garmentFrameStyle('coat', true, 4)).toBeUndefined();
    expect(garmentFrameStyle('coat', true, -1)?.transform).toBe('rotate(270deg)');
  });
});
