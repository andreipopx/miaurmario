import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Plus, Search } from 'lucide-react';
import { Garment, type GarmentKind } from '../components/Garment';
import { AppHeader, Dock, PillChip, u } from '../components/Phone';
import { Headline, PhoneStage, popStyle, usePop } from '../components/anim';
import { C } from '../theme';

const ITEMS: { kind: GarmentKind; color: string; name: string; wash?: boolean }[] = [
  { kind: 'shirt', color: C.sky, name: 'Camisa de lino' },
  { kind: 'jeans', color: '#3B5B8C', name: 'Vaqueros rectos' },
  { kind: 'sweater', color: C.amber, name: 'Jersey mostaza', wash: true },
  { kind: 'sneaker', color: '#FFFFFF', name: 'Zapatillas blancas' },
  { kind: 'coat', color: '#C8925A', name: 'Gabardina camel' },
  { kind: 'dress', color: C.mint, name: 'Vestido verde' },
  { kind: 'skirt', color: C.pink, name: 'Falda plisada' },
  { kind: 'tee', color: C.ink, name: 'Camiseta negra' },
  { kind: 'bag', color: '#8B5A3C', name: 'Bolso de piel' },
  { kind: 'trousers', color: '#E9E2D6', name: 'Pantalón crudo' },
];

const CHIPS: [string, string | undefined][] = [
  ['Todo', undefined],
  ['Tops', C.amber],
  ['Pantalones', C.sky],
  ['Calzado', C.pink],
  ['Abrigos', C.mint],
];

export const Wardrobe: React.FC = () => {
  const frame = useCurrentFrame();
  const scroll = interpolate(frame, [55, 110], [0, u(250)], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const tile = (u(390) - u(16) * 2 - u(12)) / 2;
  return (
    <PhoneStage accent={C.sky} headline={<Headline step="2 · Organiza" color={C.sky} title="Todo tu armario." sub="Ordenado, filtrable y a mano." />}>
      <AbsoluteFill style={{ background: C.bg }}>
        <div style={{ position: 'relative', zIndex: 10, background: C.bg }}>
          <AppHeader />
        </div>
        <div style={{ transform: `translateY(${-scroll}px)` }}>
          <div style={{ padding: `${u(6)}px ${u(16)}px 0` }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: u(28), fontWeight: 800, letterSpacing: '-0.02em' }}>Armario</div>
                <div style={{ fontSize: u(14), color: C.muted, fontWeight: 500 }}>48 prendas</div>
              </div>
              <div
                style={{
                  height: u(40),
                  padding: `0 ${u(14)}px`,
                  borderRadius: 999,
                  background: C.pink,
                  display: 'flex',
                  alignItems: 'center',
                  gap: u(6),
                  fontSize: u(14),
                  fontWeight: 700,
                }}
              >
                <Plus size={u(18)} strokeWidth={2.2} /> Añadir
              </div>
            </div>
            <div
              style={{
                marginTop: u(14),
                height: u(46),
                borderRadius: 999,
                background: C.panel,
                display: 'flex',
                alignItems: 'center',
                gap: u(8),
                padding: `0 ${u(16)}px`,
                color: C.muted,
                fontSize: u(15),
              }}
            >
              <Search size={u(18)} /> Busca en tu armario
            </div>
            <div style={{ display: 'flex', gap: u(8), marginTop: u(12), overflow: 'hidden' }}>
              {CHIPS.map(([label, dot], i) => (
                <PillChip key={label} dot={dot} active={i === 0}>
                  {label}
                </PillChip>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `${tile}px ${tile}px`, gap: u(12), marginTop: u(16) }}>
              {ITEMS.map((it, i) => {
                const p = usePop(8 + i * 4, 13);
                return (
                  <div key={it.name} style={popStyle(p, 0.5)}>
                    <div
                      style={{
                        position: 'relative',
                        height: tile * 1.15,
                        borderRadius: u(18),
                        background: C.panel,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Garment kind={it.kind} color={it.color} size={tile * 0.8} />
                      {it.wash ? (
                        <div
                          style={{
                            position: 'absolute',
                            top: u(10),
                            left: u(10),
                            height: u(24),
                            padding: `0 ${u(10)}px`,
                            borderRadius: 999,
                            background: C.sky,
                            fontSize: u(12),
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          Lavar
                        </div>
                      ) : null}
                    </div>
                    <div style={{ fontSize: u(14), fontWeight: 600, marginTop: u(6) }}>{it.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <Dock active="armario" />
      </AbsoluteFill>
    </PhoneStage>
  );
};
