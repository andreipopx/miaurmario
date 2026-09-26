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
  resolve: {
    alias: {
      '@': frontend,
      // Three pieces of Next that only exist inside Next. Shimming them is what lets
      // a scene mount a whole dialog — the garment editor — rather than a copy of its
      // markup that would drift the first time somebody changed the real one.
      'next/image': path.resolve(here, 'shims/next-image.tsx'),
      'next/navigation': path.resolve(here, 'shims/next-navigation.ts'),
      'next-auth/react': path.resolve(here, 'shims/next-auth.ts'),
    },
  },
  plugins: [react()],
  // Next hands the browser a `process.env`; Vite does not, and the app's API client
  // reads it at module load, so a scene that imports a dialog would die on import.
  define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }) },
  css: { postcss: frontend },
  server: { host: '127.0.0.1', port: 5199, fs: { allow: [frontend] } },
});
