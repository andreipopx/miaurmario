import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { ArrowUp, ChevronLeft } from 'lucide-react';
import { Garment, type GarmentKind } from '../components/Garment';
import { Dock, u } from '../components/Phone';
import { Stinky } from '../components/Stinky';
import { FadeUp, Headline, PhoneStage, popStyle, usePop } from '../components/anim';
import { C } from '../theme';

export const QUESTION = '¿Qué me pongo para cenar el viernes?';
const ANSWER = 'Miau. Vaqueros rectos, la camiseta negra y tu gabardina camel. Elegante sin pasarte.';
export const TYPE_END = 40;
export const ANSWER_AT = 78;

const PICK: { kind: GarmentKind; color: string }[] = [
  { kind: 'jeans', color: '#3B5B8C' },
  { kind: 'tee', color: C.ink },
  { kind: 'coat', color: '#C8925A' },
];

export const Chat: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = QUESTION.slice(0, Math.floor((Math.min(frame, TYPE_END) / TYPE_END) * QUESTION.length));
  const sent = frame >= TYPE_END + 4;
  const sentP = usePop(TYPE_END + 4, 14);
  const statusP = usePop(TYPE_END + 12, 14);
  const ansP = usePop(ANSWER_AT, 13);
  const pickP = PICK.map((_, i) => usePop(ANSWER_AT + 16 + i * 5, 11));
  const answerChars = Math.floor(Math.min(1, Math.max(0, (frame - ANSWER_AT) / 34)) * ANSWER.length);
  const status = frame < TYPE_END + 34 ? 'Asomándome a la ventana…' : 'Husmeando en tu armario…';
  const tile = u(104);
  return (
    <PhoneStage accent={C.mint} headline={<Headline step="4 · Habla con Stinky" color={C.mint} title="Pregúntale lo que sea." sub="Tu estilista gatuno, siempre a mano." />}>
      <AbsoluteFill style={{ background: C.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: u(10), padding: `${u(58)}px ${u(16)}px ${u(12)}px`, borderBottom: `1px solid ${C.border}` }}>
          <ChevronLeft size={u(24)} />
          <div style={{ width: u(44), height: u(44), borderRadius: '50%', background: C.pinkSoft, overflow: 'hidden' }}>
            <Stinky state={frame < ANSWER_AT ? 'thinking' : 'idle'} size={u(44)} />
          </div>
          <div>
            <div style={{ fontSize: u(17), fontWeight: 800 }}>Stinky</div>
            <div style={{ fontSize: u(13), color: C.muted, fontWeight: 500 }}>Tu estilista gatuno</div>
          </div>
        </div>
        <div style={{ padding: `${u(16)}px ${u(16)}px`, display: 'flex', flexDirection: 'column', gap: u(12) }}>
          <FadeUp delay={0}>
            <div style={{ alignSelf: 'flex-start', maxWidth: '82%', background: C.panel, borderRadius: u(20), borderBottomLeftRadius: u(6), padding: `${u(12)}px ${u(14)}px`, fontSize: u(15.5), lineHeight: 1.35 }}>
              Miau. ¿Qué nos ponemos hoy?
            </div>
          </FadeUp>
          {sent ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', ...popStyle(sentP, 0.7) }}>
              <div style={{ maxWidth: '78%', background: C.ink, color: '#fff', borderRadius: u(20), borderBottomRightRadius: u(6), padding: `${u(12)}px ${u(14)}px`, fontSize: u(15.5), lineHeight: 1.35 }}>
                {QUESTION}
              </div>
            </div>
          ) : null}
          {sent && frame < ANSWER_AT ? (
            <div style={{ fontSize: u(14), color: C.muted, fontWeight: 600, opacity: statusP, fontStyle: 'italic' }}>{status}</div>
          ) : null}
          {frame >= ANSWER_AT ? (
            <div style={{ ...popStyle(ansP, 0.85), transformOrigin: 'left top' }}>
              <div style={{ maxWidth: '86%', background: C.panel, borderRadius: u(20), borderBottomLeftRadius: u(6), padding: `${u(12)}px ${u(14)}px`, fontSize: u(15.5), lineHeight: 1.35 }}>
                {ANSWER.slice(0, answerChars)}
                <span style={{ opacity: 0 }}>{ANSWER.slice(answerChars)}</span>
              </div>
              <div style={{ display: 'flex', gap: u(8), marginTop: u(10) }}>
                {PICK.map((g, i) => (
                  <div
                    key={g.kind}
                    style={{
                      width: tile,
                      height: tile * 1.15,
                      borderRadius: u(18),
                      background: C.pinkSoft,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      ...popStyle(pickP[i], 0.3),
                    }}
                  >
                    <Garment kind={g.kind} color={g.color} size={tile * 0.82} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div
          style={{
            position: 'absolute',
            left: u(16),
            right: u(16),
            bottom: u(104),
            height: u(50),
            borderRadius: 999,
            border: `${u(1.5)}px solid ${sent ? C.border : C.ink}`,
            display: 'flex',
            alignItems: 'center',
            padding: `0 ${u(6)}px 0 ${u(18)}px`,
            fontSize: u(15),
            color: sent ? C.muted : C.ink,
            boxShadow: sent ? 'none' : `0 0 0 ${u(4)}px ${C.pinkSoft}`,
          }}
        >
          <div style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {sent ? 'Escríbele a Stinky…' : typed}
            {!sent && frame % 16 < 8 ? <span style={{ borderLeft: `${u(2)}px solid ${C.ink}`, marginLeft: 2 }} /> : null}
          </div>
          <div style={{ width: u(38), height: u(38), borderRadius: '50%', background: C.pink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowUp size={u(20)} strokeWidth={2.4} />
          </div>
        </div>
        <Dock active="stinky" />
      </AbsoluteFill>
    </PhoneStage>
  );
};
