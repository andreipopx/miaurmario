import { formatDistanceStrict as formatDistance } from 'date-fns';
import { getDateFnsLocale } from '@/lib/date-locale';
import type { PopColor } from '@/components/chip';

/** Types for /api/v1/music/* */

export type MusicRange = '7d' | '30d' | '6m';
export type MusicSource = 'spotify' | 'lastfm';

export interface MusicSettings {
  contrast: boolean;
  use_for_mood: boolean;
  source: MusicSource | null;
  sources: Record<MusicSource, boolean>;
}
export const MUSIC_RANGES: readonly MusicRange[] = ['7d', '30d', '6m'];

export type MoodKey =
  | 'euphoric'
  | 'electric'
  | 'intense'
  | 'romantic'
  | 'calm'
  | 'dreamy'
  | 'nostalgic'
  | 'melancholic'
  | 'eclectic';

export const MOOD_KEYS: readonly MoodKey[] = [
  'euphoric',
  'electric',
  'intense',
  'romantic',
  'calm',
  'dreamy',
  'nostalgic',
  'melancholic',
  'eclectic',
];

/** Pop colour per mood (amber = high & happy, pink = charged, sky = low/wistful, mint = calm). */
export const MOOD_COLORS: Record<MoodKey, PopColor> = {
  euphoric: 'amber',
  electric: 'pink',
  intense: 'pink',
  romantic: 'pink',
  calm: 'mint',
  dreamy: 'sky',
  nostalgic: 'sky',
  melancholic: 'sky',
  eclectic: 'amber',
};

export function isMoodKey(value: unknown): value is MoodKey {
  return typeof value === 'string' && (MOOD_KEYS as readonly string[]).includes(value);
}

export function moodColor(key: string | null | undefined): PopColor {
  return isMoodKey(key) ? MOOD_COLORS[key] : 'amber';
}

export interface MusicTrack {
  track_id: string | null;
  name: string;
  artists: string[];
  album: string | null;
  image_url: string | null;
  duration_ms: number | null;
  url: string | null;
  plays?: number | null;
  source?: 'spotify' | 'lastfm' | 'musicbrainz';
}

/** Settings page of a source (where "Gestionar" links to). */
export function sourceSettingsHref(source: MusicSource | null | undefined): string {
  return source === 'spotify'
    ? '/dashboard/settings/integrations/spotify'
    : source === 'lastfm'
      ? '/dashboard/settings/integrations/lastfm'
      : '/dashboard/settings/integrations';
}

export interface NowPlaying extends MusicTrack {
  is_playing: boolean;
  progress_ms: number | null;
}

export interface ListeningEventItem {
  id: string;
  track_id: string;
  name: string;
  artists: string[];
  album: string | null;
  image_url: string | null;
  duration_ms: number | null;
  played_at: string;
  source: string;
  genres: string[];
  url: string | null;
}

export interface TopArtist {
  id: string | null;
  name: string;
  image_url: string | null;
  genres: string[];
  plays: number | null;
  url: string | null;
}

export interface DayMood {
  date: string;
  moods: string[];
  mood_keys: MoodKey[];
  mood_key: MoodKey;
  color: PopColor;
  energy: number;
  valence: number;
  top_genres: string[];
  track_count: number;
  minutes: number;
  dominant_artists: string[];
  one_liner: string;
  /** How the music sounds ("melancólica"), Spanish, agrees with "música". */
  sounds?: string[];
  method: 'heuristic' | 'ai';
}

export interface OutfitDay {
  date: string;
  mood: DayMood | null;
  outfits: {
    id: string;
    name: string | null;
    occasion: string;
    status: string;
    worn: boolean;
    thumbnails: string[];
  }[];
  tracks: { track_id: string; name: string; artist: string | null; image_url: string | null; plays: number }[];
}

export interface MusicOverview {
  /** Spotify configured on this server. */
  configured: boolean;
  lastfm_configured: boolean;
  connected: boolean;
  /** Primary source (Spotify wins when both are connected). */
  source: MusicSource | null;
  sources: Record<MusicSource, boolean>;
  lastfm_username: string | null;
  range: MusicRange;
  start: string;
  end: string;
  last_synced_at: string | null;
  now_playing: NowPlaying | null;
  recent: ListeningEventItem[];
  top_artists: TopArtist[];
  top_tracks: MusicTrack[];
  top_source: 'spotify' | 'lastfm' | 'history';
  moods: DayMood[];
  genres: { genre: string; count: number; share: number }[];
  stats: {
    plays: number;
    minutes: number;
    unique_tracks: number;
    unique_artists: number;
    active_days: number;
    top_mood: MoodKey | null;
    avg_energy: number | null;
    avg_valence: number | null;
  };
  outfit_days: OutfitDay[];
}

export interface MusicSearchResponse {
  source: 'spotify' | 'lastfm' | 'musicbrainz' | null;
  items: MusicTrack[];
}

/** "Artist — Title" label for a track (what the Estilista field shows). */
export function trackLabel(track: Pick<MusicTrack, 'name' | 'artists'>): string {
  const artist = track.artists?.filter(Boolean).join(', ');
  return artist ? `${artist} — ${track.name}` : track.name;
}

/** Localised "hace 5 minutos" / "5 minutes ago" (`justNow` under a minute). */
export function relativeTime(
  iso: string,
  locale: string,
  justNow: string,
  now: Date = new Date()
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (Math.abs(now.getTime() - date.getTime()) < 60_000) return justNow;
  return formatDistance(date, now, {
    addSuffix: true,
    locale: getDateFnsLocale(locale),
  });
}

/** Parse a YYYY-MM-DD API date as a *local* calendar day (not UTC midnight). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Every calendar day from start to end (inclusive), as YYYY-MM-DD. */
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = parseDay(start);
  const last = parseDay(end);
  while (cur <= last && out.length < 400) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export interface MoodBar {
  date: string;
  mood: DayMood | null;
  /** 0..1 bar height (energy), 0 for days without listening. */
  height: number;
  color: PopColor | null;
}

/** One bar per day of the range; days without plays are empty slots. */
export function buildMoodBars(moods: DayMood[], start: string, end: string): MoodBar[] {
  const byDay = new Map(moods.map((m) => [m.date, m]));
  return daysBetween(start, end).map((date) => {
    const mood = byDay.get(date) ?? null;
    return {
      date,
      mood,
      height: mood ? Math.max(0.08, Math.min(1, mood.energy)) : 0,
      color: mood ? moodColor(mood.mood_key) : null,
    };
  });
}

/** Mood keys present in the range, most frequent first (for the legend). */
export function moodLegend(moods: DayMood[]): MoodKey[] {
  const counts = new Map<MoodKey, number>();
  for (const m of moods) counts.set(m.mood_key, (counts.get(m.mood_key) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || MOOD_KEYS.indexOf(a[0]) - MOOD_KEYS.indexOf(b[0]))
    .map(([k]) => k);
}
