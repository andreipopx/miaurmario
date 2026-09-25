import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { BookOpen, ChevronLeft, ChevronRight, Copy, Lock, PlusSquare, RotateCw, Share, Star, Sun } from 'lucide-react';
import { Garment } from '../components/Garment';
import { AppHeader, PillChip, u } from '../components/Phone';
import { C } from '../theme';

export const URL = 'miaurmario.andreipop.org';

/** Safari's bottom address bar + toolbar. `text` is what the address field shows. */
export const SafariBar: React.FC<{ text: string; focused?: boolean; progress?: number; caret?: boolean }> = ({
  text,
  focused,
  progress = 0,
  caret,
}) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: u(124),
      background: 'rgba(248,248,248,0.96)',
      borderTop: `1px solid ${C.border}`,
      zIndex: 30,
    }}
  >
    <div
      style={{
        position: 'relative',
        margin: `${u(10)}px ${u(14)}px 0`,
        height: u(46),
        borderRadius: u(14),
        background: '#fff',
        boxShadow: focused ? `0 0 0 ${u(2)}px ${C.sky}` : '0 1px 4px rgba(0,0,0,0.1)',
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${u(14)}px`,
        gap: u(8),
        fontSize: u(16),
        overflow: 'hidden',
      }}
    >
      <span style={{ fontSize: u(14), fontWeight: 700, color: C.muted }}>aA</span>
      <div style={{ flex: 1, textAlign: focused ? 'left' : 'center', display: 'flex', justifyContent: focused ? 'flex-start' : 'center', alignItems: 'center', gap: u(5) }}>
        {!focused && text ? <Lock size={u(12)} color={C.muted} /> : null}
        <span style={{ color: text ? C.ink : C.muted }}>{text || 'Buscar o introducir sitio web'}</span>
        {caret ? <span style={{ width: u(2), height: u(20), background: C.sky }} /> : null}
      </div>
      <RotateCw size={u(16)} color={C.muted} />
      {progress > 0 && progress < 1 ? (
        <div style={{ position: 'absolute', left: 0, bottom: 0, height: u(3), width: `${progress * 100}%`, background: C.sky }} />
      ) : null}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginTop: u(12), color: C.sky }}>
      <ChevronLeft size={u(26)} />
      <ChevronRight size={u(26)} color="#C7C7CC" />
      <Share size={u(22)} />
      <BookOpen size={u(22)} />
      <Copy size={u(22)} />
    </div>
  </div>
);

/** The app's home screen, as seen inside the browser or installed. */
export const AppHome: React.FC<{ bottomPad?: number }> = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <AppHeader greeting="Buenos días" />
    <div style={{ padding: `${u(6)}px ${u(16)}px 0` }}>
      <div style={{ fontSize: u(28), fontWeight: 800, letterSpacing: '-0.02em' }}>Tu look de hoy</div>
      <div style={{ display: 'flex', gap: u(8), marginTop: u(10) }}>
        <PillChip style={{ background: C.amber }}>
          <Sun size={u(16)} strokeWidth={2} /> 21° · Soleado
        </PillChip>
        <PillChip dot={C.mint}>Oficina</PillChip>
      </div>
      <div style={{ position: 'relative', marginTop: u(14), height: u(300), borderRadius: u(24), background: C.panel }}>
        <div style={{ position: 'absolute', left: u(20), top: u(16), transform: 'rotate(-4deg)' }}>
          <Garment kind="shirt" color={C.sky} size={u(180)} />
        </div>
        <div style={{ position: 'absolute', left: u(180), top: u(34), transform: 'rotate(3deg)' }}>
          <Garment kind="trousers" color="#E9E2D6" size={u(170)} />
        </div>
        <div style={{ position: 'absolute', left: u(34), top: u(180), transform: 'rotate(-6deg)' }}>
          <Garment kind="sneaker" color="#FFFFFF" size={u(140)} />
        </div>
      </div>
    </div>
  </AbsoluteFill>
);

const SHEET_ROWS: { label: string; icon: React.ReactNode; hot?: boolean }[] = [
  { label: 'Copiar', icon: <Copy size={u(20)} /> },
  { label: 'Añadir a favoritos', icon: <Star size={u(20)} /> },
  { label: 'Añadir a pantalla de inicio', icon: <PlusSquare size={u(20)} />, hot: true },
];

/** iOS share sheet sliding up by `p` (0 hidden → 1 shown). */
export const ShareSheet: React.FC<{ p: number; highlight?: boolean }> = ({ p, highlight }) => (
  <>
    <AbsoluteFill style={{ background: `rgba(0,0,0,${0.25 * p})`, zIndex: 34 }} />
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: u(420),
        transform: `translateY(${(1 - p) * u(440)}px)`,
        background: '#F2F2F7',
        borderTopLeftRadius: u(22),
        borderTopRightRadius: u(22),
        zIndex: 35,
        padding: u(16),
      }}
    >
      <div style={{ width: u(36), height: u(5), borderRadius: 3, background: '#C7C7CC', margin: `0 auto ${u(14)}px` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: u(12), background: '#fff', borderRadius: u(14), padding: u(12) }}>
        <Img src={staticFile('app-icon.png')} style={{ width: u(46), height: u(46), borderRadius: u(11) }} />
        <div>
          <div style={{ fontSize: u(16), fontWeight: 700 }}>Miaurmario</div>
          <div style={{ fontSize: u(13), color: C.muted }}>{URL}</div>
        </div>
      </div>
      <div style={{ marginTop: u(14), background: '#fff', borderRadius: u(14), overflow: 'hidden' }}>
        {SHEET_ROWS.map((r) => (
          <div
            key={r.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: u(50),
              padding: `0 ${u(16)}px`,
              fontSize: u(16),
              borderTop: r.label === 'Copiar' ? 'none' : `1px solid ${C.border}`,
              background: r.hot && highlight ? '#E5E5EA' : '#fff',
              fontWeight: r.hot ? 700 : 400,
            }}
          >
            {r.label}
            {r.icon}
          </div>
        ))}
      </div>
    </div>
  </>
);
