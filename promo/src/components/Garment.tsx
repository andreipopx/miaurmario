import React from 'react';

export type GarmentKind = 'tee' | 'shirt' | 'jeans' | 'skirt' | 'sneaker' | 'coat' | 'sweater' | 'dress' | 'bag' | 'trousers';

const SHADE = 'rgba(0,0,0,0.16)';
const LINE = 'rgba(0,0,0,0.22)';

/** Flat, sticker-like garment illustrations in a 200×200 box. */
export const Garment: React.FC<{ kind: GarmentKind; color: string; size: number; style?: React.CSSProperties }> = ({
  kind,
  color,
  size,
  style,
}) => {
  const body = (() => {
    switch (kind) {
      case 'tee':
        return (
          <>
            <path d="M62 32 L86 22 Q100 36 114 22 L138 32 L172 60 L152 84 L140 74 L140 176 L60 176 L60 74 L48 84 L28 60 Z" fill={color} />
            <path d="M86 22 Q100 36 114 22 Q100 30 86 22 Z" fill={SHADE} />
            <path d="M60 164 L140 164 L140 176 L60 176 Z" fill={SHADE} />
          </>
        );
      case 'shirt':
        return (
          <>
            <path d="M62 28 L86 20 L114 20 L138 28 L160 50 L178 150 L158 155 L140 84 L140 180 L60 180 L60 84 L42 155 L22 150 L40 50 Z" fill={color} />
            <path d="M86 20 L100 40 L114 20 L108 16 L92 16 Z" fill={SHADE} />
            <path d="M86 20 L100 40 L92 50 L78 26 Z M114 20 L100 40 L108 50 L122 26 Z" fill="rgba(255,255,255,0.55)" />
            <line x1="100" y1="42" x2="100" y2="180" stroke={LINE} strokeWidth="2" />
            {[62, 88, 114, 140, 166].map((y) => <circle key={y} cx="106" cy={y} r="2.6" fill={LINE} />)}
            <path d="M22 150 L42 155 L40 164 L20 159 Z M178 150 L158 155 L160 164 L180 159 Z" fill={SHADE} />
          </>
        );
      case 'sweater':
        return (
          <>
            <path d="M60 30 L84 22 Q100 32 116 22 L140 30 L162 52 L178 152 L156 156 L140 86 L140 172 L60 172 L60 86 L44 156 L22 152 L38 52 Z" fill={color} />
            <path d="M84 22 Q100 40 116 22 Q100 32 84 22 Z" fill={SHADE} />
            <path d="M60 162 L140 162 L140 178 L60 178 Z" fill={color} />
            <path d="M60 162 L140 162 L140 178 L60 178 Z" fill={SHADE} />
            {[70, 82, 94, 106, 118, 130].map((x) => <line key={x} x1={x} y1="163" x2={x} y2="177" stroke={LINE} strokeWidth="2" />)}
            <path d="M22 152 L44 156 L42 168 L20 164 Z M178 152 L156 156 L158 168 L180 164 Z" fill={SHADE} />
          </>
        );
      case 'coat':
        return (
          <>
            <path d="M64 22 L88 16 L100 60 L112 16 L136 22 L160 46 L176 170 L156 172 L142 90 L144 188 L56 188 L58 90 L44 172 L24 170 L40 46 Z" fill={color} />
            <path d="M88 16 L100 60 L84 88 L74 30 Z M112 16 L100 60 L116 88 L126 30 Z" fill={SHADE} />
            <line x1="100" y1="60" x2="100" y2="188" stroke={LINE} strokeWidth="2" />
            <circle cx="92" cy="110" r="3.4" fill={LINE} />
            <circle cx="92" cy="140" r="3.4" fill={LINE} />
            <path d="M68 132 L86 132" stroke={LINE} strokeWidth="2.5" />
            <path d="M114 132 L132 132" stroke={LINE} strokeWidth="2.5" />
          </>
        );
      case 'jeans':
      case 'trousers':
        return (
          <>
            <path d="M58 18 L142 18 L152 184 L110 184 L100 72 L90 184 L48 184 Z" fill={color} />
            <path d="M58 18 L142 18 L143 32 L57 32 Z" fill={SHADE} />
            <path d="M100 32 L100 72" stroke={LINE} strokeWidth="2" />
            {kind === 'jeans' ? (
              <>
                <path d="M64 34 Q70 54 88 52" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" fill="none" />
                <path d="M136 34 Q130 54 112 52" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" fill="none" />
              </>
            ) : (
              <>
                <path d="M76 34 L72 184" stroke={LINE} strokeWidth="1.6" />
                <path d="M124 34 L128 184" stroke={LINE} strokeWidth="1.6" />
              </>
            )}
          </>
        );
      case 'skirt':
        return (
          <>
            <path d="M68 40 L132 40 L164 166 L36 166 Z" fill={color} />
            <path d="M68 40 L132 40 L134 54 L66 54 Z" fill={SHADE} />
            {[70, 90, 110, 130].map((x, i) => <path key={x} d={`M${88 + i * 8} 54 L${x - 4} 166`} stroke={LINE} strokeWidth="1.8" />)}
          </>
        );
      case 'dress':
        return (
          <>
            <path d="M80 18 L86 18 L92 48 L108 48 L114 18 L120 18 L124 58 L158 182 L42 182 L76 58 Z" fill={color} />
            <path d="M76 58 L124 58 L122 72 L78 72 Z" fill={SHADE} />
            <path d="M100 72 Q92 130 70 182" stroke={LINE} strokeWidth="1.6" fill="none" />
            <path d="M100 72 Q108 130 130 182" stroke={LINE} strokeWidth="1.6" fill="none" />
          </>
        );
      case 'sneaker':
        return (
          <>
            <path d="M24 126 Q24 92 56 88 L92 84 Q106 104 130 108 L162 114 Q180 118 180 136 L180 142 L24 142 Z" fill={color} />
            <path d="M22 140 L182 140 Q182 156 168 156 L34 156 Q22 156 22 140 Z" fill="#FFFFFF" stroke={LINE} strokeWidth="2" />
            {[0, 1, 2].map((i) => <line key={i} x1={70 + i * 12} y1={94 + i * 4} x2={84 + i * 12} y2={108 + i * 3} stroke="rgba(255,255,255,0.8)" strokeWidth="3" />)}
            <path d="M40 118 Q70 112 100 128" stroke={SHADE} strokeWidth="6" fill="none" />
          </>
        );
      case 'bag':
        return (
          <>
            <path d="M70 76 Q70 30 100 30 Q130 30 130 76" stroke={color} strokeWidth="10" fill="none" />
            <path d="M40 76 L160 76 L150 172 L50 172 Z" fill={color} />
            <path d="M40 76 L160 76 L158 96 L42 96 Z" fill={SHADE} />
            <rect x="92" y="90" width="16" height="14" rx="3" fill="rgba(255,255,255,0.7)" />
          </>
        );
    }
  })();
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} style={{ display: 'block', overflow: 'visible', ...style }}>
      <g style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.12))' }}>{body}</g>
    </svg>
  );
};
