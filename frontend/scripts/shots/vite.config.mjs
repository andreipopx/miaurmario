/**
 * A tiny Vite app that mounts the real components at phone width, so the
 * screenshots in a review are of the code that ships rather than of a mock-up.
 *
 * It reuses the app's own `@` alias, its PostCSS/Tailwind pipeline and
 * `app/globals.css`, so the tokens, the dark theme and the type scale are the real
 * ones. What it does not have is a backend: the garments are local PNGs and the
 * mutations are stubbed, because the point is to photograph the interface.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..', '..');

export default defineConfig({
  root: here,
  resolve: { alias: { '@': frontend } },
  plugins: [react()],
  css: { postcss: frontend },
  server: { host: '127.0.0.1', port: 5199, fs: { allow: [frontend] } },
});
