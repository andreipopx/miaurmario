import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Sparkles, X } from 'lucide-react';
import { Garment } from '../components/Garment';
import { PillChip, SCREEN_H, u } from '../components/Phone';
import { Stinky } from '../components/Stinky';
import { Headline, PhoneStage, Tap, popStyle, usePop } from '../components/anim';
import { C, POP } from '../theme';

const SHOT = 38;
const TAGS = ['Camisa', 'Lino', 'Azul cielo', 'Primavera', 'Casual'];

const Camera: React.FC = () => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, SHOT], [1.08, 1], { extrapolateRight: 'clamp' });
  const corner = (s: React.CSSProperties) => (
    <div style={{ position: 'absolute', width: u(40), height: u(40), borderColor: '#fff', borderStyle: 'solid', borderWidth: 0, ...s }} />
  );
  return (
    <AbsoluteFill style={{ background: '#0c0c0c' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: u(110),
          height: u(520),
          background: 'linear-gradient(180deg,#e9e2d6,#d9cfbf)',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%,-50%) scale(${zoom}) rotate(-3deg)` }}>
          <Garment kind="shirt" color={C.sky} size={u(360)} />
        </div>
        {corner({ left: u(40), top: u(60), borderTopWidth: u(3), borderLeftWidth: u(3), borderTopLeftRadius: u(12) })}
        {corner({ right: u(40), top: u(60), borderTopWidth: u(3), borderRightWidth: u(3), borderTopRightRadius: u(12) })}
        {corner({ left: u(40), bottom: u(60), borderBottomWidth: u(3), borderLeftWidth: u(3), borderBottomLeftRadius: u(12) })}
        {corner({ right: u(40), bottom: u(60), borderBottomWidth: u(3), borderRightWidth: u(3), borderBottomRightRadius: u(12) })}
      </div>
      <div style={{ position: 'absolute', top: u(68), left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: u(15), fontWeight: 600 }}>
        Añadir prenda
      </div>
      <div style={{ position: 'absolute', top: u(64), left: u(20), color: '#fff' }}>
        <X size={u(24)} />
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: u(90),
          left: '50%',
          width: u(78),
          height: u(78),
          marginLeft: -u(39),
          borderRadius: '50%',
          border: `${u(4)}px solid #fff`,
          padding: u(5),
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: '#fff',
            transform: `scale(${frame >= SHOT - 2 && frame < SHOT + 4 ? 0.86 : 1})`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const Detail: React.FC = () => {
  const frame = useCurrentFrame();
  const inP = usePop(SHOT + 6, 16);
  const tagged = frame > SHOT + 48;
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: Math.min(1, inP * 2) }}>
      <div
        style={{
          position: 'absolute',
          left: u(16),
          right: u(16),
          top: u(64),
          height: u(390),
          borderRadius: u(24),
          background: C.panel,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ transform: `scale(${0.7 + 0.3 * inP}) rotate(${(1 - inP) * -3}deg)` }}>
          <Garment kind="shirt" color={C.sky} size={u(300)} />
        </div>
        {!tagged ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              borderRadius: u(24),
              background: `linear-gradient(100deg, transparent ${interpolate(frame, [SHOT, SHOT + 48], [-40, 120])}%, rgba(255,255,255,0.7) ${interpolate(frame, [SHOT, SHOT + 48], [-20, 140])}%, transparent ${interpolate(frame, [SHOT, SHOT + 48], [0, 160])}%)`,
            }}
          />
        ) : null}
      </div>
      <div style={{ position: 'absolute', left: u(16), right: u(16), top: u(474) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: u(10) }}>
          <div style={{ width: u(52), height: u(52), borderRadius: '50%', background: C.pinkSoft, overflow: 'hidden' }}>
            <Stinky state={tagged ? 'happy' : 'thinking'} size={u(52)} from={tagged ? SHOT + 48 : SHOT} />
          </div>
          <div style={{ fontSize: u(15), fontWeight: 600, color: C.muted, display: 'flex', alignItems: 'center', gap: u(6) }}>
            <Sparkles size={u(16)} />
            {tagged ? 'Etiquetada por la IA' : 'Husmeando la prenda…'}
          </div>
        </div>
        <div
          style={{
            fontSize: u(28),
            fontWeight: 800,
            letterSpacing: '-0.02em',
            marginTop: u(16),
            opacity: tagged ? 1 : 0.15,
            background: tagged ? 'transparent' : C.panel,
            borderRadius: u(10),
            color: tagged ? C.ink : 'transparent',
          }}
        >
          Camisa de lino
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: u(8), marginTop: u(16) }}>
          {TAGS.map((t, i) => {
            const p = usePop(SHOT + 52 + i * 5, 10);
            return (
              <div key={t} style={popStyle(p, 0.3)}>
                <PillChip dot={POP[i % POP.length]}>{t}</PillChip>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: u(8), marginTop: u(22), ...popStyle(usePop(SHOT + 80, 14), 0.8) }}>
          <div style={{ flex: 1, height: u(44), borderRadius: 999, background: C.ink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: u(15), fontWeight: 700 }}>
            Guardar en mi armario
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Snap: React.FC = () => {
  const frame = useCurrentFrame();
  const flash = interpolate(frame, [SHOT, SHOT + 3, SHOT + 12], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <PhoneStage lightStatus={frame < SHOT + 8} accent={C.amber} headline={<Headline step="1 · Haz una foto" color={C.amber} title="Hazle una foto." sub="La IA la etiqueta sola." />}>
      {frame < SHOT + 8 ? <Camera /> : <Detail />}
      <AbsoluteFill style={{ background: '#fff', opacity: flash, zIndex: 45 }} />
      <Tap at={SHOT - 2} x={u(195)} y={SCREEN_H - u(129)} />
    </PhoneStage>
  );
};
