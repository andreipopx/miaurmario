import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Music } from 'lucide-react';
import { AppHeader, Dock, u } from '../components/Phone';
import { Stinky } from '../components/Stinky';
import { Headline, PhoneStage, Tap, popStyle, usePop } from '../components/anim';
import { C } from '../theme';
import { Cover, LookCaption, LookPanel, MoodRow, StinkyLine } from './parts';
import { PICKED } from './songs';

const QUERY = 'sin ti no soy';
export const TYPE_FROM = 6;
export const TYPE_TO = 32;
export const SUGGEST = 26;
/** The tap on the suggestion: the song starts playing here. */
export const PICK = 58;
export const LOOK_AT = PICK + 44;

// Layout (phone points) so the taps line up.
const FIELD_Y = 170;
const DROP_Y = FIELD_Y + 52;
const ROW_H = 50;

const SUGGESTIONS = [
  { title: 'Sin ti no soy nada', artist: 'Amaral' },
  { title: 'Días de verano', artist: 'Amaral' },
  { title: 'Moriría por vos', artist: 'Amaral' },
];

export const SongField: React.FC<{ typed?: string; caret?: boolean; picked: boolean; chipP?: number }> = ({ typed = '', caret, picked, chipP = 1 }) => (
  <div
    style={{
      height: u(46),
      borderRadius: 999,
      border: `${u(1.5)}px solid ${picked ? C.border : C.ink}`,
      boxShadow: picked ? 'none' : `0 0 0 ${u(4)}px ${C.pinkSoft}`,
      display: 'flex',
      alignItems: 'center',
      gap: u(8),
      padding: `0 ${u(picked ? 7 : 16)}px`,
      fontSize: u(15),
      background: '#fff',
    }}
  >
    {picked ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: u(6), height: u(32), padding: `0 ${u(12)}px`, borderRadius: 999, background: C.pinkSoft, fontSize: u(13.5), fontWeight: 700, whiteSpace: 'nowrap', ...popStyle(chipP, 0.5), transformOrigin: 'left center' }}>
        {PICKED.cover ? <Cover song={PICKED} size={22} radius={5} /> : <Music size={u(15)} />} {PICKED.title} · {PICKED.artist}
      </div>
    ) : (
      <span style={{ color: typed ? C.ink : C.muted, whiteSpace: 'nowrap' }}>
        {typed || 'Ej: Mitski — My Love Mine All Mine…'}
        {caret ? <span style={{ borderLeft: `${u(2)}px solid ${C.ink}`, marginLeft: 2 }} /> : null}
      </span>
    )}
  </div>
);

export const ManualSong: React.FC = () => {
  const frame = useCurrentFrame();
  const picked = frame >= PICK;
  const typed = QUERY.slice(0, Math.floor(interpolate(frame, [TYPE_FROM, TYPE_TO], [0, QUERY.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
  const drop = usePop(SUGGEST, 16);
  const chipP = usePop(PICK, 10);
  const think = usePop(PICK + 4, 15);
  const mood = usePop(LOOK_AT + 14, 11);
  const caption = usePop(LOOK_AT + 18, 15);
  const s = PICKED;
  return (
    <PhoneStage accent={s.moodColor} headline={<Headline step={s.step} color={s.moodColor} title={s.headline} sub={s.sub} />}>
      <AbsoluteFill style={{ background: C.bg }}>
        <AppHeader />
        <div style={{ position: 'absolute', left: u(16), right: u(16), top: u(112) }}>
          <div style={{ fontSize: u(28), fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>Estilista</div>
          <div style={{ fontSize: u(13.5), fontWeight: 700, color: C.muted, marginTop: u(10) }}>¿Qué escuchas hoy?</div>
        </div>
        <div style={{ position: 'absolute', left: u(16), right: u(16), top: u(FIELD_Y) }}>
          <SongField typed={typed} caret={!picked && frame % 16 < 9} picked={picked} chipP={chipP} />
        </div>
        {!picked ? (
          <div style={{ position: 'absolute', left: u(16), right: u(16), top: u(DROP_Y + 4), fontSize: u(12.5), color: C.muted, lineHeight: 1.35 }}>
            Opcional. El Estilista usará el mood de la canción como capa de inspiración.
          </div>
        ) : null}
        <div style={{ position: 'absolute', left: u(16), right: u(16), top: u(DROP_Y + 50) }}>
          {picked ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: u(12) }}>
              <LookPanel look={s.look} from={LOOK_AT} height={250}>
                {frame < LOOK_AT ? (
                  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: u(22), textAlign: 'center', opacity: think }}>
                    <div style={{ width: u(120), height: u(120), borderRadius: '50%', background: C.pinkSoft }}>
                      <Stinky state="thinking" size={u(120)} from={PICK} />
                    </div>
                    <div style={{ marginTop: u(10), fontSize: u(14.5), color: C.muted, lineHeight: 1.35 }}>
                      Mirando tu armario, el tiempo y lo que suena: <b style={{ color: C.ink }}>{s.title}</b>.
                    </div>
                  </AbsoluteFill>
                ) : null}
              </LookPanel>
              <LookCaption title={s.lookTitle} weather={s.weather} p={caption} />
              <div style={{ opacity: frame >= LOOK_AT + 14 ? 1 : 0 }}>
                <MoodRow song={s} p={mood} />
              </div>
              <StinkyLine text={s.line} from={LOOK_AT + 22} typeFrames={30} />
            </div>
          ) : null}
        </div>
        {frame >= SUGGEST && frame < PICK + 4 ? (
          <div
            style={{
              position: 'absolute',
              left: u(16),
              right: u(16),
              top: u(DROP_Y),
              borderRadius: u(20),
              background: '#fff',
              boxShadow: '0 12px 30px rgba(0,0,0,0.14)',
              border: `1px solid ${C.border}`,
              overflow: 'hidden',
              transformOrigin: 'top center',
              ...popStyle(drop, 0.9),
              zIndex: 20,
            }}
          >
            <div style={{ height: u(30), padding: `0 ${u(14)}px`, display: 'flex', alignItems: 'center', fontSize: u(12), fontWeight: 700, color: C.muted }}>Canciones sugeridas</div>
            {SUGGESTIONS.map((r, i) => (
              <div
                key={r.title}
                style={{
                  height: u(ROW_H),
                  display: 'flex',
                  alignItems: 'center',
                  gap: u(10),
                  padding: `0 ${u(14)}px`,
                  background: i === 0 && frame >= PICK - 6 ? C.pinkSoft : '#fff',
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                {i === 0 ? (
                  <Cover song={PICKED} size={34} />
                ) : (
                  <div style={{ width: u(34), height: u(34), borderRadius: u(8), background: C.panel, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Music size={u(16)} color={C.muted} />
                  </div>
                )}
                <div>
                  <div style={{ fontSize: u(15), fontWeight: 700 }}>{r.title}</div>
                  <div style={{ fontSize: u(12.5), color: C.muted }}>{r.artist}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <Dock active="estilista" />
        <Tap at={PICK} x={u(150)} y={u(DROP_Y + 30 + ROW_H / 2)} />
      </AbsoluteFill>
    </PhoneStage>
  );
};
