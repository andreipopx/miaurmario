import type { GarmentKind } from '../components/Garment';
import { C } from '../theme';

export type LookItem = { kind: GarmentKind; color: string; x: number; y: number; s: number; r: number };

export type Song = {
  title: string;
  artist: string;
  /** Under public/. The songs are NOT in git (copyright): drop the files in public/music/. */
  src: string;
  /** Second of the song this segment starts on. */
  startSec: number;
  durationSec: number;
  /** Mood as the app names it (music.moods in frontend/messages/es.json). */
  mood: string;
  moodColor: string;
  /** Stinky's one-liner: the app's music.oneLiner.<mood>.withArtist template. */
  line: string;
  headline: string;
  lookTitle: string;
  look: LookItem[];
};

/** Plays under the first half (hook → connect music); its drop lands on "Sí… y no." */
export const INTRO: Pick<Song, 'src' | 'startSec'> = { src: 'music/bad-bunny-eoo.mp3', startSec: 16.4 };

/** One "Suena ahora" scene per song, in order. The last one keeps playing under the outro. */
export const SONGS: Song[] = [
  {
    title: "Doin' Time",
    artist: 'Lana Del Rey',
    src: 'music/lana-doin-time.mp3',
    startSec: 29.8,
    durationSec: 265,
    mood: 'Soñador',
    moodColor: '#C9B8E8',
    line: 'Música soñadora con Lana Del Rey: texturas ligeras y un pastel que flote.',
    headline: 'Soñadora = pastel.',
    lookTitle: 'Verano en cámara lenta',
    look: [
      { kind: 'dress', color: '#BFD9F2', x: 20, y: 6, s: 200, r: -3 },
      { kind: 'bag', color: '#F4E1C1', x: 200, y: 20, s: 120, r: 8 },
      { kind: 'sneaker', color: '#FFFFFF', x: 196, y: 132, s: 130, r: -6 },
    ],
  },
  {
    title: 'Yo pensaba que me había tocado Dios',
    artist: 'Barry B y Carolina Durante',
    src: 'music/barry-b-carolina-durante.mp3',
    startSec: 34,
    durationSec: 206,
    mood: 'Eléctrico',
    moodColor: C.sky,
    line: 'Barry B y Carolina Durante ponen tu música en alto voltaje: contraste, actitud y bigotes de punta.',
    headline: 'Voltaje = contraste.',
    lookTitle: 'Indie con chupa roja',
    look: [
      { kind: 'coat', color: '#D92D3A', x: 10, y: 4, s: 200, r: -4 },
      { kind: 'tee', color: C.ink, x: 196, y: 10, s: 140, r: 6 },
      { kind: 'jeans', color: '#3B5B8C', x: 200, y: 110, s: 150, r: -3 },
    ],
  },
  {
    title: 'EoO',
    artist: 'Bad Bunny',
    src: 'music/bad-bunny-eoo.mp3',
    startSec: 47,
    durationSec: 205,
    mood: 'Eufórico',
    moodColor: C.amber,
    line: 'Tu música de hoy suena a subidón con Bad Bunny: Stinky pide color y algo que brille.',
    headline: 'Subidón = color.',
    lookTitle: 'Perreo a todo color',
    look: [
      { kind: 'shirt', color: C.amber, x: 12, y: 4, s: 190, r: -5 },
      { kind: 'trousers', color: '#FFFFFF', x: 190, y: 14, s: 170, r: 4 },
      { kind: 'sneaker', color: C.pink, x: 20, y: 150, s: 130, r: -8 },
      { kind: 'bag', color: C.mint, x: 170, y: 150, s: 100, r: 10 },
    ],
  },
];
