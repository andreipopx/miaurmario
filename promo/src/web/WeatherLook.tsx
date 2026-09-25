import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { CloudRain, Sun } from 'lucide-react';
import { AppHeader, Dock, u } from '../components/Phone';
import { Headline, PhoneStage, usePop } from '../components/anim';
import { C } from '../theme';
import { Equalizer, LookCaption, LookPanel, StinkyLine } from './parts';
import { SongField } from './ManualSong';
import { PICKED, RAINY } from './songs';

export const DROP_FROM = 14;
export const DROP_TO = 38;
export const SWAP = 46;

/** Weather is always on (when enabled): same song, colder day → the look gains layers. */
export const WeatherLook: React.FC = () => {
  const frame = useCurrentFrame();
  const temp = Math.round(interpolate(frame, [DROP_FROM, DROP_TO], [21, 9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const rainy = frame >= (DROP_FROM + DROP_TO) / 2;
  const outA = interpolate(frame, [SWAP - 8, SWAP], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const caption = usePop(SWAP + 16, 15);
  const cardP = usePop(0, 15);
  const Icon = rainy ? CloudRain : Sun;
  return (
    <PhoneStage
      accent={C.sky}
      headline={<Headline step="Y siempre, el tiempo" color={C.sky} title="¿Refresca? Te abriga." sub="Con el tiempo activado, cada look lo tiene en cuenta." />}
    >
      <AbsoluteFill style={{ background: C.bg }}>
        <AppHeader />
        <div style={{ position: 'absolute', left: u(16), right: u(16), top: u(112), display: 'flex', flexDirection: 'column', gap: u(12) }}>
          <div style={{ fontSize: u(28), fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>Tu look de hoy</div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: u(12),
              height: u(72),
              borderRadius: u(22),
              padding: `0 ${u(16)}px`,
              background: rainy ? C.sky : C.amber,
              transform: `scale(${0.9 + 0.1 * cardP})`,
            }}
          >
            <Icon size={u(34)} strokeWidth={2} />
            <div style={{ fontSize: u(34), fontWeight: 800, letterSpacing: '-0.03em' }}>{temp}°</div>
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontSize: u(15), fontWeight: 800 }}>{rainy ? 'Lluvia · 80%' : 'Soleado'}</div>
              <div style={{ fontSize: u(12.5), fontWeight: 600 }}>{rainy ? 'Va a hacer frío' : 'Hoy'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: u(8) }}>
            <div style={{ flex: 1 }}>
              <SongField picked />
            </div>
            <Equalizer />
          </div>
          <div style={{ position: 'relative' }}>
            {frame < SWAP ? (
              <LookPanel look={PICKED.look} from={-30} height={230} out={outA} />
            ) : (
              <LookPanel look={RAINY.look} from={SWAP} height={230} />
            )}
            {rainy ? (
              <div style={{ position: 'absolute', inset: 0, borderRadius: u(24), overflow: 'hidden', pointerEvents: 'none' }}>
                {Array.from({ length: 18 }, (_, i) => {
                  const x = (i * 53) % 340;
                  const y = ((frame * 9 + i * 71) % 300) - 40;
                  return <div key={i} style={{ position: 'absolute', left: u(x), top: u(y), width: u(2), height: u(18), borderRadius: 2, background: 'rgba(86,194,255,0.55)', transform: 'rotate(12deg)' }} />;
                })}
              </div>
            ) : null}
          </div>
          <LookCaption title={frame < SWAP ? PICKED.lookTitle : RAINY.lookTitle} weather={frame < SWAP ? PICKED.weather : RAINY.weather} p={frame < SWAP ? 1 : caption} />
          <StinkyLine text={RAINY.line} from={SWAP + 10} typeFrames={34} />
        </div>
        <Dock active="estilista" />
      </AbsoluteFill>
    </PhoneStage>
  );
};
