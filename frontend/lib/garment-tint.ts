/**
 * The soft plate a garment photo sits on.
 *
 * Cut-outs are stored as white-backed JPEGs and drawn with `mix-blend-multiply`,
 * so whatever is behind the tile shows through the white. Flat white behind every
 * tile makes a grid of floating rectangles; a whisper of the garment's own colour
 * makes each tile feel like it belongs to that garment while the grid still reads
 * as one surface. "A whisper" is the whole point: the saturation is capped hard
 * and the lightness is high, because a tint you can name is a tint that fights
 * the clothes.
 *
 * Both themes get a value. The plate stays light in the dark theme too — multiply
 * over a dark plate would swallow the garment — just deeper and duller, so it
 * reads as a dusky card rather than a torch.
 */

import { hexToRgb } from '@/lib/colors';
import { CLOTHING_COLORS } from '@/lib/types';

export interface GarmentTint {
  /** Light theme plate. */
  light: string;
  /** Dark theme plate: the same hue, deeper and duller. */
  dark: string;
}

/**
 * Below this the colour has no hue worth tinting with: black, white, the greys,
 * and the blue-grey ones like charcoal whose cast is real but far too faint to
 * survive being washed out to a 3% plate.
 */
const MIN_CHROMA = 0.12;

const LIGHT = { saturation: 0.3, lightness: 0.955, maxSaturation: 0.26 };
const DARK = { saturation: 0.22, lightness: 0.8, maxSaturation: 0.2 };

function rgbToHsl(hex: string): { h: number; s: number; l: number } | null {
  let rgb;
  try {
    rgb = hexToRgb(hex);
  } catch {
    return null;
  }
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: ((h * 60) % 360 + 360) % 360, s, l };
}

function plate(h: number, chroma: number, spec: typeof LIGHT): string {
  const s = Math.min(spec.maxSaturation, chroma * spec.saturation);
  return `hsl(${Math.round(h)} ${(s * 100).toFixed(1)}% ${(spec.lightness * 100).toFixed(1)}%)`;
}

/** The named palette's hex for a tag value, if it is one we know. */
function hexForNamedColor(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return CLOTHING_COLORS.find((c) => c.value === value)?.hex;
}

/**
 * The plate for a garment, or `null` when there is nothing to derive it from.
 *
 * `null` covers three cases that all want the neutral panel: no colour recorded
 * yet, a colour we do not know, and the greys — a "tinted" black jumper would
 * just be a dirty tile. Callers fall back to `bg-panel`.
 *
 * `hex` is the garment's measured colour if we have one (feat/color-capture
 * stores one); otherwise the named colour's swatch is close enough, since the
 * result is a 4%-saturation wash either way.
 */
export function garmentTint(
  color: string | null | undefined,
  hex?: string | null
): GarmentTint | null {
  const source = hex || hexForNamedColor(color);
  if (!source) return null;
  const hsl = rgbToHsl(source);
  if (!hsl) return null;
  // Chroma, not saturation: HSL saturation goes to 1 for near-black and near-white,
  // which would tint the very colours that must stay neutral.
  const chroma = hsl.s * (1 - Math.abs(2 * hsl.l - 1));
  if (chroma < MIN_CHROMA) return null;
  return {
    light: plate(hsl.h, chroma, LIGHT),
    dark: plate(hsl.h, chroma, DARK),
  };
}

/**
 * Style + class for a tile that holds a garment cut-out.
 *
 * Returned together because they have to agree: the custom properties carry the
 * two plates and the class picks one per theme, falling back to the panel colour
 * when there is no tint.
 */
export function garmentTileTint(color: string | null | undefined, hex?: string | null) {
  const tint = garmentTint(color, hex);
  if (!tint) return { className: 'bg-panel', style: undefined };
  return {
    className: 'bg-[var(--tile-tint)] dark:bg-[var(--tile-tint-dark)]',
    style: {
      '--tile-tint': tint.light,
      '--tile-tint-dark': tint.dark,
    } as React.CSSProperties,
  };
}
