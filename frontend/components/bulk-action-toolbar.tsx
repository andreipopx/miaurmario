'use client';

import { X, Trash2, RefreshCw, Loader2, CheckSquare, Square, MinusSquare, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export interface BulkSelection {
  mode: 'none' | 'some' | 'all';
  selectedIds: Set<string>;    // Used when mode is 'some'
  excludedIds: Set<string>;    // Used when mode is 'all'
}

interface BulkActionToolbarProps {
  selection: BulkSelection;
  totalItems: number;
  pageItems: number;
  onSelectAll: () => void;
  onSelectAllMatching: () => void;
  onClear: () => void;
  onDelete: () => void;
  onReanalyze: () => void;
  /**
   * "Es la espalda de otra prenda". Offered only with exactly one garment picked,
   * because it is a statement about one photo and one other garment — there is no
   * such thing as doing it to nine at once.
   */
  onMergeBack?: (itemId: string) => void;
  isDeleting?: boolean;
  isReanalyzing?: boolean;
  // Pagination props
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function BulkActionToolbar({
  selection,
  totalItems,
  pageItems,
  onSelectAll,
  onSelectAllMatching,
  onClear,
  onDelete,
  onReanalyze,
  onMergeBack,
  isDeleting = false,
  isReanalyzing = false,
  page,
  pageSize,
  onPageChange,
}: BulkActionToolbarProps) {
  const t = useTranslations('bulk');
  const tMerge = useTranslations('mergeBack');
  // Calculate selected count
  const selectedCount = selection.mode === 'all'
    ? totalItems - selection.excludedIds.size
    : selection.selectedIds.size;

  // Determine checkbox state
  const isAllSelected =
    (selection.mode === 'all' && selection.excludedIds.size === 0) ||
    (selection.mode === 'some' && selection.selectedIds.size === pageItems && pageItems > 0);
  const isPartiallySelected = selection.mode === 'all'
    ? selection.excludedIds.size > 0
    : selection.selectedIds.size > 0 && selection.selectedIds.size < pageItems;
  const hasSelection = selectedCount > 0;
  const canSelectAllMatching =
    selection.mode === 'some' && selection.selectedIds.size === pageItems && pageItems > 0 && pageItems < totalItems;

  // Pagination
  // Exactly one garment, picked by hand: "all except three" is not one garment even
  // when the wardrobe happens to hold four.
  const loneId =
    selection.mode === 'some' && selection.selectedIds.size === 1
      ? Array.from(selection.selectedIds)[0]
      : null;

  const totalPages = Math.ceil(totalItems / pageSize);
  const showPagination = totalPages > 1;

  // Nothing to act on: don't float an empty bar over the grid (tiles carry their own checkboxes).
  if (!hasSelection && !showPagination) return null;

  return (
    // Floats above the mobile dock (24px inset + 64px dock + safe area) on < lg.
    <div
      role="toolbar"
      aria-label={t('selectAll')}
      className="glass-dock fixed bottom-[calc(6.25rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 rounded-full p-1.5 sm:gap-2 sm:px-2 lg:bottom-6"
    >
      {/* Select All Checkbox */}
      <button
        type="button"
        onClick={onSelectAll}
        aria-pressed={isAllSelected ? true : isPartiallySelected ? 'mixed' : false}
        aria-label={isAllSelected ? t('all') : t('selectAll')}
        className="flex h-11 shrink-0 items-center gap-2 rounded-full px-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {isAllSelected ? (
          <CheckSquare className="h-5 w-5 text-foreground" strokeWidth={2} />
        ) : isPartiallySelected ? (
          <MinusSquare className="h-5 w-5 text-foreground" strokeWidth={2} />
        ) : (
          <Square className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
        )}
        <span className="hidden whitespace-nowrap text-sm font-semibold sm:inline">
          {isAllSelected ? t('all') : t('selectAll')}
        </span>
      </button>

      <span
        className={cn(
          'shrink-0 whitespace-nowrap rounded-full text-sm font-bold',
          hasSelection ? 'bg-signature px-3 py-1 text-signature-foreground' : 'text-muted-foreground'
        )}
        aria-live="polite"
      >
        {selectedCount === 0 ? (
          <span className="hidden sm:inline">{t('noneSelected')}</span>
        ) : selection.mode === 'all' && selection.excludedIds.size > 0 ? (
          <>
            <span className="sm:hidden">{totalItems - selection.excludedIds.size}</span>
            <span className="hidden sm:inline">{t('allExcept', { count: selection.excludedIds.size })}</span>
          </>
        ) : selection.mode === 'all' ? (
          <>
            <span className="sm:hidden">{t('all')} ({totalItems})</span>
            <span className="hidden sm:inline">{t('allNSelected', { total: totalItems })}</span>
          </>
        ) : (
          <>
            <span className="sm:hidden">{selectedCount}</span>
            <span className="hidden sm:inline">{t('nSelected', { count: selectedCount })}</span>
          </>
        )}
      </span>

      {canSelectAllMatching && (
        <Button
          variant="link"
          size="sm"
          className="hidden shrink-0 text-xs sm:inline-flex"
          onClick={onSelectAllMatching}
        >
          {t('selectAllMatching', { total: totalItems })}
        </Button>
      )}

      {hasSelection && (
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClear}
            className="shrink-0 text-muted-foreground"
            aria-label={t('clearSelection')}
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </Button>
          {loneId && onMergeBack && (
            <Button
              variant="secondary"
              size="icon"
              className="shrink-0"
              onClick={() => onMergeBack(loneId)}
              aria-label={tMerge('openFromSelection')}
              title={tMerge('openFromSelection')}
            >
              <Layers className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon"
            className="shrink-0"
            onClick={onReanalyze}
            disabled={isReanalyzing}
            aria-label={t('reanalyze')}
          >
            {isReanalyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
            )}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="icon" className="shrink-0" disabled={isDeleting} aria-label={t('delete')}>
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {selection.mode === 'all' && selection.excludedIds.size === 0
                    ? t('confirmTitleAll', { total: totalItems })
                    : t('confirmTitleCount', { count: selectedCount })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t('confirmBody')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className={buttonVariants({ variant: 'destructive' })}
                >
                  {t('delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      {/* Pagination */}
      {showPagination && (
        <>
          <div className="h-5 w-px shrink-0 bg-border" aria-hidden />
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:flex"
              disabled={page === 1}
              onClick={() => onPageChange(1)}
              aria-label={t('firstPage')}
            >
              <ChevronsLeft className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={page === 1}
              onClick={() => onPageChange(page - 1)}
              aria-label={t('prevPage')}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <span className="whitespace-nowrap px-1 text-sm font-semibold tabular-nums sm:px-2">
              {page}/{totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label={t('nextPage')}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:flex"
              disabled={page >= totalPages}
              onClick={() => onPageChange(totalPages)}
              aria-label={t('lastPage')}
            >
              <ChevronsRight className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
