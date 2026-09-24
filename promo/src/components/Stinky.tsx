import React from 'react';
import { Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import meta from '../stinky-meta.json';

export type StinkyState = keyof typeof meta;

/**
 * Plays the mascot's WebP clips as PNG sequences (extracted from
 * frontend/public/brand/stinky/head/anim) so every rendered frame is deterministic.
 * `from` is the local frame the clip starts on; one-shot clips hold their last frame.
 */
export const Stinky: React.FC<{ state: StinkyState; size: number; from?: number; style?: React.CSSProperties }> = ({
  state,
  size,
  from = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const m = meta[state];
  const ms = (Math.max(0, frame - from) / fps) * 1000;
  const t = m.loop ? ms % m.durationMs : Math.min(ms, m.durationMs - 1);
  const i = Math.min(m.frames - 1, Math.floor((t / m.durationMs) * m.frames));
  return (
    <Img
      src={staticFile(`stinky/${state}/${String(i).padStart(3, '0')}.png`)}
      style={{ width: size, height: size, display: 'block', ...style }}
    />
  );
};
