import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Stinky } from '../components/Stinky';
import { StinkyBiteFx } from '../components/StinkyFx';
import { FadeUp, usePop } from '../components/anim';
import { C, sans } from '../theme';

export const ANSWER = 48;

export const HookWeb: React.FC = () => {
  const frame = useCurrentFrame();
  const ans = usePop(ANSWER, 9);
  const cat = usePop(10, 14);
  return (
    <AbsoluteFill style={{ background: C.pink, fontFamily: sans, color: C.ink, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 280, left: 70, right: 70 }}>
        <FadeUp delay={2}>
          <div style={{ fontSize: 60, fontWeight: 700, opacity: 0.75 }}>Me preguntáis mucho…</div>
        </FadeUp>
        <FadeUp delay={10}>
          <div style={{ fontSize: 132, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 0.98, marginTop: 20 }}>
            ¿Es una
            <br />
            app?
          </div>
        </FadeUp>
        <div
          style={{
            display: 'inline-block',
            marginTop: 40,
            padding: '12px 36px 20px',
            background: C.ink,
            color: '#fff',
            borderRadius: 40,
            fontSize: 120,
            fontWeight: 800,
            letterSpacing: '-0.035em',
            lineHeight: 1,
            transform: `scale(${0.3 + 0.7 * ans}) rotate(${interpolate(ans, [0, 1], [-12, -3])}deg)`,
            transformOrigin: 'left center',
            opacity: Math.min(1, ans * 2),
          }}
        >
          Sí… y no.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 540 - 320,
          top: interpolate(cat, [0, 1], [1920, 1180]) + Math.sin(frame / 10) * 6,
        }}
      >
        <div style={{ position: 'relative' }}>
          <Stinky state={frame < ANSWER ? 'thinking' : 'bite'} size={640} from={frame < ANSWER ? 0 : ANSWER} />
          <StinkyBiteFx size={640} from={ANSWER} ink="#fff" outline={C.ink} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
