'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  addDays,
  addMonths,
  subMonths,
} from 'date-fns';
import type { Outfit, OutfitSource } from '@/lib/hooks/use-outfits';
import { capitalizeFirst, useDateFnsLocale, useFormatDate } from '@/lib/date-locale';

interface OutfitCalendarProps {
  year: number;
  month: number;
  outfits: Outfit[];
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  onMonthChange: (year: number, month: number) => void;
}

export function OutfitCalendar({
  year,
  month,
  outfits,
  selectedDate,
  onSelectDate,
  onMonthChange,
}: OutfitCalendarProps) {
  const t = useTranslations('outfitCalendar');
  const currentMonth = new Date(year, month - 1, 1);
  const dateFnsLocale = useDateFnsLocale();
  const formatDate = useFormatDate();

  // Build a map of date -> outfit sources for quick lookup
  const outfitsByDate = useMemo(() => {
    const map = new Map<string, Set<OutfitSource>>();
    outfits.forEach((outfit) => {
      const dateKey = outfit.scheduled_for;
      if (!dateKey) return;
      if (!map.has(dateKey)) {
        map.set(dateKey, new Set());
      }
      map.get(dateKey)!.add(outfit.source);
    });
    return map;
  }, [outfits]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  const handlePrevMonth = () => {
    const prev = subMonths(currentMonth, 1);
    onMonthChange(prev.getFullYear(), prev.getMonth() + 1);
  };

  const handleNextMonth = () => {
    const next = addMonths(currentMonth, 1);
    onMonthChange(next.getFullYear(), next.getMonth() + 1);
  };

  // Two-letter weekday headers ("Su".."Sa" / "Do".."Sá"), Sunday first to
  // match the grid's weekStartsOn: 0.
  const weekDays = useMemo(() => {
    const sunday = startOfWeek(new Date(), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) =>
      capitalizeFirst(format(addDays(sunday, i), 'EEEEEE', { locale: dateFnsLocale }))
    );
  }, [dateFnsLocale]);

  return (
    <div className="w-full">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="secondary"
          size="icon"
          onClick={handlePrevMonth}
          aria-label={t('prevMonth')}
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
        </Button>
        <h3 className="text-lg font-bold">
          {capitalizeFirst(formatDate(currentMonth, 'monthYear'))}
        </h3>
        <Button
          variant="secondary"
          size="icon"
          onClick={handleNextMonth}
          aria-label={t('nextMonth')}
        >
          <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
        </Button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-2">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-1 text-center text-xs font-semibold text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const sources = outfitsByDate.get(dateKey);
          const hasScheduled = sources?.has('scheduled');
          const hasOnDemand = sources?.has('on_demand') || sources?.has('manual');
          const isSelected = !!selectedDate && isSameDay(day, selectedDate);
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isDayToday = isToday(day);

          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onSelectDate(day)}
              aria-pressed={isSelected}
              aria-current={isDayToday ? 'date' : undefined}
              aria-label={formatDate(day, 'long')}
              className="group relative flex h-11 w-full items-center justify-center rounded-full focus-visible:outline-none"
            >
              <span
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-colors duration-150',
                  'group-hover:bg-accent group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2',
                  !isCurrentMonth && 'text-muted-foreground/60',
                  isSelected &&
                    'bg-signature font-bold text-signature-foreground group-hover:bg-signature',
                  isDayToday &&
                    !isSelected &&
                    'bg-signature-soft font-bold text-foreground ring-[1.5px] ring-inset ring-signature group-hover:bg-signature-soft'
                )}
              >
                {format(day, 'd')}
              </span>
              {/* Outfit indicators */}
              {sources && sources.size > 0 && (
                <div className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5">
                  {hasScheduled && (
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        'bg-foreground'
                      )}
                    />
                  )}
                  {hasOnDemand && (
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        'bg-pop-amber ring-1 ring-foreground/20'
                      )}
                    />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 text-xs font-medium text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-foreground" />
          <span>{t('scheduled')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-pop-amber" />
          <span>{t('onDemand')}</span>
        </div>
      </div>
    </div>
  );
}
