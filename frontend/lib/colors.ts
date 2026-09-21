import { CLOTHING_COLORS } from '@/lib/types';

/**
 * Colour maths for the preference picker: any colour the user picks on the
 * wheel is snapped to the nearest named colour the tagger/scorer understands
 * (CLOTHING_COLORS), using CIEDE2000 in CIELAB — perceptual distance, so a
 * dusty rose lands on "pink" and not on "red".
 */

export type ClothingColorValue = (typeof CLOTHING_COLORS)[number]['value'];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Invalid hex colour: ${hex}`);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return (
    '#' +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** h in [0, 360), s and l in [0, 1]. */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r1, g1, b1] = [0, 0, 0];
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function rgbToLab({ r, g, b }: Rgb): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  // sRGB -> XYZ (D65), normalised by the reference white.
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** CIEDE2000 colour difference (Sharma et al. 2005 reference implementation). */
export function ciede2000(lab1: Lab, lab2: Lab): number {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = C1p === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = C2p === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh)
  );
}

/**
 * The palette swatches are muted "real fabric" tones, so a vivid wheel pick
 * (pure green, electric blue) is perceptually closer to a dull neighbour
 * (khaki, charcoal) than to its own family. Extra anchors give each family a
 * few saturated/light variants; every anchor still resolves to a palette value.
 */
const EXTRA_ANCHORS: ReadonlyArray<[ClothingColorValue, string]> = [
  ['green', '#2E9E44'], ['green', '#00C853'], ['green', '#7ED957'], ['green', '#1B5E20'],
  ['blue', '#1E88E5'], ['blue', '#2962FF'], ['blue', '#3F51B5'],
  ['light-blue', '#4FC3F7'], ['light-blue', '#81D4FA'],
  ['teal', '#009688'], ['teal', '#00BCD4'],
  ['navy', '#0D1B5C'], ['navy', '#1A237E'],
  ['red', '#E53935'], ['red', '#FF1744'],
  ['burgundy', '#800020'],
  ['pink', '#FF4FA3'], ['pink', '#F48FB1'], ['pink', '#FF80AB'],
  ['purple', '#8E24AA'], ['purple', '#7C4DFF'], ['purple', '#B39DDB'], ['purple', '#4A148C'],
  ['yellow', '#FFEB3B'], ['yellow', '#FFD600'],
  ['orange', '#FF9800'], ['orange', '#FF6D00'],
  ['brown', '#8B4513'],
];

const PALETTE_LAB = [
  ...CLOTHING_COLORS.map((c) => ({ value: c.value as ClothingColorValue, lab: rgbToLab(hexToRgb(c.hex)) })),
  ...EXTRA_ANCHORS.map(([value, hex]) => ({ value, lab: rgbToLab(hexToRgb(hex)) })),
];

/** Nearest named clothing colour (tag value) for any hex. */
export function nearestClothingColor(hex: string): ClothingColorValue {
  const lab = rgbToLab(hexToRgb(hex));
  let best = PALETTE_LAB[0];
  let bestDist = Infinity;
  for (const entry of PALETTE_LAB) {
    const d = ciede2000(lab, entry.lab);
    if (d < bestDist) {
      bestDist = d;
      best = entry;
    }
  }
  return best.value;
}

export function clothingColorHex(value: string): string | undefined {
  return CLOTHING_COLORS.find((c) => c.value === value)?.hex;
}

/** Ink or white glyph on top of a swatch, by relative luminance. */
export function isLightColor(hex: string): boolean {
  try {
    const { r, g, b } = hexToRgb(hex);
    const lum = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
    return lum > 0.4;
  } catch {
    return false;
  }
}

/** Preset palettes that add several named colours at once. */
export const COLOR_PRESETS: ReadonlyArray<{ id: string; colors: ClothingColorValue[] }> = [
  { id: 'earth', colors: ['tan', 'khaki', 'olive', 'brown', 'dark-brown', 'cream'] },
  { id: 'pastel', colors: ['pink', 'light-blue', 'cream', 'yellow', 'purple'] },
  { id: 'mono', colors: ['black', 'charcoal', 'gray', 'white'] },
  { id: 'neutrals', colors: ['white', 'cream', 'beige', 'tan', 'gray', 'navy', 'black'] },
  { id: 'neon', colors: ['pink', 'yellow', 'orange', 'green', 'light-blue'] },
  { id: 'jewel', colors: ['burgundy', 'teal', 'purple', 'navy', 'green', 'gold'] },
];
