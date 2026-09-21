'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Loader2, Music, Radio, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useMusicSearch, useNowPlaying } from '@/lib/hooks/use-music';
import { trackLabel, type MusicTrack } from '@/lib/music';

export interface SongSelection {
  /** What the field shows and what is sent as `song_query`. */
  text: string;
  /** Exact Spotify track id when picked from Spotify results / now playing. */
  trackId: string | null;
  track?: MusicTrack | null;
}

/** Room the floating mobile dock (and its fade) takes at the bottom, below `lg`. */
const MOBILE_DOCK_RESERVE = 120;
const LIST_MAX = 344;
const LIST_MIN = 160;
/** The sticky app header at the top. */
const HEADER_RESERVE = 72;

interface ListPlacement {
  up: boolean;
  maxHeight: number;
}

/**
 * Where the suggestions fit: below the field unless the floating dock would
 * cover them and there is more room above (short pages on phones).
 */
function measurePlacement(anchor: HTMLElement): ListPlacement {
  const rect = anchor.getBoundingClientRect();
  const vh = window.innerHeight;
  const desktop =
    typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;
  const reserve = desktop ? 16 : MOBILE_DOCK_RESERVE;
  const gap = 8;
  const below = vh - reserve - rect.bottom - gap;
  const above = rect.top - HEADER_RESERVE - gap;
  const up = below < Math.min(LIST_MAX, 240) && above > below;
  const room = (up ? above : below) - 32; // source footer
  return { up, maxHeight: Math.max(LIST_MIN, Math.min(LIST_MAX, Math.floor(room))) };
}

function Cover({ src, size = 40 }: { src: string | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-panel"
      style={{ width: size, height: size }}
    >
      {src && !broken ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={`${size}px`}
          className="object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <Music className="h-4 w-4 text-muted-foreground" aria-hidden />
      )}
    </span>
  );
}

/**
 * Estilista song field: free text still works, but typing suggests tracks
 * (Spotify search when connected, Last.fm / MusicBrainz otherwise) and a
 * "Lo que suena ahora" chip fills it from what is playing.
 */
export function SongAutocomplete({
  value,
  onChange,
  spotifyConnected,
  describedBy,
}: {
  value: SongSelection;
  onChange: (next: SongSelection) => void;
  spotifyConnected: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('suggest');
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ListPlacement>({ up: false, maxHeight: LIST_MAX });

  const searching = open && !value.trackId && value.text.trim().length >= 2;
  const search = useMusicSearch(value.text, searching);
  const items = searching ? (search.data?.items ?? []) : [];
  const nowPlaying = useNowPlaying(spotifyConnected);
  const playing = nowPlaying.data?.track ?? null;

  useEffect(() => {
    setActiveIndex(-1);
  }, [value.text]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const select = (track: MusicTrack) => {
    onChange({ text: trackLabel(track), trackId: track.track_id, track });
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      select(items[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = searching && (items.length > 0 || search.isFetching);
  const source = search.data?.source;

  useLayoutEffect(() => {
    if (!showList || !fieldRef.current) return;
    const el = fieldRef.current;
    const update = () => setPlacement(measurePlacement(el));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [showList]);

  return (
    <div ref={wrapRef} className="space-y-2">
      <div ref={fieldRef} className="relative">
        {value.trackId && value.track ? (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
            <Cover src={value.track.image_url} size={32} />
          </span>
        ) : null}
        <Input
          id="song-query"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          value={value.text}
          onChange={(e) => {
            onChange({ text: e.target.value, trackId: null, track: null });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('songPlaceholder')}
          maxLength={280}
          className={cn('border-transparent bg-panel pr-11', value.trackId && value.track && 'pl-12')}
          aria-describedby={describedBy}
        />
        {value.text && (
          <button
            type="button"
            onClick={() => onChange({ text: '', trackId: null, track: null })}
            className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('songClear')}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}

        {showList && (
          <div
            data-placement={placement.up ? 'top' : 'bottom'}
            className={cn(
              'absolute inset-x-0 z-30 overflow-hidden rounded-lg border border-border bg-card shadow-lg',
              placement.up ? 'bottom-full mb-2' : 'top-full mt-2'
            )}
          >
            <ul
              id={listId}
              role="listbox"
              aria-label={t('songSuggestions')}
              className="overflow-y-auto py-1.5"
              style={{ maxHeight: placement.maxHeight }}
            >
              {items.map((item, i) => (
                <li
                  key={`${item.track_id ?? item.name}-${i}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    'flex min-h-[52px] cursor-pointer items-center gap-3 px-3 py-1.5',
                    i === activeIndex && 'bg-panel'
                  )}
                >
                  <Cover src={item.image_url} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[item.artists.join(', '), item.album].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </li>
              ))}
              {search.isFetching && items.length === 0 && (
                <li className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground" role="presentation">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t('songSearching')}
                </li>
              )}
            </ul>
            {source && items.length > 0 && (
              <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
                {t('songSource', { source: source === 'spotify' ? 'Spotify' : source === 'lastfm' ? 'Last.fm' : 'MusicBrainz' })}
              </p>
            )}
          </div>
        )}
      </div>

      {playing && playing.track_id !== value.trackId && (
        <button
          type="button"
          onClick={() => select(playing)}
          className="inline-flex h-10 max-w-full items-center gap-2 rounded-full border-[1.5px] border-border bg-background pl-1.5 pr-3.5 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Cover src={playing.image_url} size={28} />
          <Radio className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          <span className="shrink-0 font-semibold">{t('songNowPlaying')}</span>
          <span className="truncate text-muted-foreground">{trackLabel(playing)}</span>
        </button>
      )}
    </div>
  );
}
