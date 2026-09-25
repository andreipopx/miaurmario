import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Calendar, Camera, Clock, Mail, Map, MessageSquare, Music2, Phone as PhoneIcon, Settings, StickyNote, Sun, Image as ImageIcon } from 'lucide-react';
import { Dock, SCREEN_H, u } from '../components/Phone';
import { Stinky } from '../components/Stinky';
import { Headline, PhoneStage, Tap, usePop } from '../components/anim';
import { C } from '../theme';
import { AppHome, SafariBar, ShareSheet, URL } from './ui';

export const SHARE_TAP = 14;
export const ADD_TAP = 50;
export const HOME = 66;
export const ICON_IN = 76;
export const OPEN_TAP = 112;

const ICONS = [
  { l: 'Cámara', c: '#8E8E93', i: Camera },
  { l: 'Fotos', c: '#FF9F0A', i: ImageIcon },
  { l: 'Mapas', c: '#34C759', i: Map },
  { l: 'Tiempo', c: '#0A84FF', i: Sun },
  { l: 'Correo', c: '#0A84FF', i: Mail },
  { l: 'Calendario', c: '#FF3B30', i: Calendar },
  { l: 'Notas', c: '#FFCC00', i: StickyNote },
  { l: 'Reloj', c: '#1C1C1E', i: Clock },
  { l: 'Música', c: '#FF2D55', i: Music2 },
  { l: 'Ajustes', c: '#8E8E93', i: Settings },
  { l: 'Mensajes', c: '#34C759', i: MessageSquare },
];
const COLS = 4;
const ICON = 62;
const PAD_X = 26;
const GAP_X = (390 - PAD_X * 2 - ICON * COLS) / (COLS - 1);
const TOP = 80;
const ROW = 100;
const slot = (i: number) => ({ x: PAD_X + (i % COLS) * (ICON + GAP_X), y: TOP + Math.floor(i / COLS) * ROW });
const MIAU = slot(ICONS.length);

const HomeScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const inP = usePop(ICON_IN, 8);
  const press = frame >= OPEN_TAP - 2 && frame < OPEN_TAP + 4 ? 0.9 : 1;
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(160deg, #FFD6E7 0%, #CDEBFF 55%, #D8F7E9 100%)' }}>
      {ICONS.map((ic, i) => {
        const s = slot(i);
        const Icon = ic.i;
        return (
          <div key={ic.l} style={{ position: 'absolute', left: u(s.x), top: u(s.y), width: u(ICON), textAlign: 'center' }}>
            <div style={{ width: u(ICON), height: u(ICON), borderRadius: u(15), background: ic.c, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={u(30)} color="#fff" strokeWidth={1.8} />
            </div>
            <div style={{ fontSize: u(12), marginTop: u(5), color: C.ink, fontWeight: 500 }}>{ic.l}</div>
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: u(MIAU.x),
          top: u(MIAU.y),
          width: u(ICON),
          textAlign: 'center',
          transform: `scale(${inP * press})`,
          opacity: Math.min(1, inP * 2),
        }}
      >
        <Img src={staticFile('app-icon.png')} style={{ width: u(ICON), height: u(ICON), borderRadius: u(15), boxShadow: '0 6px 16px rgba(255,126,182,0.5)' }} />
        <div style={{ fontSize: u(12), marginTop: u(5), fontWeight: 700 }}>Miaurmario</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: u(14),
          right: u(14),
          bottom: u(14),
          height: u(92),
          borderRadius: u(32),
          background: 'rgba(255,255,255,0.45)',
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
        }}
      >
        {[
          { c: '#34C759', i: PhoneIcon },
          { c: '#0A84FF', i: Mail },
          { c: '#34C759', i: MessageSquare },
          { c: '#FF2D55', i: Music2 },
        ].map(({ c, i: Icon }, k) => (
          <div key={k} style={{ width: u(ICON), height: u(ICON), borderRadius: u(15), background: c, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={u(30)} color="#fff" strokeWidth={1.8} />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** The icon grows into the full-screen app (no browser bars: standalone). */
const Launch: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - (OPEN_TAP + 4), fps, config: { damping: 20, stiffness: 120 } });
  const W = u(390);
  const x = interpolate(p, [0, 1], [u(MIAU.x), 0]);
  const y = interpolate(p, [0, 1], [u(MIAU.y), 0]);
  const w = interpolate(p, [0, 1], [u(ICON), W]);
  const h = interpolate(p, [0, 1], [u(ICON), SCREEN_H]);
  const app = interpolate(frame, [OPEN_TAP + 30, OPEN_TAP + 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (frame < OPEN_TAP + 4) return null;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: interpolate(p, [0, 1], [u(15), u(56)]), overflow: 'hidden', background: '#fff', zIndex: 20 }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: u(150) * p, height: u(150) * p, borderRadius: '50%', background: C.pink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Stinky state="wave" size={u(130) * p} from={OPEN_TAP + 8} />
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', inset: 0, opacity: app }}>
        <AppHome />
        <Dock active="hoy" />
      </div>
    </div>
  );
};

export const Install: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sheet = frame < HOME ? spring({ frame: frame - (SHARE_TAP + 3), fps, config: { damping: 18 } }) : 0;
  const shareY = SCREEN_H - u(124) + u(10 + 46 + 12) + u(11);
  const rowY = SCREEN_H - u(420) + u(16 + 19 + 70 + 14 + 100 + 25);
  return (
    <PhoneStage accent={C.mint} headline={<Headline step="Pero se instala" color={C.mint} title="Como una app más." sub="Compartir → Añadir a pantalla de inicio." />}>
      {frame < HOME ? (
        <>
          <AppHome />
          <SafariBar text={URL} />
          <ShareSheet p={sheet} highlight={frame >= ADD_TAP - 2} />
        </>
      ) : (
        <>
          <HomeScreen />
          <Launch />
        </>
      )}
      <Tap at={SHARE_TAP} x={u(195)} y={shareY} />
      <Tap at={ADD_TAP} x={u(195)} y={rowY} />
      <Tap at={OPEN_TAP} x={u(MIAU.x + ICON / 2)} y={u(MIAU.y + ICON / 2)} />
    </PhoneStage>
  );
};
