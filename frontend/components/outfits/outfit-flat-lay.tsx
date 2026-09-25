'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Shirt } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import {
  buildFlatLay,
  flatLayTintFor,
  type FlatLayInput,
  type FlatLayPiece,
} from '@/lib/outfit-flat-lay';

/**
 * Frame shapes. 4:5 is the default because that is the shape a shared look
 * wants; the others exist so a flat lay can stand in for an existing tile
 * without changing a screen's rhythm.
 */
const RATIOS = {
  '4/5': { aspect: 4 / 5, className: 'aspect-[4/5]' },
  '3/4': { aspect: 3 / 4, className: 'aspect-[3/4]' },
  '1/1': { aspect: 1, className: 'aspect-square' },
} as const;

export type FlatLayRatio = keyof typeof RATIOS;

/**
 * A look as one image instead of four thumbnails: the garment cut-outs float
 * together on a soft tint of the look's own dominant colour, top above the
 * bottom, shoes below, accessories tucked beside.
 *
 * The arrangement comes from `lib/outfit-flat-lay` — deterministic, derived
 * from each garment's role, never dragged. (The Studio canvas is the editable
 * one; this is the automatic one, and the two stay separate on purpose.)
 *
 * Deliberately screenshot-safe, because this is also the basis for sharing a
 * look later: a fixed 4:5 frame, no sticky positioning, no backdrop filters,
 * no blend modes — only images, a background and a shadow.
 *
 * Garments whose photo was never cut out keep their own background; they are
 * clipped to a rounded tile so they read as a deliberate tile rather than a
 * stray white rectangle.
 */

interface OutfitFlatLayProps<T extends FlatLayInput> {
  items: readonly T[] | null | undefined;
  className?: string;
  /**
   * When provided, every garment becomes a link to itself, so a tap on a piece
   * opens that item. Leave it out where the flat lay already sits inside a link
   * (Hoy's moment card) or where the garments are not the viewer's (the feed).
   */
  hrefForItem?: (item: T) => string;
  /** Overrides the default "the whole look" group label. */
  label?: string;
  /** Optional short pill on a piece, e.g. Hoy marking what changed in a transition. */
  badgeForItem?: (item: T) => string | null | undefined;
  ratio?: FlatLayRatio;
  max?: number;
  sizes?: string;
  priority?: boolean;
}

function srcOf(item: FlatLayInput): string | null {
  return item.thumbnail_url || item.image_url || null;
}

export function OutfitFlatLay<T extends FlatLayInput>({
  items,
  className,
  hrefForItem,
  label,
  badgeForItem,
  ratio = '4/5',
  max,
  sizes = '(max-width: 640px) 90vw, 360px',
  priority = false,
}: OutfitFlatLayProps<T>) {
  const t = useTranslations('flatLay');
  const typeLabel = useClothingTypeLabel();
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  const list = useMemo(() => (items ?? []).filter(Boolean) as T[], [items]);
  const shape = RATIOS[ratio] ?? RATIOS['4/5'];
  const { pieces, overflow } = useMemo(
    () => buildFlatLay(list, { max, aspect: shape.aspect }),
    [list, max, shape.aspect]
  );
  const tint = useMemo(() => flatLayTintFor(list), [list]);

  const frame = cn(
    'relative w-full overflow-hidden rounded-tile bg-panel',
    shape.className,
    className
  );

  if (pieces.length === 0) {
    return (
      <div className={frame} role="img" aria-label={t('empty')}>
        <span className="absolute inset-0 flex items-center justify-center">
          <Shirt className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        </span>
      </div>
    );
  }

  return (
    <div
      className={frame}
      role="group"
      aria-label={label ?? t('label')}
      style={
        tint
          ? ({
              '--flatlay-tint': tint.light,
              '--flatlay-tint-dark': tint.dark,
            } as React.CSSProperties)
          : undefined
      }
    >
      {tint && (
        <span
          aria-hidden
          className="absolute inset-0 bg-[var(--flatlay-tint)] dark:bg-[var(--flatlay-tint-dark)]"
        />
      )}
      {/* A breath of light from above so the pieces sit on a surface. */}
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-white/50 via-transparent to-black/[0.05] dark:from-white/[0.06] dark:to-black/20"
      />

      {pieces.map((piece) => (
        <FlatLayGarment
          key={piece.item.id}
          piece={piece}
          name={piece.item.name || typeLabel(piece.item.type)}
          href={hrefForItem?.(piece.item)}
          badge={badgeForItem?.(piece.item)}
          openLabel={t('open', { name: piece.item.name || typeLabel(piece.item.type) })}
          sizes={sizes}
          priority={priority}
          isLoaded={Boolean(loaded[piece.item.id])}
          onLoaded={() => setLoaded((prev) => ({ ...prev, [piece.item.id]: true }))}
        />
      ))}

      {overflow > 0 && (
        <span className="absolute bottom-2 right-2 z-[200] rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-bold">
          {t('more', { count: overflow })}
        </span>
      )}
    </div>
  );
}

function FlatLayGarment<T extends FlatLayInput>({
  piece,
  name,
  href,
  badge,
  openLabel,
  sizes,
  priority,
  isLoaded,
  onLoaded,
}: {
  piece: FlatLayPiece<T>;
  name: string;
  href?: string;
  badge?: string | null;
  openLabel: string;
  sizes: string;
  priority: boolean;
  isLoaded: boolean;
  onLoaded: () => void;
}) {
  const src = srcOf(piece.item);
  const style: React.CSSProperties = {
    left: `${piece.x * 100}%`,
    top: `${piece.y * 100}%`,
    width: `${piece.width * 100}%`,
    transform: 'translate(-50%, -50%)',
    zIndex: piece.z,
  };

  const body = (
    <span
      className={cn(
        'relative block h-full w-full overflow-hidden rounded-tile',
        'drop-shadow-[0_5px_10px_rgba(0,0,0,0.16)] dark:drop-shadow-[0_7px_14px_rgba(0,0,0,0.5)]'
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={href ? '' : name}
          fill
          sizes={sizes}
          priority={priority}
          draggable={false}
          onLoad={onLoaded}
          onError={onLoaded}
          className={cn(
            'object-contain transition-opacity duration-300',
            isLoaded ? 'opacity-100' : 'opacity-0'
          )}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-tile bg-background/60">
          <Shirt className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        </span>
      )}
      {src && !isLoaded && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse rounded-tile bg-foreground/[0.07]"
        />
      )}
    </span>
  );

  const content = badge ? (
    <>
      {body}
      <span className="absolute -left-1 -top-1 rounded-full bg-signature px-2 py-0.5 text-[11px] font-bold text-signature-foreground">
        {badge}
      </span>
    </>
  ) : (
    body
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={openLabel}
        title={name}
        style={style}
        className="absolute aspect-square rounded-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
      >
        {content}
      </Link>
    );
  }

  return (
    <span style={style} className="absolute aspect-square">
      {content}
    </span>
  );
}
