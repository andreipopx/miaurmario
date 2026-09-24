import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Stinky } from '../components/Stinky';
import { FadeUp, usePop } from '../components/anim';
import { C, POP, sans, wordmark } from '../theme';

export const Brand: React.FC = () => {
  const frame = useCurrentFrame();
  const circle = usePop(0, 14);
  const cat = usePop(4, 10);
  const word = usePop(16, 9);
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: sans, color: C.ink, alignItems: 'center', overflow: 'hidden' }}>
      {POP.map((c, i) => {
        const p = usePop(8 + i * 3, 14);
        const a = (i / 4) * Math.PI * 2 + frame / 50;
        return (
          <div
            key={c}
            style={{
              position: 'absolute',
              width: 90,
              height: 90,
              borderRadius: '50%',
              background: c,
              left: 540 - 45 + Math.cos(a) * 400 * p,
              top: 720 - 45 + Math.sin(a) * 400 * p,
              transform: `scale(${p})`,
            }}
          />
        );
      })}
      <div
        style={{
          position: 'absolute',
          top: 720 - 330,
          width: 660,
          height: 660,
          borderRadius: '50%',
          background: C.pinkSoft,
          transform: `scale(${circle})`,
        }}
      />
      <div style={{ position: 'absolute', top: 720 - 310, transform: `scale(${cat}) translateY(${(1 - cat) * 120}px)` }}>
        <Stinky state="wave" size={620} from={4} />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 1150,
          fontFamily: wordmark,
          fontSize: 176,
          lineHeight: 1,
          transform: `scale(${0.4 + 0.6 * word}) rotate(${interpolate(word, [0, 1], [-8, -2])}deg)`,
          opacity: Math.min(1, word * 2),
        }}
      >
        miaurmario
      </div>
      <FadeUp delay={28} style={{ position: 'absolute', top: 1400, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 54, fontWeight: 700, letterSpacing: '-0.02em' }}>Tu armario, curado por Stinky.</div>
      </FadeUp>
    </AbsoluteFill>
  );
};
