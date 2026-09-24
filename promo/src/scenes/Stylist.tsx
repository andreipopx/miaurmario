import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Check, Sun } from 'lucide-react';
import { Garment, type GarmentKind } from '../components/Garment';
import { AppHeader, Dock, PillChip, u } from '../components/Phone';
import { Stinky } from '../components/Stinky';
import { Headline, PhoneStage, Tap, popStyle, usePop } from '../components/anim';
import { C } from '../theme';

const READY = 42;
const WEAR = 112;

const LOOK: { kind: GarmentKind; color: string; x: number; y: number; s: number; r: number }[] = [
  { kind: 'shirt', color: C.sky, x: 22, y: 18, s: 190, r: -4 },
  { kind: 'trousers', color: '#E9E2D6', x: 180, y: 40, s: 180, r: 3 },
  { kind: 'sneaker', color: '#FFFFFF', x: 30, y: 196, s: 150, r: -6 },
  { kind: 'bag', color: '#8B5A3C', x: 168, y: 204, s: 110, r: 8 },
];

export const Stylist: React.FC = () => {
  const frame = useCurrentFrame();
  const ready = frame >= READY;
  const worn = frame >= WEAR;
  const wearPress = frame >= WEAR - 2 && frame < WEAR + 4 ? 0.95 : 1;
  const toast = usePop(WEAR + 4, 12);
  const headP = usePop(READY + 18, 16);
  const lookP = LOOK.map((_, i) => usePop(READY + i * 5, 11));
  const catP = usePop(READY + 20, 10);
  const btnP = usePop(READY + 26, 14);
  return (
    <PhoneStage
      accent={C.pink}
      headline={<Headline step="3 · El Estilista" color={C.pink} title="Un look cada día." sub="Según el tiempo y tus planes." />}
    >
      <AbsoluteFill style={{ background: C.bg }}>
        <AppHeader greeting="Buenos días" />
        <div style={{ padding: `${u(6)}px ${u(16)}px 0` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: u(28), fontWeight: 800, letterSpacing: '-0.02em' }}>Tu look de hoy</div>
          </div>
          <div style={{ display: 'flex', gap: u(8), marginTop: u(10) }}>
            <PillChip style={{ background: C.amber }}>
              <Sun size={u(16)} strokeWidth={2} /> 21° · Soleado
            </PillChip>
            <PillChip dot={C.mint}>Oficina</PillChip>
            <PillChip dot={C.sky}>Paseo</PillChip>
          </div>
          <div
            style={{
              position: 'relative',
              marginTop: u(14),
              height: u(340),
              borderRadius: u(24),
              background: C.panel,
              overflow: 'hidden',
            }}
          >
            {!ready ? (
              <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: u(150), height: u(150), borderRadius: '50%', background: C.pinkSoft }}>
                  <Stinky state="thinking" size={u(150)} />
                </div>
                <div style={{ marginTop: u(12), fontSize: u(16), fontWeight: 600, color: C.muted }}>
                  Dándole vueltas{'.'.repeat(1 + (Math.floor(frame / 8) % 3))}
                </div>
              </AbsoluteFill>
            ) : (
              <>
                {LOOK.map((g, i) => (
                  <div key={g.kind} style={{ position: 'absolute', left: u(g.x), top: u(g.y), transform: `rotate(${g.r}deg)` }}>
                    <div style={popStyle(lookP[i], 0.3)}>
                      <Garment kind={g.kind} color={g.color} size={u(g.s)} />
                    </div>
                  </div>
                ))}
                <div
                  style={{
                    position: 'absolute',
                    right: u(10),
                    bottom: u(10),
                    width: u(84),
                    height: u(84),
                    borderRadius: '50%',
                    background: C.pinkSoft,
                    ...popStyle(catP, 0),
                  }}
                >
                  <Stinky state="happy" size={u(84)} from={READY + 20} />
                </div>
              </>
            )}
          </div>
          <div style={{ marginTop: u(14), opacity: headP, transform: `translateY(${(1 - headP) * 20}px)` }}>
            <div style={{ fontSize: u(21), fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              Lino al sol, con un punto de descaro
            </div>
            <div style={{ fontSize: u(14.5), color: C.muted, marginTop: u(6), lineHeight: 1.35 }}>
              Camisa celeste, pantalón crudo y zapatillas blancas. Fresco, fácil y muy tú.
            </div>
          </div>
          <div style={{ display: 'flex', gap: u(10), marginTop: u(16), ...popStyle(btnP, 0.8) }}>
            <div
              style={{
                flex: 1.2,
                height: u(48),
                borderRadius: 999,
                background: worn ? C.mint : C.ink,
                color: worn ? C.ink : '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: u(6),
                fontSize: u(16),
                fontWeight: 700,
                transform: `scale(${wearPress})`,
              }}
            >
              {worn ? <Check size={u(18)} strokeWidth={2.5} /> : null}
              Me lo pongo
            </div>
            <div
              style={{
                flex: 1,
                height: u(48),
                borderRadius: 999,
                background: C.panel,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: u(16),
                fontWeight: 700,
              }}
            >
              Otra idea
            </div>
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: u(24),
            right: u(24),
            bottom: u(104),
            height: u(52),
            borderRadius: u(18),
            background: C.ink,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: u(10),
            padding: `0 ${u(14)}px`,
            fontSize: u(15),
            fontWeight: 600,
            opacity: frame >= WEAR ? Math.min(1, toast * 1.5) : 0,
            transform: `translateY(${(1 - toast) * u(30)}px)`,
            zIndex: 45,
          }}
        >
          <span style={{ width: u(24), height: u(24), borderRadius: '50%', background: C.pink, color: C.ink, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Check size={u(15)} strokeWidth={3} />
          </span>
          ¡Look guardado en tu historial!
        </div>
        <Dock active="estilista" />
        <Tap at={WEAR} x={u(16) + u(80)} y={u(700)} />
      </AbsoluteFill>
    </PhoneStage>
  );
};
