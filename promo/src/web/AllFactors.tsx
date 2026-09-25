import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { CalendarDays, CloudRain, Heart, History, Music, WashingMachine, type LucideIcon } from 'lucide-react';
import { Stinky } from '../components/Stinky';
import { StinkyPurrFx } from '../components/StinkyFx';
import { Headline, popStyle, usePop } from '../components/anim';
import { C, sans } from '../theme';

export const HAPPY_AT = 56;

const FACTORS: [string, LucideIcon, string][] = [
  ['Lo que escuchas', Music, C.pink],
  ['El tiempo', CloudRain, C.sky],
  ['Tu plan del día', CalendarDays, C.amber],
  ['Lo que menos usas', History, C.mint],
  ['Lo que está para lavar', WashingMachine, C.sky],
  ['Lo que te gusta', Heart, C.pink],
];

/** Everything the Stylist weighs, around Stinky. */
export const AllFactors: React.FC = () => {
  const frame = useCurrentFrame();
  const cat = usePop(0, 14);
  const chips = FACTORS.map((_, i) => usePop(8 + i * 6, 11));
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: sans, color: C.ink, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: 1100, height: 1100, left: -10, top: 560, borderRadius: '50%', background: C.pinkSoft, opacity: 0.8 }} />
      <Headline step="Todo cuenta" color={C.pink} title="Stinky lo junta todo." sub="Y aprende de lo que eliges." />
      <div style={{ position: 'absolute', left: 540 - 210, top: 500, width: 420, height: 420, transform: `scale(${cat})` }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#fff' }} />
        <Stinky state={frame < HAPPY_AT ? 'thinking' : 'purr'} size={420} from={frame < HAPPY_AT ? 0 : HAPPY_AT} style={{ position: 'relative' }} />
        <StinkyPurrFx size={420} from={HAPPY_AT} />
      </div>
      <div style={{ position: 'absolute', top: 980, left: 60, right: 60, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        {FACTORS.map(([label, Icon, color], i) => (
          <div
            key={label}
            style={{
              height: 150,
              borderRadius: 32,
              background: '#fff',
              boxShadow: '0 10px 30px rgba(17,17,17,0.08)',
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '0 26px',
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              ...popStyle(chips[i], 0.4),
            }}
          >
            <div style={{ width: 72, height: 72, flexShrink: 0, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={36} strokeWidth={2} />
            </div>
            {label}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
