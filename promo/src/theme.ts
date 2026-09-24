import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

// Same tokens as frontend/app/globals.css ("Stinky pop").
export const C = {
  bg: '#FFFFFF',
  panel: '#F4F4F2',
  border: '#ECECEC',
  ink: '#111111',
  muted: '#6B6B6B',
  pink: '#FF7EB6',
  pinkSoft: '#FFE3EF',
  amber: '#FFB81C',
  sky: '#56C2FF',
  mint: '#3FD99A',
} as const;

export const POP = [C.amber, C.sky, C.pink, C.mint] as const;

// Fonts ship in public/fonts (Google Fonts woff2) so renders never depend on the network.
export const sans = 'Figtree';
export const wordmark = 'Bagel Fat One';

loadFont({ family: sans, url: staticFile('fonts/figtree-latin.woff2'), weight: '400 800' });
loadFont({
  family: sans,
  url: staticFile('fonts/figtree-latin-ext.woff2'),
  weight: '400 800',
  unicodeRange: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+20A0-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
});
loadFont({ family: wordmark, url: staticFile('fonts/bagel-fat-one-latin.woff2') });

export const FPS = 30;
