import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, sans } from '../theme';
import { Phone } from './Phone';

export const usePop = (delay = 0, damping = 12) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.6, stiffness: 140 } });
};

export const popStyle = (p: number, from = 0.6): React.CSSProperties => ({
  transform: `scale(${from + (1 - from) * p})`,
  opacity: Math.min(1, p * 1.6),
});

export const FadeUp: React.FC<{ delay?: number; distance?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  delay = 0,
  distance = 40,
  children,
  style,
}) => {
  const p = usePop(delay, 16);
  return <div style={{ opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * distance}px)`, ...style }}>{children}</div>;
};

/** Step badge + headline + subline above the phone. */
export const Headline: React.FC<{ step: string; color: string; title: string; sub: string }> = ({ step, color, title, sub }) => (
  <div style={{ position: 'absolute', top: 190, left: 60, right: 60, textAlign: 'center', fontFamily: sans, color: C.ink }}>
    <FadeUp delay={2}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 60,
          padding: '0 28px',
          borderRadius: 999,
          background: color,
          fontSize: 32,
          fontWeight: 800,
        }}
      >
        {step}
      </div>
    </FadeUp>
    <FadeUp delay={6}>
      <div style={{ fontSize: 86, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.02, marginTop: 26 }}>{title}</div>
    </FadeUp>
    <FadeUp delay={11}>
      <div style={{ fontSize: 40, fontWeight: 500, color: C.muted, marginTop: 16 }}>{sub}</div>
    </FadeUp>
  </div>
);

/** White stage with a soft colour blob, a headline and the phone rising in. */
export const PhoneStage: React.FC<{ accent: string; headline: React.ReactNode; children: React.ReactNode; lightStatus?: boolean }> = ({
  accent,
  headline,
  children,
  lightStatus,
}) => {
  const frame = useCurrentFrame();
  const p = usePop(0, 18);
  const bob = Math.sin(frame / 22) * 6;
  const blob = interpolate(frame, [0, 200], [0.9, 1.08]);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          width: 1100,
          height: 1100,
          left: -10,
          top: 820,
          borderRadius: '50%',
          background: accent,
          opacity: 0.22,
          transform: `scale(${blob})`,
        }}
      />
      {headline}
      <div style={{ position: 'absolute', left: 208, top: 520 + (1 - p) * 700 + bob }}>
        <Phone lightStatus={lightStatus}>{children}</Phone>
      </div>
    </AbsoluteFill>
  );
};

/** A finger-tap marker. */
export const Tap: React.FC<{ at: number; x: number; y: number }> = ({ at, x, y }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < -8 || t > 22) return null;
  const inP = interpolate(t, [-8, 0], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ring = interpolate(t, [0, 18], [1, 2.2], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const out = interpolate(t, [6, 22], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: x - 40, top: y - 40, width: 80, height: 80, zIndex: 60, opacity: inP * out }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(17,17,17,0.28)', transform: `scale(${t < 0 ? 1.2 : 0.9})` }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '4px solid rgba(17,17,17,0.35)', transform: `scale(${ring})` }} />
    </div>
  );
};
