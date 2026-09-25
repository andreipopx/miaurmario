'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { OutfitFlatLay } from '@/components/outfits/outfit-flat-lay';
import type { SocialOutfitItem } from '@/lib/hooks/use-social';

function hasLayout(items: SocialOutfitItem[]): boolean {
  return items.some((i) => i.pos_x != null && i.pos_y != null);
}

/**
 * Read-only outfit thumbnail for social cards: the Studio canvas when the look
 * has a free-form layout, otherwise an automatic flat lay so a friend's look
 * reads as one composed image instead of a 2×2 grid of thumbnails.
 * Image URLs come pre-signed from the API (only for outfits we may see).
 *
 * The garments are not links here — they are someone else's wardrobe.
 */
export function OutfitComposition({
  items,
  className,
  sizes = '(max-width: 640px) 80vw, 320px',
}: {
  items: SocialOutfitItem[];
  className?: string;
  sizes?: string;
}) {
  const typeLabel = useClothingTypeLabel();

  if (hasLayout(items)) {
    return (
      <div className={cn('relative aspect-[3/4] w-full overflow-hidden rounded-tile bg-panel', className)}>
        {items.map((item) => {
          const src = item.thumbnail_url ?? item.image_url;
          return (
            <div
              key={item.id}
              className="absolute aspect-square w-[30%]"
              style={{
                left: `${(item.pos_x ?? 0.5) * 100}%`,
                top: `${(item.pos_y ?? 0.5) * 100}%`,
                transform: `translate(-50%, -50%) scale(${item.scale ?? 1}) rotate(${item.rotation ?? 0}deg)`,
                zIndex: item.z_index ?? 0,
              }}
            >
              {src && (
                <Image
                  src={src}
                  alt={item.name || typeLabel(item.type)}
                  fill
                  className="object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.15)]"
                  sizes="30vw"
                  draggable={false}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return <OutfitFlatLay items={items} ratio="3/4" className={className} sizes={sizes} />;
}
