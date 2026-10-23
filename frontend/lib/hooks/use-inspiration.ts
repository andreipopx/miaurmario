'use client';

import type { Service } from '@/components/brand/service-logos';
import { useMusicOverview } from '@/lib/hooks/use-music';
import { usePinterestPins, usePinterestStatus } from '@/lib/hooks/use-pinterest';
import type { ListeningEventItem } from '@/lib/music';

export interface Inspiration {
  music: {
    loaded: boolean;
    connected: boolean;
    /** The connected services, or the ones to connect. */
    services: Service[];
    /** What is playing now, or the last thing played. */
    latest: Pick<ListeningEventItem, 'name' | 'artists'> | null;
    playing: boolean;
    covers: string[];
  };
  pins: {
    loaded: boolean;
    connected: boolean;
    count: number;
    images: string[];
  };
}

/** What Stinky picked up lately from your music and your Pinterest boards. */
export function useInspiration(): Inspiration {
  const { data: music } = useMusicOverview('7d');
  const { data: pinterest } = usePinterestStatus();
  const pins = usePinterestPins(4, 0, undefined, Boolean(pinterest?.connected));

  const connected = Boolean(music?.connected);
  return {
    music: {
      loaded: Boolean(music),
      connected,
      services: connected && music ? (['spotify', 'lastfm'] as const).filter((s) => music.sources[s]) : ['spotify', 'lastfm'],
      latest: music?.now_playing ?? music?.recent[0] ?? null,
      playing: Boolean(music?.now_playing?.is_playing),
      covers: Array.from(
        new Set((music?.recent ?? []).map((r) => r.image_url).filter((u): u is string => Boolean(u)))
      ),
    },
    pins: {
      loaded: Boolean(pinterest),
      connected: Boolean(pinterest?.connected),
      count: pinterest?.pin_count ?? 0,
      images: (pins.data?.items ?? []).map((p) => p.image_url),
    },
  };
}
