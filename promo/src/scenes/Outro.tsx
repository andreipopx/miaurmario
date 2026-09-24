import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Stinky } from '../components/Stinky';
import { FadeUp, usePop } from '../components/anim';
import { C, sans, wordmark } from '../theme';

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const cat = usePop(0, 11);
  const word = usePop(10, 9);
  return (
    <AbsoluteFill style={{ background: C.pink, fontFamily: sans, color: C.ink, alignItems: 'center', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: 300,
          width: 640,
          height: 640,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.35)',
          transform: `scale(${cat * (1 + Math.sin(frame / 14) * 0.02)})`,
        }}
      />
      <div style={{ position: 'absolute', top: 310, transform: `scale(${cat})` }}>
        <Stinky state="happy" size={620} />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 1010,
          fontFamily: wordmark,
          fontSize: 180,
          lineHeight: 1,
          transform: `scale(${0.4 + 0.6 * word}) rotate(-2deg)`,
          opacity: Math.min(1, word * 2),
        }}
      >
        miaurmario
      </div>
      <FadeUp delay={22} style={{ position: 'absolute', top: 1250, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 62, fontWeight: 800, letterSpacing: '-0.025em' }}>Foto. Armario. Look.</div>
      </FadeUp>
      <FadeUp delay={32} style={{ position: 'absolute', top: 1390, width: '100%', display: 'flex', justifyContent: 'center' }}>
        <div
          style={{
            height: 96,
            padding: '0 44px',
            borderRadius: 999,
            background: C.ink,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            fontSize: 42,
            fontWeight: 700,
          }}
        >
          miaurmario.andreipop.org
        </div>
      </FadeUp>
    </AbsoluteFill>
  );
};
