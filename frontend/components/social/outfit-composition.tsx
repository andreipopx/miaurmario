'use client';

import Image from 'next/image';
import { Shirt } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SocialOutfitItem } from '@/lib/hooks/use-social';

function hasLayout(items: SocialOutfitItem[]): boolean {
  return items.some((i) => i.pos_x != null && i.pos_y != null);
}

/**
 * Read-only outfit thumbnail for social cards: the Studio canvas when the look
 * has a free-form layout, otherwise a 2×2 garment grid on the gray panel.
 * Image URLs come pre-signed from the API (only for outfits we may see).
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
                  alt={item.name || item.type}
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

  const shown = items.slice(0, 4);
  return (
    <div
      className={cn(
        'grid aspect-[3/4] w-full gap-1.5 overflow-hidden rounded-tile bg-panel p-2',
        shown.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
        shown.length > 2 ? 'grid-rows-2' : 'grid-rows-1',
        className
      )}
    >
      {shown.length === 0 && (
        <div className="flex items-center justify-center">
          <Shirt className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        </div>
      )}
      {shown.map((item) => {
        const src = item.thumbnail_url ?? item.image_url;
        return (
          <div key={item.id} className="relative min-h-0">
            {src ? (
              <Image
                src={src}
                alt={item.name || item.type}
                fill
                className="object-contain p-1 mix-blend-multiply dark:mix-blend-normal"
                sizes={sizes}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-tile bg-background/60">
                <Shirt className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
