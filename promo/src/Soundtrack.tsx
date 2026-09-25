import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';
import { PILE } from './scenes/Hook';
import { SHOT, TAGS } from './scenes/Snap';
import { ITEMS } from './scenes/Wardrobe';
import { READY, WEAR } from './scenes/Stylist';
import { ANSWER_AT, QUESTION, TYPE_END } from './scenes/Chat';
import { LIKE } from './scenes/Friends';

export type Sfx = 'pop' | 'pop-high' | 'thud' | 'whoosh' | 'shutter' | 'tick' | 'key' | 'chime' | 'success' | 'heart' | 'boing' | 'send' | 'purr' | 'chomp';
type Cue = { at: number; sfx: Sfx; volume: number };

/** Scene start frames, in the order of SCENES in Root.tsx. */
export type SceneStarts = { hook: number; brand: number; snap: number; wardrobe: number; stylist: number; chat: number; friends: number; outro: number };

const cues = (s: SceneStarts): Cue[] => {
  const c: Cue[] = [];
  const cue = (at: number, sfx: Sfx, volume = 0.6) => c.push({ at, sfx, volume });

  // Transitions.
  for (const at of [s.brand, s.snap, s.wardrobe, s.stylist, s.chat, s.friends, s.outro]) cue(at - 2, 'whoosh', 0.35);

  // Hook: clothes crash into a pile, the headline pops, Stinky peeks up.
  PILE.forEach((g) => cue(s.hook + g.d + 9, 'thud', 0.5));
  cue(s.hook + 4, 'pop', 0.5);
  cue(s.hook + 22, 'pop', 0.6);
  cue(s.hook + 38, 'boing', 0.5);

  // Brand reveal.
  cue(s.brand + 4, 'pop-high', 0.5);
  cue(s.brand + 16, 'chime', 0.55);

  // Photo + AI tags.
  cue(s.snap + SHOT - 1, 'shutter', 0.8);
  TAGS.forEach((_, i) => cue(s.snap + SHOT + 52 + i * 5, i % 2 ? 'pop-high' : 'pop', 0.4));
  cue(s.snap + SHOT + 52, 'chime', 0.3);

  // Wardrobe tiles.
  ITEMS.forEach((_, i) => cue(s.wardrobe + 8 + i * 4, 'tick', 0.25));

  // El Estilista.
  cue(s.stylist + READY, 'chime', 0.45);
  cue(s.stylist + WEAR, 'pop', 0.5);
  cue(s.stylist + WEAR + 4, 'success', 0.55);

  // Chat: typing, send, answer.
  for (let f = 1; f < TYPE_END; f += Math.max(2, Math.round(TYPE_END / QUESTION.length) * 2)) cue(s.chat + f, 'key', 0.25);
  cue(s.chat + TYPE_END + 4, 'send', 0.5);
  cue(s.chat + ANSWER_AT, 'pop', 0.45);
  cue(s.chat + ANSWER_AT + 16, 'chime', 0.3);

  // Friends: like + comment.
  cue(s.friends + LIKE, 'heart', 0.6);
  cue(s.friends + LIKE + 22, 'pop', 0.4);

  // Outro.
  cue(s.outro + 10, 'pop-high', 0.45);
  return c;
};

export const Soundtrack: React.FC<{ starts: SceneStarts }> = ({ starts }) => (
  <>
    <Audio src={staticFile('audio/music.wav')} volume={0.75} />
    {cues(starts).map((c, i) => (
      <Sequence key={i} from={c.at} durationInFrames={60} layout="none">
        <Audio src={staticFile(`audio/${c.sfx}.wav`)} volume={Math.min(1, c.volume * 1.3)} />
      </Sequence>
    ))}
  </>
);
