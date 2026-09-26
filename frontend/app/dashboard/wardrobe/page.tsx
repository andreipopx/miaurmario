'use client';

import { memo, useCallback, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';
import { Plus, Search, Heart, Loader2, AlertCircle, RefreshCw, Droplets, ArrowUpDown, SlidersHorizontal, X, Shirt, ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// Heavy dialogs (uploader, detail editor, colour tools) load in their own chunks after the grid.
const AddItemDialog = dynamic(() => import('@/components/add-item-dialog').then((m) => m.AddItemDialog), { ssr: false });
const ItemDetailDialog = dynamic(() => import('@/components/item-detail-dialog').then((m) => m.ItemDetailDialog), {
  ssr: false,
});
import { BulkActionToolbar, BulkSelection } from '@/components/bulk-action-toolbar';
import { MergeBackDialog } from '@/components/merge-back-dialog';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Chip, popColorAt } from '@/components/chip';
import { useItems, useItem, useItemTypes, useReanalyzeItem, useCancelAnalysis, useBulkDeleteItems, useBulkReanalyzeItems, BulkOperationParams } from '@/lib/hooks/use-items';
import { useUserProfile } from '@/lib/hooks/use-user';
import { Item } from '@/lib/types';
import { swatchHex } from '@/lib/colors';
import { garmentFrameStyle } from '@/lib/garment-framing';
import { toast } from 'sonner';
import { cn, getDaysSinceDateInTimezone } from '@/lib/utils';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { useTranslations } from 'next-intl';
import { useColorLabel } from '@/lib/tag-labels';
import { garmentTileTint } from '@/lib/garment-tint';
import { readSharedIntake } from '@/lib/shared-intake';
import type { AddItemInitial } from '@/components/add-item-dialog';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const SORT_OPTIONS = [
  { labelKey: 'newestFirst', value: 'created_at', order: 'desc' as const },
  { labelKey: 'oldestFirst', value: 'created_at', order: 'asc' as const },
  { labelKey: 'recentlyWorn', value: 'last_worn', order: 'desc' as const },
  { labelKey: 'leastRecentlyWorn', value: 'last_worn', order: 'asc' as const },
  { labelKey: 'mostWornFirst', value: 'wear_count', order: 'desc' as const },
  { labelKey: 'leastWornFirst', value: 'wear_count', order: 'asc' as const },
  { labelKey: 'nameAsc', value: 'name', order: 'asc' as const },
  { labelKey: 'nameDesc', value: 'name', order: 'desc' as const },
] as const;

const ItemCard = memo(function ItemCard({
  item,
  selected,
  onSelect,
  onRetry,
  onCancelAnalysis,
  onOpen,
  userTimezone,
}: {
  item: Item;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onRetry?: (id: string) => void;
  onCancelAnalysis?: (id: string) => void;
  onOpen: (id: string) => void;
  userTimezone: string;
}) {
  const onClick = () => onOpen(item.id);
  const t = useTranslations('wardrobe');
  const tCommon = useTranslations('common');
  const typeLabel = useClothingTypeLabel();
  const colorLabel = useColorLabel();
  // The garment's own shade when we sampled one, the palette's otherwise: the
  // label underneath is still the family, so both browns read "marrón".
  const swatch = swatchHex(item.primary_color, item.primary_color_hex);
  // A whisper of the garment's own colour behind it, so the grid reads as a set of
  // garments rather than as a sheet of white rectangles. The plate is derived from
  // the same shade the swatch shows, so a tile and its dot always agree. Neutral
  // panel when there is no colour yet, which is every garment before it is tagged.
  const tint = garmentTileTint(item.primary_color, swatch);
  const isProcessing = item.status === 'processing';
  const isError = item.status === 'error';
  const name = item.name || typeLabel(item.type);

  const usage = item.last_worn_at
    ? t('item.wornAgo', { days: getDaysSinceDateInTimezone(item.last_worn_at.slice(0, 10), userTimezone) })
    : item.wear_count > 0
      ? t('item.wornCount', { count: item.wear_count })
      : t('item.neverWorn');

  return (
    <article className="group">
      <div className="relative">
        <button
          type="button"
          onClick={onClick}
          aria-label={name}
          style={tint.style}
          className={cn(
            'no-callout pressable relative block aspect-square w-full overflow-hidden rounded-tile transition-shadow',
            tint.className,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            selected && 'ring-[3px] ring-signature'
          )}
        >
          {item.thumbnail_url ? (
            <Image
              src={item.thumbnail_url}
              alt=""
              fill
              className={cn(
                'object-contain p-3 transition-transform duration-300 group-hover:scale-[1.04]',
                // A real cut-out is transparent and simply sits on the tint. An
                // older photo has white baked in, and multiplying lets the tint
                // show through it — doing that to a cut-out would darken the
                // garment itself, in either theme.
                !item.has_cutout && 'mix-blend-multiply'
              )}
              // Scaled by what the garment is, so a hat is not drawn the size of a
              // coat and a grid of mixed types reads with believable proportions.
              // Presentation only, and only for cut-outs (see lib/garment-framing).
              style={garmentFrameStyle(item.type, item.has_cutout)}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Shirt className="h-10 w-10" strokeWidth={1.5} aria-hidden />
            </span>
          )}
        </button>

        {item.needs_wash && (
          <span
            className="pointer-events-none absolute left-2.5 top-2.5 z-10 inline-flex h-6 items-center gap-1 rounded-full bg-pop-sky px-2.5 text-xs font-bold text-pop-foreground"
            title={t('needsWashingTooltip')}
          >
            <Droplets className="h-3 w-3" strokeWidth={2.25} aria-hidden />
            {t('washBadge')}
          </span>
        )}
        {item.favorite && (
          <span
            className="pointer-events-none absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background"
            title={t('favorite')}
          >
            <Heart className="h-4 w-4 fill-signature text-foreground" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">{t('favorite')}</span>
          </span>
        )}
        {/* Selection checkbox — visible on hover/focus or when selected */}
        <div
          className={cn(
            'absolute bottom-2 right-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/90 transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'
          )}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelect(item.id, checked === true)}
            aria-label={t('select', { name })}
          />
        </div>

        {isProcessing && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-tile bg-black/55">
            <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden />
            <span className="text-xs font-semibold text-white">{t('aiAnalyzing')}</span>
            {onCancelAnalysis && (
              <Button
                size="sm"
                variant="secondary"
                className="h-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelAnalysis(item.id);
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                {tCommon('cancel')}
              </Button>
            )}
          </div>
        )}
        {isError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-tile bg-black/55 p-2">
            <AlertCircle className="h-6 w-6 text-white" aria-hidden />
            <span className="text-center text-xs font-semibold text-white">{t('analysisFailed')}</span>
            {onRetry && (
              <Button
                size="sm"
                variant="secondary"
                className="h-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(item.id);
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {tCommon('retry')}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="cursor-pointer px-1 pt-1.5" onClick={onClick} aria-hidden>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[14.5px] font-semibold leading-tight">{name}</p>
          {swatch && item.primary_color && (
            <span
              className="h-3 w-3 shrink-0 rounded-full ring-1 ring-border"
              style={{ backgroundColor: swatch }}
              title={colorLabel(item.primary_color)}
            />
          )}
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{usage}</p>
      </div>
    </article>
  );
});

function ItemCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-square w-full rounded-tile" />
      <div className="px-1 pt-2">
        <Skeleton className="h-4 w-3/4 rounded-full" />
        <Skeleton className="mt-1.5 h-3 w-1/2 rounded-full" />
      </div>
    </div>
  );
}

function EmptyWardrobe({
  onAddClick,
  onBulkClick,
}: {
  onAddClick: () => void;
  onBulkClick: () => void;
}) {
  const t = useTranslations('wardrobe');
  const tBulk = useTranslations('bulkUpload');
  return (
    <EmptyState
      state="sleepy"
      size="lg"
      title={t('emptyTitle')}
      description={t('emptyBody')}
      action={
        // A wardrobe of one garment is still an empty wardrobe, so the loud button
        // is the batch one and adding a single item is the quiet alternative.
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row">
          <Button variant="signature" size="lg" onClick={onBulkClick}>
            <ImagePlus className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
            {tBulk('cta')}
          </Button>
          <Button variant="secondary" size="lg" onClick={onAddClick}>
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
            {t('addFirstItem')}
          </Button>
        </div>
      }
    />
  );
}

export default function WardrobePage() {
  const t = useTranslations('wardrobe');
  const tCommon = useTranslations('common');
  const tShare = useTranslations('wardrobe.share');
  const tBulk = useTranslations('bulkUpload');
  const typeLabel = useClothingTypeLabel();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: userProfile } = useUserProfile();
  const userTimezone = userProfile?.timezone || 'UTC';
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  // Which tab the add dialog opens on, and — for the bulk tab — whether it starts
  // at the picker or straight in the quick pass over everything still untagged.
  const [addTab, setAddTab] = useState<'single' | 'link' | 'bulk'>('single');
  const [bulkMode, setBulkMode] = useState<'batch' | 'untagged'>('batch');
  const [sharedIntake, setSharedIntake] = useState<AddItemInitial | null>(null);
  const [selection, setSelection] = useState<BulkSelection>({
    mode: 'none',
    selectedIds: new Set(),
    excludedIds: new Set(),
  });
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  /** The one selected garment being handed to another as its back photo, if any. */
  const [mergeBackId, setMergeBackId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortIndex, setSortIndex] = useState(0);
  const [needsWash, setNeedsWash] = useState<boolean | undefined>(undefined);
  const [favoriteFilter, setFavoriteFilter] = useState<boolean | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // ?bulk=1 opens the add dialog on its "muchas prendas" tab, and ?bulk=review
  // opens that tab straight in the quick pass. The Hoy nudge, Stinky and the
  // floating upload bar all link here rather than owning a dialog of their own;
  // the param stays in the URL while the dialog is open so the bar stands down.
  useEffect(() => {
    const bulk = searchParams.get('bulk');
    if (!bulk) return;
    setBulkMode(bulk === 'review' ? 'untagged' : 'batch');
    setAddTab('bulk');
    setAddDialogOpen(true);
  }, [searchParams]);

  // Open item detail dialog from URL param (e.g. ?item=uuid from outfit pages)
  useEffect(() => {
    const itemParam = searchParams.get('item');
    if (itemParam && !detailItemId) {
      setDetailItemId(itemParam);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the add dialog from a quick action (?add=1), then clean the URL.
  // ?shared=1 means the share target stashed a photo or a link for us to pick
  // up; ?share_failed=1 means the POST reached the server instead of the
  // worker, so there is nothing to pick up and we say so.
  useEffect(() => {
    if (!searchParams.get('add')) return;
    const shared = searchParams.get('shared');
    const shareFailed = searchParams.get('share_failed');
    setAddDialogOpen(true);
    router.replace('/dashboard/wardrobe', { scroll: false });

    if (shareFailed) {
      toast.error(tShare('failed'));
      return;
    }
    if (!shared) return;
    let cancelled = false;
    void readSharedIntake().then((payload) => {
      if (cancelled) return;
      if (!payload) {
        toast.error(tShare('failed'));
        return;
      }
      setSharedIntake({ file: payload.file, link: payload.link, name: payload.title });
    });
    return () => {
      cancelled = true;
    };
  }, [searchParams, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortOption = SORT_OPTIONS[sortIndex];

  const filters = {
    search: search || undefined,
    type: typeFilter !== 'all' ? typeFilter : undefined,
    needs_wash: needsWash,
    favorite: favoriteFilter,
    is_archived: false,
    sort_by: sortOption.value,
    sort_order: sortOption.order,
  };

  const activeFilterCount = [
    needsWash !== undefined,
    favoriteFilter !== undefined,
    typeFilter !== 'all',
  ].filter(Boolean).length;

  // Fetch items with automatic polling (faster when items are processing)
  const { data, isLoading, error } = useItems(filters, page, pageSize);
  const { data: itemTypes } = useItemTypes();
  const reanalyze = useReanalyzeItem();
  const cancelAnalysis = useCancelAnalysis();
  const bulkDelete = useBulkDeleteItems();
  const bulkReanalyze = useBulkReanalyzeItems();

  const items = data?.items || [];
  const total = data?.total || 0;

  // Get selected item: try from list first, then fetch individually (for deep-link from outfit pages)
  const listItem = detailItemId ? items.find((i) => i.id === detailItemId) || null : null;
  const { data: fetchedItem } = useItem(detailItemId && !listItem ? detailItemId : '');
  const detailItem = listItem || fetchedItem || null;
  const mergeBackItem = mergeBackId ? items.find((i) => i.id === mergeBackId) || null : null;

  // Count items being processed or with errors
  const processingCount = items.filter((i) => i.status === 'processing').length;
  const errorCount = items.filter((i) => i.status === 'error').length;

  // Clear selection when filters change (but not page - allow cross-page selection)
  useEffect(() => {
    setSelection({ mode: 'none', selectedIds: new Set(), excludedIds: new Set() });
  }, [search, typeFilter, needsWash, favoriteFilter, sortIndex]);

  const { mutate: reanalyzeItem } = reanalyze;
  const { mutate: cancelItemAnalysis } = cancelAnalysis;
  const handleRetry = useCallback((itemId: string) => reanalyzeItem(itemId), [reanalyzeItem]);
  const handleCancelAnalysis = useCallback((itemId: string) => cancelItemAnalysis(itemId), [cancelItemAnalysis]);
  const handleOpen = useCallback((itemId: string) => setDetailItemId(itemId), []);

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelection((prev) => {
      if (prev.mode === 'all') {
        // In "select all" mode, toggle exclusion
        const next = new Set(prev.excludedIds);
        if (checked) {
          next.delete(id); // Remove from excluded = selected
        } else {
          next.add(id); // Add to excluded = deselected
        }
        return { ...prev, excludedIds: next };
      } else {
        // In "some" or "none" mode, toggle selection
        const next = new Set(prev.selectedIds);
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return { mode: next.size > 0 ? 'some' : 'none', selectedIds: next, excludedIds: new Set() };
      }
    });
  }, []);

  const handleSelectPage = () => {
    setSelection((prev) => {
      const pageFullySelected =
        (prev.mode === 'all' && prev.excludedIds.size === 0) ||
        (prev.mode === 'some' && prev.selectedIds.size === items.length && items.length > 0);
      if (pageFullySelected) {
        return { mode: 'none', selectedIds: new Set(), excludedIds: new Set() };
      }
      return { mode: 'some', selectedIds: new Set(items.map((i) => i.id)), excludedIds: new Set() };
    });
  };

  const handleSelectAllMatching = () => {
    setSelection({ mode: 'all', selectedIds: new Set(), excludedIds: new Set() });
  };

  const handleClearSelection = () => {
    setSelection({ mode: 'none', selectedIds: new Set(), excludedIds: new Set() });
  };

  // Build bulk operation params from selection state
  const getBulkParams = (): BulkOperationParams => {
    if (selection.mode === 'all') {
      return {
        select_all: true,
        excluded_ids: Array.from(selection.excludedIds),
        filters: {
          type: typeFilter !== 'all' ? typeFilter : undefined,
          search: search || undefined,
          needs_wash: needsWash,
          favorite: favoriteFilter,
          is_archived: false,
        },
      };
    } else {
      return {
        item_ids: Array.from(selection.selectedIds),
      };
    }
  };

  const handleBulkDelete = async () => {
    const params = getBulkParams();
    try {
      const result = await bulkDelete.mutateAsync(params);
      toast.success(t('bulk.deleted', { count: result.deleted }));
      if (result.failed > 0) {
        toast.error(t('bulk.deleteFailed', { count: result.failed }));
      }
      handleClearSelection();
    } catch {
      toast.error(t('bulk.deleteError'));
    }
  };

  const handleBulkReanalyze = async () => {
    const params = getBulkParams();
    try {
      const result = await bulkReanalyze.mutateAsync(params);
      if (result.queued > 20) {
        toast.success(t('bulk.queuedMany', { count: result.queued }));
      } else {
        toast.success(t('bulk.queued', { count: result.queued }));
      }
      if (result.failed > 0) {
        toast.error(t('bulk.queueFailed', { count: result.failed }));
      }
      handleClearSelection();
    } catch {
      toast.error(t('bulk.reanalyzeError'));
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const typeChips = (itemTypes ?? []).slice().sort((a, b) => b.count - a.count);
  const hasFilters = search || typeFilter !== 'all' || needsWash !== undefined || favoriteFilter !== undefined;
  const extraFilterCount = [needsWash !== undefined, favoriteFilter !== undefined, sortIndex !== 0].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t('itemCount', { count: total })}</span>
            {processingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t('processingBadge', { count: processingCount })}
              </span>
            )}
            {errorCount > 0 && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-destructive">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                {t('errorBadge', { count: errorCount })}
              </span>
            )}
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setAddTab('single');
                setAddDialogOpen(true);
              }}
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
              {tCommon('add')}
            </Button>
            <Button
              variant="signature"
              onClick={() => {
                setBulkMode('batch');
                setAddTab('bulk');
                setAddDialogOpen(true);
              }}
            >
              <ImagePlus className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
              {tBulk('cta')}
            </Button>
          </div>
        }
      />

      {/* Search (gray pill) with filter toggle inside */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label={tCommon('search')}
          placeholder={total > 0 ? t('searchCountPlaceholder', { count: total }) : t('searchItemsPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="h-12 border-transparent bg-panel pl-11 pr-14"
        />
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-controls="wardrobe-filters"
          aria-label={t('moreFilters')}
          className={cn(
            'absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            showFilters ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent'
          )}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
          {extraFilterCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-signature px-1 text-[10px] font-bold text-signature-foreground">
              {extraFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Category chips */}
      {typeChips.length > 0 && (
        <div role="group" aria-label={t('categories')} className="-mx-4 flex gap-2 overflow-x-auto scrollbar-none px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip
            active={typeFilter === 'all'}
            onClick={() => {
              setTypeFilter('all');
              setPage(1);
            }}
          >
            {t('filter.all')}
          </Chip>
          {typeChips.map((ct, i) => (
            <Chip
              key={ct.type}
              active={typeFilter === ct.type}
              dot={popColorAt(i)}
              onClick={() => {
                setTypeFilter(typeFilter === ct.type ? 'all' : ct.type);
                setPage(1);
              }}
            >
              {typeLabel(ct.type)}
            </Chip>
          ))}
        </div>
      )}

      {/* Expandable filter panel */}
      {showFilters && (
        <div id="wardrobe-filters" className="flex flex-wrap items-center gap-2 rounded-lg bg-panel p-3">
          <Select
            value={String(sortIndex)}
            onValueChange={(v) => {
              setSortIndex(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-10 w-auto min-w-[180px] border-transparent bg-background" aria-label={t('sort.label')}>
              <ArrowUpDown className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt, i) => (
                <SelectItem key={i} value={String(i)}>
                  {t(`sort.${opt.labelKey}` as `sort.${typeof opt.labelKey}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-10 w-auto min-w-[130px] border-transparent bg-background" aria-label={t('perPageLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {t('perPage', { size })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Chip
            active={needsWash === true}
            dot="sky"
            activeStyle="pop"
            onClick={() => {
              setNeedsWash(needsWash === true ? undefined : true);
              setPage(1);
            }}
          >
            {t('needsWashFilter')}
          </Chip>

          <Chip
            active={favoriteFilter === true}
            dot="pink"
            activeStyle="pop"
            onClick={() => {
              setFavoriteFilter(favoriteFilter === true ? undefined : true);
              setPage(1);
            }}
          >
            {t('favoritesFilter')}
          </Chip>

          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setTypeFilter('all');
                setNeedsWash(undefined);
                setFavoriteFilter(undefined);
                setPage(1);
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {t('clearFilters')}
            </Button>
          )}
        </div>
      )}

      {error ? (
        <EmptyState
          state="sad"
          title={t('loadError')}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              {tCommon('retry')}
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-4 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ItemCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            state="sleepy"
            size="sm"
            title={t('noResults')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setTypeFilter('all');
                  setNeedsWash(undefined);
                  setFavoriteFilter(undefined);
                }}
              >
                {t('clearFiltersButton')}
              </Button>
            }
          />
        ) : (
          <EmptyWardrobe
            onAddClick={() => {
              setAddTab('single');
              setAddDialogOpen(true);
            }}
            onBulkClick={() => {
              setBulkMode('batch');
              setAddTab('bulk');
              setAddDialogOpen(true);
            }}
          />
        )
      ) : (
        <div
          className={cn(
            'grid grid-cols-2 gap-x-2.5 gap-y-4 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4',
            (selection.mode !== 'none' || total > pageSize) && 'pb-16'
          )}
        >
          {items.map((item) => {
            // Determine if item is selected based on selection mode
            const isSelected = selection.mode === 'all'
              ? !selection.excludedIds.has(item.id)
              : selection.selectedIds.has(item.id);
            return (
              <ItemCard
                key={item.id}
                item={item}
                selected={isSelected}
                onSelect={handleSelect}
                onRetry={handleRetry}
                onCancelAnalysis={handleCancelAnalysis}
                onOpen={handleOpen}
                userTimezone={userTimezone}
              />
            );
          })}
        </div>
      )}

      <BulkActionToolbar
        selection={selection}
        totalItems={total}
        pageItems={items.length}
        onSelectAll={handleSelectPage}
        onSelectAllMatching={handleSelectAllMatching}
        onClear={handleClearSelection}
        onDelete={handleBulkDelete}
        onReanalyze={handleBulkReanalyze}
        onMergeBack={setMergeBackId}
        isDeleting={bulkDelete.isPending}
        isReanalyzing={bulkReanalyze.isPending}
        page={page}
        pageSize={pageSize}
        onPageChange={handlePageChange}
      />

      {/* From the grid's selection: pick one garment that turned out to be a photo
          of another, and hand the photo over. */}
      <MergeBackDialog
        source={mergeBackItem}
        open={mergeBackId !== null}
        onOpenChange={(open) => {
          if (!open) setMergeBackId(null);
        }}
        onMerged={() => {
          setMergeBackId(null);
          setSelection({ mode: 'none', selectedIds: new Set(), excludedIds: new Set() });
        }}
      />

      <AddItemDialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) {
            setSharedIntake(null);
            setBulkMode('batch');
            // Drop ?bulk so the floating upload bar can take over again.
            if (searchParams.get('bulk')) {
              router.replace('/dashboard/wardrobe', { scroll: false });
            }
          }
        }}
        initial={sharedIntake}
        initialTab={addTab}
        bulkMode={bulkMode}
      />
      <ItemDetailDialog
        item={detailItem}
        open={!!detailItemId}
        onOpenChange={(open) => {
          if (!open) {
            setDetailItemId(null);
            // Clear the ?item= param from URL without navigation
            if (searchParams.has('item')) {
              router.replace('/dashboard/wardrobe', { scroll: false });
            }
          }
        }}
      />
    </div>
  );
}
