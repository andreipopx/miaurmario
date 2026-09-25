import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Music, SkipForward } from 'lucide-react';
import { Garment } from '../components/Garment';
import { AppHeader, Dock, u } from '../components/Phone';
import { Stinky } from '../components/Stinky';
import { Headline, PhoneStage, popStyle, usePop } from '../components/anim';
import { C } from '../theme';
import type { Song } from './songs';

export const MOOD_AT = 16;
export const TIP_AT = 26;
export const LOOK_AT = 70;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const SongLook: React.FC<{ song: Song; index: number; count: number }> = ({ song, index, count }) => {
  const frame = useCurrentFrame();
  const card = usePop(0, 14);
  const mood = usePop(MOOD_AT, 11);
  const tip = usePop(TIP_AT, 13);
  const panel = usePop(LOOK_AT - 8, 15);
  const lookP = song.look.map((_, i) => usePop(LOOK_AT + i * 5, 11));
  const titleP = usePop(LOOK_AT + 22, 15);
  const shown = song.line.slice(0, Math.floor(interpolate(frame, [TIP_AT + 4, TIP_AT + 44], [0, song.line.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
  const elapsed = song.startSec + frame / 30;
  return (
    <PhoneStage
      accent={song.moodColor}
      headline={<Headline step={`Suena ahora · ${index + 1}/${count}`} color={song.moodColor} title={song.headline} sub="Stinky viste lo que escuchas." />}
    >
      <AbsoluteFill style={{ background: C.bg }}>
        <AppHeader />
        <div style={{ padding: `${u(4)}px ${u(16)}px 0` }}>
          <div style={{ borderRadius: u(24), background: C.panel, padding: u(14), ...popStyle(card, 0.85) }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: u(13), fontWeight: 700, color: C.muted }}>Suena ahora</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: u(6), fontSize: u(12.5), fontWeight: 700 }}>
                <span style={{ width: u(8), height: u(8), borderRadius: '50%', background: '#1DB954' }} /> Spotify
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: u(12), marginTop: u(10) }}>
              <div
                style={{
                  width: u(70),
                  height: u(70),
                  borderRadius: u(14),
                  background: `linear-gradient(145deg, ${song.moodColor} 0%, #111 120%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                }}
              >
                <Music size={u(28)} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: u(18), fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
                <div style={{ fontSize: u(14.5), color: C.muted, fontWeight: 600 }}>{song.artist}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: u(3), height: u(28) }}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} style={{ width: u(5), borderRadius: u(3), background: C.pink, height: u(8 + 18 * Math.abs(Math.sin(frame / (3.5 + i) + i * 1.7))) }} />
                ))}
              </div>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: u(12) }}>
            <div style={{ fontSize: u(15), fontWeight: 800 }}>Cómo suena tu música</div>
            <div style={{ height: u(30), padding: `0 ${u(12)}px`, borderRadius: 999, background: song.moodColor, fontSize: u(13.5), fontWeight: 800, display: 'flex', alignItems: 'center', ...popStyle(mood, 0.3) }}>
              {song.mood}
            </div>
          </div>
          <div style={{ display: 'flex', gap: u(10), alignItems: 'flex-start', marginTop: u(10), ...popStyle(tip, 0.8), transformOrigin: 'left top' }}>
            <div style={{ width: u(46), height: u(46), borderRadius: '50%', background: C.pinkSoft, flexShrink: 0 }}>
              <Stinky state="purr" size={u(46)} from={TIP_AT} />
            </div>
            <div style={{ background: C.pinkSoft, borderRadius: u(18), borderTopLeftRadius: u(6), padding: `${u(9)}px ${u(12)}px`, fontSize: u(14), lineHeight: 1.35 }}>
              <b>Stinky:</b> {shown}
              <span style={{ opacity: 0 }}>{song.line.slice(shown.length)}</span>
            </div>
          </div>
          <div style={{ position: 'relative', marginTop: u(12), height: u(270), borderRadius: u(24), background: C.panel, overflow: 'hidden', ...popStyle(panel, 0.9) }}>
            {song.look.map((g, i) => (
              <div key={i} style={{ position: 'absolute', left: u(g.x), top: u(g.y), transform: `rotate(${g.r}deg)` }}>
                <div style={popStyle(lookP[i], 0.3)}>
                  <Garment kind={g.kind} color={g.color} size={u(g.s)} />
                </div>
              </div>
            ))}

          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: u(8), marginTop: u(10), ...popStyle(titleP, 0.6), transformOrigin: 'left center' }}>
            <span style={{ fontSize: u(13), color: C.muted, fontWeight: 700 }}>Tu look:</span>
            <span style={{ fontSize: u(17), fontWeight: 800, letterSpacing: '-0.01em' }}>{song.lookTitle}</span>
          </div>
        </div>
        <Dock active="estilista" />
      </AbsoluteFill>
    </PhoneStage>
  );
};
