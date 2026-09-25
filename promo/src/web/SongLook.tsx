import React from 'react';
import { AbsoluteFill } from 'remotion';
import { AppHeader, Dock, u } from '../components/Phone';
import { Headline, PhoneStage, usePop } from '../components/anim';
import { C } from '../theme';
import { LookCaption, LookPanel, MoodRow, NowPlayingCard, StinkyLine } from './parts';
import type { Song } from './songs';

export const MOOD_AT = 18;
export const TIP_AT = 32;
export const LOOK_AT = 88;

/** Mode 1: what's playing on Spotify → mood → look (with today's weather). */
export const SongLook: React.FC<{ song: Song }> = ({ song }) => {
  const card = usePop(0, 14);
  const mood = usePop(MOOD_AT, 11);
  const caption = usePop(LOOK_AT + 26, 15);
  return (
    <PhoneStage accent={song.moodColor} headline={<Headline step={song.step} color={song.moodColor} title={song.headline} sub={song.sub} />}>
      <AbsoluteFill style={{ background: C.bg }}>
        <AppHeader />
        <div style={{ padding: `${u(4)}px ${u(16)}px 0`, display: 'flex', flexDirection: 'column', gap: u(12) }}>
          <NowPlayingCard song={song} p={card} />
          <MoodRow song={song} p={mood} />
          <StinkyLine text={song.line} from={TIP_AT} typeFrames={44} />
          <LookPanel look={song.look} from={LOOK_AT} height={236} />
          <LookCaption title={song.lookTitle} weather={song.weather} p={caption} />
        </div>
        <Dock active="estilista" />
      </AbsoluteFill>
    </PhoneStage>
  );
};
