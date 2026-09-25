import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Garment, type GarmentKind } from '../components/Garment';
import { AppHeader, Dock, u } from '../components/Phone';
import { Headline, PhoneStage, Tap, popStyle, usePop } from '../components/anim';
import { C } from '../theme';
import { LookCaption, LookPanel, StinkyLine } from './parts';
import type { LookItem } from './songs';

export const PICK_AT = 34;
export const LOOK_AT = 58;

const FORGOTTEN: { kind: GarmentKind; color: string; badge: string; badgeBg: string }[] = [
  { kind: 'skirt', color: C.pink, badge: 'Sin estrenar', badgeBg: C.mint },
  { kind: 'coat', color: '#5B6B8C', badge: 'Hace 3 meses', badgeBg: C.amber },
  { kind: 'dress', color: '#E9E2D6', badge: 'Hace 5 meses', badgeBg: C.amber },
];

// Built around the pink skirt (FORGOTTEN[0]).
const LOOK: LookItem[] = [
  { kind: 'skirt', color: C.pink, x: 196, y: 30, s: 160, r: 4 },
  { kind: 'sweater', color: '#FFFFFF', x: 14, y: 8, s: 180, r: -4 },
  { kind: 'sneaker', color: C.ink, x: 40, y: 118, s: 112, r: -6 },
];

const TILE = 104;

/** "Preferir prendas menos usadas": Stinky rescues what you never wear. */
export const Revive: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tiles = FORGOTTEN.map((_, i) => usePop(4 + i * 5, 12));
  const caption = usePop(LOOK_AT + 18, 15);
  const fly = spring({ frame: frame - PICK_AT, fps, config: { damping: 16 } });
  const picked = frame >= PICK_AT;
  return (
    <PhoneStage accent={C.mint} headline={<Headline step="Revive tu armario" color={C.mint} title="Rescata lo olvidado." sub="Stinky tira de lo que menos te pones." />}>
      <AbsoluteFill style={{ background: C.bg }}>
        <AppHeader />
        <div style={{ position: 'absolute', left: u(16), right: u(16), top: u(112), display: 'flex', flexDirection: 'column', gap: u(12) }}>
          <div>
            <div style={{ fontSize: u(22), fontWeight: 800, letterSpacing: '-0.02em' }}>Nunca usadas</div>
            <div style={{ fontSize: u(14), color: C.muted, fontWeight: 600 }}>¿Hora de probarlas?</div>
          </div>
          <div style={{ display: 'flex', gap: u(10) }}>
            {FORGOTTEN.map((g, i) => {
              const chosen = i === 0 && picked;
              return (
                <div key={i} style={{ ...popStyle(tiles[i], 0.5) }}>
                  <div
                    style={{
                      position: 'relative',
                      width: u(TILE),
                      height: u(TILE * 1.1),
                      borderRadius: u(18),
                      background: C.panel,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: chosen ? `0 0 0 ${u(3)}px ${C.pink}` : 'none',
                      opacity: picked && !chosen ? 0.5 : 1,
                    }}
                  >
                    <Garment kind={g.kind} color={g.color} size={u(TILE * 0.8)} style={{ opacity: chosen ? 1 - fly * 0.6 : 1 }} />
                    <div style={{ position: 'absolute', top: u(6), left: u(6), height: u(20), padding: `0 ${u(8)}px`, borderRadius: 999, background: g.badgeBg, fontSize: u(10.5), fontWeight: 800, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                      {g.badge}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ position: 'relative' }}>
            <LookPanel look={LOOK} from={LOOK_AT} height={220}>
              {frame < LOOK_AT ? (
                <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontSize: u(14.5), color: C.muted, fontWeight: 600, opacity: interpolate(frame, [PICK_AT, PICK_AT + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
                  Montando un look alrededor…
                </AbsoluteFill>
              ) : null}
              {frame >= LOOK_AT + 10 ? (
                <div style={{ position: 'absolute', right: u(10), top: u(10), height: u(24), padding: `0 ${u(10)}px`, borderRadius: 999, background: C.mint, fontSize: u(12), fontWeight: 800, display: 'flex', alignItems: 'center', ...popStyle(usePopSafe(frame, LOOK_AT + 10), 0.3) }}>
                  ¡Por fin la estrenas!
                </div>
              ) : null}
            </LookPanel>
          </div>
          <LookCaption title="Rescate de armario" weather="19° · Soleado" p={caption} />
          <StinkyLine text="Esta falda lleva meses esperándote en el armario: hoy sale a pasear." from={LOOK_AT + 22} typeFrames={30} />
        </div>
        <Dock active="estilista" />
        <Tap at={PICK_AT - 2} x={u(16 + TILE / 2)} y={u(112 + 50 + 12 + (TILE * 1.1) / 2)} />
      </AbsoluteFill>
    </PhoneStage>
  );
};

/** Hook-free pop curve for elements that mount mid-scene. */
function usePopSafe(frame: number, from: number) {
  return interpolate(frame, [from, from + 6, from + 10], [0, 1.1, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}
