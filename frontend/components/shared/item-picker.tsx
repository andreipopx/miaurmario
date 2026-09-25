'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Check, Loader2, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';

import { Input } from '@/components/ui/input';
import { useItems } from '@/lib/hooks/use-items';
import { cn } from '@/lib/utils';
import type { Item } from '@/lib/types';

const PAGE_SIZE = 24;

interface ItemPickerProps {
  selectedIds: Set<string>;
  onToggle: (item: Item) => void;
  hideNeedsWash?: boolean;
  filterType?: string;
  emptyMessage?: string;
  heightClass?: string;
}

export function ItemPicker({
  selectedIds,
  onToggle,
  hideNeedsWash = true,
  filterType,
  emptyMessage,
  heightClass = 'h-[360px]',
}: ItemPickerProps) {
  const t = useTranslations('itemPicker');
  const typeLabel = useClothingTypeLabel();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [accumulatedItems, setAccumulatedItems] = useState<Item[]>([]);
  const [accVersion, setAccVersion] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
      setAccumulatedItems([]);
      setAccVersion((v) => v + 1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: itemsData, isLoading, isFetching } = useItems(
    {
      search: debouncedSearch || undefined,
      is_archived: false,
      type: filterType,
      needs_wash: hideNeedsWash ? false : undefined,
    },
    page,
    PAGE_SIZE
  );

  const hasMore = itemsData?.has_more ?? false;
  const totalItems = itemsData?.total ?? 0;

  useEffect(() => {
    if (itemsData?.items) {
      if (page === 1) {
        setAccumulatedItems(itemsData.items);
      } else {
        setAccumulatedItems((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const newItems = itemsData.items.filter(
            (i) => !existingIds.has(i.id)
          );
          return [...prev, ...newItems];
        });
      }
    }
  }, [itemsData?.items, page, accVersion]);

  const items =
    accumulatedItems.length > 0 ? accumulatedItems : itemsData?.items ?? [];

  const loadMore = useCallback(() => {
    if (hasMore && !isFetching) {
      setPage((p) => p + 1);
    }
  }, [hasMore, isFetching]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.target as HTMLDivElement;
      const nearBottom =
        target.scrollHeight - target.scrollTop <= target.clientHeight + 100;
      if (nearBottom) loadMore();
    },
    [loadMore]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t('search')}
          aria-label={t('search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-11 border-transparent bg-panel pl-10"
        />
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={cn('-mx-1 overflow-y-auto px-1 py-2', heightClass)}
      >
        <div className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 md:grid-cols-5">
          {items.map((item) => {
            const isSelected = selectedIds.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggle(item)}
                aria-pressed={isSelected}
                className="group min-w-0 rounded-tile text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div
                  className={cn(
                    'relative aspect-square overflow-hidden rounded-tile bg-panel transition-shadow duration-150',
                    isSelected
                      ? 'ring-[2.5px] ring-inset ring-signature'
                      : 'group-hover:ring-[1.5px] group-hover:ring-inset group-hover:ring-border'
                  )}
                >
                  {item.thumbnail_url || item.image_url ? (
                    <Image
                      src={(item.thumbnail_url || item.image_url)!}
                      alt={item.name || typeLabel(item.type)}
                      fill
                      className="object-contain p-2"
                      sizes="(max-width: 640px) 33vw, 20vw"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="text-xs text-muted-foreground">
                        {typeLabel(item.type)}
                      </span>
                    </div>
                  )}
                  {isSelected && (
                    <div className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-signature text-signature-foreground">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </div>
                  )}
                </div>
                <span className="mt-1 block truncate px-0.5 text-xs font-semibold">
                  {item.name ?? typeLabel(item.type)}
                </span>
              </button>
            );
          })}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isFetching && !isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {t('loadingMore')}
            </span>
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {debouncedSearch ? t('empty') : (emptyMessage ?? t('empty'))}
          </div>
        )}

        {!isLoading && !hasMore && items.length > 0 && (
          <div className="text-center text-xs text-muted-foreground py-3">
            {t('results', { count: totalItems })}
          </div>
        )}
      </div>
    </div>
  );
}
