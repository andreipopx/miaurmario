import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Check, Music, Pin, Radio } from 'lucide-react';
import { AppHeader, u } from '../components/Phone';
import { Headline, PhoneStage, Tap, popStyle, usePop } from '../components/anim';
import { C } from '../theme';

export const CONNECT_TAP = 46;
const SPOTIFY = '#1DB954';

const Card: React.FC<{
  name: string;
  line: string;
  color: string;
  icon: React.ReactNode;
  status: string;
  statusBg: string;
  children?: React.ReactNode;
  dim?: boolean;
  style?: React.CSSProperties;
}> = ({ name, line, color, icon, status, statusBg, children, dim, style }) => (
  <div style={{ borderRadius: u(24), border: `1px solid ${C.border}`, padding: u(14), marginTop: u(12), opacity: dim ? 0.55 : 1, ...style }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: u(12) }}>
      <div style={{ width: u(46), height: u(46), borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: u(17), fontWeight: 800 }}>{name}</div>
        <div style={{ fontSize: u(13.5), color: C.muted }}>{line}</div>
      </div>
      <div style={{ height: u(26), padding: `0 ${u(10)}px`, borderRadius: 999, background: statusBg, fontSize: u(12), fontWeight: 700, display: 'flex', alignItems: 'center', gap: u(4) }}>{status}</div>
    </div>
    {children}
  </div>
);

export const Connect: React.FC = () => {
  const frame = useCurrentFrame();
  const done = frame >= CONNECT_TAP + 8;
  const press = frame >= CONNECT_TAP - 2 && frame < CONNECT_TAP + 4 ? 0.95 : 1;
  const cards = [0, 1, 2].map((i) => usePop(4 + i * 6, 15));
  const okP = usePop(CONNECT_TAP + 8, 10);
  return (
    <PhoneStage accent={SPOTIFY} headline={<Headline step="Nuevo · Música" color={C.pink} title="Conecta tu música." sub="Spotify o Last.fm, en un toque." />}>
      <AbsoluteFill style={{ background: C.bg }}>
        <AppHeader />
        <div style={{ padding: `${u(6)}px ${u(16)}px 0` }}>
          <div style={{ fontSize: u(13), color: C.muted, fontWeight: 600 }}>← Ajustes</div>
          <div style={{ fontSize: u(28), fontWeight: 800, letterSpacing: '-0.02em', marginTop: u(4) }}>Integraciones</div>
          <div style={{ fontSize: u(14), color: C.muted }}>Conecta servicios para nutrir tu estilo.</div>
          <Card
            name="Spotify"
            line="Lo que suena, como mood del día."
            color={SPOTIFY}
            icon={<Music size={u(22)} />}
            status={done ? '✓ Conectado' : 'Sin conectar'}
            statusBg={done ? C.mint : C.panel}
            style={popStyle(cards[0], 0.85)}
          >
            <div
              style={{
                marginTop: u(12),
                height: u(46),
                borderRadius: 999,
                background: done ? C.mint : C.ink,
                color: done ? C.ink : '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: u(6),
                fontSize: u(15.5),
                fontWeight: 700,
                transform: `scale(${press * (done ? 0.9 + 0.1 * okP : 1)})`,
              }}
            >
              {done ? <Check size={u(18)} strokeWidth={2.6} /> : null}
              {done ? 'Stinky ya te escucha' : 'Conectar Spotify'}
            </div>
          </Card>
          <Card name="Last.fm" line="Tu historial de escuchas." color="#D51007" icon={<Radio size={u(22)} />} status="Sin conectar" statusBg={C.panel} style={popStyle(cards[1], 0.85)} />
          <Card name="Pinterest" line="Tus tableros, como inspiración." color="#E60023" icon={<Pin size={u(22)} />} status="Muy pronto" statusBg={C.pinkSoft} dim style={popStyle(cards[2], 0.85)} />
        </div>
      </AbsoluteFill>
      <Tap at={CONNECT_TAP} x={u(195)} y={u(58 + 50 + 6 + 20 + 34 + 20 + 12 + 14 + 46 + 12 + 23)} />
    </PhoneStage>
  );
};
