'use client';

import { useId, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { RefreshCw, Shirt } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import {
  buildFlatLay,
  flatLayFace,
  flatLayTintFor,
  lookHasABack,
  type FlatLayFace,
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
 * stray white rectangle. A real cut-out (`has_cutout`) is left unclipped, so its
 * silhouette is whole and the shadow follows the garment rather than a card.
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
  /**
   * Whether to offer "ver por detrás" above the frame. On by default, because the
   * control pays for itself wherever a look is looked at; off where the frame is a
   * thumbnail too small to carry a label.
   */
  backToggle?: boolean;
  /**
   * Which side to show, when the caller owns the toggle. Hoy's moment card is the
   * reason this exists: the whole card is a link, and a button inside an anchor is
   * not valid HTML, so that screen renders `FlatLayBackToggle` above the link and
   * tells the frame what it chose. Left out, the frame keeps its own state.
   */
  showBack?: boolean;
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
  backToggle = true,
  showBack,
}: OutfitFlatLayProps<T>) {
  const t = useTranslations('flatLay');
  const typeLabel = useClothingTypeLabel();
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [ownShowBack, setOwnShowBack] = useState(false);
  const frameId = useId();
  const controlled = showBack !== undefined;
  const asked = controlled ? showBack : ownShowBack;

  const list = useMemo(() => (items ?? []).filter(Boolean) as T[], [items]);
  const shape = RATIOS[ratio] ?? RATIOS['4/5'];
  const { pieces, overflow } = useMemo(
    () => buildFlatLay(list, { max, aspect: shape.aspect }),
    [list, max, shape.aspect]
  );
  const tint = useMemo(() => flatLayTintFor(list), [list]);
  // Only what is actually in the frame counts: a back photo on the seventh garment,
  // which the "+2 más" swallowed, is not a back this frame can show.
  const canShowBack = useMemo(
    () => lookHasABack(pieces.map((piece) => piece.item)),
    [pieces]
  );
  // A look can lose its last back photo while the frame is open (the garment is
  // removed), and a toggle nobody can see must not still be holding the frame
  // backwards.
  const behind = Boolean(asked) && canShowBack;

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

  const composition = (
    <div
      id={frameId}
      className={frame}
      role="group"
      aria-label={label ?? (behind ? t('labelBack') : t('label'))}
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

      {pieces.map((piece) => {
        const name = piece.item.name || typeLabel(piece.item.type);
        const face = flatLayFace(piece.item, behind);
        return (
          <FlatLayGarment
            key={piece.item.id}
            piece={piece}
            face={face}
            name={face.missingBack ? t('noBackFor', { name }) : name}
            href={hrefForItem?.(piece.item)}
            badge={badgeForItem?.(piece.item)}
            openLabel={t('open', { name })}
            sizes={sizes}
            priority={priority}
            isLoaded={Boolean(loaded[faceKey(piece.item.id, face)])}
            onLoaded={() =>
              setLoaded((prev) => ({ ...prev, [faceKey(piece.item.id, face)]: true }))
            }
          />
        );
      })}

      {overflow > 0 && (
        <span className="absolute bottom-2 right-2 z-[200] rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-bold">
          {t('more', { count: overflow })}
        </span>
      )}
    </div>
  );

  if (controlled || !backToggle || !canShowBack) return composition;

  return (
    <div className="flex flex-col gap-2">
      {/* Above the frame, not on it: the frame is screenshot-safe and shared as an
          image, and a control baked into the picture would travel with it. */}
      <FlatLayBackToggle checked={behind} onChange={setOwnShowBack} controls={frameId} />
      {composition}
    </div>
  );
}

/**
 * "Ver por detrás". A plain `role="switch"` button rather than a styled checkbox:
 * it is one state with one name, it is reachable and operable from the keyboard
 * for free, and a screen reader reads it as on or off without any extra wiring.
 *
 * Exported because a caller that cannot nest a button inside its own markup has to
 * render this itself and feed the answer back to `OutfitFlatLay` as `showBack`.
 * Pair it with `lookHasABack` — never render it for a look with no back photo.
 */
export function FlatLayBackToggle({
  checked,
  onChange,
  controls,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The id of the frame this switch turns around, for assistive tech. */
  controls?: string;
  className?: string;
}) {
  const t = useTranslations('flatLay');
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-controls={controls}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex min-h-[44px] w-fit max-w-full items-center gap-2 self-start rounded-full px-3 py-2',
        'text-[13px] font-bold transition-colors motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'bg-signature text-signature-foreground' : 'bg-panel text-foreground hover:bg-accent',
        className
      )}
    >
      <RefreshCw
        className={cn(
          'h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none',
          checked && 'rotate-180'
        )}
        strokeWidth={2}
        aria-hidden
      />
      <span className="min-w-0 truncate">{t('seeBack')}</span>
    </button>
  );
}

/**
 * The loading key has to change when the photo does, or swapping to the back would
 * show the previous image's "already loaded" state over a picture still arriving.
 */
function faceKey(id: string, face: { thumbnail_url?: string | null; image_url?: string | null }) {
  return `${id}:${face.thumbnail_url || face.image_url || ''}`;
}

function FlatLayGarment<T extends FlatLayInput>({
  piece,
  face,
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
  face: FlatLayFace;
  name: string;
  href?: string;
  badge?: string | null;
  openLabel: string;
  sizes: string;
  priority: boolean;
  isLoaded: boolean;
  onLoaded: () => void;
}) {
  const src = face.thumbnail_url || face.image_url || null;
  const style: React.CSSProperties = {
    left: `${piece.x * 100}%`,
    top: `${piece.y * 100}%`,
    width: `${piece.width * 100}%`,
    transform: 'translate(-50%, -50%)',
    zIndex: piece.z,
  };

  // A real cut-out is transparent, so the shadow is already the shape of the
  // garment and there is nothing to clip: clipping it would shave the corner off a
  // wide jacket for no gain. A photo with white baked in keeps the rounded clip, or
  // it reads as a stray white rectangle lying over the others.
  //
  // Asked of the photo on screen, not of the garment: a cut-out back photo on a
  // white-backed front is a real combination, and drawing either one by the other's
  // flag is what would put a white rectangle over the look.
  const cutout = face.has_cutout === true;

  const body = (
    <span
      className={cn(
        'relative block h-full w-full',
        !cutout && 'overflow-hidden rounded-tile',
        'drop-shadow-[0_5px_10px_rgba(0,0,0,0.16)] dark:drop-shadow-[0_7px_14px_rgba(0,0,0,0.5)]',
        // "No tengo su espalda": still its front photo, and visibly standing in for
        // something we do not have. Opacity only — no blur, no filter — so the frame
        // stays as screenshot-safe as it was.
        face.missingBack && 'opacity-40'
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
            'object-contain transition-opacity duration-300 motion-reduce:transition-none',
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
