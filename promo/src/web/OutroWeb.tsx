import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Stinky } from '../components/Stinky';
import { FadeUp, usePop } from '../components/anim';
import { C, sans, wordmark } from '../theme';
import { URL } from './ui';

export const OutroWeb: React.FC = () => {
  const frame = useCurrentFrame();
  const cat = usePop(0, 11);
  const word = usePop(12, 9);
  return (
    <AbsoluteFill style={{ background: C.pink, fontFamily: sans, color: C.ink, alignItems: 'center', overflow: 'hidden' }}>
      <FadeUp delay={2} style={{ position: 'absolute', top: 200, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
          Sin tienda.
          <br />
          Sin descargas.
        </div>
      </FadeUp>
      <div style={{ position: 'absolute', top: 440, width: 560, height: 560, borderRadius: '50%', background: 'rgba(255,255,255,0.35)', transform: `scale(${cat * (1 + Math.sin(frame / 14) * 0.02)})` }} />
      <div style={{ position: 'absolute', top: 450, transform: `scale(${cat})` }}>
        <Stinky state="happy" size={540} />
      </div>
      <div style={{ position: 'absolute', top: 1050, fontFamily: wordmark, fontSize: 170, lineHeight: 1, transform: `scale(${0.4 + 0.6 * word}) rotate(-2deg)`, opacity: Math.min(1, word * 2) }}>
        miaurmario
      </div>
      <FadeUp delay={24} style={{ position: 'absolute', top: 1290, width: '100%', display: 'flex', justifyContent: 'center' }}>
        <div style={{ height: 96, padding: '0 44px', borderRadius: 999, background: C.ink, color: '#fff', display: 'flex', alignItems: 'center', fontSize: 42, fontWeight: 700 }}>{URL}</div>
      </FadeUp>
      <FadeUp delay={34} style={{ position: 'absolute', top: 1420, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 44, fontWeight: 700 }}>Ábrela y añádela a tu inicio.</div>
      </FadeUp>
    </AbsoluteFill>
  );
};
