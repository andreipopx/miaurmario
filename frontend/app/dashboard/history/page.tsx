'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { useTranslations } from 'next-intl';

function EmptyHistory() {
  const t = useTranslations('history');
  return (
    <EmptyState
      state="sleepy"
      title={t('emptyTitle')}
      description={t('emptyBody')}
      action={
        <Button variant="signature" asChild>
          <Link href="/dashboard/suggest">{t('getFirstSuggestion')}</Link>
        </Button>
      }
    />
  );
}

function EmptyDate({ date }: { date: Date }) {
  const t = useTranslations('history');
  const formatDate = useFormatDate();
  return (
    <EmptyState
      state="sleepy"
      size="sm"
      title={t('noOutfitsForDate', { date: formatDate(date, 'long') })}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="p-4 sm:p-4">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <Skeleton className="mb-2 h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-6 w-6 rounded-full" />
            </div>
            <div className="flex gap-2">
              {[1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-16 w-16 rounded-tile" />
              ))}
            </div>
          </CardContent>
        </Card>
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

export default function HistoryPage() {
  const t = useTranslations('history');
  const formatDate = useFormatDate();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<Date | null>(now);
  const [filters, setFilters] = useState<OutfitFilters>({});
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
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Select value={filters.occasion || 'all'} onValueChange={handleOccasionChange}>
          <SelectTrigger className="h-11 w-[170px]" aria-label={t('allOccasions')}>
            <SelectValue placeholder={t('allOccasions')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allOccasions')}</SelectItem>
            <SelectItem value="casual">{t('occasions.casual')}</SelectItem>
            <SelectItem value="office">{t('occasions.office')}</SelectItem>
            <SelectItem value="formal">{t('occasions.formal')}</SelectItem>
            <SelectItem value="date">{t('occasions.date')}</SelectItem>
            <SelectItem value="workout">{t('occasions.workout')}</SelectItem>
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

      {/* Main content - two column layout */}
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Calendar column */}
        <Card className="order-2 h-fit border-0 bg-panel lg:order-1">
          <CardContent className="p-4 sm:p-4">
            {isLoading ? (
              <CalendarSkeleton />
            ) : (
              <OutfitCalendar
                year={year}
                month={month}
                outfits={data?.outfits || []}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onMonthChange={handleMonthChange}
              />
            )}
          </CardContent>
        </Card>

        {/* Outfits column */}
        <div className="order-1 lg:order-2 space-y-4">
          {/* Selected date header */}
          {selectedDate && (
            <div className="space-y-0.5">
              <h2 className="text-lg font-bold">
                {capitalizeFirst(formatDate(selectedDate, 'weekdayLong'))}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('outfitCount', { count: selectedDateOutfits.length })}
              </p>
            </div>
          )}

          {isLoading ? (
            <LoadingSkeleton />
          ) : !data || data.outfits.length === 0 ? (
            <EmptyHistory />
          ) : selectedDate && selectedDateOutfits.length === 0 ? (
            <EmptyDate date={selectedDate} />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {selectedDateOutfits.map((outfit) => (
                <OutfitHistoryCard
                  key={outfit.id}
                  outfit={outfit}
                  onFeedback={() => setFeedbackOutfit(outfit)}
                  onPreview={() => setPreviewOutfit(outfit)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

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
