import React from 'react';
import { Img, staticFile } from 'remotion';
import { Bell, Compass, Home, MessageCircle, Shirt, Sparkles, type LucideIcon } from 'lucide-react';
import { C, sans, wordmark } from '../theme';

/** Phone points → video pixels. The screen is a 390pt-wide iPhone. */
export const S = 1.6;
export const u = (pt: number) => pt * S;

export const SCREEN_W = u(390);
export const SCREEN_H = u(844);
const BEZEL = 20;

export const Phone: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; lightStatus?: boolean }> = ({
  children,
  style,
  lightStatus,
}) => (
  <div
    style={{
      width: SCREEN_W + BEZEL * 2,
      height: SCREEN_H + BEZEL * 2,
      borderRadius: u(56) + BEZEL,
      background: '#161616',
      padding: BEZEL,
      boxShadow: '0 60px 120px rgba(17,17,17,0.28), 0 0 0 3px #2b2b2b inset',
      ...style,
    }}
  >
    <div
      style={{
        position: 'relative',
        width: SCREEN_W,
        height: SCREEN_H,
        borderRadius: u(56),
        overflow: 'hidden',
        background: C.bg,
        fontFamily: sans,
        color: C.ink,
      }}
    >
      {children}
      <StatusBar color={lightStatus ? '#FFFFFF' : C.ink} />
    </div>
  </div>
);

const StatusBar: React.FC<{ color: string }> = ({ color }) => (
  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: u(54), zIndex: 50, color }}>
    <div style={{ position: 'absolute', left: u(46), top: u(17), fontSize: u(17), fontWeight: 600 }}>9:41</div>
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: u(11),
        width: u(124),
        height: u(36),
        marginLeft: -u(62),
        borderRadius: u(18),
        background: '#000',
      }}
    />
    <div style={{ position: 'absolute', right: u(34), top: u(20), display: 'flex', gap: u(6), alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: u(2), alignItems: 'flex-end' }}>
        {[5, 7, 9, 11].map((h) => <div key={h} style={{ width: u(3), height: u(h), borderRadius: u(1), background: color }} />)}
      </div>
      <div style={{ width: u(25), height: u(12), borderRadius: u(4), border: `${u(1.2)}px solid ${color}`, padding: u(1.5) }}>
        <div style={{ width: '80%', height: '100%', borderRadius: u(2), background: color }} />
      </div>
    </div>
  </div>
);

/** Sticky app header: Stinky avatar · greeting/wordmark · bell. */
export const AppHeader: React.FC<{ greeting?: string }> = ({ greeting }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: u(10), padding: `${u(58)}px ${u(16)}px ${u(10)}px` }}>
    <div
      style={{
        width: u(40),
        height: u(40),
        borderRadius: '50%',
        background: C.pinkSoft,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Img src={staticFile('stinky-head.svg')} style={{ width: u(34), height: u(34) }} />
    </div>
    <div style={{ flex: 1, lineHeight: 1.1 }}>
      {greeting ? (
        <>
          <div style={{ fontSize: u(13), color: C.muted, fontWeight: 600 }}>{greeting}</div>
          <div style={{ fontFamily: wordmark, fontSize: u(20) }}>miaurmario</div>
        </>
      ) : (
        <div style={{ fontFamily: wordmark, fontSize: u(22) }}>miaurmario</div>
      )}
    </div>
    <div
      style={{
        width: u(40),
        height: u(40),
        borderRadius: '50%',
        background: C.panel,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Bell size={u(19)} strokeWidth={1.75} />
    </div>
  </div>
);

const TABS: { key: DockTab; label: string; icon: LucideIcon }[] = [
  { key: 'hoy', label: 'Hoy', icon: Home },
  { key: 'armario', label: 'Armario', icon: Shirt },
  { key: 'estilista', label: 'Estilista', icon: Sparkles },
  { key: 'inspo', label: 'Inspiración', icon: Compass },
  { key: 'stinky', label: 'Stinky', icon: MessageCircle },
];
export type DockTab = 'hoy' | 'armario' | 'estilista' | 'inspo' | 'stinky';

/** Floating glass dock with the pink active pill. */
export const Dock: React.FC<{ active: DockTab }> = ({ active }) => (
  <div
    style={{
      position: 'absolute',
      left: u(16),
      right: u(16),
      bottom: u(24),
      height: u(64),
      borderRadius: u(32),
      background: 'rgba(255,255,255,0.86)',
      border: '1px solid rgba(0,0,0,0.06)',
      boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: `0 ${u(8)}px`,
      zIndex: 40,
    }}
  >
    {TABS.map(({ key, label, icon: Icon }) => {
      const on = key === active;
      return (
        <div
          key={key}
          style={{
            height: u(48),
            minWidth: u(48),
            padding: on ? `0 ${u(16)}px` : 0,
            borderRadius: u(24),
            background: on ? C.pink : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: u(6),
            fontSize: u(14),
            fontWeight: 700,
          }}
        >
          <Icon size={u(21)} strokeWidth={on ? 2 : 1.75} />
          {on ? label : null}
        </div>
      );
    })}
  </div>
);

export const PillChip: React.FC<{ children: React.ReactNode; dot?: string; active?: boolean; style?: React.CSSProperties }> = ({
  children,
  dot,
  active,
  style,
}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: u(7),
      height: u(36),
      padding: `0 ${u(14)}px`,
      borderRadius: 999,
      background: active ? C.ink : C.panel,
      color: active ? '#fff' : C.ink,
      fontSize: u(14),
      fontWeight: 600,
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    {dot ? <span style={{ width: u(9), height: u(9), borderRadius: '50%', background: dot }} /> : null}
    {children}
  </div>
);
