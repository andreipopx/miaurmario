import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { CloudRain, CloudSun, Music, SkipForward, Sun } from 'lucide-react';
import { Garment } from '../components/Garment';
import { u } from '../components/Phone';
import { Stinky } from '../components/Stinky';
import { popStyle, usePop } from '../components/anim';
import { C } from '../theme';
import type { LookItem, Song } from './songs';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const NowPlayingCard: React.FC<{ song: Song; p: number }> = ({ song, p }) => {
  const frame = useCurrentFrame();
  const elapsed = song.startSec + frame / 30;
  return (
    <div style={{ borderRadius: u(24), background: C.panel, padding: u(14), ...popStyle(p, 0.85) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: u(13), fontWeight: 700, color: C.muted }}>Suena ahora</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: u(6), fontSize: u(12.5), fontWeight: 700 }}>
          <span style={{ width: u(8), height: u(8), borderRadius: '50%', background: '#1DB954' }} /> Spotify
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: u(12), marginTop: u(10) }}>
        <Cover song={song} size={64} radius={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: u(18), fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
          <div style={{ fontSize: u(14.5), color: C.muted, fontWeight: 600 }}>{song.artist}</div>
        </div>
        <Equalizer />
      </div>
      <div style={{ marginTop: u(12), height: u(5), borderRadius: 3, background: '#E2E2DF' }}>
        <div style={{ width: `${(elapsed / song.durationSec) * 100}%`, height: '100%', borderRadius: 3, background: C.ink }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: u(11.5), color: C.muted, marginTop: u(5), fontWeight: 600 }}>
        <span>{fmt(elapsed)}</span>
        <SkipForward size={u(14)} />
        <span>{fmt(song.durationSec)}</span>
      </div>
    </div>
  );
};

/** Album cover, or a mood-coloured placeholder with a note when there is none. */
export const Cover: React.FC<{ song: Song; size: number; radius?: number }> = ({ song, size, radius = 8 }) =>
  song.cover ? (
    <Img src={staticFile(song.cover)} style={{ width: u(size), height: u(size), borderRadius: u(radius), objectFit: 'cover', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }} />
  ) : (
    <div style={{ width: u(size), height: u(size), borderRadius: u(radius), flexShrink: 0, background: `linear-gradient(145deg, ${song.moodColor} 0%, #111 120%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
      <Music size={u(size * 0.4)} />
    </div>
  );

export const Equalizer: React.FC<{ color?: string }> = ({ color = C.pink }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: u(3), height: u(28) }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ width: u(5), borderRadius: u(3), background: color, height: u(8 + 18 * Math.abs(Math.sin(frame / (3.5 + i) + i * 1.7))) }} />
      ))}
    </div>
  );
};

export const MoodRow: React.FC<{ song: Song; p: number }> = ({ song, p }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <div style={{ fontSize: u(15), fontWeight: 800 }}>Cómo suena tu música</div>
    <div style={{ height: u(30), padding: `0 ${u(12)}px`, borderRadius: 999, background: song.moodColor, fontSize: u(13.5), fontWeight: 800, display: 'flex', alignItems: 'center', ...popStyle(p, 0.3) }}>{song.mood}</div>
  </div>
);

/** Stinky's typed one-liner in a soft-pink bubble. */
export const StinkyLine: React.FC<{ text: string; from: number; typeFrames?: number }> = ({ text, from, typeFrames = 40 }) => {
  const frame = useCurrentFrame();
  const p = usePop(from, 13);
  const shown = text.slice(0, Math.floor(interpolate(frame, [from + 4, from + 4 + typeFrames], [0, text.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
  return (
    <div style={{ display: 'flex', gap: u(10), alignItems: 'flex-start', ...popStyle(p, 0.8), transformOrigin: 'left top' }}>
      <div style={{ width: u(46), height: u(46), borderRadius: '50%', background: C.pinkSoft, flexShrink: 0 }}>
        <Stinky state="purr" size={u(46)} from={from} />
      </div>
      <div style={{ background: C.pinkSoft, borderRadius: u(18), borderTopLeftRadius: u(6), padding: `${u(9)}px ${u(12)}px`, fontSize: u(14), lineHeight: 1.35 }}>
        <b>Stinky:</b> {shown}
        <span style={{ opacity: 0 }}>{text.slice(shown.length)}</span>
      </div>
    </div>
  );
};

/** Garments popping in on the gray panel. `out` (0→1) pops them away again. */
export const LookPanel: React.FC<{ look: LookItem[]; from: number; height?: number; out?: number; children?: React.ReactNode }> = ({
  look,
  from,
  height = 270,
  out = 0,
  children,
}) => {
  const ps = look.map((_, i) => usePop(from + i * 5, 11));
  return (
    <div style={{ position: 'relative', height: u(height), borderRadius: u(24), background: C.panel, overflow: 'hidden' }}>
      {look.map((g, i) => (
        <div key={i} style={{ position: 'absolute', left: u(g.x), top: u(g.y), transform: `rotate(${g.r}deg)` }}>
          <div style={popStyle(ps[i] * (1 - out), 0.3)}>
            <Garment kind={g.kind} color={g.color} size={u(g.s)} />
          </div>
        </div>
      ))}
      {children}
    </div>
  );
};

const weatherIcon = (w: string) => (/lluvia/i.test(w) ? CloudRain : /nubl/i.test(w) ? CloudSun : Sun);

export const WeatherChip: React.FC<{ text: string; color?: string; style?: React.CSSProperties }> = ({ text, color, style }) => {
  const Icon = weatherIcon(text);
  const bg = color ?? (/lluvia/i.test(text) ? C.sky : /nubl/i.test(text) ? '#E2E2DF' : C.amber);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: u(6), height: u(30), padding: `0 ${u(12)}px`, borderRadius: 999, background: bg, fontSize: u(13.5), fontWeight: 800, whiteSpace: 'nowrap', ...style }}>
      <Icon size={u(16)} strokeWidth={2.2} /> {text}
    </div>
  );
};

/** "Tu look: …" and, on its own line, the weather it was made for. */
export const LookCaption: React.FC<{ title: string; weather: string; p: number }> = ({ title, weather, p }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: u(7), ...popStyle(p, 0.6), transformOrigin: 'left center' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: u(6) }}>
      <span style={{ fontSize: u(13), color: C.muted, fontWeight: 700, whiteSpace: 'nowrap' }}>Tu look:</span>
      <span style={{ fontSize: u(17), fontWeight: 800, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{title}</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: u(8) }}>
      <span style={{ fontSize: u(13), color: C.muted, fontWeight: 700 }}>Pensado para</span>
      <WeatherChip text={weather} />
    </div>
  </div>
);
