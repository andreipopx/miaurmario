'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { List as ListIcon, CalendarDays, Plus, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { OutfitCard } from '@/components/outfits/outfit-card';
import { OutfitCalendar } from '@/components/outfit-calendar';
import {
  useCalendarOutfits,
  useOutfits,
  type Outfit,
  type OutfitFilters,
} from '@/lib/hooks/use-outfits';
import { cn } from '@/lib/utils';
import { useFormatter, useTranslations } from 'next-intl';

interface MonthRef {
  year: number;
  month: number;
}

function currentMonthRef(): MonthRef {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function formatDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatMonthParam(ref: MonthRef): string {
  return `${ref.year}-${String(ref.month).padStart(2, '0')}`;
}

function parseMonthParam(val: string | null): MonthRef | null {
  if (!val) return null;
  const [y, m] = val.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const d = new Date(ref.year, ref.month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function outfitDateSet(outfits: Outfit[]): Set<string> {
  const set = new Set<string>();
  for (const o of outfits) {
    if (o.scheduled_for) set.add(o.scheduled_for);
  }
  return set;
}

function outfitsByDate(outfits: Outfit[]): Map<string, Outfit[]> {
  const map = new Map<string, Outfit[]>();
  for (const o of outfits) {
    if (!o.scheduled_for) continue;
    const arr = map.get(o.scheduled_for) ?? [];
    arr.push(o);
    map.set(o.scheduled_for, arr);
  }
  return map;
}

type FilterChip =
  | 'all'
  | 'my-looks'
  | 'worn'
  | 'pairings'
  | 'replacements'
  | 'ai';

type ViewMode = 'list' | 'calendar';

const CHIP_ORDER: FilterChip[] = [
  'all',
  'my-looks',
  'worn',
  'pairings',
  'replacements',
  'ai',
];

type ChipKey = 'all' | 'myLooks' | 'worn' | 'pairings' | 'replacements' | 'ai';

const CHIP_KEYS: Record<FilterChip, ChipKey> = {
  all: 'all',
  'my-looks': 'myLooks',
  worn: 'worn',
  pairings: 'pairings',
  replacements: 'replacements',
  ai: 'ai',
};

function chipToFilters(chip: FilterChip, search: string): OutfitFilters {
  const filters: OutfitFilters = {};
  if (search) filters.search = search;
  switch (chip) {
    case 'my-looks':
      filters.is_lookbook = true;
      return filters;
    case 'worn':
      filters.is_lookbook = false;
      filters.status = 'accepted';
      return filters;
    case 'pairings':
      filters.has_source_item = true;
      return filters;
    case 'replacements':
      filters.is_replacement = true;
      return filters;
    case 'ai':
      filters.source = 'scheduled,on_demand';
      return filters;
    case 'all':
    default:
      return filters;
  }
}

function OutfitsPageContent() {
  const t = useTranslations('outfits');
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawFilter = (searchParams.get('filter') as FilterChip) || 'all';
  const urlView: ViewMode = searchParams.get('view') === 'calendar' ? 'calendar' : 'list';
  const urlFilter: FilterChip =
    urlView === 'calendar' && rawFilter === 'my-looks' ? 'all' : rawFilter;
  const chip: FilterChip = urlFilter;
  const view: ViewMode = urlView;
  const urlMonth = parseMonthParam(searchParams.get('month'));

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [defaultChecked, setDefaultChecked] = useState(false);
  const [monthRef, setMonthRef] = useState<MonthRef>(urlMonth ?? currentMonthRef());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (urlMonth && (urlMonth.year !== monthRef.year || urlMonth.month !== monthRef.month)) {
      setMonthRef(urlMonth);
    }
  }, [urlMonth, monthRef.year, monthRef.month]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = useMemo(
    () => chipToFilters(chip, debouncedSearch),
    [chip, debouncedSearch],
  );

  const listQuery = useOutfits(filters, page, 24);

  const calendarQuery = useCalendarOutfits(
    monthRef.year,
    monthRef.month,
    view === 'calendar' ? filters : {},
  );

  const lookbookProbe = useOutfits({ is_lookbook: true }, 1, 1);

  useEffect(() => {
    if (defaultChecked) return;
    if (urlFilter !== 'all' || urlView === 'calendar') {
      setDefaultChecked(true);
      return;
    }
    if (lookbookProbe.data) {
      if (lookbookProbe.data.total === 0) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('filter', 'my-looks');
        router.replace(`/dashboard/outfits?${params.toString()}`);
      }
      setDefaultChecked(true);
    }
  }, [defaultChecked, lookbookProbe.data, urlFilter, urlView, searchParams, router]);

  const updateQuery = useCallback(
    (next: {
      filter?: FilterChip;
      view?: ViewMode;
      month?: MonthRef | null;
    }) => {
      const params = new URLSearchParams(searchParams.toString());

      if ('filter' in next) {
        if (!next.filter || next.filter === 'all') {
          params.delete('filter');
        } else {
          params.set('filter', next.filter);
        }
      }

      if ('view' in next) {
        if (!next.view || next.view === 'list') {
          params.delete('view');
        } else {
          params.set('view', next.view);
        }
      }

      if ('month' in next) {
        if (!next.month) {
          params.delete('month');
        } else {
          params.set('month', formatMonthParam(next.month));
        }
      }

      router.replace(
        `/dashboard/outfits${params.toString() ? `?${params}` : ''}`,
      );
    },
    [router, searchParams],
  );

  const handleChipClick = (next: FilterChip) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') {
      params.delete('filter');
    } else {
      params.set('filter', next);
    }
    setPage(1);
    setSelectedDate(null);
    router.replace(
      `/dashboard/outfits${params.toString() ? `?${params}` : ''}`,
    );
  };

  const handleViewChange = (next: ViewMode) => {
    setSelectedDate(null);
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'calendar') {
      params.set('view', 'calendar');
      if (params.get('filter') === 'my-looks') {
        params.delete('filter');
      }
    } else {
      params.delete('view');
    }
    router.replace(
      `/dashboard/outfits${params.toString() ? `?${params}` : ''}`,
    );
  };

  const handleMonthChange = (year: number, month: number) => {
    const nextRef = { year, month };
    setMonthRef(nextRef);
    setSelectedDate(null);
    updateQuery({ month: nextRef });
  };

  const handleShiftMonth = (delta: number) => {
    const nextRef = shiftMonth(monthRef, delta);
    setMonthRef(nextRef);
    setSelectedDate(null);
    updateQuery({ month: nextRef });
  };

  const calendarOutfits: Outfit[] = calendarQuery.data?.outfits ?? [];
  const dateSet = useMemo(() => outfitDateSet(calendarOutfits), [calendarOutfits]);
  const dateMap = useMemo(() => outfitsByDate(calendarOutfits), [calendarOutfits]);
  const selectedDayOutfits: Outfit[] = selectedDate
    ? dateMap.get(selectedDate) ?? []
    : [];

  const outfits = listQuery.data?.outfits ?? [];
  const hasMore = listQuery.data?.has_more ?? false;
  const listLoading = listQuery.isLoading;
  const listError = listQuery.isError;
  const calendarLoading = calendarQuery.isLoading;
  const calendarError = calendarQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <>
            <div
              className="inline-flex h-11 items-center gap-1 rounded-full bg-panel p-1"
              role="group"
              aria-label={t('viewToggle')}
            >
              {(['list', 'calendar'] as const).map((v) => {
                const Icon = v === 'list' ? ListIcon : CalendarDays;
                const active = view === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleViewChange(v)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      active
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={active ? 2 : 1.75} />
                    {v === 'list' ? t('viewList') : t('viewCalendar')}
                  </button>
                );
              })}
            </div>
            <Button asChild variant="signature">
              <Link href="/dashboard/outfits/new">
                <Plus className="h-4 w-4" />
                {t('newOutfit')}
              </Link>
            </Button>
          </>
        }
      />

      {view === 'list' && (
      <div className="flex flex-wrap items-center gap-3">
        <div className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto scrollbar-none px-4 pb-1 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {CHIP_ORDER.map((c) => (
            <Chip
              key={c}
              active={chip === c}
              onClick={() => handleChipClick(c)}
              className="h-11"
            >
              {t(`chips.${CHIP_KEYS[c]}` as `chips.${ChipKey}`)}
            </Chip>
          ))}
        </div>

        {chip === 'my-looks' && (
          <div className="relative ml-auto min-w-[220px] flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('searchLookbook')}
              aria-label={t('searchLookbook')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 border-transparent bg-panel pl-10"
            />
          </div>
        )}

        {listQuery.data && (
          <Badge variant="secondary" className="ml-auto">
            {t('totalCount', { count: listQuery.data.total })}
          </Badge>
        )}
      </div>
      )}

      {view === 'list' ? (
        <>
          {listError ? (
            <EmptyState state="sad" title={t('loadError')} />
          ) : listLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[5/4] rounded-lg" />
              ))}
            </div>
          ) : outfits.length === 0 ? (
            <EmptyState
              state="sleepy"
              title={t(`empty.${CHIP_KEYS[chip]}` as `empty.${ChipKey}`)}
              action={
                chip === 'my-looks' ? (
                  <Button asChild variant="signature">
                    <Link href="/dashboard/outfits/new">
                      <Plus className="h-4 w-4" />
                      {t('newOutfit')}
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {outfits.map((outfit) => (
                  <OutfitCard key={outfit.id} outfit={outfit} />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center pt-4">
                  <Button variant="secondary" onClick={() => setPage((p) => p + 1)}>
                    {t('loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="grid lg:grid-cols-[360px_1fr] gap-6">
          <Card className="h-fit border-0 bg-panel">
            <CardContent className="p-4 sm:p-4">
              {calendarLoading ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <Skeleton className="h-11 w-11 rounded-full bg-background" />
                    <Skeleton className="h-6 w-32 rounded-full bg-background" />
                    <Skeleton className="h-11 w-11 rounded-full bg-background" />
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: 35 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full rounded-full bg-background" />
                    ))}
                  </div>
                </div>
              ) : (
                <OutfitCalendar
                  year={monthRef.year}
                  month={monthRef.month}
                  outfits={calendarOutfits}
                  selectedDate={selectedDate ? parseYmd(selectedDate) : null}
                  onSelectDate={(d: Date) =>
                    setSelectedDate(formatDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate()))
                  }
                  onMonthChange={handleMonthChange}
                />
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {calendarError ? (
              <EmptyState state="sad" size="sm" title={t('loadError')} />
            ) : calendarLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[5/4] rounded-lg" />
                ))}
              </div>
            ) : selectedDate && selectedDayOutfits.length === 0 ? (
              <EmptyState state="sleepy" size="sm" title={t('noOutfitsOnDay')} />
            ) : (
              <>
                {selectedDate && (
                  <div className="space-y-0.5">
                    <h2 className="text-lg font-bold">
                      {format.dateTime(parseYmd(selectedDate), { weekday: 'short', month: 'short', day: 'numeric' })}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t('outfitCount', { count: selectedDayOutfits.length })}
                    </p>
                  </div>
                )}
                {!selectedDate && (
                  <p className="text-sm text-muted-foreground">
                    {t('outfitsThisMonth', { count: calendarOutfits.length })}
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(selectedDate ? selectedDayOutfits : calendarOutfits).map((outfit) => (
                    <OutfitCard key={outfit.id} outfit={outfit} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function parseYmd(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function OutfitsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-9 w-48 rounded-full" />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[5/4] rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      <OutfitsPageContent />
    </Suspense>
  );
}
