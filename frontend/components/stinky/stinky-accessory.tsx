/**
 * What Stinky wears, unlocked by his meals (one a day you log what you wore).
 *
 * Drawn on top of the head, under the chin: every head set (any coat, any eyes,
 * every clip) is framed the same way, chin at ~80 % of the box, so one overlay in
 * the same 0–100 box fits them all and never fights the animation.
 */

export const STINKY_ACCESSORIES = [
  'pajarita',
  'cascabel',
  'panuelo',
  'lazo',
  'perlas',
  'pajarita-dorada',
] as const;
export type StinkyAccessory = (typeof STINKY_ACCESSORIES)[number];

export const isStinkyAccessory = (value: unknown): value is StinkyAccessory =>
  typeof value === 'string' && (STINKY_ACCESSORIES as readonly string[]).includes(value);

function BowTie({ fill, shade }: { fill: string; shade: string }) {
  return (
    <g>
      <path d="M50 84 L36.5 77.5 Q34 84 36.5 90.5 Z" fill={fill} stroke={shade} strokeWidth="1" strokeLinejoin="round" />
      <path d="M50 84 L63.5 77.5 Q66 84 63.5 90.5 Z" fill={fill} stroke={shade} strokeWidth="1" strokeLinejoin="round" />
      <path d="M40 81 L46 84 L40 87" fill="none" stroke={shade} strokeWidth="0.8" opacity="0.5" />
      <path d="M60 81 L54 84 L60 87" fill="none" stroke={shade} strokeWidth="0.8" opacity="0.5" />
      <rect x="46.5" y="80.5" width="7" height="7" rx="2.2" fill={fill} stroke={shade} strokeWidth="1" />
    </g>
  );
}

function Bell() {
  return (
    <g>
      <path d="M29 79 Q50 89 71 79" fill="none" stroke="#9b1c2c" strokeWidth="4.6" strokeLinecap="round" />
      <path d="M29 79 Q50 89 71 79" fill="none" stroke="#d63447" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="50" cy="90" r="5.4" fill="#f2c14e" stroke="#a87b16" strokeWidth="1" />
      <path d="M45.6 89 H54.4" stroke="#a87b16" strokeWidth="0.9" />
      <circle cx="50" cy="91.8" r="1" fill="#6b4c0c" />
      <path d="M50 92.4 V95" stroke="#6b4c0c" strokeWidth="0.9" strokeLinecap="round" />
      <circle cx="48" cy="87.6" r="1.1" fill="#fff4cf" />
    </g>
  );
}

function Bandana() {
  return (
    <g>
      <path d="M28 78.5 Q50 85 72 78.5 L52 97 Q50 98.6 48 97 Z" fill="#3a6fd9" stroke="#1f4597" strokeWidth="1" strokeLinejoin="round" />
      {[
        [40, 83],
        [50, 85],
        [60, 83],
        [45, 89],
        [55, 89],
        [50, 93.5],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="#f5f2ea" />
      ))}
    </g>
  );
}

function Ribbon() {
  return (
    <g>
      <path d="M48 85 L41 96 L44 96.5 L49 88 Z" fill="#e8467c" stroke="#a51d50" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M52 85 L59 96 L56 96.5 L51 88 Z" fill="#e8467c" stroke="#a51d50" strokeWidth="0.9" strokeLinejoin="round" />
      <ellipse cx="40.5" cy="82.5" rx="9.5" ry="5.6" transform="rotate(-14 40.5 82.5)" fill="#ff7fb2" stroke="#a51d50" strokeWidth="1" />
      <ellipse cx="59.5" cy="82.5" rx="9.5" ry="5.6" transform="rotate(14 59.5 82.5)" fill="#ff7fb2" stroke="#a51d50" strokeWidth="1" />
      <ellipse cx="40.5" cy="82.5" rx="4.6" ry="2.2" transform="rotate(-14 40.5 82.5)" fill="#e8467c" opacity="0.55" />
      <ellipse cx="59.5" cy="82.5" rx="4.6" ry="2.2" transform="rotate(14 59.5 82.5)" fill="#e8467c" opacity="0.55" />
      <circle cx="50" cy="84" r="3.7" fill="#ff7fb2" stroke="#a51d50" strokeWidth="1" />
    </g>
  );
}

function Pearls() {
  const pearls = Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    const x = 30 + 40 * t;
    const y = 79 + 9 * 4 * t * (1 - t);
    return [x, y] as const;
  });
  return (
    <g>
      {pearls.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="2.15" fill="#fbf8f1" stroke="#b9b2a3" strokeWidth="0.6" />
          <circle cx={x - 0.6} cy={y - 0.7} r="0.6" fill="#fff" />
        </g>
      ))}
    </g>
  );
}

export function StinkyAccessoryArt({ accessory }: { accessory: StinkyAccessory }) {
  switch (accessory) {
    case 'pajarita':
      return <BowTie fill="#ff7fb2" shade="#a51d50" />;
    case 'pajarita-dorada':
      return <BowTie fill="#f2c14e" shade="#8a6410" />;
    case 'cascabel':
      return <Bell />;
    case 'panuelo':
      return <Bandana />;
    case 'lazo':
      return <Ribbon />;
    case 'perlas':
      return <Pearls />;
  }
}

/** The accessory, sized to the head box it sits on (position the parent `relative`). */
export function StinkyAccessoryOverlay({
  accessory,
  className,
}: {
  accessory: StinkyAccessory | null | undefined;
  className?: string;
}) {
  if (!accessory) return null;
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      className={className ?? 'pointer-events-none absolute inset-0 h-full w-full'}
    >
      <StinkyAccessoryArt accessory={accessory} />
    </svg>
  );
}
