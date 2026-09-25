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
import { LOOK_AT, MOOD_AT, SongLook } from './SongLook';
import { LOOK_AT as M_LOOK_AT, ManualSong, PICK, SUGGEST, TYPE_FROM as M_TYPE_FROM, TYPE_TO as M_TYPE_TO } from './ManualSong';
import { DROP_FROM, SWAP, WeatherLook } from './WeatherLook';
import { LOOK_AT as R_LOOK_AT, PICK_AT as R_PICK, Revive } from './Revive';
import { AllFactors } from './AllFactors';
import { BITE_AT, OutroWeb } from './OutroWeb';
import { INTRO, PICKED, SONGS } from './songs';

export type WebPromoProps = {
  /** false renders only the UI sounds, for posting with the platform's own music. */
  withMusic: boolean;
};

const T = 14;
const timing = springTiming({ config: { damping: 200 }, durationInFrames: T });

const SCENES: { key: string; el: React.ReactNode; d: number }[] = [
  { key: 'hook', el: <HookWeb />, d: 92 },
  { key: 'browser', el: <OpenInBrowser />, d: 110 },
  { key: 'install', el: <Install />, d: 160 },
  { key: 'everywhere', el: <Everywhere />, d: 90 },
  { key: 'connect', el: <Connect />, d: 96 },
  ...SONGS.map((song, i) => ({ key: `song${i}`, el: <SongLook song={song} />, d: 176 })),
  { key: 'manual', el: <ManualSong />, d: 222 },
  { key: 'weather', el: <WeatherLook />, d: 170 },
  { key: 'revive', el: <Revive />, d: 164 },
  { key: 'factors', el: <AllFactors />, d: 100 },
  { key: 'outro', el: <OutroWeb />, d: 116 },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const presentation = (i: number): TransitionPresentation<any> =>
  i === 0 ? wipe({ direction: 'from-bottom' }) : i === 2 ? slide({ direction: 'from-bottom' }) : i === SCENES.length - 2 ? fade() : slide({ direction: 'from-right' });

export const WEB_TOTAL = SCENES.reduce((s, x) => s + x.d, 0) - T * (SCENES.length - 1);
const START: Record<string, number> = {};
SCENES.forEach((sc, i) => (START[sc.key] = SCENES.slice(0, i).reduce((s, x) => s + x.d, 0) - T * i));
const at = (key: string) => START[key];
/** Songs switch mid-transition, like skipping a track. */
const cut = (key: string) => at(key) + Math.round(T / 2);

/** "¡ñam!" pop and two chomps, on the bite clip's own beats (120 / 470 / 800 ms). */
const bite = (f: number): [number, Sfx, number][] => [
  [f + 4, 'pop-high', 0.5],
  [f + 14, 'chomp', 0.9],
  [f + 24, 'chomp', 0.8],
];

const CUES: [number, Sfx, number][] = [
  ...SCENES.slice(1).map((sc): [number, Sfx, number] => [at(sc.key) - 2, 'whoosh', 0.35]),
  [at('hook') + 12, 'pop', 0.6],
  [at('hook') + ANSWER, 'boing', 0.5],
  ...bite(at('hook') + ANSWER),
  ...Array.from({ length: 10 }, (_, i): [number, Sfx, number] => [at('browser') + TYPE_FROM + Math.round((i * (TYPE_TO - TYPE_FROM)) / 10), 'key', 0.3]),
  [at('browser') + GO, 'send', 0.6],
  [at('install') + SHARE_TAP, 'pop', 0.5],
  [at('install') + ADD_TAP, 'pop-high', 0.5],
  [at('install') + ICON_IN, 'chime', 0.6],
  [at('install') + OPEN_TAP, 'pop', 0.6],
  ...[30, 36, 42].map((f): [number, Sfx, number] => [at('everywhere') + f, 'tick', 0.35]),
  [at('connect') + CONNECT_TAP, 'pop', 0.5],
  [at('connect') + CONNECT_TAP + 8, 'success', 0.7],
  ...SONGS.flatMap((_, i): [number, Sfx, number][] => [
    [at(`song${i}`) + MOOD_AT, 'pop-high', 0.5],
    [at(`song${i}`) + LOOK_AT, 'pop', 0.5],
  ]),
  ...Array.from({ length: 8 }, (_, i): [number, Sfx, number] => [at('manual') + M_TYPE_FROM + Math.round((i * (M_TYPE_TO - M_TYPE_FROM)) / 8), 'key', 0.3]),
  [at('manual') + SUGGEST, 'pop-high', 0.4],
  [at('manual') + PICK, 'pop', 0.6],
  [at('manual') + M_LOOK_AT, 'chime', 0.5],
  ...[0, 4, 8, 12].map((f): [number, Sfx, number] => [at('weather') + DROP_FROM + f * 2, 'tick', 0.3]),
  [at('weather') + SWAP, 'chime', 0.5],
  [at('revive') + R_PICK - 2, 'pop', 0.6],
  [at('revive') + R_LOOK_AT + 10, 'success', 0.6],
  ...[0, 1, 2, 3, 4, 5].map((i): [number, Sfx, number] => [at('factors') + 8 + i * 6, 'tick', 0.35]),
  [at('outro') + 12, 'pop-high', 0.5],
  ...bite(at('outro') + BITE_AT),
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
  const pick = at('manual') + PICK;
  return (
    <>
      <Clip src={INTRO.src} startSec={INTRO.startSec} from={0} to={cut('song0') + 6} fadeIn={2} volume={0.68} />
      {SONGS.map((song, i) => (
        <Clip
          key={song.src}
          src={song.src}
          startSec={song.startSec - T / 2 / 30}
          from={cut(`song${i}`) - 6}
          to={(i === SONGS.length - 1 ? pick : cut(`song${i + 1}`)) + 6}
          volume={0.68}
        />
      ))}
      {/* Mode 2: the typed song starts on the tap and plays to the end. */}
      <Clip src={PICKED.src} startSec={PICKED.startSec} from={pick} to={WEB_TOTAL} fadeIn={4} fadeOut={36} volume={0.68} />
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
      {SCENES.map(({ key, el, d }, i) => (
        <React.Fragment key={key}>
          <TransitionSeries.Sequence durationInFrames={d}>{el}</TransitionSeries.Sequence>
          {i < SCENES.length - 1 ? <TransitionSeries.Transition presentation={presentation(i)} timing={timing} /> : null}
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);
