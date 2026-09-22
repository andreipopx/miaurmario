import { describe, expect, it } from 'vitest';
import {
  MAX_AVATAR_BYTES,
  MAX_ZOOM,
  avatarFileError,
  centred,
  clampOffset,
  cropBox,
  zoomAt,
} from '@/lib/avatar-crop';
import { avatarSrcFor } from '@/components/social/person-avatar';
import { avatarErrorKey } from '@/components/settings/avatar-settings';
import { ApiError } from '@/lib/api';

const VIEW = 200;
const landscape = { width: 400, height: 200 };

describe('avatar crop geometry', () => {
  it('starts centred and covering the viewport', () => {
    const s = centred(landscape, VIEW);
    expect(s).toEqual({ zoom: 1, x: -100, y: 0 });
    expect(cropBox(landscape, VIEW, s)).toEqual({ x: 100, y: 0, size: 200 });
  });

  it('never lets the image leave the viewport', () => {
    const s = clampOffset(landscape, VIEW, { zoom: 1, x: 50, y: 30 });
    expect(s).toEqual({ zoom: 1, x: 0, y: 0 });
    const far = clampOffset(landscape, VIEW, { zoom: 1, x: -9999, y: -9999 });
    expect(far).toEqual({ zoom: 1, x: -200, y: 0 });
    expect(cropBox(landscape, VIEW, far)).toEqual({ x: 200, y: 0, size: 200 });
  });

  it('zooming around the centre keeps the centre and shrinks the square', () => {
    const s = zoomAt(landscape, VIEW, centred(landscape, VIEW), 2);
    const box = cropBox(landscape, VIEW, s);
    expect(box.size).toBe(100);
    expect(box.x + box.size / 2).toBe(200);
    expect(box.y + box.size / 2).toBe(100);
  });

  it('clamps zoom to [1, MAX_ZOOM]', () => {
    expect(zoomAt(landscape, VIEW, centred(landscape, VIEW), 99).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(landscape, VIEW, centred(landscape, VIEW), 0.1).zoom).toBe(1);
  });

  it('crop box stays inside the image', () => {
    const portrait = { width: 300, height: 900 };
    for (const [x, y, zoom] of [
      [0, 0, 1],
      [-5000, -5000, 3.3],
      [10, -400, 2],
    ]) {
      const box = cropBox(portrait, VIEW, clampOffset(portrait, VIEW, { x, y, zoom }));
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.size).toBeLessThanOrEqual(portrait.width);
      expect(box.y + box.size).toBeLessThanOrEqual(portrait.height);
    }
  });
});

describe('avatar file pre-check', () => {
  it('accepts common formats incl. HEIC', () => {
    expect(avatarFileError({ type: 'image/jpeg', size: 1000, name: 'a.jpg' })).toBeNull();
    expect(avatarFileError({ type: 'image/heic', size: 1000, name: 'a.heic' })).toBeNull();
    // Some browsers leave HEIC's type empty.
    expect(avatarFileError({ type: '', size: 1000, name: 'IMG_1.HEIC' })).toBeNull();
  });

  it('rejects other types and big files', () => {
    expect(avatarFileError({ type: 'image/gif', size: 1000, name: 'a.gif' })).toBe('type');
    expect(avatarFileError({ type: 'application/pdf', size: 1000, name: 'a.pdf' })).toBe('type');
    expect(avatarFileError({ type: 'image/png', size: MAX_AVATAR_BYTES + 1, name: 'a.png' })).toBe('size');
  });
});

describe('PersonAvatar source', () => {
  const user = { username: 'ana', display_name: 'ana', avatar_url: '/full', avatar_thumb_url: '/thumb' };

  it('small avatars use the thumb, big ones the full photo', () => {
    expect(avatarSrcFor(user, 40)).toBe('/thumb');
    expect(avatarSrcFor(user, 96)).toBe('/full');
  });

  it('falls back between sizes and to initials (null)', () => {
    expect(avatarSrcFor({ ...user, avatar_thumb_url: null }, 40)).toBe('/full');
    expect(avatarSrcFor({ ...user, avatar_url: null }, 96)).toBe('/thumb');
    expect(avatarSrcFor({ ...user, avatar_url: null, avatar_thumb_url: null }, 40)).toBeNull();
  });
});

describe('avatar upload errors', () => {
  it('maps server codes to message keys', () => {
    expect(avatarErrorKey(new ApiError('unsupported_image_type', 415, {}))).toBe('type');
    expect(avatarErrorKey(new ApiError('image_too_large', 413, {}))).toBe('size');
    expect(avatarErrorKey(new ApiError('invalid_image', 400, {}))).toBe('invalid');
    expect(avatarErrorKey(new ApiError('Too many', 429, {}))).toBe('rateLimited');
    expect(avatarErrorKey(new Error('boom'))).toBe('generic');
  });
});
