'use client';

import { useId } from 'react';

import { Garment, TexturePattern, type GarmentId, type TextureId } from '@/components/style-quiz/garment-shapes';
import type { StyleCard } from '@/lib/style-quiz/cards';
import { cn } from '@/lib/utils';

/**
 * What each card in «Tu estilo con Stinky» actually looks like.
 *
 * Every card is a little flat-lay built from the shared silhouettes in
 * `garment-shapes.tsx`: two or three pieces that embody the look, a texture
 * where the texture *is* the point (denim, rayas, cuadros), the palette's real
 * colours for the palette cards, and a two-silhouette diagram for the fit
 * cards (holgado vs ajustado, recto vs ancho).
 *
 * All of it is decorative — the title, the description and the examples in the
 * copy carry the meaning — so the SVG is `aria-hidden`.
 */

/** Everything is laid out in this box; the SVG scales it to whatever it gets. */
const VIEW = { w: 180, h: 104 };

/** Tones resolve to CSS variables, so a card is legible in light and dark. */
const TONES: Record<string, string> = {
  ink: 'var(--foreground)',
  mid: 'color-mix(in srgb, var(--foreground) 38%, var(--card))',
  soft: 'color-mix(in srgb, var(--foreground) 11%, var(--card))',
  amber: 'var(--pop-amber)',
  sky: 'var(--pop-sky)',
  mint: 'var(--pop-mint)',
  pink: 'var(--pop-pink)',
};

/** Anything that is not a tone name is used as-is: the palette cards pass hexes. */
const toneOf = (tone: string) => TONES[tone] ?? tone;

interface Piece {
  shape: GarmentId;
  tone: string;
  texture?: TextureId;
  x: number;
  y: number;
  size: number;
  /** The "not this one" half of a fit diagram. */
  faded?: boolean;
}

/** The flat-lay: top, bottom and a third piece, cascading down to the right. */
const SLOTS = [
  { x: 2, y: 2, size: 70 },
  { x: 54, y: 28, size: 76 },
  { x: 120, y: 44, size: 58 },
] as const;

type Spec = readonly [GarmentId, string, TextureId?];

/** A bag or a shoe standing in for a garment sits smaller, centred in its slot. */
const ACCESSORIES = new Set<GarmentId>(['bag', 'sneaker', 'boot']);

const outfit = (...pieces: readonly Spec[]): Piece[] =>
  pieces.map(([shape, tone, texture], i) => {
    const slot = SLOTS[i];
    const size = i < 2 && ACCESSORIES.has(shape) ? Math.round(slot.size * 0.72) : slot.size;
    const inset = (slot.size - size) / 2;
    return { shape, tone, texture, x: slot.x + inset, y: slot.y + inset, size };
  });

/**
 * Three tops lined up at the shoulder so the hems step down: a tee, a jacket
 * over it and a long coat over that. The staircase is what "ir por capas" is.
 */
const layered: Piece[] = [
  { shape: 'tee', tone: 'soft', x: 4, y: 8, size: 48 },
  { shape: 'blazer', tone: 'mid', x: 48, y: 8, size: 62 },
  { shape: 'coat', tone: 'ink', x: 104, y: 8, size: 72 },
];

/**
 * The fit diagram: the same two outfits on both cards — close on the left,
 * roomy on the right — with the card's own answer in full colour and the other
 * one ghosted, so the contrast is the illustration.
 */
const fitDiagram = (loose: boolean): Piece[] => [
  { shape: 'tee', tone: loose ? 'soft' : 'ink', x: 20, y: 16, size: 50, faded: loose },
  { shape: 'slim', tone: loose ? 'soft' : 'sky', x: 19, y: 50, size: 52, faded: loose },
  { shape: 'tee', tone: loose ? 'ink' : 'soft', x: 98, y: 8, size: 64, faded: !loose },
  { shape: 'wide', tone: loose ? 'sky' : 'soft', x: 100, y: 46, size: 60, faded: !loose },
];

/** Straight leg next to wide leg, same drawing, same scale. */
const legDiagram: Piece[] = [
  { shape: 'trousers', tone: 'soft', x: 18, y: 6, size: 92, faded: true },
  { shape: 'wide', tone: 'ink', x: 78, y: 6, size: 92 },
];

/** Looks and silhouettes. The palette cards are built from their own swatches. */
const ART: Record<string, Piece[]> = {
  minimal: outfit(['tee', 'soft'], ['trousers', 'ink'], ['sneaker', 'soft']),
  streetwear: outfit(['hoodie', 'ink'], ['wide', 'sky', 'denim'], ['sneaker', 'amber']),
  tailored: outfit(['blazer', 'ink'], ['trousers', 'mid'], ['boot', 'ink']),
  boho: outfit(['dress', 'amber', 'floral'], ['bag', 'mid'], ['boot', 'mid']),
  preppy: outfit(['knit', 'mint'], ['skirt', 'sky', 'check'], ['sneaker', 'soft']),
  vintage: outfit(['shirt', 'amber', 'stripes'], ['trousers', 'sky', 'denim'], ['bag', 'mid']),
  sporty: outfit(['tee', 'mint'], ['shorts', 'ink'], ['sneaker', 'sky']),
  romantic: outfit(['dress', 'pink', 'floral'], ['bag', 'soft'], ['boot', 'soft']),
  utility: outfit(['coat', 'mid'], ['wide', 'ink'], ['boot', 'ink']),
  oversize: fitDiagram(true),
  fitted: fitDiagram(false),
  'wide-leg': legDiagram,
  layers: layered,
};

/**
 * Palette cards wear their own colours: the same three-piece outfit painted
 * with the swatches the card is about, so "neutros cálidos" is a beige top and
 * a camel trouser rather than four dots.
 */
const PALETTE_ORDER: Record<string, readonly [number, number, number]> = {
  monochrome: [2, 0, 1],
  neutrals: [0, 2, 1],
  'black-white': [3, 0, 2],
  pastels: [1, 0, 2],
  brights: [1, 3, 0],
  jewel: [0, 2, 1],
};

const PALETTE_SHAPES: readonly GarmentId[] = ['tee', 'trousers', 'sneaker'];

function piecesFor(card: StyleCard): Piece[] {
  if (card.swatches?.length) {
    const order = PALETTE_ORDER[card.id] ?? [0, 1, 2];
    return PALETTE_SHAPES.map((shape, i) => ({
      shape,
      tone: card.swatches![order[i] % card.swatches!.length],
      ...SLOTS[i],
    }));
  }
  return ART[card.id] ?? outfit(['tee', 'soft'], ['trousers', 'mid'], ['sneaker', 'soft']);
}

export interface StyleCardArtProps {
  card: StyleCard;
  className?: string;
}

/** The illustration for one card. Decorative: the copy says what it means. */
export function StyleCardArt({ card, className }: StyleCardArtProps) {
  // `useId` can contain characters that are awkward inside url(#…).
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const pieces = piecesFor(card);
  const textured = pieces.filter((p) => p.texture);

  return (
    <svg
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      focusable="false"
      role="presentation"
      data-testid={`style-card-art-${card.id}`}
      className={cn('h-full w-full text-foreground', className)}
    >
      <defs>
        {textured.map((p, i) => (
          <TexturePattern
            key={`${p.shape}-${i}`}
            id={`${uid}-${i}`}
            texture={p.texture!}
            base={toneOf(p.tone)}
            ink="var(--foreground)"
          />
        ))}
      </defs>
      {/* A calm surface behind the garments, so a near-white piece still reads
          on a light tint and a near-black one on a dark one. */}
      <rect
        x="0.7"
        y="0.7"
        width={VIEW.w - 1.4}
        height={VIEW.h - 1.4}
        rx="13"
        fill="var(--card)"
        stroke="currentColor"
        strokeOpacity={0.12}
        strokeWidth={1.4}
        vectorEffect="non-scaling-stroke"
      />
      {pieces.map((p, i) => (
        <Garment
          key={`${p.shape}-${i}`}
          shape={p.shape}
          fill={toneOf(p.tone)}
          x={p.x}
          y={p.y}
          size={p.size}
          faded={p.faded}
          patternId={p.texture ? `${uid}-${textured.indexOf(p)}` : undefined}
        />
      ))}
    </svg>
  );
}
