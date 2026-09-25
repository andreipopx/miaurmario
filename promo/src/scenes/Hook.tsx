import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Garment, type GarmentKind } from '../components/Garment';
import { Stinky } from '../components/Stinky';
import { FadeUp } from '../components/anim';
import { C, sans } from '../theme';

export const PILE: { kind: GarmentKind; color: string; x: number; y: number; r: number; d: number; s: number }[] = [
  { kind: 'jeans', color: '#3B5B8C', x: 40, y: 1250, r: -18, d: 0, s: 380 },
  { kind: 'sweater', color: C.amber, x: 640, y: 1230, r: 22, d: 4, s: 400 },
  { kind: 'dress', color: C.mint, x: 330, y: 1150, r: -6, d: 8, s: 360 },
  { kind: 'tee', color: C.sky, x: -40, y: 1000, r: 14, d: 12, s: 330 },
  { kind: 'skirt', color: '#FFFFFF', x: 760, y: 980, r: -20, d: 15, s: 300 },
  { kind: 'coat', color: '#C8925A', x: 520, y: 1020, r: 10, d: 18, s: 360 },
  { kind: 'sneaker', color: C.ink, x: 150, y: 1480, r: 8, d: 21, s: 300 },
  { kind: 'bag', color: '#FFFFFF', x: 740, y: 1500, r: -12, d: 24, s: 260 },
  { kind: 'shirt', color: '#FFFFFF', x: 360, y: 1430, r: 16, d: 27, s: 340 },
];

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const peek = spring({ frame: frame - 34, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ background: C.pink, overflow: 'hidden', fontFamily: sans, color: C.ink }}>
      {PILE.map((g, i) => {
        const p = spring({ frame: frame - g.d, fps, config: { damping: 11, mass: 0.7 } });
        const y = interpolate(p, [0, 1], [-500, g.y]);
        return (
          <div key={i} style={{ position: 'absolute', left: g.x, top: y, transform: `rotate(${g.r * p + (1 - p) * 60}deg)` }}>
            <Garment kind={g.kind} color={g.color} size={g.s} />
          </div>
        );
      })}
      <div style={{ position: 'absolute', top: 270, left: 70, right: 70 }}>
        <FadeUp delay={4}>
          <div style={{ fontSize: 124, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 0.98 }}>Armario lleno.</div>
        </FadeUp>
        <FadeUp delay={22}>
          <div
            style={{
              display: 'inline-block',
              marginTop: 30,
              padding: '10px 30px 18px',
              background: C.ink,
              color: '#fff',
              borderRadius: 36,
              fontSize: 112,
              fontWeight: 800,
              letterSpacing: '-0.035em',
              lineHeight: 1,
              transform: 'rotate(-2deg)',
            }}
          >
            Y nada que
            <br />
            ponerte.
          </div>
        </FadeUp>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 540 - 300,
          top: interpolate(peek, [0, 1], [1920, 1370]),
          transform: 'rotate(-4deg)',
        }}
      >
        <Stinky state="sleepy" size={600} from={34} />
      </div>
    </AbsoluteFill>
  );
};
