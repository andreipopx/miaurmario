import React from 'react';
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile } from 'remotion';
import { TransitionSeries, springTiming, type TransitionPresentation } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { fade } from '@remotion/transitions/fade';
import type { Sfx } from '../Soundtrack';
import { ANSWER, HookWeb } from './HookWeb';
import { GO, OpenInBrowser, TYPE_FROM, TYPE_TO } from './OpenInBrowser';
import { ADD_TAP, ICON_IN, Install, OPEN_TAP, SHARE_TAP } from './Install';
import { Everywhere } from './Everywhere';
import { CONNECT_TAP, Connect } from './Connect';
import { LOOK_AT, MOOD_AT, SongLook, TIP_AT } from './SongLook';
import { OutroWeb } from './OutroWeb';
import { INTRO, SONGS } from './songs';

export type WebPromoProps = {
  /** false renders only the UI sounds, for posting with the platform's own music. */
  withMusic: boolean;
};

const T = 14;
const SONG_D = 150;
const timing = springTiming({ config: { damping: 200 }, durationInFrames: T });

const SCENES: { el: React.ReactNode; d: number }[] = [
  { el: <HookWeb />, d: 92 },
  { el: <OpenInBrowser />, d: 120 },
  { el: <Install />, d: 176 },
  { el: <Everywhere />, d: 110 },
  { el: <Connect />, d: 104 },
  ...SONGS.map((song, i) => ({ el: <SongLook song={song} index={i} count={SONGS.length} />, d: SONG_D })),
  { el: <OutroWeb />, d: 124 },
];
const FIRST_SONG = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const presentation = (i: number): TransitionPresentation<any> =>
  i === 0 ? wipe({ direction: 'from-bottom' }) : i === 2 ? slide({ direction: 'from-bottom' }) : i === SCENES.length - 2 ? fade() : slide({ direction: 'from-right' });

export const WEB_TOTAL = SCENES.reduce((s, x) => s + x.d, 0) - T * (SCENES.length - 1);
const START = SCENES.map((_, i) => SCENES.slice(0, i).reduce((s, x) => s + x.d, 0) - T * i);
const [hook, browser, install, everywhere, connect] = START;
const outro = START[START.length - 1];

const CUES: [number, Sfx, number][] = [
  ...START.slice(1).map((s): [number, Sfx, number] => [s - 2, 'whoosh', 0.35]),
  [hook + 12, 'pop', 0.6],
  [hook + ANSWER, 'boing', 0.7],
  ...Array.from({ length: 10 }, (_, i): [number, Sfx, number] => [browser + TYPE_FROM + Math.round((i * (TYPE_TO - TYPE_FROM)) / 10), 'key', 0.3]),
  [browser + GO, 'send', 0.6],
  [install + SHARE_TAP, 'pop', 0.5],
  [install + ADD_TAP, 'pop-high', 0.5],
  [install + ICON_IN, 'chime', 0.6],
  [install + OPEN_TAP, 'pop', 0.6],
  [everywhere + 30, 'tick', 0.35],
  [everywhere + 36, 'tick', 0.35],
  [everywhere + 42, 'tick', 0.35],
  [connect + CONNECT_TAP, 'pop', 0.5],
  [connect + CONNECT_TAP + 8, 'success', 0.7],
  ...SONGS.flatMap((_, i): [number, Sfx, number][] => [
    [START[FIRST_SONG + i] + MOOD_AT, 'pop-high', 0.5],
    [START[FIRST_SONG + i] + TIP_AT, 'chime', 0.35],
    [START[FIRST_SONG + i] + LOOK_AT, 'pop', 0.5],
  ]),
  [outro + 12, 'pop-high', 0.5],
];

/** A song clip that fades in/out over `fade` frames. */
const Clip: React.FC<{ src: string; startSec: number; from: number; to: number; fadeIn?: number; fadeOut?: number; volume: number }> = ({
  src,
  startSec,
  from,
  to,
  fadeIn = 8,
  fadeOut = 12,
  volume,
}) => (
  <Sequence from={from} durationInFrames={to - from} layout="none">
    <Audio
      src={staticFile(src)}
      trimBefore={Math.round(startSec * 30)}
      volume={(f) => volume * interpolate(f, [0, fadeIn, to - from - fadeOut, to - from], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
    />
  </Sequence>
);

const Music: React.FC = () => {
  // Songs switch mid-transition, like skipping a track.
  const cut = (i: number) => START[i] + Math.round(T / 2);
  return (
    <>
      <Clip src={INTRO.src} startSec={INTRO.startSec} from={0} to={cut(FIRST_SONG) + 6} fadeIn={2} volume={0.68} />
      {SONGS.map((song, i) => {
        const last = i === SONGS.length - 1;
        return (
          <Clip
            key={song.src + i}
            src={song.src}
            startSec={song.startSec - (T / 2) / 30}
            from={cut(FIRST_SONG + i) - 6}
            to={last ? WEB_TOTAL : cut(FIRST_SONG + i + 1) + 6}
            fadeOut={last ? 36 : 12}
            volume={0.68}
          />
        );
      })}
    </>
  );
};

export const WebPromo: React.FC<WebPromoProps> = ({ withMusic }) => (
  <AbsoluteFill>
    {withMusic ? <Music /> : null}
    {CUES.map(([at, sfx, v], i) => (
      <Sequence key={i} from={at} durationInFrames={60} layout="none">
        <Audio src={staticFile(`audio/${sfx}.wav`)} volume={Math.min(1, v * (withMusic ? 0.85 : 1.2))} />
      </Sequence>
    ))}
    <TransitionSeries>
      {SCENES.map(({ el, d }, i) => (
        <React.Fragment key={i}>
          <TransitionSeries.Sequence durationInFrames={d}>{el}</TransitionSeries.Sequence>
          {i < SCENES.length - 1 ? <TransitionSeries.Transition presentation={presentation(i)} timing={timing} /> : null}
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);
