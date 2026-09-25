import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Compass, Home, Laptop, MessageCircle, Shirt, Smartphone, Sparkles } from 'lucide-react';
import { Garment, type GarmentKind } from '../components/Garment';
import { Dock, Phone } from '../components/Phone';
import { FadeUp, Headline, popStyle, usePop } from '../components/anim';
import { C, sans, wordmark } from '../theme';
import { AppHome } from './ui';

const TILES: { kind: GarmentKind; color: string }[] = [
  { kind: 'shirt', color: C.sky },
  { kind: 'jeans', color: '#3B5B8C' },
  { kind: 'sweater', color: C.amber },
  { kind: 'sneaker', color: '#FFFFFF' },
  { kind: 'coat', color: '#C8925A' },
  { kind: 'dress', color: C.mint },
  { kind: 'skirt', color: C.pink },
  { kind: 'bag', color: '#8B5A3C' },
];

const Laptop_: React.FC = () => (
  <div style={{ width: 900 }}>
    <div style={{ height: 560, borderRadius: 30, background: '#161616', padding: 16 }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 16, background: '#fff', display: 'flex', overflow: 'hidden', fontFamily: sans }}>
        <div style={{ width: 200, borderRight: `1px solid ${C.border}`, padding: 18 }}>
          <div style={{ fontFamily: wordmark, fontSize: 30 }}>miaurmario</div>
          {[
            ['Hoy', Home],
            ['Armario', Shirt],
            ['Estilista', Sparkles],
            ['Inspiración', Compass],
            ['Stinky', MessageCircle],
          ].map(([l, I], i) => {
            const Icon = I as typeof Home;
            return (
              <div
                key={l as string}
                style={{
                  marginTop: i === 0 ? 22 : 8,
                  height: 40,
                  borderRadius: 20,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '0 14px',
                  background: i === 1 ? C.pink : 'transparent',
                  fontSize: 17,
                  fontWeight: 700,
                }}
              >
                <Icon size={19} /> {l as string}
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, padding: 24 }}>
          <div style={{ fontSize: 32, fontWeight: 800 }}>Armario</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 16 }}>
            {TILES.map((t, i) => (
              <div key={i} style={{ height: 190, borderRadius: 18, background: C.panel, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Garment kind={t.kind} color={t.color} size={130} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    <div style={{ height: 26, margin: '0 -50px', background: '#d4d4d4', borderRadius: '0 0 30px 30px' }} />
  </div>
);

const CHIPS: [string, React.ReactNode, string][] = [
  ['iPhone', <Smartphone key="a" size={34} />, C.sky],
  ['Android', <Smartphone key="b" size={34} />, C.mint],
  ['Ordenador', <Laptop key="c" size={34} />, C.amber],
];

export const Everywhere: React.FC = () => {
  const frame = useCurrentFrame();
  const lap = usePop(4, 16);
  const ph = usePop(14, 14);
  const chips = CHIPS.map((_, i) => usePop(30 + i * 6, 11));
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: 1300, height: 1300, left: -110, top: 700, borderRadius: '50%', background: C.amber, opacity: 0.2 }} />
      <Headline step="En todas partes" color={C.amber} title="Móvil u ordenador." sub="La misma cuenta, siempre al día." />
      <div style={{ position: 'absolute', left: 30, top: 520 + (1 - lap) * 400, transform: `rotate(${Math.sin(frame / 30) * 0.5}deg)`, opacity: Math.min(1, lap * 1.5) }}>
        <Laptop_ />
      </div>
      <div style={{ position: 'absolute', left: 700, top: 700 + (1 - ph) * 600, transform: 'scale(0.46)', transformOrigin: 'top left' }}>
        <Phone>
          <AppHome />
          <Dock active="hoy" />
        </Phone>
      </div>
      <div style={{ position: 'absolute', top: 1360, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 22, fontFamily: sans }}>
        {CHIPS.map(([l, icon, c], i) => (
          <div
            key={l}
            style={{
              height: 84,
              padding: '0 30px',
              borderRadius: 999,
              background: c,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 36,
              fontWeight: 800,
              ...popStyle(chips[i], 0.4),
            }}
          >
            {icon}
            {l}
          </div>
        ))}
      </div>
      <FadeUp delay={52} style={{ position: 'absolute', top: 1470, left: 0, right: 0, textAlign: 'center', fontFamily: sans }}>
        <div style={{ fontSize: 40, fontWeight: 600, color: C.muted }}>Ocupa casi nada y se actualiza sola.</div>
      </FadeUp>
    </AbsoluteFill>
  );
};
