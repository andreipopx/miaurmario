'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, total, pageSize, onPageChange }: PaginationProps) {
  const t = useTranslations('bulk');
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className="flex items-center justify-center gap-2" aria-label={t('pagination')}>
      <Button
        variant="secondary"
        size="icon"
        disabled={page === 1}
        onClick={() => onPageChange(1)}
        aria-label={t('firstPage')}
      >
        <ChevronsLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="secondary"
        size="icon"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        aria-label={t('prevPage')}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[4.5rem] px-2 text-center text-sm font-bold tabular-nums" aria-live="polite">
        {`${page} / ${totalPages}`}
      </span>
      <Button
        variant="secondary"
        size="icon"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label={t('nextPage')}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button
        variant="secondary"
        size="icon"
        disabled={page >= totalPages}
        onClick={() => onPageChange(totalPages)}
        aria-label={t('lastPage')}
      >
        <ChevronsRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
