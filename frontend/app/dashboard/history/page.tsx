'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCalendarOutfits, type Outfit, type OutfitFilters } from '@/lib/hooks/use-outfits';
import { OutfitCalendar } from '@/components/outfit-calendar';
import { OutfitHistoryCard } from '@/components/outfit-history-card';
import { FeedbackDialog } from '@/components/feedback-dialog';
import { OutfitPreviewDialog } from '@/components/outfit-preview-dialog';
import { isSameDay, parseISO } from 'date-fns';
import { capitalizeFirst, useFormatDate } from '@/lib/date-locale';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

function EmptyHistory() {
  const t = useTranslations('history');
  return (
    <EmptyState
      state="sleepy"
      title={t('emptyTitle')}
      action={
        <Button asChild>
          <Link href="/dashboard/suggest">{t('getFirstSuggestion')}</Link>
        </Button>
      }
    />
  );
}

function EmptyDate({ date }: { date: Date }) {
  const t = useTranslations('history');
  const formatDate = useFormatDate();
  return <EmptyState state="sleepy" title={t('noOutfitsForDate', { date: formatDate(date, 'long') })} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
      ))}
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="space-y-4">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-11 w-11 rounded-full bg-background" />
        <Skeleton className="h-6 w-32 rounded-full bg-background" />
        <Skeleton className="h-11 w-11 rounded-full bg-background" />
      </div>
      <div className="grid grid-cols-7 gap-1">
        {[...Array(35)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-full bg-background" />
        ))}
      </div>
    </div>
  );
}

/**
 * One look of the day as a row: its garments and a title. The whole card (the
 * reasoning, Stinky's note, the rating) opens on tap.
 */
function HistoryRow({
  outfit,
  open,
  onToggle,
  onFeedback,
  onPreview,
}: {
  outfit: Outfit;
  open: boolean;
  onToggle: () => void;
  onFeedback: () => void;
  onPreview: () => void;
}) {
  const t = useTranslations('outfitHistoryCard');
  const tOccasions = useTranslations('suggest.occasions');
  const typeLabel = useClothingTypeLabel();
  const occasionLabel = tOccasions.has(outfit.occasion as never) ? tOccasions(outfit.occasion as never) : outfit.occasion;
  const title = outfit.name || outfit.reasoning || occasionLabel;
  const thumbs = outfit.items.slice(0, 4);
  const more = outfit.items.length - thumbs.length;

  return (
    <li className="overflow-hidden rounded-lg bg-panel">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex shrink-0 gap-1">
          {thumbs.map((item) => (
            <span key={item.id} className="relative h-11 w-11 overflow-hidden rounded-[10px] bg-background">
              {item.thumbnail_url ? (
                <Image src={item.thumbnail_url} alt={item.name || typeLabel(item.type)} fill className="object-contain p-1" sizes="44px" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                  {typeLabel(item.type)}
                </span>
              )}
            </span>
          ))}
          {more > 0 && (
            <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-background text-[12px] font-bold text-muted-foreground">
              +{more}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[14px] font-bold leading-snug">{title}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
            {occasionLabel} · {t(`source.${outfit.source}`)}
          </span>
        </span>
        <ChevronDown
          className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      {open && (
        <div className="px-3 pb-3">
          <OutfitHistoryCard outfit={outfit} onFeedback={onFeedback} onPreview={onPreview} />
        </div>
      )}
    </li>
  );
}

export default function HistoryPage() {
  const t = useTranslations('history');
  const tOccasions = useTranslations('suggest.occasions');
  const formatDate = useFormatDate();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<Date | null>(now);
  const [filters, setFilters] = useState<OutfitFilters>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [feedbackOutfit, setFeedbackOutfit] = useState<Outfit | null>(null);
  const [previewOutfit, setPreviewOutfit] = useState<Outfit | null>(null);

  const { data, isLoading, isError } = useCalendarOutfits(year, month, filters);

  // Filter outfits for the selected date
  const selectedDateOutfits = useMemo(() => {
    if (!data?.outfits || !selectedDate) return [];
    return data.outfits.filter((outfit) =>
      outfit.scheduled_for && isSameDay(parseISO(outfit.scheduled_for), selectedDate)
    );
  }, [data?.outfits, selectedDate]);

  // Only offer occasions the user actually has looks for: the backend knows 22
  // of them, and a filter full of empty options is worse than a short one. The
  // active filter stays listed even when this month has none of it.
  const occasionOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const outfit of data?.outfits ?? []) {
      if (outfit.occasion) seen.add(outfit.occasion);
    }
    if (filters.occasion) seen.add(filters.occasion);
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [data?.outfits, filters.occasion]);

  const handleMonthChange = (newYear: number, newMonth: number) => {
    setYear(newYear);
    setMonth(newMonth);
  };

  const handleOccasionChange = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      occasion: value === 'all' ? undefined : value,
    }));
  };

  const handleStatusChange = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      status: value === 'all' ? undefined : value,
    }));
  };

  if (isError) {
    return (
      <EmptyState state="sad" title={t('loadError')} />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={t('title')} />

      {/* The calendar first: the day is how you find a look. */}
      <div className="rounded-lg bg-panel p-4">
        {isLoading ? (
          <CalendarSkeleton />
        ) : (
          <OutfitCalendar
            year={year}
            month={month}
            outfits={data?.outfits || []}
            selectedDate={selectedDate}
            onSelectDate={(d) => {
              setSelectedDate(d);
              setOpenId(null);
            }}
            onMonthChange={handleMonthChange}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={filters.occasion || 'all'} onValueChange={handleOccasionChange}>
          <SelectTrigger className="h-11 w-[170px]" aria-label={t('allOccasions')}>
            <SelectValue placeholder={t('allOccasions')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allOccasions')}</SelectItem>
            {occasionOptions.map((occasion) => (
              <SelectItem key={occasion} value={occasion}>
                {tOccasions.has(occasion) ? tOccasions(occasion) : occasion}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status || 'all'} onValueChange={handleStatusChange}>
          <SelectTrigger className="h-11 w-[170px]" aria-label={t('allStatus')}>
            <SelectValue placeholder={t('allStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatus')}</SelectItem>
            <SelectItem value="accepted">{t('status.accepted')}</SelectItem>
            <SelectItem value="rejected">{t('status.rejected')}</SelectItem>
            <SelectItem value="pending">{t('status.pending')}</SelectItem>
            <SelectItem value="viewed">{t('status.viewed')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <section className="space-y-3">
        {selectedDate && (
          <h2 className="px-1 text-[15px] font-bold">
            {capitalizeFirst(formatDate(selectedDate, 'weekdayLong'))}
            <span className="font-normal text-muted-foreground"> · {t('outfitCount', { count: selectedDateOutfits.length })}</span>
          </h2>
        )}

        {isLoading ? (
          <LoadingSkeleton />
        ) : !data || data.outfits.length === 0 ? (
          <EmptyHistory />
        ) : selectedDate && selectedDateOutfits.length === 0 ? (
          <EmptyDate date={selectedDate} />
        ) : (
          <ul className="space-y-2">
            {selectedDateOutfits.map((outfit) => (
              <HistoryRow
                key={outfit.id}
                outfit={outfit}
                open={openId === outfit.id}
                onToggle={() => setOpenId((cur) => (cur === outfit.id ? null : outfit.id))}
                onFeedback={() => setFeedbackOutfit(outfit)}
                onPreview={() => setPreviewOutfit(outfit)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Feedback dialog */}
      {feedbackOutfit && (
        <FeedbackDialog
          outfit={feedbackOutfit}
          open={!!feedbackOutfit}
          onClose={() => setFeedbackOutfit(null)}
        />
      )}

      {/* Preview dialog */}
      {previewOutfit && (
        <OutfitPreviewDialog
          outfit={previewOutfit}
          open={!!previewOutfit}
          onClose={() => setPreviewOutfit(null)}
        />
      )}
    </div>
  );
}
