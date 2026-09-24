import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Heart, MessageCircle } from 'lucide-react';
import { Garment, type GarmentKind } from '../components/Garment';
import { AppHeader, Dock, PillChip, u } from '../components/Phone';
import { Headline, PhoneStage, Tap, popStyle, usePop } from '../components/anim';
import { C } from '../theme';

export const LIKE = 40;
const LOOK: { kind: GarmentKind; color: string; x: number; y: number; s: number; r: number }[] = [
  { kind: 'dress', color: C.mint, x: 20, y: 20, s: 230, r: -3 },
  { kind: 'bag', color: C.pink, x: 210, y: 40, s: 130, r: 10 },
  { kind: 'sneaker', color: '#FFFFFF', x: 196, y: 170, s: 140, r: -8 },
];
const FLOATERS = [
  { x: 40, d: 0, c: C.pink },
  { x: 64, d: 4, c: C.amber },
  { x: 28, d: 8, c: C.sky },
  { x: 56, d: 12, c: C.pink },
];

export const Friends: React.FC = () => {
  const frame = useCurrentFrame();
  const liked = frame >= LIKE;
  const heartP = usePop(LIKE, 7);
  const cardP = usePop(4, 15);
  const commentP = usePop(LIKE + 22, 13);
  return (
    <PhoneStage accent={C.amber} headline={<Headline step="5 · Inspiración" color={C.amber} title="Compártelo." sub="Amigos, looks y comentarios." />}>
      <AbsoluteFill style={{ background: C.bg }}>
        <AppHeader />
        <div style={{ padding: `${u(6)}px ${u(16)}px 0` }}>
          <div style={{ fontSize: u(28), fontWeight: 800, letterSpacing: '-0.02em' }}>Amigos</div>
          <div style={{ display: 'flex', gap: u(8), marginTop: u(10) }}>
            <PillChip active>Feed</PillChip>
            <PillChip>Mis amigos</PillChip>
            <PillChip dot={C.pink}>2 nuevas</PillChip>
          </div>
          <div style={{ marginTop: u(14), borderRadius: u(24), border: `1px solid ${C.border}`, padding: u(12), ...popStyle(cardP, 0.9) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: u(10) }}>
              <div style={{ width: u(40), height: u(40), borderRadius: '50%', background: C.sky, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: u(17) }}>
                L
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: u(15), fontWeight: 700 }}>lucia</div>
                <div style={{ fontSize: u(13), color: C.muted }}>Hoy · Brunch con amigas</div>
              </div>
            </div>
            <div style={{ position: 'relative', marginTop: u(12), height: u(290), borderRadius: u(18), background: C.panel, overflow: 'hidden' }}>
              {LOOK.map((g) => (
                <div key={g.kind} style={{ position: 'absolute', left: u(g.x), top: u(g.y), transform: `rotate(${g.r}deg)` }}>
                  <Garment kind={g.kind} color={g.color} size={u(g.s)} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: u(16), marginTop: u(12), fontSize: u(15), fontWeight: 700 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: u(6) }}>
                <div style={{ transform: `scale(${liked ? 1 + 0.5 * Math.sin(Math.min(1, heartP) * Math.PI) : 1})` }}>
                  <Heart size={u(24)} strokeWidth={2} fill={liked ? C.pink : 'none'} color={liked ? C.pink : C.ink} />
                </div>
                {liked ? 24 : 23}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: u(6) }}>
                <MessageCircle size={u(22)} strokeWidth={1.75} />
                {frame >= LIKE + 22 ? 6 : 5}
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: u(13), color: C.muted, fontWeight: 600 }}>Me encanta</div>
            </div>
            <div style={{ marginTop: u(10), display: 'flex', gap: u(8), alignItems: 'flex-start', ...popStyle(commentP, 0.6), transformOrigin: 'left center' }}>
              <div style={{ width: u(28), height: u(28), borderRadius: '50%', background: C.mint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: u(13) }}>
                T
              </div>
              <div style={{ background: C.panel, borderRadius: u(16), padding: `${u(8)}px ${u(12)}px`, fontSize: u(14.5) }}>
                <b>tú</b> Ese vestido es un 10. ¡Me lo pido!
              </div>
            </div>
          </div>
        </div>
        {FLOATERS.map((f, i) => {
          const t = frame - LIKE - f.d;
          if (t < 0 || t > 40) return null;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: u(f.x) - u(14) + Math.sin(t / 5 + i) * u(10),
                top: u(600) - t * u(7),
                opacity: interpolate(t, [0, 8, 40], [0, 1, 0]),
                zIndex: 55,
              }}
            >
              <Heart size={u(28)} fill={f.c} color={f.c} />
            </div>
          );
        })}
        <Dock active="inspo" />
        <Tap at={LIKE} x={u(40)} y={u(624)} />
      </AbsoluteFill>
    </PhoneStage>
  );
};
