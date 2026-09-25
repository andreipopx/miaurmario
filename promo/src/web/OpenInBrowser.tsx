import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { u } from '../components/Phone';
import { Headline, PhoneStage } from '../components/anim';
import { C } from '../theme';
import { AppHome, SafariBar, URL } from './ui';

export const TYPE_FROM = 10;
export const TYPE_TO = 42;
export const GO = 46;

export const OpenInBrowser: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = URL.slice(0, Math.floor(interpolate(frame, [TYPE_FROM, TYPE_TO], [0, URL.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
  const progress = interpolate(frame, [GO, GO + 22], [0.05, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const page = interpolate(frame, [GO + 14, GO + 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <PhoneStage accent={C.sky} headline={<Headline step="Es una web" color={C.sky} title="Ábrela en el navegador." sub="Sin App Store. Sin descargas." />}>
      <AbsoluteFill style={{ background: '#fff' }}>
        <div style={{ padding: `${u(80)}px ${u(20)}px 0` }}>
          <div style={{ fontSize: u(20), fontWeight: 800 }}>Favoritos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: u(18), marginTop: u(14) }}>
            {['#E5E5EA', '#D1D1D6', '#E5E5EA', '#D1D1D6', '#D1D1D6', '#E5E5EA', '#D1D1D6', '#E5E5EA'].map((c, i) => (
              <div key={i} style={{ height: u(68), borderRadius: u(14), background: c }} />
            ))}
          </div>
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', inset: 0, opacity: page }}>
        <AppHome />
      </div>
      <SafariBar text={frame < GO ? typed : URL} focused={frame < GO} caret={frame < GO && frame % 16 < 9} progress={frame >= GO ? progress : 0} />
    </PhoneStage>
  );
};
