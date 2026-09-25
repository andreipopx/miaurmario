import React from 'react';
import { Composition } from 'remotion';
import { TransitionSeries, springTiming, type TransitionPresentation } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { fade } from '@remotion/transitions/fade';
import { Hook } from './scenes/Hook';
import { Brand } from './scenes/Brand';
import { Snap } from './scenes/Snap';
import { Wardrobe } from './scenes/Wardrobe';
import { Stylist } from './scenes/Stylist';
import { Chat } from './scenes/Chat';
import { Friends } from './scenes/Friends';
import { Outro } from './scenes/Outro';
import { Soundtrack, type SceneStarts } from './Soundtrack';
import { FPS } from './theme';
import { WEB_TOTAL, WebPromo } from './web/WebPromo';

const T = 14;
const timing = springTiming({ config: { damping: 200 }, durationInFrames: T });

const SCENES = [
  { C: Hook, d: 96 },
  { C: Brand, d: 84 },
  { C: Snap, d: 150 },
  { C: Wardrobe, d: 118 },
  { C: Stylist, d: 160 },
  { C: Chat, d: 150 },
  { C: Friends, d: 118 },
  { C: Outro, d: 110 },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PRESENTATIONS: TransitionPresentation<any>[] = [
  wipe({ direction: 'from-bottom' }),
  slide({ direction: 'from-bottom' }),
  slide({ direction: 'from-right' }),
  slide({ direction: 'from-right' }),
  slide({ direction: 'from-right' }),
  slide({ direction: 'from-right' }),
  fade(),
];

export const TOTAL = SCENES.reduce((s, x) => s + x.d, 0) - T * (SCENES.length - 1);

const starts = SCENES.map((_, i) => SCENES.slice(0, i).reduce((s, x) => s + x.d, 0) - T * i);
const STARTS: SceneStarts = {
  hook: starts[0],
  brand: starts[1],
  snap: starts[2],
  wardrobe: starts[3],
  stylist: starts[4],
  chat: starts[5],
  friends: starts[6],
  outro: starts[7],
};

const Promo: React.FC = () => (
  <>
    <Soundtrack starts={STARTS} />
    <TransitionSeries>
      {SCENES.map(({ C, d }, i) => (
        <React.Fragment key={i}>
          <TransitionSeries.Sequence durationInFrames={d}>
            <C />
          </TransitionSeries.Sequence>
          {i < PRESENTATIONS.length ? <TransitionSeries.Transition presentation={PRESENTATIONS[i]} timing={timing} /> : null}
        </React.Fragment>
      ))}
    </TransitionSeries>
  </>
);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920} />
    <Composition id="WebPromo" component={WebPromo} defaultProps={{ withMusic: true }} durationInFrames={WEB_TOTAL} fps={FPS} width={1080} height={1920} />
  </>
);
