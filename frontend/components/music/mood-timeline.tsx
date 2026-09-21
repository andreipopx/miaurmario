'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { POP_BG } from '@/components/chip';
import { capitalizeFirst, formatDateLocalized } from '@/lib/date-locale';
import { buildMoodBars, moodColor, moodLegend, parseDay, type DayMood } from '@/lib/music';

const POP_VAR: Record<string, string> = {
  amber: 'var(--pop-amber)',
  pink: 'var(--pop-pink)',
  sky: 'var(--pop-sky)',
  mint: 'var(--pop-mint)',
};

const CHART_H = 120;

/**
 * Lightweight SVG mood timeline: one bar per day (height = estimated energy,
 * colour = the day's mood), a dotted valence line on top. Tapping a bar
 * shows that day's details underneath.
 */
export function MoodTimeline({
  moods,
  start,
  end,
}: {
  moods: DayMood[];
  start: string;
  end: string;
}) {
  const t = useTranslations('music');
  const locale = useLocale();
  const bars = useMemo(() => buildMoodBars(moods, start, end), [moods, start, end]);
  const legend = useMemo(() => moodLegend(moods), [moods]);
  const latest = moods.length ? moods[moods.length - 1].date : null;
  const [selected, setSelected] = useState<string | null>(null);
  const active = moods.find((m) => m.date === (selected ?? latest)) ?? null;

  const n = bars.length;
  const slot = 100 / Math.max(n, 1);
  const barW = Math.max(slot * 0.62, 0.35);
  const valencePoints = bars
    .map((b, i) =>
      b.mood ? `${(i + 0.5) * slot},${CHART_H - 8 - b.mood.valence * (CHART_H - 16)}` : null
    )
    .filter(Boolean)
    .join(' ');

  const summary = t('chartSummary', {
    days: moods.length,
    mood: legend[0] ? t(`moods.${legend[0]}`) : '—',
  });

  return (
    <div className="space-y-3">
      <div className="relative rounded-tile bg-panel px-3 pb-2 pt-3">
        <svg
          viewBox={`0 0 100 ${CHART_H}`}
          preserveAspectRatio="none"
          className="h-[140px] w-full"
          role="img"
          aria-label={summary}
        >
          {[0.25, 0.5, 0.75].map((y) => (
            <line
              key={y}
              x1={0}
              x2={100}
              y1={CHART_H * y}
              y2={CHART_H * y}
              stroke="var(--border)"
              strokeWidth={0.4}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {bars.map((b, i) => {
            const h = b.height * (CHART_H - 8);
            const x = i * slot + (slot - barW) / 2;
            const isActive = active?.date === b.date;
            return (
              <g key={b.date}>
                {b.mood ? (
                  <rect
                    x={x}
                    y={CHART_H - h}
                    width={barW}
                    height={h}
                    rx={Math.min(barW / 2, 2)}
                    fill={POP_VAR[b.color ?? 'amber']}
                    opacity={active && !isActive ? 0.55 : 1}
                  />
                ) : (
                  <rect
                    x={x}
                    y={CHART_H - 2}
                    width={barW}
                    height={2}
                    rx={1}
                    fill="var(--border)"
                  />
                )}
              </g>
            );
          })}
          {valencePoints && (
            <polyline
              points={valencePoints}
              fill="none"
              stroke="var(--foreground)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity={0.55}
            />
          )}
        </svg>
        {/* Invisible hit targets (≥ 44px tall) over each day with data. */}
        <div className="absolute inset-x-3 top-3 flex h-[140px]" aria-hidden={n > 40}>
          {bars.map((b) =>
            b.mood ? (
              <button
                key={b.date}
                type="button"
                onClick={() => setSelected(b.date)}
                className="h-full flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t('dayLabel', {
                  date: formatDateLocalized(parseDay(b.date), 'short', locale),
                  mood: t(`moods.${b.mood.mood_key}`),
                })}
                aria-pressed={active?.date === b.date}
                tabIndex={n > 40 ? -1 : 0}
              />
            ) : (
              <span key={b.date} className="h-full flex-1" />
            )
          )}
        </div>
        <div className="mt-1 flex justify-between text-[11px] font-medium text-muted-foreground">
          <span>{formatDateLocalized(parseDay(start), 'short', locale)}</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-4 border-t-[1.5px] border-dashed border-foreground/60" />
            {t('valenceLegend')}
          </span>
          <span>{formatDateLocalized(parseDay(end), 'short', locale)}</span>
        </div>
      </div>

      {legend.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('legend')}>
          {legend.map((key) => (
            <li
              key={key}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border-[1.5px] border-border px-2.5 text-xs font-semibold"
            >
              <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', POP_BG[moodColor(key)])} />
              {t(`moods.${key}`)}
            </li>
          ))}
        </ul>
      )}

      {active && (
        <div className="rounded-tile border-[1.5px] border-border p-3.5" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-sm font-bold">
              {capitalizeFirst(formatDateLocalized(parseDay(active.date), 'weekdayLong', locale))}
            </p>
            <span
              className={cn(
                'inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-bold text-pop-foreground',
                POP_BG[active.color]
              )}
            >
              {active.mood_keys.map((k) => t(`moods.${k}`)).join(' · ')}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Meter label={t('energy')} value={active.energy} />
            <Meter label={t('valence')} value={active.valence} />
            <div className="rounded-md bg-panel px-2 py-1.5">
              <dt className="text-[11px] text-muted-foreground">{t('plays')}</dt>
              <dd className="text-sm font-bold">{active.track_count}</dd>
            </div>
          </dl>
          {active.top_genres.length > 0 && (
            <p className="mt-2 truncate text-xs text-muted-foreground">
              {active.top_genres.slice(0, 3).join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="rounded-md bg-panel px-2 py-1.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-bold">{pct}%</dd>
    </div>
  );
}
