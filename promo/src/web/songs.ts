import type { GarmentKind } from '../components/Garment';
import { C } from '../theme';

export type LookItem = { kind: GarmentKind; color: string; x: number; y: number; s: number; r: number };

export type Song = {
  title: string;
  artist: string;
  /** Under public/. The songs are NOT in git (copyright): drop the files in public/music/. */
  src: string;
  /** Album cover under public/ (git-ignored like the songs); null shows a mood-coloured placeholder. */
  cover: string | null;
  /** Second of the song this segment starts on. */
  startSec: number;
  durationSec: number;
  /** Mood as the app names it (music.moods in frontend/messages/es.json). */
  mood: string;
  moodColor: string;
  /** Stinky's one-liner: the app's music.oneLiner.<mood>.withArtist template. */
  line: string;
  headline: string;
  /** Badge + subline above the phone. */
  step: string;
  sub: string;
  /** Weather chip shown with the look: weather is always part of the recommendation. */
  weather: string;
  lookTitle: string;
  look: LookItem[];
};

/** Plays under the first half (hook → connect music); its drop lands on "Sí… y no." */
export const INTRO: Pick<Song, 'src' | 'startSec'> = { src: 'music/bad-bunny-eoo.mp3', startSec: 16.4 };

/** Mode 1 ("lo que suena"): one "Suena ahora" scene per song, in order. */
export const SONGS: Song[] = [
  {
    title: "Doin' Time",
    artist: 'Lana Del Rey',
    src: 'music/lana-doin-time.mp3',
    cover: 'covers/lana-doin-time.jpg',
    startSec: 29.8,
    durationSec: 265,
    mood: 'Soñador',
    moodColor: '#C9B8E8',
    line: 'Música soñadora con Lana Del Rey: texturas ligeras y un pastel que flote.',
    headline: 'Soñadora = pastel.',
    step: 'Modo 1 · Lo que suena',
    sub: 'Pilla lo que escuchas en Spotify.',
    weather: '24° · Soleado',
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
    cover: 'covers/barry-b-carolina-durante.jpg',
    startSec: 34,
    durationSec: 206,
    mood: 'Eléctrico',
    moodColor: C.sky,
    line: 'Barry B y Carolina Durante ponen tu música en alto voltaje: contraste, actitud y bigotes de punta.',
    headline: 'Voltaje = contraste.',
    step: 'Cambias de canción…',
    sub: '…y cambia tu look.',
    weather: '17° · Nublado',
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
    cover: 'covers/bad-bunny-eoo.jpg',
    startSec: 47,
    durationSec: 205,
    mood: 'Eufórico',
    moodColor: C.amber,
    line: 'Tu música de hoy suena a subidón con Bad Bunny: Stinky pide color y algo que brille.',
    headline: 'Subidón = color.',
    step: 'Otra más…',
    sub: 'Cada canción, su look.',
    weather: '26° · Soleado',
    lookTitle: 'Perreo a todo color',
    look: [
      { kind: 'shirt', color: C.amber, x: 12, y: 4, s: 190, r: -5 },
      { kind: 'trousers', color: '#FFFFFF', x: 190, y: 14, s: 170, r: 4 },
      { kind: 'sneaker', color: C.pink, x: 20, y: 150, s: 130, r: -8 },
      { kind: 'bag', color: C.mint, x: 170, y: 150, s: 100, r: 10 },
    ],
    },
];

/** Mode 2 ("tú eliges"): typed in the Stylist's "¿Qué escuchas hoy?". Keeps playing to the end. */
export const PICKED: Song = {
  title: 'Sin ti no soy nada',
  artist: 'Amaral',
  src: 'music/amaral-sin-ti.mp3',
  cover: 'covers/amaral-sin-ti.jpg',
  startSec: 39.5,
  durationSec: 263,
  mood: 'Nostálgico',
  moodColor: '#F2B98C',
  line: 'Amaral le da a tu música un aire retro: Stinky rebusca un básico vintage.',
  headline: 'Hoy me siento…',
  step: 'Modo 2 · Tú eliges',
  sub: 'Escribe una canción y Stinky viste a juego.',
  weather: '21° · Soleado',
  lookTitle: 'Vintage de los 2000',
  look: [
    { kind: 'sweater', color: '#C9A227', x: 12, y: 6, s: 190, r: -4 },
    { kind: 'trousers', color: '#7A4E2D', x: 196, y: 16, s: 165, r: 3 },
    { kind: 'sneaker', color: '#FFFFFF', x: 22, y: 160, s: 125, r: -6 },
    { kind: 'bag', color: '#8B5A3C', x: 176, y: 160, s: 95, r: 9 },
  ],
};

/** Same song, but it turns cold and rainy: the look keeps the mood and adds layers. */
export const RAINY = {
  weather: '9° · Lluvia',
  line: 'Sigue sonando a nostalgia, pero llueve y refresca: vintage, sí, y con gabardina encima.',
  lookTitle: 'Vintage bajo la lluvia',
  look: [
    { kind: 'coat', color: '#C8925A', x: 6, y: 2, s: 200, r: -4 },
    { kind: 'sweater', color: '#C9A227', x: 196, y: 6, s: 140, r: 5 },
    { kind: 'trousers', color: '#7A4E2D', x: 214, y: 118, s: 140, r: 3 },
    { kind: 'sneaker', color: C.ink, x: 40, y: 178, s: 115, r: -6 },
  ] as LookItem[],
};
