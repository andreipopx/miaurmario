import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, sans } from '../theme';

// Frame-driven ports of frontend/components/stinky/stinky-{purr,bite}-fx.tsx (same layout, same timings).

const PURR_MS = 2600;
const PURR = [
  { kind: 'heart', x: 18, dx: -10, delay: 0, scale: 0.16, rotate: -14 },
  { kind: 'prrr', x: 70, dx: 8, delay: 150, scale: 0.13, rotate: 8 },
  { kind: 'heart', x: 88, dx: -2, delay: 420, scale: 0.12, rotate: 12 },
  { kind: 'heart', x: 44, dx: -4, delay: 780, scale: 0.1, rotate: -6 },
  { kind: 'prrr', x: 14, dx: -6, delay: 1050, scale: 0.11, rotate: -10 },
  { kind: 'heart', x: 62, dx: 10, delay: 1300, scale: 0.14, rotate: 10 },
] as const;

const BITE_MS = 1500;
const BITE = [
  { kind: 'word', text: '¡ñam!', x: 78, y: 16, delay: 120, scale: 0.16, rotate: 8, jump: -0.16 },
  { kind: 'mark', text: '', x: 86, y: 50, delay: 470, scale: 0.2, rotate: -18, jump: 0 },
  { kind: 'word', text: 'ñac', x: 18, y: 24, delay: 800, scale: 0.12, rotate: -10, jump: -0.12 },
  { kind: 'mark', text: '', x: 12, y: 56, delay: 820, scale: 0.17, rotate: 20, jump: 0 },
] as const;

const Heart: React.FC<{ px: number; color: string; stroke: string }> = ({ px, color, stroke }) => (
  <svg viewBox="0 0 24 24" width={px} height={px} style={{ display: 'block', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.15))' }}>
    <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.9 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21z" fill={color} stroke={stroke} strokeWidth={1.5} />
  </svg>
);

/** `ink`: particle colour (pink on white, ink on the pink stage). */
export const StinkyPurrFx: React.FC<{ size: number; from: number; ink?: string; outline?: string }> = ({ size, from, ink = C.pink, outline = '#fff' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = ((frame - from) / fps) * 1000;
  if (ms < 0 || ms > PURR_MS) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {PURR.map((p, i) => {
        const t = (ms - p.delay) / (PURR_MS - p.delay);
        if (t < 0 || t > 1) return null;
        const opacity = interpolate(t, [0, 0.12, 0.7, 1], [0, 1, 1, 0]);
        const scale = interpolate(t, [0, 0.15, 1], [0.4, 1, 0.9]);
        const px = Math.round(size * p.scale);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${p.x}%`,
              top: '18%',
              opacity,
              transform: `translate(${(p.dx / 100) * size * t}px, ${-0.75 * size * t}px) rotate(${p.rotate}deg) scale(${scale})`,
            }}
          >
            {p.kind === 'heart' ? (
              <Heart px={px} color={ink} stroke={outline} />
            ) : (
              <span style={{ fontFamily: sans, fontWeight: 800, fontStyle: 'italic', fontSize: px, color: ink, letterSpacing: '-0.02em', textShadow: `0 2px 0 ${outline}` }}>prrr</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const StinkyBiteFx: React.FC<{ size: number; from: number; ink?: string; outline?: string }> = ({ size, from, ink = C.pink, outline = '#fff' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = ((frame - from) / fps) * 1000;
  if (ms < 0 || ms > BITE_MS + 200) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {BITE.map((b, i) => {
        const t = (ms - b.delay) / (BITE_MS - b.delay);
        if (t < 0) return null;
        const opacity = interpolate(t, [0, 0.08, 0.75, 1], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
        const px = Math.round(size * b.scale);
        if (b.kind === 'word') {
          const pop = interpolate(t, [0, 0.12, 0.25], [0.3, 1.25, 1], { extrapolateRight: 'clamp' });
          const jump = Math.sin(Math.min(1, t / 0.35) * Math.PI) * b.jump * size;
          return (
            <div key={i} style={{ position: 'absolute', left: `${b.x}%`, top: `${b.y}%`, opacity, transform: `translate(-50%, ${jump}px) rotate(${b.rotate}deg) scale(${pop})` }}>
              <span style={{ fontFamily: sans, fontWeight: 800, fontStyle: 'italic', fontSize: px, color: ink, letterSpacing: '-0.02em', whiteSpace: 'nowrap', textShadow: `0 2px 0 ${outline}` }}>
                {b.text}
              </span>
            </div>
          );
        }
        const draw = interpolate(t, [0, 0.3], [40, 0], { extrapolateRight: 'clamp' });
        const draw2 = interpolate(t, [0.08, 0.38], [40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <div key={i} style={{ position: 'absolute', left: `${b.x}%`, top: `${b.y}%`, opacity, transform: `translate(-50%, -50%) rotate(${b.rotate}deg)` }}>
            <svg viewBox="0 0 32 24" width={px} height={(px * 24) / 32} style={{ overflow: 'visible', display: 'block' }}>
              <g fill="none" strokeLinecap="round" strokeLinejoin="round" stroke={ink} strokeWidth={2.4}>
                <path pathLength={40} strokeDasharray={40} strokeDashoffset={draw} d="M3 7 L8 11 L13 6 L18 11 L23 6 L28 10" />
                <path pathLength={40} strokeDasharray={40} strokeDashoffset={draw2} d="M5 18 L10 14 L15 19 L20 14 L25 18" />
              </g>
            </svg>
          </div>
        );
      })}
    </div>
  );
};
