/**
 * Flat garment silhouettes for «Tu estilo con Stinky».
 *
 * One shared set of primitives, all drawn by hand in the same 100×100 box, so
 * every card in the deck is built from the same vocabulary instead of nineteen
 * unrelated drawings. Nothing here is fetched, scraped or generated: these are
 * plain path strings.
 *
 * Colours are CSS variables (or, for the palette cards, the palette's own
 * hexes) so the art works in light and dark. Every piece carries a hairline
 * outline in `currentColor`, which is what keeps a near-white garment readable
 * on a light card and a near-black one readable on a dark card.
 *
 * The art is decorative: the card title and description carry the meaning, so
 * the whole SVG is `aria-hidden`.
 */

export type GarmentId =
  | 'tee'
  | 'shirt'
  | 'hoodie'
  | 'knit'
  | 'blazer'
  | 'coat'
  | 'dress'
  | 'skirt'
  | 'trousers'
  | 'wide'
  | 'slim'
  | 'shorts'
  | 'sneaker'
  | 'boot'
  | 'bag';

interface GarmentShape {
  /** The filled silhouette, in a 100×100 box. */
  d: string;
  /** A second filled part in a darker tone (a sole, a waistband). */
  accent?: string;
  /** Stroke-only details: seams, collars, pockets, handles. */
  lines?: readonly string[];
}

export const GARMENTS: Record<GarmentId, GarmentShape> = {
  tee: {
    d: 'M34 14 L44 9 C47 17 53 17 56 9 L66 14 L88 25 L80 43 L70 38 L70 88 C58 91 42 91 30 88 L30 38 L20 43 L12 25 Z',
    lines: ['M44 9 C47 17 53 17 56 9'],
  },
  shirt: {
    d: 'M34 14 L44 9 C47 17 53 17 56 9 L66 14 L86 22 L93 60 L78 65 L76 89 C58 92 42 92 24 89 L22 65 L7 60 L14 22 Z',
    lines: ['M44 10 L50 22 L56 10', 'M50 22 V88', 'M78 65 L76 45', 'M22 65 L24 45'],
  },
  hoodie: {
    d: 'M33 22 C33 8 67 8 67 22 L86 29 L93 64 L78 69 L76 91 C58 94 42 94 24 91 L22 69 L7 64 L14 29 Z',
    lines: ['M35 20 C40 34 60 34 65 20', 'M46 30 V41', 'M54 30 V41', 'M34 68 H66 V82 H34 Z'],
  },
  knit: {
    d: 'M34 16 C40 25 60 25 66 16 L86 24 L92 62 L78 66 L77 88 C58 91 42 91 23 88 L22 66 L8 62 L14 24 Z',
    lines: ['M34 16 C40 25 60 25 66 16', 'M26 82 H74'],
  },
  blazer: {
    d: 'M32 14 L44 9 L50 36 L56 9 L68 14 L86 22 L92 60 L79 65 L77 90 C58 93 42 93 23 90 L21 65 L8 60 L14 22 Z',
    lines: ['M44 9 L50 36', 'M56 9 L50 36', 'M50 36 V90', 'M58 52 H70'],
  },
  coat: {
    d: 'M32 14 L44 9 C47 16 53 16 56 9 L68 14 L87 23 L93 66 L79 71 L78 96 L22 96 L21 71 L7 66 L13 23 Z',
    accent: 'M21 52 H79 V62 H21 Z',
    lines: ['M50 18 V96'],
  },
  dress: {
    d: 'M34 14 L44 9 C47 17 53 17 56 9 L66 14 L82 23 L75 36 L68 31 L80 84 C64 90 36 90 20 84 L32 31 L25 36 L18 23 Z',
    lines: ['M33 46 C44 50 56 50 67 46', 'M44 9 C47 17 53 17 56 9'],
  },
  skirt: {
    d: 'M30 12 H70 L84 78 C68 85 32 85 16 78 Z',
    accent: 'M30 12 H70 V21 H30 Z',
    lines: ['M50 24 V80'],
  },
  trousers: {
    d: 'M29 10 H71 L70 95 H55 L50 46 L45 95 H30 Z',
    accent: 'M29 10 H71 V19 H29 Z',
    lines: ['M50 20 V32'],
  },
  wide: {
    d: 'M30 10 H70 L85 95 H57 L50 48 L43 95 H15 Z',
    accent: 'M30 10 H70 V19 H30 Z',
    lines: ['M50 20 V32'],
  },
  slim: {
    d: 'M31 10 H69 L63 95 H54 L50 48 L46 95 H37 Z',
    accent: 'M31 10 H69 V19 H31 Z',
    lines: ['M50 20 V32'],
  },
  shorts: {
    d: 'M29 12 H71 L69 60 H54 L50 36 L46 60 H31 Z',
    accent: 'M29 12 H71 V21 H29 Z',
  },
  sneaker: {
    d: 'M10 60 C10 50 17 45 25 45 C33 45 36 52 44 57 C54 63 70 65 84 67 C90 68 92 71 92 75 H10 Z',
    accent: 'M8 74 H93 C95 74 95 85 89 85 H14 C9 85 7 80 8 74 Z',
    lines: ['M30 49 L38 60', 'M40 55 L48 65'],
  },
  boot: {
    d: 'M33 10 H61 L59 54 C59 66 72 70 83 74 C89 76 89 82 83 82 H36 C33 82 32 80 32 76 Z',
    accent: 'M30 80 H88 C91 80 91 89 86 89 H35 C31 89 29 86 30 80 Z',
    lines: ['M33 24 H60'],
  },
  bag: {
    d: 'M22 36 H78 L83 90 H17 Z',
    lines: ['M37 36 C37 19 63 19 63 36'],
  },
};

/** Texture fills. Each one is a real SVG pattern, not an image. */
export type TextureId = 'stripes' | 'check' | 'dots' | 'denim' | 'floral';

export const TEXTURES: readonly TextureId[] = ['stripes', 'check', 'dots', 'denim', 'floral'];

/**
 * The pattern tiles, parameterised by the garment colour underneath. Drawn in
 * user space, so a scaled-down garment gets a scaled-down texture.
 */
export function TexturePattern({ id, texture, base, ink }: { id: string; texture: TextureId; base: string; ink: string }) {
  const common = { id, patternUnits: 'userSpaceOnUse' as const };
  switch (texture) {
    case 'stripes':
      return (
        <pattern {...common} width="7" height="7">
          <rect width="7" height="7" fill={base} />
          <rect width="3" height="7" fill={ink} opacity="0.55" />
        </pattern>
      );
    case 'check':
      return (
        <pattern {...common} width="12" height="12">
          <rect width="12" height="12" fill={base} />
          <rect width="12" height="4" y="4" fill={ink} opacity="0.35" />
          <rect width="4" height="12" x="4" fill={ink} opacity="0.35" />
        </pattern>
      );
    case 'dots':
      return (
        <pattern {...common} width="14" height="14">
          <rect width="14" height="14" fill={base} />
          <ellipse cx="4" cy="4" rx="2.6" ry="2" fill={ink} opacity="0.6" />
          <ellipse cx="11" cy="10" rx="2.2" ry="2.8" fill={ink} opacity="0.6" />
        </pattern>
      );
    case 'denim':
      return (
        <pattern {...common} width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={base} />
          <rect width="6" height="2" fill={ink} opacity="0.38" />
        </pattern>
      );
    case 'floral':
      return (
        <pattern {...common} width="14" height="14">
          <rect width="14" height="14" fill={base} />
          <circle cx="4" cy="4" r="2.2" fill={ink} opacity="0.45" />
          <circle cx="11" cy="11" r="1.6" fill={ink} opacity="0.35" />
          <circle cx="11" cy="4" r="1" fill={ink} opacity="0.3" />
        </pattern>
      );
  }
}

export interface GarmentProps {
  shape: GarmentId;
  /** Any CSS colour: a token for the themed cards, a real hex for the palettes. */
  fill: string;
  /** Where the 100×100 box lands in the parent viewBox, and how big it is. */
  x: number;
  y: number;
  size: number;
  /** Optional texture; the caller has already put the matching pattern in defs. */
  patternId?: string;
  /** Ghosted silhouettes (the "not this" half of a fit diagram) fade back. */
  faded?: boolean;
}

/**
 * One garment, placed and scaled. The outline and the details are drawn in
 * `currentColor` with a non-scaling stroke, so they stay a hairline whatever
 * the card size and flip with the theme.
 */
export function Garment({ shape, fill, x, y, size, patternId, faded = false }: GarmentProps) {
  const g = GARMENTS[shape];
  const stroke = { stroke: 'currentColor', strokeWidth: 1.4, vectorEffect: 'non-scaling-stroke' as const };
  // A ghosted piece is drawn as an empty outline rather than a pale fill: that
  // survives both themes, where "a bit more transparent" does not.
  const body = faded ? 'var(--card)' : patternId ? `url(#${patternId})` : fill;
  const edge = faded ? 0.5 : 0.4;
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 100})`}>
      <path d={g.d} fill={body} strokeOpacity={edge} strokeLinejoin="round" {...stroke} />
      {g.accent && (
        <>
          <path d={g.accent} fill={body} strokeOpacity={0} {...stroke} />
          <path d={g.accent} fill="currentColor" fillOpacity={faded ? 0.06 : 0.16} strokeOpacity={edge * 0.8} {...stroke} />
        </>
      )}
      {g.lines?.map((d) => (
        <path key={d} d={d} fill="none" strokeOpacity={faded ? 0.4 : 0.34} strokeLinecap="round" {...stroke} />
      ))}
    </g>
  );
}
